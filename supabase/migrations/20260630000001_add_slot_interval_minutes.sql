-- Per-provider DISPLAY granularity for the customer's available-times grid.
-- `slot_interval_minutes` controls only the SPACING of the candidate start-times
-- shown to customers (and in the provider walk-in sheet): 15 → 09:00, 09:15,
-- 09:30…; 30 → 09:00, 09:30, 10:00…; etc.
--
-- DISPLAY-ONLY. This does NOT touch the conflict trigger
-- (prevent_booking_conflicts), service durations, or any overlap/booking logic.
-- The trigger enforces OVERLAPS, not start-time granularity, so offering 30-min
-- slots while the trigger still accepts any start time is safe — the trigger
-- never rejects a slot merely because of its granularity. The interval is
-- independent of service duration; the provider just picks the spacing.
--
-- NOT NULL DEFAULT 15 backfills every existing row to 15 on apply, so behavior
-- is unchanged at launch (the old hardcoded grid step was also 15). New
-- providers also default to 15.
--
-- CHECK (15,30,45,60) mirrors the UI's four options and protects the column from
-- out-of-range writes regardless of client.
ALTER TABLE public.provider_profiles
  ADD COLUMN IF NOT EXISTS slot_interval_minutes integer NOT NULL DEFAULT 15;

ALTER TABLE public.provider_profiles
  DROP CONSTRAINT IF EXISTS provider_profiles_slot_interval_minutes_check;

ALTER TABLE public.provider_profiles
  ADD CONSTRAINT provider_profiles_slot_interval_minutes_check
  CHECK (slot_interval_minutes IN (15, 30, 45, 60));
