-- (e) anon: no write privileges on any table.
--
-- ORDER: VERIFY §0 → curl (before) → this file → VERIFY §A → §B
--        → curl (after), on DEV and then on PROD. Then the smoke list.
-- Safe to re-run: REVOKE is a no-op when already applied.
-- Rollback: VERIFY §E.
-- Grants only. No policy, no table definition, and NO SELECT grant is changed.
--
-- WHY. Supabase's default privileges gave anon EVERY privilege on every table
-- created in public (the audit of 2026-11-17, section F). On 21 tables anon
-- still holds INSERT, UPDATE, DELETE and TRUNCATE. Row-level security blocks
-- the first three today — every write policy ties the row to auth.uid(), and
-- anon has none — so nothing is exploitable now. But it leaves RLS as the ONLY
-- thing between the public anon key and the data: one policy written as
-- `true`, or scoped to {public} by mistake (the notifications INSERT policy
-- was exactly that), and logged-out callers can write. After this, a
-- logged-out write is refused by the grant before any policy is consulted.
-- TRUNCATE is not covered by RLS at all; PostgREST does not expose it, and
-- now anon does not hold it either.
--
-- THE APP NEVER WRITES WHILE LOGGED OUT (checked 2026-11-17/18):
--   * The public routes are /, /explore, /nearby, /provider/:id,
--     /provider/:id/course/:courseId, /auth, /reset-password, /install,
--     /privacy. The only writers reachable from them are favorites, reviews
--     and push subscriptions, and each one stops without a user:
--       useFavorites ........ `if (!user) throw`
--       useReviews .......... ensureLiveSession() before the insert
--       usePushSubscription . `if (!user) return`
--   * Every other write is on a ProtectedRoute / AdminRoute screen or inside
--     a provider dashboard hook.
--   * Edge functions write with the service role; SECURITY DEFINER functions
--     write as their owner. Neither uses anon's grants.
--
-- ONE BEHAVIOUR CHANGE — for a DEAD session only. When supabase-js has no
-- usable token it sends the request with the anon key. Until now:
--     UPDATE / DELETE  → RLS matched nothing → "success", zero rows changed
--     INSERT           → refused by RLS (401, code 42501)
-- From now on all three are refused the same way: HTTP 401, code 42501,
-- "permission denied for table …". isUnauthenticatedWriteError() already
-- treats 42501 + 401 as "the session ended", so the customer flows that use
-- the live-session guard (booking, cancel, reschedule, review) behave as
-- before. A write that did NOT check — a provider-dashboard update sent with a
-- dead session — used to look like it worked while changing nothing; it now
-- returns an error. That is the more honest outcome, and it is the only
-- visible difference.
--
-- THE LIST — the tables on which the audit found anon holding write
-- privileges (PROD, 22 rows; profiles was the 22nd and lost everything in
-- 20261117000005). Missing tables are skipped with a NOTICE (DEV lacks
-- provider_staff_availability and provider_staff_blocked_dates). Tables
-- created by newer migrations (academy_*, course_registrations, recurring_*,
-- waitlist_*, …) already have no anon write grant and are not listed.
-- VERIFY §A2 checks the WHOLE schema, not only this list.
--
-- ALSO REVOKED: REFERENCES and TRIGGER. anon holds them on the same tables;
-- they let a role create foreign keys to, and triggers on, a table. Nothing
-- reachable through the API uses them and anon should hold nothing it does
-- not need. This goes one step beyond the four privileges in the approved
-- list — say so if you want it limited to INSERT/UPDATE/DELETE/TRUNCATE.
--
-- NOT TOUCHED: anon's SELECT. Several of these tables are read by logged-out
-- screens (provider_profiles, provider_services, availability, photos,
-- staff, reviews, package_templates, class schedule). Others are not
-- (bookings, customer_packages, notifications, push_subscriptions, favorites,
-- package_usage_log, user_roles) — anon's SELECT there returns nothing under
-- RLS and could be removed too, but that is a separate decision.
-- authenticated and service_role are not touched at all.

BEGIN;

DO $anon_writes$
DECLARE
  v_tables text[] := ARRAY[
    'bookings', 'customer_packages', 'favorites', 'notifications',
    'package_templates', 'package_usage_log',
    'provider_availability', 'provider_blocked_dates', 'provider_class_schedule',
    'provider_date_overrides', 'provider_photos', 'provider_profiles',
    'provider_services', 'provider_sessions', 'provider_staff',
    'provider_staff_availability', 'provider_staff_blocked_dates',
    'provider_staff_services', 'push_subscriptions', 'reviews', 'user_roles'
  ];
  v_table text;
  v_done  integer := 0;
BEGIN
  FOREACH v_table IN ARRAY v_tables LOOP
    IF to_regclass(format('public.%I', v_table)) IS NULL THEN
      RAISE NOTICE 'SKIPPED — no table public.% on this database', v_table;
      CONTINUE;
    END IF;
    EXECUTE format(
      'REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.%I FROM anon',
      v_table);
    v_done := v_done + 1;
  END LOOP;
  RAISE NOTICE 'anon write privileges revoked on % table(s)', v_done;
END;
$anon_writes$;

COMMIT;
