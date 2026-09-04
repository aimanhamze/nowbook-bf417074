-- Membership / package system — Phase 1, migration 2 of 8.
--
-- What a provider OFFERS. One row per package type on sale.
-- Applies to every provider category, not just fitness_studio.
CREATE TABLE public.package_templates (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  provider_id uuid NOT NULL REFERENCES provider_profiles(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  total_entries integer NOT NULL CHECK (total_entries > 0),
  validity_days integer NOT NULL CHECK (validity_days > 0),
  price numeric NOT NULL CHECK (price >= 0),
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
