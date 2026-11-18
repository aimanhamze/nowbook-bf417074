-- (c) Pin search_path on the five functions that have none.
--
-- ORDER: VERIFY §0 → this file → VERIFY §A → §B (DEV only),
--        on DEV and then on PROD.
-- Safe to re-run: ALTER FUNCTION ... SET is idempotent.
-- Rollback: VERIFY §E.
-- NO BODY IS CHANGED. Only the function-level setting is added; VERIFY §0/§A
-- compare md5(prosrc) before and after to prove it.
--
-- THE FIVE (Security Advisor: function_search_path_mutable, PROD 2026-11-17):
--   get_slot_capacity(uuid, date, text, uuid)   SECURITY DEFINER
--   update_provider_average_rating()            SECURITY DEFINER, trigger
--   set_updated_at()                            trigger (many tables)
--   update_class_schedule_updated_at()          trigger
--   booking_time_to_minutes(text)               called by the conflict logic
--
-- WHY. A function without its own search_path resolves every unqualified
-- name through the CALLER's search_path. For a SECURITY DEFINER function that
-- is the classic privilege-escalation path: a caller who can put a schema in
-- front of public decides which "bookings" the function reads with the
-- owner's rights. The two definer functions here are the ones that matter;
-- the other three are pinned so the advisor is clean and they behave the same
-- no matter who calls them.
--
-- WHY public, pg_temp AND NOT ''. get_slot_capacity's body names
-- provider_services and bookings WITHOUT a schema (see the definition
-- below), so search_path = '' would break it. "public, pg_temp" keeps every
-- name resolving exactly where it resolves today and puts pg_temp LAST, so a
-- temporary object can never shadow a real one.
--
-- ONE SIDE EFFECT, ACCEPTED. booking_time_to_minutes is a one-line SQL
-- function; a SQL function with a SET clause is no longer inlined into the
-- calling query. It is called a handful of times per booking write inside
-- plpgsql trigger code (where it was never inlined), so nothing measurable
-- changes. VERIFY §0b shows whether any index or constraint uses it.
-- (The repo's own definition, 20260328194531, already carries
-- SET search_path = public; PROD's does not — drift this file ends.)
--
-- BY NAME, EVERY OVERLOAD, MISSING ONES SKIPPED. DEV does not have
-- update_provider_average_rating or update_class_schedule_updated_at; the
-- loop raises a NOTICE for a name it does not find and carries on.
--
-- ───────────────────────────────────────────────────────────────────────────
-- RECORD — three functions that exist on PROD and in NO earlier migration.
-- Copied verbatim from pg_get_functiondef on PROD, 2026-11-17, so the repo
-- matches the live database. They are a RECORD ONLY: nothing below creates or
-- replaces them (that would also create them on DEV, which is the parity
-- ticket's job, not this commit's). After this migration each of them also
-- carries:  SET search_path TO 'public', 'pg_temp'
--
--   CREATE OR REPLACE FUNCTION public.get_slot_capacity(p_provider_id uuid, p_date date, p_time text, p_service_id uuid)
--    RETURNS TABLE(max_capacity integer, booked_count bigint, available_spots integer, is_full boolean)
--    LANGUAGE plpgsql
--    SECURITY DEFINER
--   AS $function$
--   DECLARE
--     v_max_capacity integer;
--     v_booked_count bigint;
--   BEGIN
--     SELECT ps.max_capacity INTO v_max_capacity
--     FROM provider_services ps
--     WHERE ps.id = p_service_id;
--     v_max_capacity := COALESCE(v_max_capacity, 1);
--
--     SELECT COUNT(*) INTO v_booked_count
--     FROM bookings b
--     WHERE b.provider_id  = p_provider_id
--       AND b.booking_date = p_date
--       AND b.booking_time = p_time
--       AND b.status IN ('confirmed', 'pending');
--
--     RETURN QUERY SELECT
--       v_max_capacity,
--       v_booked_count,
--       GREATEST(0, v_max_capacity - v_booked_count::integer)::integer,
--       v_booked_count >= v_max_capacity;
--   END;
--   $function$
--   -- Grants: service_role only since 20261117000006. Not called by the app.
--
--   CREATE OR REPLACE FUNCTION public.update_class_schedule_updated_at()
--    RETURNS trigger
--    LANGUAGE plpgsql
--   AS $function$
--   BEGIN
--     NEW.updated_at = now();
--     RETURN NEW;
--   END;
--   $function$
--   -- Trigger function on provider_class_schedule (PROD only).
--
--   CREATE OR REPLACE FUNCTION public.update_provider_average_rating()
--    RETURNS trigger
--    LANGUAGE plpgsql
--    SECURITY DEFINER
--   AS $function$
--   DECLARE
--     v_provider_id uuid;
--   BEGIN
--     -- Determine provider_id from the affected row
--     IF TG_OP = 'DELETE' THEN
--       v_provider_id := OLD.provider_id;
--     ELSE
--       v_provider_id := NEW.provider_id;
--     END IF;
--
--     UPDATE public.provider_profiles
--     SET average_rating = COALESCE((
--       SELECT AVG(rating)::numeric(3,2)
--       FROM public.reviews
--       WHERE provider_id = v_provider_id
--     ), 0)
--     WHERE id = v_provider_id;
--
--     RETURN NULL;
--   END;
--   $function$
--   -- Fired by (PROD only):
--   --   trg_update_provider_rating
--   --   AFTER INSERT OR DELETE OR UPDATE ON public.reviews FOR EACH ROW
--   -- This is what keeps provider_profiles.average_rating current on PROD.
--   -- DEV has neither the function nor the trigger (parity ticket).
-- ───────────────────────────────────────────────────────────────────────────

BEGIN;

DO $pin$
DECLARE
  v_names text[] := ARRAY['get_slot_capacity', 'update_provider_average_rating',
                          'set_updated_at', 'update_class_schedule_updated_at',
                          'booking_time_to_minutes'];
  v_name  text;
  fn      regprocedure;
  v_found integer;
BEGIN
  FOREACH v_name IN ARRAY v_names LOOP
    v_found := 0;
    FOR fn IN
      SELECT p.oid::regprocedure
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = v_name
    LOOP
      EXECUTE format('ALTER FUNCTION %s SET search_path = public, pg_temp', fn);
      v_found := v_found + 1;
      RAISE NOTICE 'search_path pinned: %', fn;
    END LOOP;
    IF v_found = 0 THEN
      RAISE NOTICE 'SKIPPED — no function named % in public on this database', v_name;
    END IF;
  END LOOP;
END;
$pin$;

COMMIT;
