-- Waiting list — Phase 3b: the customer's join and leave RPCs.
--
-- These are the ONLY way a waiting-list entry is created or ended by a
-- customer. waitlist_entries has no INSERT/UPDATE/DELETE policy (Phase 1), so
-- the client cannot write the table directly; every rule lives here.
--
-- ORDER: VERIFY §0 → this file → §A → §B (DEV only). Then PROD: §0, this file,
-- §A. Safe to apply alone: nothing in the deployed app calls these until 3c.
-- Rollback: VERIFY §E.
--
-- ── waitlist_join ───────────────────────────────────────────────────────────
-- Returns ONE row (entry_id, code). code 'OK' with the new entry's id, or a
-- refusal code with entry_id NULL and nothing written. It never raises for a
-- rule, so the client maps codes to translated copy and never shows raw error
-- text. Checked in this order:
--
--   NOT_CUSTOMER       not signed in, or the caller has a 'provider' or 'admin'
--                      role row. Customer = "not a provider and not an admin",
--                      matching AuthContext; a 'user' row is NOT required (the
--                      live handle_new_user no longer writes one).
--   WAITLIST_OFF       the provider does not exist or waitlist_enabled is false
--   BAD_LANG           p_lang is not he / ar / en
--   NO_WINDOW          none of morning / afternoon / evening chosen
--   DATE_OUT_OF_RANGE  outside Israel today … today + booking_window_days − 1
--                      (the booking page's own calendar range; default 14)
--   SERVICE_INVALID    not this provider's, inactive, a group service, or one
--                      with scheduled sessions (waitlist_is_private_service)
--   STAFF_INVALID      a member was named but the provider has staff off, or
--                      the member is inactive / does not perform the service
--                      (waitlist_staff_performs). NULL = "anyone", always allowed.
--   ALREADY_BOOKED     the caller already holds a confirmed/pending booking with
--                      this provider that day (as booker or linked walk-in) —
--                      housekeeping would mark the entry fulfilled at once
--   ALREADY_ON_LIST    an active entry for this provider and day exists
--   LIMIT_REACHED      5 active entries already, counting only today onward
--                      (a past-dated entry housekeeping has not expired yet
--                      does not count)
--
-- Provider visibility (is_visible) is deliberately NOT checked (ruling
-- 2026-11-03).
--
-- Concurrency: a per-customer transaction advisory lock serialises one
-- customer's joins, so two taps at once cannot both pass the max-5 count. The
-- one-per-day rule is also enforced by waitlist_entries_one_active_per_day;
-- a unique violation is reported as ALREADY_ON_LIST.
--
-- ── waitlist_leave ──────────────────────────────────────────────────────────
-- Returns 'OK' or 'NOT_FOUND'. Sets status 'left' and ended_at on the caller's
-- own entry — never a hard delete. Leaving an entry that has already ended is
-- 'OK' and changes nothing (a double tap is harmless). Someone else's entry,
-- or none, is NOT_FOUND. Leaving and joining again creates a new entry with
-- fresh rounds (accepted 2026-11-03).
--
-- Both are SECURITY DEFINER with a pinned search_path: they write a table the
-- caller cannot, and call the Phase 2 helpers that only service_role may
-- execute. EXECUTE: authenticated only, revoked explicitly from PUBLIC and
-- anon (Supabase's default privileges grant new functions to both).
--
-- DELIBERATELY NOT TOUCHED: every existing function, trigger, table, policy and
-- grant, the dispatcher included.

BEGIN;

CREATE OR REPLACE FUNCTION public.waitlist_join(
  p_provider_id uuid,
  p_entry_date  date,
  p_service_id  uuid,
  p_staff_id    uuid,
  p_morning     boolean,
  p_afternoon   boolean,
  p_evening     boolean,
  p_lang        text
)
RETURNS TABLE (entry_id uuid, code text)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_uid    uuid := auth.uid();
  v_today  date := (now() AT TIME ZONE 'Asia/Jerusalem')::date;
  v_window integer;
  v_staff  boolean;
  v_on     boolean;
  v_id     uuid;
BEGIN
  IF v_uid IS NULL OR EXISTS (
       SELECT 1 FROM public.user_roles r
        WHERE r.user_id = v_uid AND r.role::text IN ('provider', 'admin')) THEN
    RETURN QUERY SELECT NULL::uuid, 'NOT_CUSTOMER'::text; RETURN;
  END IF;

  SELECT p.waitlist_enabled, COALESCE(p.booking_window_days, 14), COALESCE(p.staff_enabled, false)
    INTO v_on, v_window, v_staff
    FROM public.provider_profiles p
   WHERE p.id = p_provider_id;
  IF NOT COALESCE(v_on, false) THEN
    RETURN QUERY SELECT NULL::uuid, 'WAITLIST_OFF'::text; RETURN;
  END IF;

  IF p_lang IS NULL OR p_lang NOT IN ('he', 'ar', 'en') THEN
    RETURN QUERY SELECT NULL::uuid, 'BAD_LANG'::text; RETURN;
  END IF;

  IF NOT (COALESCE(p_morning, false) OR COALESCE(p_afternoon, false) OR COALESCE(p_evening, false)) THEN
    RETURN QUERY SELECT NULL::uuid, 'NO_WINDOW'::text; RETURN;
  END IF;

  IF p_entry_date IS NULL OR p_entry_date < v_today OR p_entry_date > v_today + v_window - 1 THEN
    RETURN QUERY SELECT NULL::uuid, 'DATE_OUT_OF_RANGE'::text; RETURN;
  END IF;

  IF p_service_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.provider_services s
                     WHERE s.id = p_service_id AND s.provider_id = p_provider_id
                       AND COALESCE(s.is_active, true))
     OR NOT public.waitlist_is_private_service(p_provider_id, p_service_id, v_today) THEN
    RETURN QUERY SELECT NULL::uuid, 'SERVICE_INVALID'::text; RETURN;
  END IF;

  IF p_staff_id IS NOT NULL
     AND (NOT v_staff OR NOT public.waitlist_staff_performs(p_provider_id, p_staff_id, p_service_id)) THEN
    RETURN QUERY SELECT NULL::uuid, 'STAFF_INVALID'::text; RETURN;
  END IF;

  -- Everything below reads the caller's own rows; serialise their joins.
  PERFORM pg_advisory_xact_lock(hashtextextended('waitlist_join:' || v_uid::text, 0));

  IF public.waitlist_customer_has_booking(v_uid, p_provider_id, p_entry_date) THEN
    RETURN QUERY SELECT NULL::uuid, 'ALREADY_BOOKED'::text; RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.waitlist_entries w
              WHERE w.user_id = v_uid AND w.provider_id = p_provider_id
                AND w.entry_date = p_entry_date AND w.status = 'active') THEN
    RETURN QUERY SELECT NULL::uuid, 'ALREADY_ON_LIST'::text; RETURN;
  END IF;

  IF (SELECT count(*) FROM public.waitlist_entries w
       WHERE w.user_id = v_uid AND w.status = 'active' AND w.entry_date >= v_today) >= 5 THEN
    RETURN QUERY SELECT NULL::uuid, 'LIMIT_REACHED'::text; RETURN;
  END IF;

  BEGIN
    INSERT INTO public.waitlist_entries (
      user_id, provider_id, entry_date, service_id, staff_id,
      wants_morning, wants_afternoon, wants_evening, notify_lang
    ) VALUES (
      v_uid, p_provider_id, p_entry_date, p_service_id, p_staff_id,
      COALESCE(p_morning, false), COALESCE(p_afternoon, false), COALESCE(p_evening, false), p_lang
    )
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    RETURN QUERY SELECT NULL::uuid, 'ALREADY_ON_LIST'::text; RETURN;
  END;

  RETURN QUERY SELECT v_id, 'OK'::text;
