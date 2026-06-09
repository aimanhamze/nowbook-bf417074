-- Private-service capacity (overlap-based).
--
-- Until now the PRIVATE branch of prevent_booking_conflicts rejected a booking
-- if ANY active booking overlapped its time window — i.e. an implicit capacity
-- of 1. This adds real capacity to private services by reusing the EXISTING
-- duration-overlap logic but COUNTing the overlapping bookings and rejecting
-- only once that count reaches the service's max_capacity.
--
-- Model: OVERLAP-BASED. Two bookings conflict when their [start, start+duration)
-- intervals intersect (the same test the branch already used). A slot can hold
-- up to max_capacity concurrently-overlapping bookings; the (max_capacity+1)-th
-- overlapping booking is rejected with the unchanged conflict error.
--
-- BACKWARD COMPATIBLE: every existing private service has max_capacity = 1
-- (the column default). COUNT(*) >= COALESCE(max_capacity, 1) with capacity 1
-- rejects on the very first overlap — byte-for-byte the old EXISTS behavior.
-- Existing services are therefore completely unaffected.
--
-- Capacity source: primary_max_capacity is already selected at the top of the
-- function from the primary service (service_ids[1]); we reuse it here. This
-- matches how the group branch reads capacity, keeping a single convention.
--
-- UNCHANGED: the advisory lock (race-condition / TOCTOU protection), the
-- conflict_statuses logic for approvals (pending->confirmed), and the entire
-- GROUP branch (service_type = 'group'), which keeps its exact-start-time
-- capacity semantics. Only the PRIVATE branch changes.

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

  -- ── PRIVATE branch: overlap-based capacity ───────────────────────────────
  new_start := public.booking_time_to_minutes(NEW.booking_time);

  SELECT COALESCE(NULLIF(SUM(ps.duration), 0), 30)
  INTO new_duration
  FROM public.provider_services ps
  WHERE ps.provider_id::text = NEW.provider_id
    AND ps.id::text = ANY(NEW.service_ids);

  -- Count active bookings whose duration window overlaps this one. Same
  -- interval-intersection test as before (new_start < other_end AND
  -- other_start < new_end), but COUNTed instead of EXISTS-tested so we can
  -- compare against capacity rather than rejecting at the first overlap.
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
    AND public.booking_time_to_minutes(b.booking_time) < (new_start + new_duration);

  -- Reject only once the slot is at capacity. Default capacity 1 ⇒ reject on
  -- the first overlap, identical to the previous EXISTS behavior.
  IF current_count >= COALESCE(primary_max_capacity, 1) THEN
    RAISE EXCEPTION 'The selected time is no longer available'
      USING ERRCODE = '23505';
  END IF;

  RETURN NEW;
END;
$$;
