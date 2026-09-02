-- HOTFIX: enforce_duration_override_permission() raised
--   42883  operator does not exist: text = uuid
-- on PROD for every duration edit, while passing every test on DEV.
--
-- ROOT CAUSE: the function compared provider_profiles against bookings without
-- casts:
--     WHERE pp.id = NEW.provider_id AND pp.user_id = auth.uid()
-- On DEV all four of those columns are `uuid`, so it type-checked and the whole
-- test suite passed. PROD does not agree on at least one of them -- the two
-- databases have divergent lineages (see 20260609000002, which fixed this exact
-- error class after ::text casts from the pre-uuid schema went stale).
--
-- WHY IT WAS NOT CAUGHT: pre-deploy verification diffed the FUNCTION BODIES of
-- prevent_booking_conflicts, the trigger definition, the RPC and its grants
-- between DEV and PROD -- and they matched. Column TYPES were never compared,
-- and this function was the only genuinely new SQL with no PROD-side precedent.
-- The existing RLS policies do the same two comparisons and work fine on PROD,
-- which is what pointed at a cast difference rather than a logic difference.
--
-- FIX: cast both sides to text so the comparison holds whichever type each
-- column actually is. provider_profiles is one row per business, so losing the
-- index lookup here is not measurable. Deliberately NOT ::uuid -- that would
-- throw on any row whose text value is not a parseable uuid, turning a
-- comparison problem into a hard failure.
--
-- Behaviour is otherwise unchanged: same early-returns, same service-role
-- bypass, same DURATION_OVERRIDE_FORBIDDEN for a non-owning caller.
--
-- CREATE OR REPLACE: no DROP, no window where the trigger points at nothing.

CREATE OR REPLACE FUNCTION public.enforce_duration_override_permission()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  override_changed boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    override_changed := NEW.duration_override IS NOT NULL;
  ELSE
    override_changed := NEW.duration_override IS DISTINCT FROM OLD.duration_override;
  END IF;

  IF NOT override_changed THEN
    RETURN NEW;
  END IF;

  -- Server-side callers (service role, cron, Edge Functions) carry no JWT.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  -- ::text on BOTH sides -- see the header. Do not "tidy" these casts away.
  IF NOT EXISTS (
    SELECT 1
    FROM public.provider_profiles pp
    WHERE pp.id::text = NEW.provider_id::text
      AND pp.user_id::text = auth.uid()::text
  ) THEN
    RAISE EXCEPTION 'DURATION_OVERRIDE_FORBIDDEN'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$function$;
