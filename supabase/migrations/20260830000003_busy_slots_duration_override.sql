-- Phase 3 of duration_override: let the CUSTOMER-side slot pipeline see it.
--
-- WHY THIS IS NEEDED
-- The customer booking page does not read `bookings` directly — RLS hides other
-- customers' and walk-in rows, so a direct select returned an incomplete set and
-- offered taken slots. It goes through get_provider_busy_slots() instead, which
-- projects only non-PII timing columns.
--
-- That projection does not include duration_override. Until it does,
-- `lib/bookingDuration` receives `undefined` on the customer path and falls back
-- to the service sum, so a provider who shortens a booking to 20 minutes still
-- has the customer's next slot offered 30 minutes later. The provider's own
-- calendar (which reads `bookings` directly) would show 20. The two disagree.
--
-- The conflict trigger is still the guarantee either way — a customer booking
-- into a wrongly-offered slot is rejected by the DB, not double-booked. This
-- migration is what stops that rejection from happening in the first place.
--
-- NO NEW PII: duration_override is a length in minutes, exactly as disclosing as
-- the service durations the projection already implies. It says how long a
-- booking runs, never who booked it.
--
-- Return-type change → DROP + CREATE (CREATE OR REPLACE cannot change a result
-- type). Body, volatility, security and grants are otherwise identical to the
-- current live definition (20260724000002, which added staff_id the same way).
--
-- After applying, regenerate src/integrations/supabase/types.ts
-- (`supabase gen types`) so the RPC's new column appears -- but see the repo
-- note first: types.ts is the authoritative record of the PROD schema, and
-- regenerating it from DEV would drop PROD-only objects.

BEGIN;

DROP FUNCTION public.get_provider_busy_slots(uuid, date, date);

CREATE FUNCTION public.get_provider_busy_slots(
  p_provider_id uuid,
  p_from_date   date,
  p_to_date     date
)
RETURNS TABLE (
  booking_date      date,
  booking_time      text,
  service_ids       text[],
  staff_id          uuid,
  duration_override integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT b.booking_date, b.booking_time, b.service_ids::text[], b.staff_id, b.duration_override
  FROM public.bookings b
  WHERE b.provider_id = p_provider_id
    AND b.status IN ('confirmed', 'pending')
    AND b.booking_date BETWEEN p_from_date AND p_to_date;
$$;

-- Grants exactly as the original migration: lock down PUBLIC, re-grant anon
-- (logged-out availability is PII-free) + authenticated (booking page,
-- provider dashboard).
REVOKE ALL ON FUNCTION public.get_provider_busy_slots(uuid, date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_provider_busy_slots(uuid, date, date) TO anon, authenticated;

COMMIT;
