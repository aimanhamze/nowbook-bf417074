-- PARALLEL SERVICES — follow-up: forbid one account from holding TWO OVERLAPPING
-- bookings with the same provider on the same date, regardless of service.
--
-- Background: the SAME-USER guard in prevent_booking_conflicts previously fired
-- only when the overlapping booking was for the SAME primary service
-- (AND b.service_ids[1] IS NOT DISTINCT FROM NEW.service_ids[1]). Once services
-- can be parallel, a single account could book two DIFFERENT overlapping
-- parallel services (Clause 1's parallel exception lets the cross-service block
-- pass). We now forbid that.
--
-- THE CHANGE (one line, SAME-USER guard ONLY): drop the same-service condition
-- from the guard's EXISTS, so it fires for ANY overlapping active booking by the
-- same non-null user_id — same service OR different service, parallel or not.
--
-- Everything else is reproduced VERBATIM from 20260621000001 (the version that
-- already carries the PARALLEL EXCEPTION): Clause 1 + its parallel exception,
-- the GROUP branch, Clause 2 capacity, duration math, advisory lock, status
-- handling, SET search_path = public, and the signature. Walk-ins (user_id IS
-- NULL) stay excluded via the existing NEW.user_id IS NOT NULL / b.user_id =
-- NEW.user_id conditions (NULL = NULL is not TRUE).
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
  new_is_parallel boolean;          -- PARALLEL: is the incoming primary service parallel?
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

  -- Read the incoming primary service's type, capacity, AND parallel flag.
  SELECT ps.service_type, ps.max_capacity, ps.is_parallel
  INTO primary_service_type, primary_max_capacity, new_is_parallel
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
  --
  -- PARALLEL EXCEPTION (UNCHANGED): the cross-service block is SKIPPED for a
  -- given overlap when BOTH the incoming primary service (new_is_parallel) AND
  -- the existing booking's primary service are parallel. If only one side is
  -- parallel, the overlap still blocks. COALESCE(..., false) makes a
  -- missing/unknown service non-parallel (still blocks; fail-safe).
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

  -- SAME-USER guard (WIDENED): one account may hold only ONE overlapping booking
  -- with this provider on this date — ANY service, not just the same one. The
  -- same-service condition that used to scope this guard
  -- (b.service_ids[1] IS NOT DISTINCT FROM NEW.service_ids[1]) has been REMOVED
  -- so a single user can no longer double-book themselves across two overlapping
  -- (e.g. parallel) services. Runs only for real accounts; walk-ins
  -- (user_id IS NULL) are excluded by the IS NOT NULL guard and by
  -- b.user_id = NEW.user_id (NULL = NULL is not TRUE). Independent of the
  -- capacity pool below, which still allows up to N DIFFERENT users.
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
  ) THEN
    RAISE EXCEPTION 'DUPLICATE_USER_BOOKING'
      USING ERRCODE = 'P0001';
  END IF;

  -- CLAUSE 2 (same-service pool, UNCHANGED): count overlapping active bookings
  -- for the SAME primary service; reject once the pool is at capacity.
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
