-- Membership / package system — Phase 1, migration 4 of 8.
--
-- Append-only audit of every entry movement.
--
-- booking_id is ON DELETE SET NULL, never CASCADE: useDeleteBooking
-- (src/hooks/useProviderBookings.ts) issues a hard DELETE, and CASCADE would
-- destroy the ledger history while RESTRICT would break that shipped button.
-- NULL also covers a manual adjustment with no booking attached.
CREATE TABLE public.package_usage_log (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  customer_package_id uuid NOT NULL REFERENCES customer_packages(id) ON DELETE CASCADE,
  booking_id uuid REFERENCES bookings(id) ON DELETE SET NULL,
  action_type text NOT NULL CHECK (action_type IN (
    'entry_deducted',
    'entry_returned_cancellation',
    'entry_returned_manual',
    'entry_added_manual',
    'package_activated',
    'package_exhausted',
    'package_expired',
    'package_extended'
  )),
  entries_before integer NOT NULL,
  entries_after integer NOT NULL,
  performed_by uuid REFERENCES auth.users(id),
  note text,
  created_at timestamptz DEFAULT now()
);
