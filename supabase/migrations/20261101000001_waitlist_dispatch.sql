-- Waiting list — Phase 2: server processing (the RPCs behind waitlist-dispatch).
--
-- Phase 1 (20261017000001_waitlist_schema.sql) fills the waitlist_events outbox
-- on every slot-freeing booking write. This migration adds the SQL half of the
-- consumer: claim events, match them to waiting customers, check the slot is
-- still open, claim a notification round, and housekeeping. The Edge Function
-- supabase/functions/waitlist-dispatch calls these, then sends WhatsApp, the
-- in-app bell and push.
--
-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  ⚠  ORDER                                                                ║
-- ║                                                                          ║
-- ║    1. VERIFY §0 on DEV — read-only pre-checks. Save the output.          ║
-- ║    2. THIS MIGRATION on DEV (§1–§9, one transaction).                    ║
-- ║    3. VERIFY §A, then §B (DEV ONLY), then deploy waitlist-dispatch to    ║
-- ║       DEV with its secrets, then §C (end-to-end, DEV ONLY).              ║
-- ║    4. §10 below — the two cron jobs — on DEV, LAST. Then §A6.            ║
-- ║    5. PROD: §0, this migration, §A, the function + secrets, §10, §A6.    ║
-- ║                                                                          ║
-- ║  Deploy order is SQL → function → cron. The cron calls the function and  ║
-- ║  the function calls these RPCs; any other order is a stream of 404s or   ║
-- ║  "function does not exist" errors every minute.                          ║
-- ║                                                                          ║
-- ║  Safe to apply alone: nothing calls these functions until §10 runs, and  ║
-- ║  with no provider opted in every event is closed as provider_off.        ║
-- ║                                                                          ║
-- ║  Rollback: VERIFY §E.                                                    ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- ── WHAT LIVES WHERE ────────────────────────────────────────────────────────
--   SQL (here): every rule that needs the clock, a lock or another customer's
--     booking — quiet hours, staleness, lead time, the 60-minute spacing, the
--     slot-is-open check and the round claim. Israel wall-clock arithmetic is
--     done with AT TIME ZONE 'Asia/Jerusalem' only, so DST is Postgres's job.
--   TypeScript (the function): the provider's opening hours, via the shared
--     resolver copy (_shared/availabilityResolver.ts) — shop hours, blocked
--     dates, monthly overrides, staff hours and staff time off, the break, the
--     slot grid and latest_start_time. Those rules live in src/lib already and
--     must not be re-implemented in SQL.
--
-- ── "STILL OPEN" MEANS WHAT THE BOOKING PAGE WOULD OFFER ────────────────────
-- The customer taps the WhatsApp button and must find the slot on the page.
-- The page (useAllProviders.getAvailableSlots) is STRICTER than
-- prevent_booking_conflicts in one way that matters here: with a staff member
-- selected, a booking with staff_id NULL blocks that member too, and with no
-- member selected every booking blocks. waitlist_slot_is_open (§5) mirrors the
-- page, which makes it at least as strict as the trigger: we may stay silent
-- about a slot the trigger would accept, never announce one it would reject.
-- VERIFY §B proves the second half against real INSERTs.
--
-- ── CONCURRENCY ─────────────────────────────────────────────────────────────
-- The cron fires every minute and a run can outlast a minute, so runs overlap.
--   * Events: claimed with FOR UPDATE SKIP LOCKED on the selected rows only,
--     plus a 5-minute lease in claimed_at, because each RPC commits on return
--     and the row lock goes with it. The outbox table is never locked as a
--     whole. 3 attempts, then the event is closed as gave_up.
--   * Rounds: waitlist_claim_round locks the ENTRY row and inserts the ledger
--     row in the same transaction. The ledger's UNIQUE (entry, kind) turns any
--     remaining race into 23505 → ALREADY_CLAIMED, and the loser sends nothing.
--   * A run that dies after claiming a round cannot send round 2 for the same
--     slot on retry: the 60-minute spacing rejects it.
--
-- DELIBERATELY NOT TOUCHED:
--   * prevent_booking_conflicts() and every bookings trigger, including the two
--     Phase 1 capture triggers and waitlist_capture_freed_slot(). No existing
--     function is created or replaced (VERIFY §A3 proves it by hash).
--   * whatsapp_send_log. This feature writes waitlist_send_log only.
--   * Existing RLS policies and grants.
--
-- EVERY FUNCTION HERE is SECURITY INVOKER with a pinned search_path, and is
-- executable by service_role only. EXECUTE is revoked from anon and
-- authenticated EXPLICITLY, not just from PUBLIC: Supabase's default privileges
-- grant EXECUTE on new functions to both roles directly, so a PUBLIC revoke
-- alone would leave them callable from the client bundle.

