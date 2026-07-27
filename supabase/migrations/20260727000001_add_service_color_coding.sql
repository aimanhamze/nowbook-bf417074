-- Service color coding (opt-in, per provider).
--
-- `provider_profiles.service_colors_enabled` is the MASTER switch. While false
-- (the default for every existing and new provider) the calendar renders exactly
-- as before and the color pickers stay hidden — the per-row `color` columns are
-- simply ignored. Nothing about booking, availability or conflict logic reads
-- these columns; they are DISPLAY-ONLY.
--
-- `color` lives on both bookable entities so each provider category is covered:
--   • provider_services      → regular providers (barber, salon, …)
--   • provider_class_schedule → fitness_studio classes
--
-- NOT NULL DEFAULT '#f97316' (orange) backfills every existing row on apply, so
-- a provider who flips the master toggle on sees a consistent orange calendar
-- until they assign per-service colors.
--
-- The CHECK constrains the column to a 6-digit hex literal regardless of client,
-- so the UI can interpolate it straight into a style attribute.

ALTER TABLE public.provider_profiles
  ADD COLUMN IF NOT EXISTS service_colors_enabled boolean NOT NULL DEFAULT false;

ALTER TABLE public.provider_services
  ADD COLUMN IF NOT EXISTS color text NOT NULL DEFAULT '#f97316';

ALTER TABLE public.provider_class_schedule
  ADD COLUMN IF NOT EXISTS color text NOT NULL DEFAULT '#f97316';

ALTER TABLE public.provider_services
  DROP CONSTRAINT IF EXISTS provider_services_color_check;

ALTER TABLE public.provider_services
  ADD CONSTRAINT provider_services_color_check
  CHECK (color ~ '^#[0-9a-fA-F]{6}$');

ALTER TABLE public.provider_class_schedule
  DROP CONSTRAINT IF EXISTS provider_class_schedule_color_check;

ALTER TABLE public.provider_class_schedule
  ADD CONSTRAINT provider_class_schedule_color_check
  CHECK (color ~ '^#[0-9a-fA-F]{6}$');
