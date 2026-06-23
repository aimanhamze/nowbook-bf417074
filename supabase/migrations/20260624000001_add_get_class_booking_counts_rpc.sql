-- Customers querying the bookings table directly are blocked by RLS to their
-- own rows only, so the spot counts on the booking page always showed max
-- capacity for classes they hadn't booked themselves. This SECURITY DEFINER
-- function bypasses RLS to return aggregate counts only — no PII is exposed.
CREATE OR REPLACE FUNCTION public.get_class_booking_counts(
  p_class_ids  uuid[],
  p_dates      date[]
)
RETURNS TABLE(class_schedule_id uuid, booking_date date, booked_count integer)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    b.class_schedule_id,
    b.booking_date,
    COUNT(*)::integer AS booked_count
  FROM public.bookings b
  WHERE b.class_schedule_id = ANY(p_class_ids)
    AND b.booking_date      = ANY(p_dates)
    AND b.status            IN ('confirmed', 'pending')
  GROUP BY b.class_schedule_id, b.booking_date;
$$;

GRANT EXECUTE ON FUNCTION public.get_class_booking_counts(uuid[], date[]) TO authenticated;
