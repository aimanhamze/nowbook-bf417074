-- Membership / package system — Phase 1, migration 3 of 8.
--
-- What a customer BOUGHT. Payment happens outside the app; the provider marks
-- it paid and the row moves from 'pending_activation' to 'active'.
--
-- validity_days is NOT snapshot here — handle_package_booking() reads it from
-- package_templates via template_id. Consequence: editing a template's
-- validity_days changes the expiry of packages sold under it that have not yet
-- been used. Snapshot the value onto this table if that is not wanted.
--
-- customer_id is NOT NULL against auth.users, so a walk-in customer (bookings
-- with user_id IS NULL, identified by phone) cannot hold a package.
CREATE TABLE public.customer_packages (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  customer_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider_id uuid NOT NULL REFERENCES provider_profiles(id) ON DELETE CASCADE,
  template_id uuid NOT NULL REFERENCES package_templates(id),
  entries_remaining integer NOT NULL CHECK (entries_remaining >= 0),
  total_entries integer NOT NULL CHECK (total_entries > 0),
  status text NOT NULL DEFAULT 'pending_activation'
    CHECK (status IN ('pending_activation','active','exhausted','expired')),
  -- Set on FIRST entry used, not at purchase. expires_at = activated_at + the
  -- template's validity_days, stamped by handle_package_booking().
  activated_at timestamptz,
  expires_at timestamptz,
  last_low_entry_notified_at timestamptz,
  purchased_at timestamptz DEFAULT now(),
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
