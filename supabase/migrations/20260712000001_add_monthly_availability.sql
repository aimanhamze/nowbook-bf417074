-- Opt-in MONTHLY availability (Phase 1: schema only, no UI).
--
-- Most providers use the fixed WEEKLY pattern in provider_availability and are
-- UNAFFECTED by this migration: availability_mode DEFAULT 'weekly' backfills
-- every existing row, so the client's weekly branch (today's exact behavior) is
-- chosen for all of them. Monthly mode is strictly additive and opt-in.
--
-- Monthly model: one flat default window applied to every day of the month
-- (monthly_default_*), plus per-DATE overrides in provider_date_overrides for
-- the specific dates that differ (different hours or closed). Blocked dates
-- (provider_blocked_dates) still always win and are checked first in BOTH modes.
--
-- No trigger / bookings-RLS change: the conflict + lead-time triggers never read
-- availability; monthly hours are resolved purely client-side (useRealAvailability).
--
-- NOTE: uuid default uses gen_random_uuid() to match the existing
-- provider_availability / provider_blocked_dates tables (built-in in PG13+),
-- rather than uuid_generate_v4() which would require the uuid-ossp extension.
--
-- Regenerate src/integrations/supabase/types.ts after applying this migration.

-- ── 1. provider_profiles: mode flag + flat monthly default ───────────────────
-- All four columns are NOT NULL DEFAULT, so every existing provider is backfilled
-- to weekly / 09:00–17:00 / open with zero behavior change. Times are stored as
-- text to mirror how the client reads start_time/end_time (it parses "HH:MM"
-- strings directly), matching the provider_availability convention.
ALTER TABLE public.provider_profiles
  ADD COLUMN IF NOT EXISTS availability_mode        text    NOT NULL DEFAULT 'weekly',
  ADD COLUMN IF NOT EXISTS monthly_default_start     text    NOT NULL DEFAULT '09:00',
  ADD COLUMN IF NOT EXISTS monthly_default_end       text    NOT NULL DEFAULT '17:00',
  ADD COLUMN IF NOT EXISTS monthly_default_available boolean NOT NULL DEFAULT true;

-- Guard the mode column against out-of-range writes regardless of client.
ALTER TABLE public.provider_profiles
  DROP CONSTRAINT IF EXISTS provider_profiles_availability_mode_check;

ALTER TABLE public.provider_profiles
  ADD CONSTRAINT provider_profiles_availability_mode_check
  CHECK (availability_mode IN ('weekly', 'monthly'));

-- ── 2. provider_date_overrides: per-date exceptions for monthly mode ─────────
-- Mirrors provider_blocked_dates conventions (UUID PK gen_random_uuid, FK ON
-- DELETE CASCADE, UNIQUE(provider_id, date)). Carries a full day window like a
-- provider_availability row (is_available + start/end + optional single break)
-- so an override can change hours OR close the day. break_* are time NULL to
-- match provider_availability's break columns exactly.
CREATE TABLE IF NOT EXISTS public.provider_date_overrides (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id   uuid NOT NULL REFERENCES public.provider_profiles(id) ON DELETE CASCADE,
  override_date date NOT NULL,
  is_available  boolean NOT NULL DEFAULT true,
  start_time    text NOT NULL DEFAULT '09:00',
  end_time      text NOT NULL DEFAULT '17:00',
  break_start   time NULL,
  break_end     time NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider_id, override_date)
);

ALTER TABLE public.provider_date_overrides ENABLE ROW LEVEL SECURITY;

-- ── 3. RLS: mirror provider_availability's CURRENT policies EXACTLY ───────────
-- provider_availability (after 20260425000001) has:
--   * "Anyone can view availability"  FOR SELECT USING (true)  → public read.
--     The customer slot logic reads availability anonymously; overrides must be
--     readable the SAME way or monthly customers would see wrong hours.
--   * "Provider manages own availability" FOR ALL with USING + WITH CHECK on
--     provider ownership.
-- We replicate both verbatim for the new table (drop-then-create = idempotent).
DROP POLICY IF EXISTS "Anyone can view date overrides"        ON public.provider_date_overrides;
DROP POLICY IF EXISTS "Provider manages own date overrides"   ON public.provider_date_overrides;

CREATE POLICY "Anyone can view date overrides"
  ON public.provider_date_overrides FOR SELECT
  USING (true);

CREATE POLICY "Provider manages own date overrides"
  ON public.provider_date_overrides FOR ALL
  USING (
    provider_id IN (
      SELECT id FROM public.provider_profiles WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    provider_id IN (
      SELECT id FROM public.provider_profiles WHERE user_id = auth.uid()
    )
  );

-- Index the customer-facing lookup path (provider_id, override_date). The UNIQUE
-- constraint above already covers this, but an explicit index documents intent.
CREATE INDEX IF NOT EXISTS idx_provider_date_overrides_provider_date
  ON public.provider_date_overrides (provider_id, override_date);
