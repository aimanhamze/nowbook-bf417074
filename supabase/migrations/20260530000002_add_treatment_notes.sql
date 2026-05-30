ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS treatment_notes text;

ALTER TABLE public.provider_profiles
  ADD COLUMN IF NOT EXISTS treatment_notes_enabled boolean NOT NULL DEFAULT false;