BEGIN;

-- ADD COLUMN on waitlist_entries needs ACCESS EXCLUSIVE on that (small) table.
-- Fail fast rather than queue: just run the migration again.
SET LOCAL lock_timeout = '3s';

-- ─────────────────────────────────────────────────────────────────────────────
-- §1. waitlist_entries.notify_lang — bell and push language
-- ─────────────────────────────────────────────────────────────────────────────
-- Set by the Phase 3 join RPC from the customer's UI language at join time.
-- profiles.preferred_lang is NOT used: the app never writes it (LangContext
-- keeps the language in localStorage) and it defaults to 'he', so it cannot
-- tell a Hebrew speaker from a customer who never chose.
--
-- Resolution, in the function: notify_lang → the provider's
-- whatsapp_message_language → 'he'. WhatsApp itself always follows the
-- provider's language (there is no English template).

ALTER TABLE public.waitlist_entries
  ADD COLUMN IF NOT EXISTS notify_lang text NULL;

ALTER TABLE public.waitlist_entries
  DROP CONSTRAINT IF EXISTS waitlist_entries_notify_lang_check;
ALTER TABLE public.waitlist_entries
  ADD CONSTRAINT waitlist_entries_notify_lang_check
  CHECK (notify_lang IS NULL OR notify_lang IN ('he', 'ar', 'en'));

COMMENT ON COLUMN public.waitlist_entries.notify_lang IS
  'Bell/push language chosen at join time (he|ar|en). NULL = fall back to the provider''s whatsapp_message_language, then he.';

-- ─────────────────────────────────────────────────────────────────────────────
-- §2. Quiet hours (22:00–08:00 Israel time) and event age
-- ─────────────────────────────────────────────────────────────────────────────
-- waitlist_quiet_window(t) describes the MOST RECENT quiet window that started
-- at or before t:
--   is_quiet          t is inside it
--   quiet_started_at  that window's 22:00
--   quiet_ends_at     the 08:00 that ends it (in the past when not quiet)
-- 22:00 and 08:00 exist on every Israeli date (DST switches at 02:00), so the
-- local → instant conversions below are never ambiguous.
--
-- p_now is a parameter so VERIFY §B can test fixed instants; every caller in
-- this file and in the function passes nothing (= now()).

CREATE OR REPLACE FUNCTION public.waitlist_quiet_window(p_now timestamptz DEFAULT now())
RETURNS TABLE (is_quiet boolean, quiet_started_at timestamptz, quiet_ends_at timestamptz)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $fn$
  WITH l AS (SELECT (p_now AT TIME ZONE 'Asia/Jerusalem') AS t)
  SELECT
    (l.t::time >= time '22:00' OR l.t::time < time '08:00'),
    ((CASE WHEN l.t::time >= time '22:00' THEN l.t::date ELSE l.t::date - 1 END)
       + time '22:00') AT TIME ZONE 'Asia/Jerusalem',
    ((CASE WHEN l.t::time >= time '22:00' THEN l.t::date + 1 ELSE l.t::date END)
       + time '08:00') AT TIME ZONE 'Asia/Jerusalem'
  FROM l;
