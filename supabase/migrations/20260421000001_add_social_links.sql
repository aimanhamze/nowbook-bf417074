-- Add social/contact links to provider profiles.
-- JSONB allows adding new platforms later without schema migrations.
ALTER TABLE public.provider_profiles
  ADD COLUMN IF NOT EXISTS social_links JSONB;
