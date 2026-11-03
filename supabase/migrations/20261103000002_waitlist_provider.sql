-- Waiting list — Phase 4a: the provider side (switch-off cleanup, counts, list).
--
-- ORDER: VERIFY §0 → this file → §A → §B (DEV only). Then PROD: §0, this file,
-- §A. Safe to apply before the Phase 4 UI ships: the two RPCs have no caller
-- yet, and the trigger only fires when a provider turns the flag off.
-- Rollback: VERIFY §E.
--
-- §1  trg_waitlist_close_on_disable — turning waitlist_enabled OFF closes the
--     provider's active entries silently (status 'closed', ended_at), in the
--     same transaction as the switch save. A trigger rather than an RPC so it
--     covers every way the flag can change (the app, the admin, SQL), and the
--     switch keeps the standard immediate-save update. Turning it back ON does
--     not reopen anything: customers join again.
-- §2  One-off backfill: entries still active at a provider whose flag is
--     already off are closed the same way (VERIFY §0.4 counts them first).
-- §3  waitlist_provider_counts(provider) — active entries per day, today
--     (Israel) onward, for the calendar.
-- §4  waitlist_provider_day(provider, date) — that day's waiting customers:
--     name, phone, service, staff, time windows.
--
-- WHO SEES WHAT. Both RPCs return rows only when the caller OWNS the
-- provider_profiles row they name (user_id = auth.uid()) and it has the
-- waiting list on. The client passes the ACTIVE branch's id, so a multi-branch
-- owner sees the branch they are on. Anyone else — another provider, a
-- customer, anon — gets zero rows, never an error. The customer's phone is
-- therefore only ever returned to the provider of that business. Phone source
-- is the dispatcher's: auth.users.phone (OTP-verified, digits without '+'),
-- else profiles.phone.
--
-- SECURITY DEFINER with a pinned search_path: providers cannot read
-- waitlist_entries, auth.users, or the profiles of customers who never booked
-- with them. EXECUTE: authenticated only, revoked explicitly from PUBLIC and
-- anon. The trigger function is executable by no client role.
--
-- DELIBERATELY NOT TOUCHED: the dispatcher and its functions, every bookings
-- trigger (prevent_booking_conflicts included), every policy and grant on
-- existing tables, and the other provider_profiles triggers.

BEGIN;

-- CREATE TRIGGER on provider_profiles takes SHARE ROW EXCLUSIVE, which queues
-- every provider_profiles write behind it while it waits. Fail fast instead:
-- if the table is busy, nothing changes — just run the file again.
SET LOCAL lock_timeout = '3s';

-- ─────────────────────────────────────────────────────────────────────────────
-- §1. Switching the waiting list off closes its entries
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.waitlist_close_on_disable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  UPDATE public.waitlist_entries
     SET status = 'closed', ended_at = now()
   WHERE provider_id = NEW.id
     AND status = 'active';
  RETURN NULL;
END;
$fn$;

COMMENT ON FUNCTION public.waitlist_close_on_disable() IS
  'AFTER UPDATE trigger on provider_profiles: waitlist_enabled true → false closes that provider''s active waiting-list entries (status closed, ended_at).';

REVOKE ALL ON FUNCTION public.waitlist_close_on_disable() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.waitlist_close_on_disable() FROM anon;
REVOKE ALL ON FUNCTION public.waitlist_close_on_disable() FROM authenticated;

-- UPDATE OF + WHEN: every other provider_profiles update — including saving
-- the flag with its current value — never calls the function.
DROP TRIGGER IF EXISTS trg_waitlist_close_on_disable ON public.provider_profiles;
CREATE TRIGGER trg_waitlist_close_on_disable
  AFTER UPDATE OF waitlist_enabled ON public.provider_profiles
  FOR EACH ROW
  WHEN (OLD.waitlist_enabled IS TRUE AND NEW.waitlist_enabled IS NOT TRUE)
  EXECUTE FUNCTION public.waitlist_close_on_disable();

-- ─────────────────────────────────────────────────────────────────────────────
-- §2. Backfill
-- ─────────────────────────────────────────────────────────────────────────────

UPDATE public.waitlist_entries w
   SET status = 'closed', ended_at = now()
  FROM public.provider_profiles p
 WHERE p.id = w.provider_id
   AND w.status = 'active'
   AND p.waitlist_enabled IS NOT TRUE;

-- ─────────────────────────────────────────────────────────────────────────────
-- §3. waitlist_provider_counts — waiting customers per day
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.waitlist_provider_counts(p_provider_id uuid)
RETURNS TABLE (entry_date date, waiting integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT w.entry_date, count(*)::integer
    FROM public.waitlist_entries w
   WHERE w.provider_id = p_provider_id
     AND w.status = 'active'
     AND w.entry_date >= (now() AT TIME ZONE 'Asia/Jerusalem')::date
     AND EXISTS (SELECT 1 FROM public.provider_profiles p
                  WHERE p.id = p_provider_id
                    AND p.user_id = auth.uid()
                    AND p.waitlist_enabled)
   GROUP BY w.entry_date
   ORDER BY w.entry_date;
$fn$;

COMMENT ON FUNCTION public.waitlist_provider_counts(uuid) IS
  'Provider calendar: active waiting-list entries per day, today onward. Rows only for the caller''s own provider with the waiting list on.';

-- ─────────────────────────────────────────────────────────────────────────────
-- §4. waitlist_provider_day — one day's waiting customers
-- ─────────────────────────────────────────────────────────────────────────────
-- Oldest first (the order they joined). staff_name NULL = "anyone".
-- service_name / staff_name come straight from the rows, active or not: this
-- is what the customer asked for.

CREATE OR REPLACE FUNCTION public.waitlist_provider_day(p_provider_id uuid, p_date date)
RETURNS TABLE (
  entry_id        uuid,
  customer_name   text,
  customer_phone  text,
  service_name    text,
  staff_name      text,
  wants_morning   boolean,
  wants_afternoon boolean,
  wants_evening   boolean,
  created_at      timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT w.id,
         nullif(btrim(pr.display_name), ''),
         coalesce(nullif(btrim(au.phone), ''), nullif(btrim(pr.phone), '')),
         s.name,
         st.name,
         w.wants_morning,
         w.wants_afternoon,
         w.wants_evening,
         w.created_at
    FROM public.waitlist_entries w
    LEFT JOIN public.profiles pr        ON pr.user_id = w.user_id
    LEFT JOIN auth.users au             ON au.id = w.user_id
    LEFT JOIN public.provider_services s ON s.id = w.service_id
    LEFT JOIN public.provider_staff st  ON st.id = w.staff_id
   WHERE w.provider_id = p_provider_id
     AND w.entry_date = p_date
     AND w.status = 'active'
     AND EXISTS (SELECT 1 FROM public.provider_profiles p
                  WHERE p.id = p_provider_id
                    AND p.user_id = auth.uid()
                    AND p.waitlist_enabled)
   ORDER BY w.created_at, w.id;
$fn$;

COMMENT ON FUNCTION public.waitlist_provider_day(uuid, date) IS
  'Provider calendar: one day''s active waiting-list customers with name and phone. Rows only for the caller''s own provider with the waiting list on.';

DO $grants$
DECLARE
  fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.waitlist_provider_counts(uuid)',
    'public.waitlist_provider_day(uuid, date)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', fn);
  END LOOP;
END
$grants$;

COMMIT;
