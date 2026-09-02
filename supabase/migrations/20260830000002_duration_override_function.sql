-- Phase 2 of duration_override (see 20260830000001_duration_override.sql).
--
-- Until now a booking's length was always derived from the sum of its services'
-- `duration`. `bookings.duration_override` lets a provider stretch or shrink a
-- single booking without touching the service definition.
--
-- The conflict trigger has to honour the override on BOTH sides of every overlap
-- test, otherwise the check becomes asymmetric: a stretched booking would block
-- new bookings without itself being blocked (or vice versa). There are four
-- duration computations in prevent_booking_conflicts() and all four change here.

-- ---------------------------------------------------------------------------
-- 1. Who is allowed to write duration_override
-- ---------------------------------------------------------------------------
-- RLS on `bookings` ("Users can update own bookings") grants a customer UPDATE on
-- their whole row with no column filter, so without this guard a customer could
-- shrink their own booking's duration_override and squeeze past the overlap
-- check. Duration is a business decision: only the owning provider may set it.
--
-- Runs as its own BEFORE trigger rather than inside prevent_booking_conflicts()
-- because that function returns early for cancelled/completed bookings and for
-- class bookings -- the permission check must apply unconditionally.
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
  -- They are already trusted; RLS is not what constrains them.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.provider_profiles pp
    WHERE pp.id = NEW.provider_id
      AND pp.user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'DURATION_OVERRIDE_FORBIDDEN'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$function$;

-- Fires on every INSERT/UPDATE (no column list): the function itself decides
-- whether the value actually changed, so an UPDATE that leaves duration_override
-- alone costs one NULL comparison and nothing else.
--
-- Name matters: PostgreSQL fires BEFORE triggers in alphabetical order, and
-- "trg_enforce_..." sorts ahead of "trg_prevent_booking_conflicts", so an
-- unauthorized write is rejected as DURATION_OVERRIDE_FORBIDDEN rather than
-- surfacing as a confusing conflict error.
DROP TRIGGER IF EXISTS trg_enforce_duration_override_permission ON public.bookings;
CREATE TRIGGER trg_enforce_duration_override_permission
  BEFORE INSERT OR UPDATE ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.enforce_duration_override_permission();

-- ---------------------------------------------------------------------------
-- 2. Teach the conflict check about duration_override
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.prevent_booking_conflicts()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  new_start integer;
  new_duration integer;
  primary_service_type text;
  primary_max_capacity integer;
  new_is_parallel boolean;
  current_count integer;
  conflict_statuses text[];
