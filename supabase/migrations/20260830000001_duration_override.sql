-- 1. Add column
ALTER TABLE public.bookings
ADD COLUMN duration_override integer;

-- 2. Safety constraint (no zero or negative values)
ALTER TABLE public.bookings
ADD CONSTRAINT bookings_duration_override_range
CHECK (duration_override IS NULL OR (duration_override > 0 AND duration_override <= 1440));

-- 3. Update trigger to include duration_override in UPDATE OF list
-- (so changing duration_override re-runs conflict check)
DROP TRIGGER IF EXISTS trg_prevent_booking_conflicts ON public.bookings;
CREATE TRIGGER trg_prevent_booking_conflicts
  BEFORE INSERT OR UPDATE OF
    provider_id, booking_date, booking_time,
    service_ids, status, staff_id, duration_override
  ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.prevent_booking_conflicts();

-- 4. Update prevent_booking_conflicts function to use duration_override
-- (deferred to the next step -- see 20260830000002)
