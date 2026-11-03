-- Waiting list — Phase 3a: never notify about a provider customers cannot see.
--
-- The admin's "hide provider" switch sets provider_profiles.is_visible = false.
-- A hidden provider is missing from useAllProviders (.eq("is_visible", true)),
-- so /provider/:id shows "not available" and /provider/:id/book shows "not
-- found". Until this migration the dispatcher only checked waitlist_enabled,
-- so a hidden provider that had opted in could still send a WhatsApp button,
-- bell and push pointing at that dead page.
--
-- "Available to customers" = the provider row exists AND is_visible IS TRUE.
-- That is the dispatcher's provider gate from now on, in all three places it
-- checks the provider:
--
--   waitlist_claim_events   the event is closed with outcome 'provider_off'
--   waitlist_candidates     the provider's entries never become candidates
--   waitlist_claim_round    returns the existing reason 'PROVIDER_OFF' — the
--                           deployed waitlist-dispatch already handles it, so
--                           NO FUNCTION REDEPLOY is needed for this change
--
-- Entries at a hidden provider stay ACTIVE (ruling 5, 2026-11-03): hiding is
-- often temporary. While hidden they are simply never matched; once the admin
-- shows the provider again they match new cancellations as before. Events
-- that arrive while the provider is hidden are closed and not replayed.
--
-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  ⚠  ORDER                                                                ║
-- ║                                                                          ║
-- ║    1. VERIFY §0 on DEV. 0.1 MUST show all three "matches" = true: it     ║
-- ║       proves the live bodies are exactly the Phase 2 file's, so this     ║
-- ║       file replaces what we think it replaces. If any is false, STOP.    ║
-- ║    2. THIS MIGRATION on DEV.                                             ║
-- ║    3. VERIFY §A, then §B (DEV ONLY).                                     ║
-- ║    4. PROD: §0, this migration, §A. Then §C (optional, PROD, Test1).     ║
-- ║                                                                          ║
-- ║  Safe to apply while the cron runs: each CREATE OR REPLACE is atomic,    ║
-- ║  and a dispatcher run that straddles the commit sees either the old or  ║
-- ║  the new body of each function — both are valid.                         ║
-- ║                                                                          ║
-- ║  Rollback: VERIFY §E.                                                    ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- ── WHAT CHANGES, EXACTLY ───────────────────────────────────────────────────
-- Each function below is the Phase 2 body (20261101000001_waitlist_dispatch.sql
-- §4, §6, §7), copied byte for byte, with ONE insertion each:
--
--   waitlist_claim_events  in the 'provider_off' test, after
--                            "WHERE p.id = e.provider_id AND p.waitlist_enabled"
--                          a new line  "AND p.is_visible IS TRUE"
--   waitlist_candidates    in the provider_profiles join, after
--                            "AND p.waitlist_enabled"
--                          a new line  "AND p.is_visible IS TRUE"
--   waitlist_claim_round   "SELECT p.waitlist_enabled" becomes
--                          "SELECT p.waitlist_enabled AND p.is_visible IS TRUE"
--
-- VERIFY §A1 proves it: deleting the inserted text from each new body gives
-- back the Phase 2 body's md5. Signatures, volatility, SECURITY INVOKER,
-- search_path and grants are unchanged (CREATE OR REPLACE keeps the ACL; §9
-- below re-asserts it anyway).
--
-- IS TRUE rather than plain is_visible: the column is NOT NULL DEFAULT true
-- (20260531000001), so the two are equivalent today; IS TRUE keeps a NULL
-- from ever reading as "visible" if that constraint is ever dropped.
--
-- DELIBERATELY NOT TOUCHED:
--   * prevent_booking_conflicts() and every bookings trigger, including the two
--     Phase 1 capture triggers and waitlist_capture_freed_slot().
--   * The other eight Phase 2 functions (VERIFY §A3 proves it by hash).
--   * waitlist_housekeeping: it does not close entries at hidden providers, by
--     ruling 5.
--   * Every table, policy and grant other than EXECUTE on these three.

BEGIN;

-- CREATE OR REPLACE FUNCTION takes no lock on any table; this only bounds a
-- wait on a concurrent DDL. Fail fast and just run the file again.
SET LOCAL lock_timeout = '3s';

