-- Membership / package system — Phase 1, migration 5 of 8.
--
-- Links a booking to the package that paid for it. NULL = booked normally;
-- packages are always optional, and a customer without one books exactly as
-- before.
--
-- ON DELETE SET NULL so deleting a package never cascades into bookings.
ALTER TABLE public.bookings
ADD COLUMN customer_package_id uuid REFERENCES customer_packages(id) ON DELETE SET NULL;
