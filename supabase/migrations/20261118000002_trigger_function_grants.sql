-- (a) Trigger functions: no EXECUTE for PUBLIC, anon or authenticated.
--
-- ORDER: VERIFY §0 → this file → VERIFY §A → §B (DEV only),
--        on DEV and then on PROD.
-- Safe to re-run: REVOKE is a no-op when already applied.
-- Rollback: VERIFY §E.
-- Grants only. No function body and no trigger is changed.
--
-- WHY. 30 SECURITY DEFINER functions were executable by anon (Security
-- Advisor, PROD 2026-11-17); 12 of them are trigger functions that inherited
-- Supabase's default grants, and 7 more trigger functions (SECURITY INVOKER)
-- carry the same grants. A trigger function cannot be called directly —
-- PostgreSQL refuses with "trigger functions can only be called as triggers" —
-- so nothing is exploitable through these grants. This is hygiene: it clears
-- the advisor's list so a real finding is not lost among them, and it makes
-- the live grants say what is true ("nobody calls this").
--
-- WHY IT CANNOT BREAK A TRIGGER. EXECUTE on a trigger function is checked
-- ONCE, when CREATE TRIGGER runs, against the role creating the trigger. When
-- a trigger FIRES, the function is invoked by the executor and the privilege
-- of the role doing the INSERT / UPDATE is not consulted — for SECURITY
-- DEFINER and SECURITY INVOKER trigger functions alike. VERIFY §B proves it on
-- DEV with seven triggers observed firing for an authenticated user who holds
-- no EXECUTE on any of their functions.
--   What IS still checked at fire time: an INVOKER trigger function that
--   calls an ordinary function needs EXECUTE on THAT function. None of the
--   ordinary helpers (booking_time_to_minutes, has_role, …) is touched here.
--
-- THE LIST — the trigger functions from the audit that are open today:
--   SECURITY DEFINER
--     enforce_class_requires_package        enforce_duration_override_permission
--     enforce_package_detach_guard          enforce_staff_enable_no_future_bookings
--     handle_package_booking                handle_package_cancellation
--     handle_package_reschedule             link_walkin_to_account
--     update_provider_average_rating (PROD only)
--     waitlist_capture_freed_slot (PUBLIC already revoked; named grants left)
--     fill_customer_package_template_name (DEV only)
--   SECURITY INVOKER
--     academy_course_sessions_fill_from_course
--     academy_courses_require_active_instructor
--     enforce_booking_approval_status       enforce_booking_lead_time
--     enforce_customer_reschedule           set_updated_at
--     update_class_schedule_updated_at (PROD only)
--
-- DELIBERATELY SKIPPED (ruling 2026-11-17) — these two stay exactly as they
-- are, grants included:
--   handle_new_user ............ creates the profile row on every sign-up.
--   prevent_booking_conflicts .. the double-booking guard; its body also
--                                differs between DEV and PROD.
-- Revoking EXECUTE on a trigger function protects nothing, and these two
-- carry sign-ups and double-bookings: no change, however safe, is worth
-- making to them for a hygiene gain. The advisor will keep listing them;
-- that is expected.
--
-- Already closed, not listed: guard_academy_category_change,
-- guard_booking_series_id, waitlist_close_on_disable.
--
-- SAFETY IN THE LOOP: a name is revoked only if the function it finds really
-- RETURNS trigger. If one of these names ever belongs to an ordinary function,
-- it is left alone and a NOTICE says so. Missing names (DEV lacks some) are
-- skipped with a NOTICE. service_role and the owner are not touched.

BEGIN;

DO $trg_grants$
DECLARE
  v_names text[] := ARRAY[
    'enforce_class_requires_package', 'enforce_duration_override_permission',
    'enforce_package_detach_guard', 'enforce_staff_enable_no_future_bookings',
    'handle_package_booking', 'handle_package_cancellation', 'handle_package_reschedule',
    'link_walkin_to_account', 'update_provider_average_rating',
    'waitlist_capture_freed_slot', 'fill_customer_package_template_name',
    'academy_course_sessions_fill_from_course', 'academy_courses_require_active_instructor',
    'enforce_booking_approval_status', 'enforce_booking_lead_time',
    'enforce_customer_reschedule', 'set_updated_at', 'update_class_schedule_updated_at'
  ];
  v_name  text;
  r       record;
  v_found integer;
  v_done  integer := 0;
BEGIN
  -- Belt and braces: the two skipped functions must never be in the list.
  IF v_names && ARRAY['handle_new_user', 'prevent_booking_conflicts'] THEN
    RAISE EXCEPTION 'handle_new_user / prevent_booking_conflicts must not be in this list';
  END IF;

  FOREACH v_name IN ARRAY v_names LOOP
    v_found := 0;
    FOR r IN
      SELECT p.oid::regprocedure AS fn,
             p.prorettype = 'pg_catalog.trigger'::regtype AS is_trigger
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = v_name
    LOOP
      v_found := v_found + 1;
      IF NOT r.is_trigger THEN
        RAISE NOTICE 'LEFT ALONE — % is not a trigger function on this database', r.fn;
        CONTINUE;
      END IF;
      -- PUBLIC, anon and authenticated BY NAME.
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.fn);
      v_done := v_done + 1;
      RAISE NOTICE 'revoked: %', r.fn;
    END LOOP;
    IF v_found = 0 THEN
      RAISE NOTICE 'SKIPPED — no function named % in public on this database', v_name;
    END IF;
  END LOOP;

  RAISE NOTICE '% trigger function(s) revoked', v_done;
END;
$trg_grants$;

COMMIT;
