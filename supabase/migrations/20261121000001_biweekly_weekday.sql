-- "Every 2 weeks" option for a weekday in the weekly schedule.
--
-- A provider who works a weekday only every other week (e.g. every second
-- Friday) marks that weekday's provider_availability row with
-- repeat_every_weeks = 2 and a repeat_anchor_date: one date he WORKS, which
-- must fall on that row's weekday. A date on that weekday is a working day when
-- it is an even number of weeks from the anchor, and closed otherwise.
-- The rule is applied by resolveDayHours (src/lib/availabilityResolver.ts and
-- its copy in supabase/functions/_shared), in step 3 only, so blocked dates and
-- date-openings still override it.
--
-- WHY AN ANCHOR DATE, NOT ODD/EVEN ISO WEEKS. 2026 has 53 ISO weeks, so week
-- parity flips at New Year (week 53 and week 1 are both odd). Counting weeks
-- from a stored date never drifts.
--
-- DEFAULT UNCHANGED. Every existing row gets repeat_every_weeks = 1 and a NULL
-- anchor, which the resolver treats exactly as today (every week). Adding a
-- NOT NULL column with a constant default does not rewrite the table.
--
-- day_of_week NUMBERING: 0 = Sunday … 6 = Saturday — confirmed on PROD
-- 2026-11-21 (min 0, max 6; Friday = 5, Saturday = 6 most closed). That is the
-- same numbering as Postgres EXTRACT(DOW …), which the CHECK below relies on.
--
-- NO grants, functions or RLS changes. anon/authenticated hold table-level
-- privileges on provider_availability (no column-level grants), so the new
-- columns are covered by the existing grants automatically.
--
-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  ⚠  DEPLOY ORDER — REQUIRED                                              ║
-- ║                                                                          ║
-- ║    1. THIS MIGRATION  on DEV, then PROD                                  ║
-- ║    2. EDGE FUNCTION   waitlist-dispatch (its select names the columns)   ║
-- ║    3. THE APP         (Home pill query names the columns too)            ║
-- ║                                                                          ║
-- ║  The migration alone is SAFE: the current app and function never read    ║
-- ║  the new columns, and every row stays repeat_every_weeks = 1.            ║
-- ║                                                                          ║
-- ║  Rollback runs in REVERSE: app -> function -> VERIFY §E.                 ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

-- 1. The columns.
ALTER TABLE public.provider_availability
  ADD COLUMN IF NOT EXISTS repeat_every_weeks smallint NOT NULL DEFAULT 1;

ALTER TABLE public.provider_availability
  ADD COLUMN IF NOT EXISTS repeat_anchor_date date NULL;

-- 2. Only every week (1) or every 2 weeks (2).
ALTER TABLE public.provider_availability
  DROP CONSTRAINT IF EXISTS provider_availability_repeat_every_weeks_check;

ALTER TABLE public.provider_availability
  ADD CONSTRAINT provider_availability_repeat_every_weeks_check
  CHECK (repeat_every_weeks IN (1, 2));

-- 3. Every 2 weeks needs an anchor, and the anchor must fall on this row's
--    weekday. With 1 the anchor is not checked (the app writes NULL there).
ALTER TABLE public.provider_availability
  DROP CONSTRAINT IF EXISTS provider_availability_repeat_anchor_check;

ALTER TABLE public.provider_availability
  ADD CONSTRAINT provider_availability_repeat_anchor_check
  CHECK (
    repeat_every_weeks = 1
    OR (
      repeat_anchor_date IS NOT NULL
      AND EXTRACT(DOW FROM repeat_anchor_date) = day_of_week
    )
  );