BEGIN
  IF NEW.status NOT IN ('confirmed', 'pending') THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.status = 'confirmed' AND OLD.status = 'pending' THEN
    conflict_statuses := ARRAY['confirmed'];
  ELSE
    conflict_statuses := ARRAY['confirmed', 'pending'];
  END IF;
  IF NEW.service_ids IS NULL OR array_length(NEW.service_ids, 1) IS NULL THEN
    IF NEW.class_schedule_id IS NOT NULL THEN
      -- Class bookings are capacity-matched against an exact class slot, never
      -- against a time window, so duration_override has nothing to act on here.
      -- Warn rather than block: the value is inert, not invalid.
      IF NEW.duration_override IS NOT NULL THEN
        RAISE WARNING 'duration_override is ignored for class bookings (class_schedule_id=%, booking_date=%)',
          NEW.class_schedule_id, NEW.booking_date;
      END IF;
      PERFORM pg_advisory_xact_lock(
        hashtext(NEW.class_schedule_id::text || '|' || NEW.booking_date::text)
      );
      SELECT cs.max_capacity INTO primary_max_capacity
      FROM public.provider_class_schedule cs
      WHERE cs.id = NEW.class_schedule_id;
      SELECT COUNT(*) INTO current_count
      FROM public.bookings b
      WHERE b.class_schedule_id = NEW.class_schedule_id
        AND b.booking_date = NEW.booking_date
        AND b.status = ANY(conflict_statuses)
        AND (TG_OP = 'INSERT' OR b.id <> NEW.id);
      IF current_count >= COALESCE(primary_max_capacity, 1) THEN
        RAISE EXCEPTION 'GROUP_CAPACITY_EXCEEDED'
          USING ERRCODE = 'P0001';
      END IF;
    END IF;
    RETURN NEW;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext(NEW.provider_id || '|' || NEW.booking_date::text));
  SELECT ps.service_type, ps.max_capacity, ps.is_parallel
  INTO primary_service_type, primary_max_capacity, new_is_parallel
  FROM public.provider_services ps
  WHERE ps.provider_id = NEW.provider_id
    AND ps.id = NEW.service_ids[1];
  IF primary_service_type = 'group' THEN
    -- Same as the class branch: group capacity is counted on an exact
    -- booking_time match, so an override here changes nothing.
    IF NEW.duration_override IS NOT NULL THEN
      RAISE WARNING 'duration_override is ignored for group services (service_id=%, booking_date=%, booking_time=%)',
        NEW.service_ids[1], NEW.booking_date, NEW.booking_time;
    END IF;
    SELECT COUNT(*)
    INTO current_count
    FROM public.bookings b
    WHERE b.provider_id = NEW.provider_id
      AND b.booking_date = NEW.booking_date
      AND b.booking_time = NEW.booking_time
      AND b.status = ANY(conflict_statuses)
      AND (TG_OP = 'INSERT' OR b.id <> NEW.id);
    IF current_count >= COALESCE(primary_max_capacity, 1) THEN
      RAISE EXCEPTION 'GROUP_CAPACITY_EXCEEDED'
        USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;
  new_start := public.booking_time_to_minutes(NEW.booking_time);
  -- (1/4) the incoming row's own length
  SELECT COALESCE(NEW.duration_override, COALESCE(NULLIF(SUM(ps.duration), 0), 30))
  INTO new_duration
  FROM public.provider_services ps
  WHERE ps.provider_id = NEW.provider_id
    AND ps.id = ANY(NEW.service_ids);
  IF EXISTS (
    SELECT 1
    FROM public.bookings b
    LEFT JOIN LATERAL (
      -- (2/4) existing rows, cross-service overlap check
      SELECT COALESCE(b.duration_override, COALESCE(NULLIF(SUM(ps2.duration), 0), 30)) AS duration_minutes
      FROM public.provider_services ps2
      WHERE ps2.provider_id = b.provider_id
        AND ps2.id = ANY(b.service_ids)
    ) svc ON TRUE
    WHERE b.provider_id = NEW.provider_id
      AND b.booking_date = NEW.booking_date
      AND b.status = ANY(conflict_statuses)
      AND (TG_OP = 'INSERT' OR b.id <> NEW.id)
      AND new_start < (public.booking_time_to_minutes(b.booking_time) + svc.duration_minutes)
      AND public.booking_time_to_minutes(b.booking_time) < (new_start + new_duration)
      AND b.staff_id IS NOT DISTINCT FROM NEW.staff_id
      AND b.service_ids[1] IS DISTINCT FROM NEW.service_ids[1]
      AND NOT (
        COALESCE(new_is_parallel, false)
        AND COALESCE((
          SELECT ps3.is_parallel
          FROM public.provider_services ps3
          WHERE ps3.provider_id = b.provider_id
            AND ps3.id = b.service_ids[1]
        ), false)
      )
  ) THEN
    RAISE EXCEPTION 'The selected time is no longer available'
      USING ERRCODE = '23505';
  END IF;
  IF NEW.user_id IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.bookings b
    LEFT JOIN LATERAL (
      -- (3/4) existing rows, same-customer double-booking check
      SELECT COALESCE(b.duration_override, COALESCE(NULLIF(SUM(ps2.duration), 0), 30)) AS duration_minutes
      FROM public.provider_services ps2
      WHERE ps2.provider_id = b.provider_id
        AND ps2.id = ANY(b.service_ids)
    ) svc ON TRUE
    WHERE b.provider_id = NEW.provider_id
      AND b.booking_date = NEW.booking_date
      AND b.status = ANY(conflict_statuses)
      AND (TG_OP = 'INSERT' OR b.id <> NEW.id)
      AND b.user_id = NEW.user_id
      AND new_start < (public.booking_time_to_minutes(b.booking_time) + svc.duration_minutes)
      AND public.booking_time_to_minutes(b.booking_time) < (new_start + new_duration)
  ) THEN
    RAISE EXCEPTION 'DUPLICATE_USER_BOOKING'
      USING ERRCODE = 'P0001';
  END IF;
  SELECT COUNT(*)
  INTO current_count
  FROM public.bookings b
  LEFT JOIN LATERAL (
    -- (4/4) existing rows, same-service capacity count
    SELECT COALESCE(b.duration_override, COALESCE(NULLIF(SUM(ps2.duration), 0), 30)) AS duration_minutes
    FROM public.provider_services ps2
    WHERE ps2.provider_id = b.provider_id
      AND ps2.id = ANY(b.service_ids)
  ) svc ON TRUE
  WHERE b.provider_id = NEW.provider_id
    AND b.booking_date = NEW.booking_date
    AND b.status = ANY(conflict_statuses)
    AND (TG_OP = 'INSERT' OR b.id <> NEW.id)
    AND new_start < (public.booking_time_to_minutes(b.booking_time) + svc.duration_minutes)
    AND public.booking_time_to_minutes(b.booking_time) < (new_start + new_duration)
    AND b.staff_id IS NOT DISTINCT FROM NEW.staff_id
    AND b.service_ids[1] IS NOT DISTINCT FROM NEW.service_ids[1];
  IF current_count >= COALESCE(primary_max_capacity, 1) THEN
    RAISE EXCEPTION 'The selected time is no longer available'
      USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END;
$function$;