$fn$;

-- One-column wrapper for the cron's guard (§10).
CREATE OR REPLACE FUNCTION public.waitlist_is_quiet_hours(p_now timestamptz DEFAULT now())
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $fn$
  SELECT q.is_quiet FROM public.waitlist_quiet_window(p_now) q;
$fn$;

-- The instant an event's 30-minute freshness is measured from.
--
-- Normally its created_at. An event created during the last quiet window — or
-- in the 30 minutes before it started, which the quiet hold cut short — is
-- measured from that window's 08:00 instead, so a slot freed at 23:00 is
-- re-checked at 08:00 rather than dropped as 9 hours old.
CREATE OR REPLACE FUNCTION public.waitlist_event_age_anchor(
  p_created_at timestamptz,
  p_now timestamptz DEFAULT now()
)
RETURNS timestamptz
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $fn$
  SELECT CASE
           WHEN p_created_at >= q.quiet_started_at - interval '30 minutes'
            AND p_created_at <  q.quiet_ends_at
           THEN q.quiet_ends_at
           ELSE p_created_at
         END
  FROM public.waitlist_quiet_window(p_now) q;
$fn$;

-- ─────────────────────────────────────────────────────────────────────────────
-- §3. Small predicates shared by the matcher, the claim and housekeeping
-- ─────────────────────────────────────────────────────────────────────────────

-- A PRIVATE service in the booking page's sense: exists for this provider, is
-- not a group service, and has no scheduled sessions from p_today on
-- (BookAppointment switches to the sessions flow when a service has any —
-- useProviderSessionsById reads session_date >= today).
CREATE OR REPLACE FUNCTION public.waitlist_is_private_service(
  p_provider_id uuid,
  p_service_id uuid,
  p_today date
)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $fn$
  SELECT EXISTS (
           SELECT 1 FROM public.provider_services ps
            WHERE ps.id = p_service_id
              AND ps.provider_id = p_provider_id
              AND ps.service_type IS DISTINCT FROM 'group'
         )
     AND NOT EXISTS (
           SELECT 1 FROM public.provider_sessions s
            WHERE s.service_id = p_service_id
              AND s.session_date >= p_today
         );
$fn$;

