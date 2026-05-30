ALTER TABLE public.provider_profiles
  ADD COLUMN IF NOT EXISTS is_visible boolean NOT NULL DEFAULT true;

UPDATE public.provider_profiles SET is_visible = true WHERE is_visible IS NULL;