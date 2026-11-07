-- Academy category guard (feat/academy-courses, Phase 1 / migration 6 of 6).
--
-- A branch whose category is 'academy' cannot be switched to another
-- category while it has LIVE course registrations, i.e. a pending or
-- confirmed registration on one of its courses where that course
--   * has a session that has not ended yet (upper(period) after Asia/Jerusalem
--     "now"), or
--   * has no sessions at all (nothing scheduled yet, so not finished).
-- Registrations on fully finished courses, and rejected/cancelled ones, do
-- not block.
--
-- Raised as RAISE EXCEPTION 'CATEGORY_CHANGE_BLOCKED' (P0001), with
-- DETAIL '<n> live course registration(s) on this branch' (the count first,
-- so the UI can show it) and a HINT to cancel them first.
--
-- Applies to EVERY caller: the provider (BusinessProfileTab), an admin
-- (EditProviderDialog) and the service role. There is no override.
--
-- SECURITY DEFINER is required, not just convenient: course_registrations
-- has no admin read policy (migration 4), so an invoker-rights function
-- running for an admin would count 0 live registrations and let the change
-- through. search_path is pinned to ''.
--
-- The trigger is BEFORE UPDATE OF category with a WHEN clause, so ordinary
-- profile edits (name, hours, visibility, ...), and updates that rewrite
-- category to the same value, never run the function.
--
-- Deleting the branch is deliberately NOT guarded here (decided 2026-11-08):
-- the provider_profiles cascade still removes its courses and registrations.

BEGIN;

CREATE OR REPLACE FUNCTION public.guard_academy_category_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_now  timestamp := (now() AT TIME ZONE 'Asia/Jerusalem');
  v_live integer;
BEGIN
  SELECT count(*) INTO v_live
  FROM public.course_registrations r
  WHERE r.provider_id = OLD.id
    AND r.status IN ('pending', 'confirmed')
    AND (
      EXISTS (
        SELECT 1 FROM public.academy_course_sessions s
        WHERE s.course_id = r.course_id
          AND upper(s.period) > v_now
      )
      OR NOT EXISTS (
        SELECT 1 FROM public.academy_course_sessions s
        WHERE s.course_id = r.course_id
      )
    );

  IF v_live > 0 THEN
    RAISE EXCEPTION 'CATEGORY_CHANGE_BLOCKED'
      USING DETAIL = format('%s live course registration(s) on this branch', v_live),
            HINT   = 'Cancel the pending/confirmed course registrations first.';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_academy_category_change() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_provider_profiles_academy_category_guard
  BEFORE UPDATE OF category ON public.provider_profiles
  FOR EACH ROW
  WHEN (OLD.category = 'academy' AND NEW.category IS DISTINCT FROM 'academy')
  EXECUTE FUNCTION public.guard_academy_category_change();

COMMIT;
