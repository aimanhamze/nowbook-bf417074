-- The prevent_booking_conflicts trigger was skipping ALL checks for
-- fitness_studio class bookings (service_ids = '{}') with the comment
-- "enforced at the application layer" — but that layer check was never
-- implemented. This migration adds real server-side capacity enforcement
-- keyed on class_schedule_id + booking_date + max_capacity.

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

  -- Class bookings (fitness_studio) use class_schedule_id and service_ids = '{}'.
  -- Enforce capacity against provider_class_schedule.max_capacity.
  IF NEW.service_ids IS NULL OR array_length(NEW.service_ids, 1) IS NULL THEN
    IF NEW.class_schedule_id IS NOT NULL THEN
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

  -- ── GROUP branch: exact-start-time capacity ──────────────────────────────
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