-- ─────────────────────────────────────────────────────────────────────────────
-- §1. waitlist_claim_events — a hidden provider closes the event as provider_off
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.waitlist_claim_events(p_limit integer DEFAULT 50)
RETURNS SETOF public.waitlist_events
LANGUAGE plpgsql
VOLATILE
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_now   timestamptz := now();
  v_today date := (now() AT TIME ZONE 'Asia/Jerusalem')::date;
BEGIN
  IF public.waitlist_is_quiet_hours(v_now) THEN
    RETURN;
  END IF;

  -- Step 1: close. The 1000-row cap bounds one run's work; the remainder is
  -- closed by the next run.
  WITH candidate AS (
    SELECT e.id
      FROM public.waitlist_events e
     WHERE e.processed_at IS NULL
       AND (e.claimed_at IS NULL OR e.claimed_at < v_now - interval '5 minutes')
     ORDER BY e.id
     LIMIT 1000
     FOR UPDATE SKIP LOCKED
  ),
  judged AS (
    SELECT e.id,
           CASE
             WHEN e.provider_id IS NULL
               OR e.booking_date IS NULL
               OR e.booking_time IS NULL
               OR e.booking_time !~ '^[0-9]{1,2}:[0-9]{2}'
               OR e.service_ids IS NULL
               OR cardinality(e.service_ids) = 0
               THEN 'malformed'
             WHEN public.waitlist_event_age_anchor(e.created_at, v_now) < v_now - interval '30 minutes'
               THEN 'stale'
             WHEN e.booking_date < v_today
               THEN 'past'
             WHEN NOT EXISTS (SELECT 1 FROM public.provider_profiles p
                               WHERE p.id = e.provider_id AND p.waitlist_enabled
                                 AND p.is_visible IS TRUE)
               THEN 'provider_off'
             WHEN EXISTS (SELECT 1 FROM public.provider_services ps
                           WHERE ps.id = e.service_ids[1] AND ps.provider_id = e.provider_id)
              AND NOT public.waitlist_is_private_service(e.provider_id, e.service_ids[1], v_today)
               THEN 'group'
             WHEN e.attempts >= 3
               THEN 'gave_up'
           END AS outcome
      FROM public.waitlist_events e
      JOIN candidate c ON c.id = e.id
  )
  UPDATE public.waitlist_events e
     SET processed_at = v_now,
         outcome      = j.outcome
    FROM judged j
   WHERE e.id = j.id
     AND j.outcome IS NOT NULL;

  -- Step 2: lease. Rows closed in step 1 are processed now and drop out.
  RETURN QUERY
  WITH c AS (
    SELECT e.id
      FROM public.waitlist_events e
     WHERE e.processed_at IS NULL
       AND (e.claimed_at IS NULL OR e.claimed_at < v_now - interval '5 minutes')
     ORDER BY e.id
     LIMIT greatest(coalesce(p_limit, 0), 0)
     FOR UPDATE SKIP LOCKED
  )
  UPDATE public.waitlist_events e
     SET claimed_at = v_now,
         attempts   = e.attempts + 1
    FROM c
   WHERE e.id = c.id
  RETURNING e.*;
END;
$fn$;

