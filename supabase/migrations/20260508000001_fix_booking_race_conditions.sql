-- Fix booking race conditions:
--   #1 Group class overbooking — max_capacity was only enforced client-side.
--   #2 Private-service duration overlap — TOCTOU between EXISTS check and INSERT.
-- Both are closed by serializing concurrent inserts/updates per (provider, day)
-- with a transaction-scoped advisory lock at the top of the trigger function.
--
-- NOTE: If two different group services share the same (provider, date, time)
-- slot, the capacity COUNT will conflate them across services. Not currently
-- possible via the UI but worth knowing.

-- The legacy strict unique index forbids two active bookings at the same
-- (provider, date, time), which is incorrect for group classes (multiple
-- participants share the slot). Capacity is now enforced by the trigger below.
DROP INDEX IF EXISTS public.bookings_provider_date_time_unique_active_idx;

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
BEGIN
  -- Cancellations / no-shows do not claim a slot — short-circuit.
  IF NEW.status NOT IN ('confirmed', 'pending') THEN
    RETURN NEW;
  END IF;

  -- ── SHARED LOCK ──────────────────────────────────────────────────────────
  -- Transaction-scoped advisory lock keyed on (provider_id, booking_date).
  -- Serializes concurrent inserts/updates targeting the same provider on the
  -- same calendar day, closing the TOCTOU window for BOTH:
  --   • Fix #1 (group capacity): COUNT-then-INSERT is now atomic
  --   • Fix #2 (private overlap): EXISTS-then-INSERT is now atomic
  -- Per-day granularity: bookings on different days never block each other;
  -- bookings for different providers on the same day never block each other.
  -- bookings.provider_id is TEXT, so concatenation is direct.
  PERFORM pg_advisory_xact_lock(hashtext(NEW.provider_id || '|' || NEW.booking_date::text));

  -- Identify the primary service. Group bookings are single-service in the UI
  -- (BookAppointment.tsx toggleService replaces, doesn't append), so the first
  -- entry of service_ids is the relevant one for capacity decisions.
  SELECT ps.service_type, ps.max_capacity
  INTO primary_service_type, primary_max_capacity
  FROM public.provider_services ps
  WHERE ps.provider_id::text = NEW.provider_id
    AND ps.id::text = NEW.service_ids[1];

  -- ── FIX #1: Group capacity enforcement ───────────────────────────────────
  IF primary_service_type = 'group' THEN
    SELECT COUNT(*)
    INTO current_count
    FROM public.bookings b
    WHERE b.provider_id = NEW.provider_id
      AND b.booking_date = NEW.booking_date
      AND b.booking_time = NEW.booking_time
      AND b.status IN ('confirmed', 'pending')
      AND (TG_OP = 'INSERT' OR b.id <> NEW.id);

    IF current_count >= COALESCE(primary_max_capacity, 1) THEN
      RAISE EXCEPTION 'GROUP_CAPACITY_EXCEEDED'
        USING ERRCODE = 'P0001';
    END IF;

    -- For group services, two bookings sharing a start time are valid
    -- (different participants in the same class). The duration overlap check
    -- below would always reject the second participant, so skip it here.
    RETURN NEW;
  END IF;

  -- ── FIX #2: Private-service duration overlap (now race-free) ─────────────
  new_start := public.booking_time_to_minutes(NEW.booking_time);

  SELECT COALESCE(NULLIF(SUM(ps.duration), 0), 30)
  INTO new_duration
  FROM public.provider_services ps
  WHERE ps.provider_id::text = NEW.provider_id
    AND ps.id::text = ANY(NEW.service_ids);

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
      AND b.status IN ('confirmed', 'pending')
      AND (TG_OP = 'INSERT' OR b.id <> NEW.id)
      AND new_start < (public.booking_time_to_minutes(b.booking_time) + svc.duration_minutes)
      AND public.booking_time_to_minutes(b.booking_time) < (new_start + new_duration)
  ) THEN
    RAISE EXCEPTION 'The selected time is no longer available'
      USING ERRCODE = '23505';
  END IF;

  RETURN NEW;
END;
$$;

-- Trigger binding is unchanged (CREATE OR REPLACE FUNCTION updates in place).
