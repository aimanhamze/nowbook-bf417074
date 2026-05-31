-- Expose a provider's BUSY time slots to anyone computing availability, WITHOUT
-- leaking customer PII.
--
-- Why this is needed: RLS on public.bookings only lets a user read their own
-- rows (auth.uid() = user_id) or, for a provider, their business's rows. So a
-- CUSTOMER browsing a provider cannot SELECT other customers' bookings — nor
-- walk-ins (user_id IS NULL, which never equals auth.uid()). The client-side
-- availability grid therefore saw an incomplete set and offered already-taken
-- slots (the DB conflict trigger still blocked the insert, but the UX was wrong).
--
-- SECURITY DEFINER bypasses RLS, but the projection is deliberately limited to
-- non-PII timing columns for active bookings only. It returns NO user_id,
-- total_price, customer_name, customer_phone, or guest_notes — nothing that
-- identifies a customer.
CREATE OR REPLACE FUNCTION public.get_provider_busy_slots(
  p_provider_id uuid,
  p_from_date   date,
  p_to_date     date
)
RETURNS TABLE (
  booking_date date,
  booking_time text,
  service_ids  text[]
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT b.booking_date, b.booking_time, b.service_ids::text[]
  FROM public.bookings b
  WHERE b.provider_id = p_provider_id
    AND b.status IN ('confirmed', 'pending')
    AND b.booking_date BETWEEN p_from_date AND p_to_date;
$$;

-- Lock down the default PUBLIC execute grant, then re-grant only where needed.
-- The result is PII-free, so anon (logged-out availability) is safe and
-- future-proofs a public availability view; authenticated covers the booking
-- page and the provider dashboard.
REVOKE ALL ON FUNCTION public.get_provider_busy_slots(uuid, date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_provider_busy_slots(uuid, date, date) TO anon, authenticated;
