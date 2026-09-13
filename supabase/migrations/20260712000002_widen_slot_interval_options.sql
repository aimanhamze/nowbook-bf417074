-- Widen the slot_interval_minutes options introduced in 20260630000001 to also
-- allow 5 and 10 minute granularity. Default stays 15 for existing/new
-- providers; only the CHECK constraint changes.
ALTER TABLE public.provider_profiles
  DROP CONSTRAINT IF EXISTS provider_profiles_slot_interval_minutes_check;

ALTER TABLE public.provider_profiles
  ADD CONSTRAINT provider_profiles_slot_interval_minutes_check
  CHECK (slot_interval_minutes IN (5, 10, 15, 30, 45, 60));
