-- Add geographic coordinates to provider_profiles for the upcoming map feature.
ALTER TABLE public.provider_profiles
  ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;
