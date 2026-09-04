-- Membership / package system — Phase 1, migration 1 of 8.
--
-- Arrival timestamp for a booking. Deliberately NOT status = 'completed':
-- that value passes bookings_status_check but is written nowhere in src/, and
-- using it would drop the row out of useProviderBookings' status filter
-- (.in("status", ["confirmed","pending","cancelled"])), free its slot in
-- prevent_booking_conflicts (which returns early for any other status), and
-- still count as revenue in providerStats.ts.
--
-- Nullable with no default: every existing row and every existing booking path
-- is unaffected.
ALTER TABLE public.bookings
ADD COLUMN check_in_at timestamptz;
