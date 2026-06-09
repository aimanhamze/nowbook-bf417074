-- Private-service capacity, fixed for mixed exclusive + shared services:
-- "same-service pool, cross-service exclusive".
--
-- BUG this fixes: 20260608000001 counted ALL active overlapping bookings and
-- rejected at >= the INCOMING service's max_capacity, ignoring which service
-- each overlap was for. So an exclusive (capacity-1) booking of service X was
-- counted as merely "1 spot used" against a capacity-3 service S, and S was
-- offered/accepted at a time X had exclusively reserved.
--
-- MODEL. For an incoming booking of service S (capacity Cs) over interval I,
-- with `overlap` = active bookings whose interval intersects I (self excluded):
--   CLAUSE 1 (cross-service = exclusive): reject if ANY overlapping booking is
--     for a DIFFERENT primary service than S. A different service means the
--     provider is otherwise occupied — capacity is shared only within one
--     service. (Accepted limitation: two different capacity services cannot
--     overlap each other.)
--   CLAUSE 2 (same-service pool): among overlapping bookings for the SAME
--     primary service, reject once the count reaches Cs.
-- Primary service = service_ids[1] (the same element the function already reads
-- for capacity); compared with IS [NOT] DISTINCT FROM so NULLs behave sanely.
--
-- NORMAL SERVICES UNCHANGED: with Cs = 1, a different-service overlap trips
-- clause 1 and a same-service overlap trips clause 2 (count >= 1), so ANY
-- overlap still blocks — byte-for-byte the pre-capacity behavior.
--
-- This MUST stay identical to the client getAvailableSlots two-clause check.
--
-- UNCHANGED: advisory lock, conflict_statuses (approval) logic, self-exclusion
-- (TG_OP='INSERT' OR b.id <> NEW.id), and the entire GROUP branch.

CREATE OR REPLACE FUNCTION public.prevent_booking_conflicts()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  new_start integer;
  new_duration integer;
  primary_service_type text;
  primary_max_capacity integer;
  current_count integer;
  -- When approving (UPDATE pending -> confirmed), only confirmed bookings
  -- create hard conflicts; other pending ones are still undecided.
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

  PERFORM pg_advisory_xact_lock(hashtext(NEW.provider_id || '|' || NEW.booking_date::text));

  SELECT ps.service_type, ps.max_capacity
  INTO primary_service_type, primary_max_capacity
  FROM public.provider_services ps
  WHERE ps.provider_id::text = NEW.provider_id
    AND ps.id::text = NEW.service_ids[1];

  -- ── GROUP branch (UNCHANGED): exact-start-time capacity ──────────────────
  IF primary_service_type = 'group' THEN
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

  -- ── PRIVATE branch: same-service pool, cross-service exclusive ────────────
  new_start := public.booking_time_to_minutes(NEW.booking_time);

  SELECT COALESCE(NULLIF(SUM(ps.duration), 0), 30)
  INTO new_duration
  FROM public.provider_services ps
  WHERE ps.provider_id::text = NEW.provider_id
    AND ps.id::text = ANY(NEW.service_ids);

  -- CLAUSE 1 (cross-service = exclusive): reject if ANY overlapping active
  -- booking is for a DIFFERENT primary service than the incoming one.
  IF EXISTS (
    SELECT 1
    FROM public.bookings b
    LEFT JOIN LATERAL (
      SELECT COALESCE(NULLIF(SUM(ps2.duration), 0), 30) AS duration_minutes
      FROM public.provider_services ps2
      WHERE ps2.provider_id::text = b.provider_id
        AND ps2.id::text = ANY(b.service_ids)
    ) svc ON TRUE
    WHERE b.provider_id = NEW.provider_id
      AND b.booking_date = NEW.booking_date
      AND b.status = ANY(conflict_statuses)
      AND (TG_OP = 'INSERT' OR b.id <> NEW.id)
      AND new_start < (public.booking_time_to_minutes(b.booking_time) + svc.duration_minutes)
      AND public.booking_time_to_minutes(b.booking_time) < (new_start + new_duration)
      AND b.service_ids[1] IS DISTINCT FROM NEW.service_ids[1]
  ) THEN
    RAISE EXCEPTION 'The selected time is no longer available'
      USING ERRCODE = '23505';
  END IF;

  -- CLAUSE 2 (same-service pool): count overlapping active bookings for the
  -- SAME primary service; reject once the pool is at capacity.
  SELECT COUNT(*)
  INTO current_count
  FROM public.bookings b
  LEFT JOIN LATERAL (
    SELECT COALESCE(NULLIF(SUM(ps2.duration), 0), 30) AS duration_minutes
    FROM public.provider_services ps2
    WHERE ps2.provider_id::text = b.provider_id
      AND ps2.id::text = ANY(b.service_ids)
  ) svc ON TRUE
  WHERE b.provider_id = NEW.provider_id
    AND b.booking_date = NEW.booking_date
    AND b.status = ANY(conflict_statuses)
    AND (TG_OP = 'INSERT' OR b.id <> NEW.id)
    AND new_start < (public.booking_time_to_minutes(b.booking_time) + svc.duration_minutes)
    AND public.booking_time_to_minutes(b.booking_time) < (new_start + new_duration)
    AND b.service_ids[1] IS NOT DISTINCT FROM NEW.service_ids[1];

  IF current_count >= COALESCE(primary_max_capacity, 1) THEN
    RAISE EXCEPTION 'The selected time is no longer available'
      USING ERRCODE = '23505';
  END IF;

  RETURN NEW;
END;
$$;
