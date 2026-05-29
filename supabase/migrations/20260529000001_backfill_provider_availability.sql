-- Backfill provider_availability so every provider has exactly 7 rows (day_of_week 0–6).
--
-- Why: provider_availability was never seeded on provider creation, and the dashboard
-- only writes a row when a day is actively toggled/edited. Days never touched had no row.
-- Three readers diverged on missing rows: getAvailableSlots / getGroupSlotsWithCapacity /
-- the dashboard display fabricated "Sun–Thu open 09:00–17:00", while WeeklyHoursTable and
-- providerStatus honestly reported "Closed". This made the same provider show different
-- hours on different pages.
--
-- Fix: make provider_availability the single source of truth — every provider always has
-- all 7 rows. The defaults below match the old fabricated fallback 1:1, so existing
-- provider behavior is preserved exactly:
--   day_of_week 0–4 (Sun–Thu) → is_available = true,  09:00–17:00
--   day_of_week 5–6 (Fri–Sat) → is_available = false, 09:00–17:00
--
-- Idempotent: ON CONFLICT on the UNIQUE (provider_id, day_of_week) constraint means
-- existing rows are NEVER touched, and re-running the migration is a no-op.

INSERT INTO public.provider_availability (provider_id, day_of_week, start_time, end_time, is_available)
SELECT
  pp.id            AS provider_id,
  dow              AS day_of_week,
  '09:00'          AS start_time,
  '17:00'          AS end_time,
  (dow BETWEEN 0 AND 4) AS is_available
FROM public.provider_profiles pp
CROSS JOIN generate_series(0, 6) AS dow
ON CONFLICT (provider_id, day_of_week) DO NOTHING;
