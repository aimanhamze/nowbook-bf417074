-- FIX: a single account could fill an entire capacity pool by itself (e.g. one
-- customer books botox 09:00 three times into a capacity-3 slot). A user should
-- hold at most ONE spot in any overlapping same-service slot.
--
-- RULE: reject an incoming booking if the SAME non-null user_id already has an
-- overlapping ACTIVE booking for the SAME primary service. This is SEPARATE from
-- the capacity count (which still permits up to N *different* users).
--
-- WALK-INS: provider-created walk-ins have user_id IS NULL (confirmed in
-- 20260531000002, which dropped NOT NULL on bookings.user_id). Two walk-ins are
-- two different real people and must NOT collapse together. The guard therefore
-- (a) only runs when NEW.user_id IS NOT NULL, and (b) compares b.user_id =
-- NEW.user_id, where any NULL b.user_id yields NULL (not TRUE) and is excluded.
-- So walk-ins never trip this check, against each other or against app users.
--
-- EVERYTHING ELSE IS UNCHANGED from 20260609000002 (the uuid-cast-corrected
-- version): advisory lock, cancel guard, conflict_statuses approval logic,
-- self-exclusion, GROUP branch, and the private two-clause cross-service /
-- capacity logic. This migration ONLY adds the same-user EXISTS guard in the
-- private branch, between CLAUSE 1 (cross-service) and CLAUSE 2 (capacity pool).
-- Comparisons stay uuid = uuid (do NOT reintroduce ::text casts).
--
-- ATOMICITY: single transaction so the live function is never half-rewritten.
BEGIN;

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
  WHERE ps.provider_id = NEW.provider_id
    AND ps.id = NEW.service_ids[1];

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
  WHERE ps.provider_id = NEW.provider_id
    AND ps.id = ANY(NEW.service_ids);

  -- CLAUSE 1 (cross-service = exclusive): reject if ANY overlapping active
  -- booking is for a DIFFERENT primary service than the incoming one.
  IF EXISTS (
    SELECT 1
    FROM public.bookings b
    LEFT JOIN LATERAL (
      SELECT COALESCE(NULLIF(SUM(ps2.duration), 0), 30) AS duration_minutes
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
      AND b.service_ids[1] IS DISTINCT FROM NEW.service_ids[1]
  ) THEN
    RAISE EXCEPTION 'The selected time is no longer available'
      USING ERRCODE = '23505';
  END IF;

  -- SAME-USER guard (NEW): one account may hold only ONE spot in an overlapping
  -- same-service slot. Runs only for real accounts; walk-ins (user_id IS NULL)
  -- are excluded both by the IS NOT NULL guard and by b.user_id = NEW.user_id
  -- (NULL = NULL is not TRUE). Separate from the capacity pool below, which
  -- still allows up to N DIFFERENT users for the same service.
  IF NEW.user_id IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.bookings b
    LEFT JOIN LATERAL (
      SELECT COALESCE(NULLIF(SUM(ps2.duration), 0), 30) AS duration_minutes
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
      AND b.service_ids[1] IS NOT DISTINCT FROM NEW.service_ids[1]
  ) THEN
    RAISE EXCEPTION 'DUPLICATE_USER_BOOKING'
      USING ERRCODE = 'P0001';
  END IF;

  -- CLAUSE 2 (same-service pool): count overlapping active bookings for the
  -- SAME primary service; reject once the pool is at capacity.
  SELECT COUNT(*)
  INTO current_count
  FROM public.bookings b
  LEFT JOIN LATERAL (
    SELECT COALESCE(NULLIF(SUM(ps2.duration), 0), 30) AS duration_minutes
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
    AND b.service_ids[1] IS NOT DISTINCT FROM NEW.service_ids[1];

  IF current_count >= COALESCE(primary_max_capacity, 1) THEN
    RAISE EXCEPTION 'The selected time is no longer available'
      USING ERRCODE = '23505';
  END IF;

  RETURN NEW;
END;
$$;

COMMIT;
