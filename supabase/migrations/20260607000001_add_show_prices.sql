-- Per-provider toggle for showing service prices (and booking totals) to customers.
-- Default true: existing providers (and new ones) keep showing prices as before.
-- Providers who don't want prices shown flip this to false from their dashboard
-- (Booking Settings tab). Real prices are always stored on provider_services;
-- this flag only controls customer-facing visibility. Provider-facing views
-- (ServicesTab, NewBookingSheet, Statistics) always show real prices regardless.
ALTER TABLE public.provider_profiles
  ADD COLUMN IF NOT EXISTS show_prices boolean NOT NULL DEFAULT true;
