-- Add minimum booking lead time to provider profiles.
-- DEFAULT 15 backfills all existing rows automatically.
ALTER TABLE public.provider_profiles
  ADD COLUMN IF NOT EXISTS min_lead_time_minutes integer NOT NULL DEFAULT 15
  CHECK (min_lead_time_minutes >= 0 AND min_lead_time_minutes <= 1440);

-- Enforce minimum lead time on same-day bookings made by regular customers.
-- Providers and admins bypass this check (walk-in support).
-- All times are assumed to be in Asia/Jerusalem — no timezone handling beyond this.
CREATE OR REPLACE FUNCTION public.enforce_booking_lead_time()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  actor_role text;
  lead_time  integer;
  booking_minutes integer;
  now_minutes     integer;
  today_israel    date;
BEGIN
  IF NEW.status NOT IN ('confirmed', 'pending') THEN
    RETURN NEW;
  END IF;

  -- Resolve current date/time in the app's assumed timezone
  today_israel := (NOW() AT TIME ZONE 'Asia/Jerusalem')::date;

  -- Lead time only applies to same-day bookings
  IF NEW.booking_date != today_israel THEN
    RETURN NEW;
  END IF;

  -- Providers and admins bypass the lead time check
  IF auth.uid() IS NOT NULL THEN
    SELECT role INTO actor_role
    FROM public.user_roles
    WHERE user_id = auth.uid()
      AND role IN ('provider', 'admin')
    LIMIT 1;

    IF actor_role IN ('provider', 'admin') THEN
      RETURN NEW;
    END IF;
  END IF;

  -- Look up this provider's configured lead time
  SELECT min_lead_time_minutes INTO lead_time
  FROM public.provider_profiles
  WHERE id = NEW.provider_id;

  lead_time := COALESCE(lead_time, 15);

  booking_minutes := public.booking_time_to_minutes(NEW.booking_time);

  now_minutes := EXTRACT(HOUR   FROM (NOW() AT TIME ZONE 'Asia/Jerusalem'))::int * 60
               + EXTRACT(MINUTE FROM (NOW() AT TIME ZONE 'Asia/Jerusalem'))::int;

  -- Slot must start MORE THAN lead_time minutes from now (strictly greater-than)
  IF booking_minutes <= now_minutes + lead_time THEN
    RAISE EXCEPTION 'LEAD_TIME_VIOLATION'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_booking_lead_time ON public.bookings;

CREATE TRIGGER trg_enforce_booking_lead_time
BEFORE INSERT OR UPDATE OF provider_id, booking_date, booking_time, service_ids, status
ON public.bookings
FOR EACH ROW
EXECUTE FUNCTION public.enforce_booking_lead_time();