-- The staff member could be picked for this service on the booking page:
-- active, and either has NO provider_staff_services rows (zero rows = performs
-- everything) or has a row for this service. Same rule as
-- src/lib/staffServices.ts eligibleStaffForService.
CREATE OR REPLACE FUNCTION public.waitlist_staff_performs(
  p_provider_id uuid,
  p_staff_id uuid,
  p_service_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $fn$
  SELECT EXISTS (
    SELECT 1
      FROM public.provider_staff st
     WHERE st.id = p_staff_id
       AND st.provider_id = p_provider_id
       AND st.is_active
       AND (
             NOT EXISTS (SELECT 1 FROM public.provider_staff_services x
                          WHERE x.staff_id = st.id)
          OR EXISTS     (SELECT 1 FROM public.provider_staff_services x
                          WHERE x.staff_id = st.id AND x.service_id = p_service_id)
       )
  );
$fn$;

-- The customer already holds a slot with this provider on this date, as the
-- booker or as the account a walk-in was linked to. "Active" = confirmed or
-- pending, the set prevent_booking_conflicts treats as holding a slot.
CREATE OR REPLACE FUNCTION public.waitlist_customer_has_booking(
  p_user_id uuid,
  p_provider_id uuid,
  p_date date
)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $fn$
  SELECT EXISTS (
    SELECT 1
      FROM public.bookings b
     WHERE b.provider_id = p_provider_id
       AND b.booking_date = p_date
       AND b.status IN ('confirmed', 'pending')
       AND (b.user_id = p_user_id OR b.linked_user_id = p_user_id)
  );
$fn$;

-- ─────────────────────────────────────────────────────────────────────────────
-- §4. waitlist_claim_events — close the hopeless, lease the rest
-- ─────────────────────────────────────────────────────────────────────────────
-- Returns nothing at all during quiet hours: events wait, untouched, and the
-- §2 age anchor keeps them fresh until 08:30.
--
-- Step 1 closes, set-based, every unleased event that can never notify anyone,
-- with its reason in outcome:
--   malformed     missing provider/date/time/services, or an unparseable time
--   stale         older than 30 minutes, measured from waitlist_event_age_anchor
--   past          the date is before today (Israel)
--   provider_off  the provider is gone or waitlist_enabled is false
--   group         the freed booking's primary service is a group service or has
--                 scheduled sessions — out of scope
--   gave_up       3 leases expired without the function finishing it
-- Step 2 leases up to p_limit of what is left, oldest first.
--
-- Both steps lock only the rows they select (FOR UPDATE SKIP LOCKED). A row
-- leased by a run that is still working (claimed_at within 5 minutes) is not
-- touched by either step.

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
                               WHERE p.id = e.provider_id AND p.waitlist_enabled)
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
-- §5. waitlist_slot_is_open — would the booking page offer this slot?
-- ─────────────────────────────────────────────────────────────────────────────
-- For a hypothetical booking of p_service_id at p_time on p_date, in staff lane
-- p_staff_id (NULL = no staff), this repeats prevent_booking_conflicts' private
-- branch READ-ONLY:
--   * cross-service overlap blocks, unless BOTH primary services are parallel
--   * same-service overlaps block at COALESCE(max_capacity, 1)
--   * durations are COALESCE(duration_override, NULLIF(SUM(durations),0), 30)
--     on the existing side and COALESCE(NULLIF(duration,0),30) on ours
-- with the booking page's lanes instead of the trigger's:
--   * staff lane X: bookings for X AND bookings with staff_id NULL count
--   * no staff:     every booking counts
-- Class and group bookings are NOT filtered out, exactly like the trigger's
-- private branch, which also counts them as cross-service overlaps.
--
-- Not here, because they are opening-hours questions the function answers with
-- the shared resolver: inside the day's window, not starting in the break,
-- on the slot grid, before latest_start_time.