END;
$fn$;

COMMENT ON FUNCTION public.waitlist_join(uuid, date, uuid, uuid, boolean, boolean, boolean, text) IS
  'Customer joins a provider''s waiting list for one day. Returns (entry_id, code): OK or a refusal code; never raises for a rule.';

CREATE OR REPLACE FUNCTION public.waitlist_leave(p_entry_id uuid)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL OR p_entry_id IS NULL THEN
    RETURN 'NOT_FOUND';
  END IF;

  UPDATE public.waitlist_entries
     SET status = 'left', ended_at = now()
   WHERE id = p_entry_id AND user_id = v_uid AND status = 'active';
  IF FOUND THEN
    RETURN 'OK';
  END IF;

  -- Already ended (left, fulfilled, expired, closed): nothing to do.
  IF EXISTS (SELECT 1 FROM public.waitlist_entries WHERE id = p_entry_id AND user_id = v_uid) THEN
    RETURN 'OK';
  END IF;
  RETURN 'NOT_FOUND';
END;
$fn$;

COMMENT ON FUNCTION public.waitlist_leave(uuid) IS
  'Customer leaves their own waiting-list entry (status left, ended_at). Returns OK or NOT_FOUND; never hard-deletes.';

DO $grants$
DECLARE
  fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.waitlist_join(uuid, date, uuid, uuid, boolean, boolean, boolean, text)',
    'public.waitlist_leave(uuid)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', fn);
  END LOOP;
END
$grants$;

COMMIT;