-- ─────────────────────────────────────────────────────────────────────────────
-- §2. waitlist_candidates — a hidden provider has no candidates
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.waitlist_candidates(p_event_ids bigint[])
RETURNS TABLE (
  entry_id          uuid,
  user_id           uuid,
  event_id          bigint,
  freed_booking_id  uuid,
  provider_id       uuid,
  slot_date         date,
  slot_time         text,
  staff_lane        uuid,
  service_id        uuid,
  service_duration  integer,
  latest_start_time text,
  next_round        smallint,
  notify_lang       text
)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $fn$
  WITH ev AS (
    SELECT e.id,
           e.booking_id,
           e.provider_id,
           e.booking_date,
           e.staff_id,
           public.booking_time_to_minutes(e.booking_time) AS start_min,
           COALESCE(
             e.duration_override,
             (SELECT NULLIF(SUM(ps.duration), 0)
                FROM public.provider_services ps
               WHERE ps.provider_id = e.provider_id
                 AND ps.id = ANY (e.service_ids)),
             30
           ) AS freed_duration
      FROM public.waitlist_events e
     WHERE e.id = ANY (p_event_ids)
       AND e.processed_at IS NULL
       AND e.booking_time ~ '^[0-9]{1,2}:[0-9]{2}'
  ),
  today AS (SELECT (now() AT TIME ZONE 'Asia/Jerusalem')::date AS d)
  SELECT w.id,
         w.user_id,
         ev.id,
         ev.booking_id,
         ev.provider_id,
         ev.booking_date,
         -- Normalised HH:MM, whatever padding the stored text had.
         lpad((ev.start_min / 60)::text, 2, '0') || ':' || lpad((ev.start_min % 60)::text, 2, '0'),
         ev.staff_id,
         w.service_id,
         COALESCE(NULLIF(s.duration, 0), 30)::integer,
         -- ::text because no migration in this repo creates the column (VERIFY
         -- §0.6 records its live type); text and time both cast cleanly.
         s.latest_start_time::text,
         (w.notify_count + 1)::smallint,
         w.notify_lang
    FROM ev
    CROSS JOIN today
    JOIN public.provider_profiles p
      ON p.id = ev.provider_id
     AND p.waitlist_enabled
     AND p.is_visible IS TRUE
    JOIN public.waitlist_entries w
      ON w.provider_id = ev.provider_id
     AND w.entry_date = ev.booking_date
     AND w.status = 'active'
    JOIN public.provider_services s
      ON s.id = w.service_id
     AND s.provider_id = w.provider_id
   WHERE (   (w.wants_morning   AND ev.start_min < 720)
          OR (w.wants_afternoon AND ev.start_min >= 720 AND ev.start_min < 1020)
          OR (w.wants_evening   AND ev.start_min >= 1020))
     AND public.waitlist_is_private_service(w.provider_id, w.service_id, today.d)
     -- The booking page lists active services only (useAllProviders filters
     -- s.is_active), so a deactivated service cannot be booked from the link.
     AND COALESCE(s.is_active, true)
     AND COALESCE(NULLIF(s.duration, 0), 30) <= ev.freed_duration
     AND (
           -- a named member: their own lane only
           (    w.staff_id IS NOT NULL
            AND ev.staff_id = w.staff_id
            AND COALESCE(p.staff_enabled, false)
            AND public.waitlist_staff_performs(w.provider_id, w.staff_id, w.service_id))
           -- "anyone", freed booking had a member
        OR (    w.staff_id IS NULL
            AND ev.staff_id IS NOT NULL
            AND COALESCE(p.staff_enabled, false)
            AND public.waitlist_staff_performs(w.provider_id, ev.staff_id, w.service_id))
           -- "anyone", freed booking had no member: the zero-staff path only
        OR (    w.staff_id IS NULL
            AND ev.staff_id IS NULL
            AND (   NOT COALESCE(p.staff_enabled, false)
                 OR NOT EXISTS (
                      SELECT 1 FROM public.provider_staff st
                       WHERE st.provider_id = w.provider_id
                         AND public.waitlist_staff_performs(w.provider_id, st.id, w.service_id))))
         )
     AND ((ev.booking_date + make_interval(mins => ev.start_min)) AT TIME ZONE 'Asia/Jerusalem')
         >= now() + make_interval(mins => COALESCE(p.min_lead_time_minutes, 15))
     AND w.notify_count < 2
     AND (w.last_notified_at IS NULL OR w.last_notified_at <= now() - interval '60 minutes')
     AND NOT public.waitlist_customer_has_booking(w.user_id, w.provider_id, w.entry_date);
$fn$;

-- ─────────────────────────────────────────────────────────────────────────────
-- §3. waitlist_claim_round — a hidden provider returns PROVIDER_OFF
-- ─────────────────────────────────────────────────────────────────────────────
-- Re-checked at the moment of the claim, so a provider hidden between
-- waitlist_candidates and the send still sends nothing on any channel.

