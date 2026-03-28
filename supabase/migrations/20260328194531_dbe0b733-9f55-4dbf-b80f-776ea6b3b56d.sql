-- Convert booking time text (HH:MM) to minutes for overlap checks
CREATE OR REPLACE FUNCTION public.booking_time_to_minutes(_time text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT (split_part(_time, ':', 1)::int * 60) + split_part(_time, ':', 2)::int
$$;

-- Prevent overlapping bookings for the same provider/date based on service durations
CREATE OR REPLACE FUNCTION public.prevent_booking_conflicts()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  new_start integer;
  new_duration integer;
BEGIN
  IF NEW.status NOT IN ('confirmed', 'pending') THEN
    RETURN NEW;
  END IF;

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

DROP TRIGGER IF EXISTS trg_prevent_booking_conflicts ON public.bookings;

CREATE TRIGGER trg_prevent_booking_conflicts
BEFORE INSERT OR UPDATE OF provider_id, booking_date, booking_time, service_ids, status
ON public.bookings
FOR EACH ROW
EXECUTE FUNCTION public.prevent_booking_conflicts();

-- Clean existing exact duplicate active bookings (keep earliest)
WITH ranked AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY provider_id, booking_date, booking_time
      ORDER BY created_at ASC, id ASC
    ) AS rn
  FROM public.bookings
  WHERE status IN ('confirmed', 'pending')
)
UPDATE public.bookings b
SET status = 'cancelled', updated_at = now()
FROM ranked r
WHERE b.id = r.id
  AND r.rn > 1;

-- Fast-path protection for exact same start-time duplicates
CREATE UNIQUE INDEX IF NOT EXISTS bookings_provider_date_time_unique_active_idx
ON public.bookings (provider_id, booking_date, booking_time)
WHERE status IN ('confirmed', 'pending');

-- Query perf for availability checks
CREATE INDEX IF NOT EXISTS bookings_provider_date_status_time_idx
ON public.bookings (provider_id, booking_date, status, booking_time);