CREATE OR REPLACE FUNCTION public.waitlist_slot_is_open(
  p_provider_id uuid,
  p_date date,
  p_time text,
  p_service_id uuid,
  p_staff_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $fn$
  WITH svc AS (
    SELECT ps.id,
           COALESCE(NULLIF(ps.duration, 0), 30)  AS dur,
           COALESCE(ps.max_capacity, 1)          AS cap,
           COALESCE(ps.is_parallel, false)       AS par,
           public.booking_time_to_minutes(p_time) AS start_min
      FROM public.provider_services ps
     WHERE ps.id = p_service_id
       AND ps.provider_id = p_provider_id
  ),
  overlapping AS (
    SELECT b.service_ids[1] AS primary_sid
      FROM svc
      JOIN public.bookings b
        ON b.provider_id = p_provider_id
       AND b.booking_date = p_date
       AND b.status IN ('confirmed', 'pending')
      LEFT JOIN LATERAL (
        SELECT COALESCE(b.duration_override, COALESCE(NULLIF(SUM(ps2.duration), 0), 30)) AS dur
          FROM public.provider_services ps2
         WHERE ps2.provider_id = b.provider_id
           AND ps2.id = ANY (b.service_ids)
      ) d ON TRUE
     WHERE svc.start_min < public.booking_time_to_minutes(b.booking_time) + d.dur
       AND public.booking_time_to_minutes(b.booking_time) < svc.start_min + svc.dur
       AND (p_staff_id IS NULL OR b.staff_id = p_staff_id OR b.staff_id IS NULL)
  )
  SELECT EXISTS (SELECT 1 FROM svc)
     AND NOT EXISTS (
           SELECT 1
             FROM overlapping o, svc
            WHERE o.primary_sid IS DISTINCT FROM svc.id
              AND NOT (
                    svc.par
                AND COALESCE((SELECT ps3.is_parallel FROM public.provider_services ps3
                               WHERE ps3.provider_id = p_provider_id
                                 AND ps3.id = o.primary_sid), false)
              )
         )
     AND (SELECT count(*) FROM overlapping o, svc WHERE o.primary_sid = svc.id)
         < (SELECT cap FROM svc);
$fn$;

-- ─────────────────────────────────────────────────────────────────────────────
-- §6. waitlist_candidates — every (entry, event) pair worth checking
-- ─────────────────────────────────────────────────────────────────────────────
-- For the events the caller leased, every active entry that matches on ALL of:
--   * same provider and date; provider still opted in
--   * the freed start falls in one of the entry's windows (Israel wall clock):
--       morning < 12:00 <= afternoon < 17:00 <= evening
--   * the entry's service is private and active, and its duration <= the freed booking's
--     COALESCE(duration_override, NULLIF(SUM(service durations),0), 30)
--   * staff:
--       entry names a member  → the freed booking was that member's, and they
--                               can still be picked for the service
--       entry says "anyone"   → the freed booking's member can be picked for
--                               the service; or, when the freed booking had NO
--                               member, the service is on the zero-staff path
--                               (staff disabled, or nobody eligible) — the only
--                               way a customer's new booking would be NULL too
--     Any staff lane also requires staff_enabled: without it the booking page
--     has no staff step and inserts staff_id NULL.
--   * the start is at least min_lead_time_minutes away (Israel time)
--   * fewer than 2 rounds so far, the last one at least 60 minutes ago
--   * the customer holds no active booking with this provider on that date
-- staff_lane is the lane the slot-open check and the resolver must use.
--
-- The slot-open check is NOT applied here: waitlist_claim_round runs it at the
-- moment of the claim, which is the only time the answer is worth anything.

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
-- §7. waitlist_claim_round — the last gate, and the claim, in one transaction
-- ─────────────────────────────────────────────────────────────────────────────
-- Called immediately before any channel sends. Locks the entry row, re-checks
-- everything that can have changed since waitlist_candidates — including the
-- slot itself — and only then inserts the ledger row and advances the entry.
-- Returns (log_id, NULL) on success, or (NULL, reason) and changes nothing:
--   ENTRY_GONE ENTRY_INACTIVE ROUND_MISMATCH TOO_SOON QUIET_HOURS PROVIDER_OFF
--   TOO_LATE ALREADY_BOOKED SLOT_TAKEN ALREADY_CLAIMED
--
-- p_whatsapp_skip: NULL = WhatsApp will be attempted, so the row starts at
-- 'sending'. A code (INVALID_PHONE, NO_NAME, …) = WhatsApp is not attempted;
-- the row is written 'skipped' with that code, and bell + push still go out on
-- this claim.

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

  SELECT p.waitlist_enabled, COALESCE(p.min_lead_time_minutes, 15)
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
-- §8. waitlist_housekeeping
-- ─────────────────────────────────────────────────────────────────────────────
-- Called by the function at the start of every run, AND by its own SQL-only
-- cron every 15 minutes (§10): the dispatch cron fires only when events exist,
-- and expiry must not wait for a cancellation (Phase 3's max-5 cap counts
-- active entries).
--   expired    active entries dated before today (Israel)
--   fulfilled  active entries whose customer now holds an active booking with
--              that provider on that date (user_id or linked_user_id)
--   purged     outbox rows processed more than 30 days ago

CREATE OR REPLACE FUNCTION public.waitlist_housekeeping()
RETURNS TABLE (expired integer, fulfilled integer, purged integer)
LANGUAGE plpgsql
VOLATILE
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Jerusalem')::date;
BEGIN
  UPDATE public.waitlist_entries
     SET status = 'expired', ended_at = now()
   WHERE status = 'active'
     AND entry_date < v_today;
  GET DIAGNOSTICS expired = ROW_COUNT;

  UPDATE public.waitlist_entries w
     SET status = 'fulfilled', ended_at = now()
   WHERE w.status = 'active'
     AND public.waitlist_customer_has_booking(w.user_id, w.provider_id, w.entry_date);
  GET DIAGNOSTICS fulfilled = ROW_COUNT;

  DELETE FROM public.waitlist_events
   WHERE processed_at IS NOT NULL
     AND processed_at < now() - interval '30 days';
  GET DIAGNOSTICS purged = ROW_COUNT;

  RETURN NEXT;
END;
$fn$;

-- ─────────────────────────────────────────────────────────────────────────────
-- §9. Grants — service_role only
-- ─────────────────────────────────────────────────────────────────────────────

DO $grants$
DECLARE
  fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.waitlist_quiet_window(timestamptz)',
    'public.waitlist_is_quiet_hours(timestamptz)',
    'public.waitlist_event_age_anchor(timestamptz, timestamptz)',
    'public.waitlist_is_private_service(uuid, uuid, date)',
    'public.waitlist_staff_performs(uuid, uuid, uuid)',
    'public.waitlist_customer_has_booking(uuid, uuid, date)',
    'public.waitlist_claim_events(integer)',
    'public.waitlist_slot_is_open(uuid, date, text, uuid, uuid)',
    'public.waitlist_candidates(bigint[])',
    'public.waitlist_claim_round(uuid, smallint, bigint, uuid, text, uuid, text, text, text, text)',
    'public.waitlist_housekeeping()'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
  END LOOP;
END
$grants$;

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────────
-- §10. Cron — RUN SEPARATELY, LAST: after the function is deployed with its
--      secrets and §C has passed on that project.
-- ─────────────────────────────────────────────────────────────────────────────
-- ⚠  Each statement is ONE LINE and an ORDINARY string literal (quotes doubled),
--    never a $cron$ dollar-quoted block, and headers are built with
--    jsonb_build_object. booking-reminder-every-15min has never run because its
--    command carried CRLF line endings into the headers JSON. After scheduling,
--    VERIFY §A6 checks the stored commands for CR and MUST pass.
--
-- Replace <REF> (aqlcjjrgsxispdjwrnqf on PROD, ovpfljqlfzxjfcbrtwra on DEV),
-- <ANON_KEY> (that project's anon key) and <CRON_SECRET> (that project's
-- CRON_SECRET secret).
--
-- The dispatch job posts only when there is an unprocessed event AND it is not
-- quiet hours, so an idle minute costs one indexed EXISTS and no HTTP call.
--
-- SELECT cron.schedule('waitlist-dispatch-1min', '* * * * *', 'SELECT net.http_post(url := ''https://<REF>.supabase.co/functions/v1/waitlist-dispatch'', headers := jsonb_build_object(''Content-Type'', ''application/json'', ''Authorization'', ''Bearer <ANON_KEY>'', ''x-cron-secret'', ''<CRON_SECRET>''), body := ''{}''::jsonb) WHERE EXISTS (SELECT 1 FROM public.waitlist_events WHERE processed_at IS NULL) AND NOT public.waitlist_is_quiet_hours()');
-- SELECT cron.schedule('waitlist-housekeeping-15min', '*/15 * * * *', 'SELECT public.waitlist_housekeeping()');
--
-- Kill switches (instant, no deploy):
--   SELECT cron.unschedule('waitlist-dispatch-1min');
--   SELECT cron.unschedule('waitlist-housekeeping-15min');
-- Or, keeping the cron: empty WHATSAPP_WAITLIST_PHONES = nothing to anyone.