CREATE OR REPLACE FUNCTION public.waitlist_claim_round(
  p_entry_id         uuid,
  p_round            smallint,
  p_event_id         bigint,
  p_freed_booking_id uuid,
  p_slot_time        text,
  p_staff_lane       uuid,
  p_phone_digits     text,
  p_template_name    text,
  p_language_code    text,
  p_whatsapp_skip    text DEFAULT NULL
)
RETURNS TABLE (log_id uuid, reason text)
LANGUAGE plpgsql
VOLATILE
SET search_path = public, pg_temp
AS $fn$
DECLARE
  w     public.waitlist_entries%ROWTYPE;
  v_lead integer;
  v_on   boolean;
  v_log  uuid;
BEGIN
  SELECT * INTO w FROM public.waitlist_entries WHERE id = p_entry_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT NULL::uuid, 'ENTRY_GONE'::text; RETURN;
  END IF;
  IF w.status <> 'active' THEN
    RETURN QUERY SELECT NULL::uuid, 'ENTRY_INACTIVE'::text; RETURN;
  END IF;
  IF p_round IS NULL OR p_round NOT IN (1, 2) OR w.notify_count <> p_round - 1 THEN
    RETURN QUERY SELECT NULL::uuid, 'ROUND_MISMATCH'::text; RETURN;
  END IF;
  IF w.last_notified_at IS NOT NULL AND w.last_notified_at > now() - interval '60 minutes' THEN
    RETURN QUERY SELECT NULL::uuid, 'TOO_SOON'::text; RETURN;
  END IF;
  IF public.waitlist_is_quiet_hours() THEN
    RETURN QUERY SELECT NULL::uuid, 'QUIET_HOURS'::text; RETURN;
  END IF;

  SELECT p.waitlist_enabled AND p.is_visible IS TRUE, COALESCE(p.min_lead_time_minutes, 15)
    INTO v_on, v_lead
    FROM public.provider_profiles p
   WHERE p.id = w.provider_id;
  IF NOT COALESCE(v_on, false) THEN
    RETURN QUERY SELECT NULL::uuid, 'PROVIDER_OFF'::text; RETURN;
  END IF;

  IF ((w.entry_date + make_interval(mins => public.booking_time_to_minutes(p_slot_time)))
        AT TIME ZONE 'Asia/Jerusalem') < now() + make_interval(mins => v_lead) THEN
    RETURN QUERY SELECT NULL::uuid, 'TOO_LATE'::text; RETURN;
  END IF;

  IF public.waitlist_customer_has_booking(w.user_id, w.provider_id, w.entry_date) THEN
    RETURN QUERY SELECT NULL::uuid, 'ALREADY_BOOKED'::text; RETURN;
  END IF;

  IF NOT public.waitlist_slot_is_open(w.provider_id, w.entry_date, p_slot_time, w.service_id, p_staff_lane) THEN
    RETURN QUERY SELECT NULL::uuid, 'SLOT_TAKEN'::text; RETURN;
  END IF;

  BEGIN
    INSERT INTO public.waitlist_send_log (
      waitlist_entry_id, message_kind, provider_id, event_id, freed_booking_id,
      slot_date, slot_time, phone_digits, template_name, language_code,
      status, error_code
    ) VALUES (
      w.id, 'waitlist_slot:' || p_round, w.provider_id, p_event_id, p_freed_booking_id,
      w.entry_date, p_slot_time, p_phone_digits, p_template_name, p_language_code,
      CASE WHEN p_whatsapp_skip IS NULL THEN 'sending' ELSE 'skipped' END,
      p_whatsapp_skip
    )
    RETURNING id INTO v_log;
  EXCEPTION WHEN unique_violation THEN
    RETURN QUERY SELECT NULL::uuid, 'ALREADY_CLAIMED'::text; RETURN;
  END;

  UPDATE public.waitlist_entries
     SET notify_count     = p_round,
         last_notified_at = now()
   WHERE id = w.id;

  RETURN QUERY SELECT v_log, NULL::text;
END;
$fn$;

-- ─────────────────────────────────────────────────────────────────────────────
-- §4. Grants — unchanged (service_role only), re-asserted
-- ─────────────────────────────────────────────────────────────────────────────

DO $grants$
DECLARE
  fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.waitlist_claim_events(integer)',
    'public.waitlist_candidates(bigint[])',
    'public.waitlist_claim_round(uuid, smallint, bigint, uuid, text, uuid, text, text, text, text)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
  END LOOP;
END
$grants$;

COMMIT;
