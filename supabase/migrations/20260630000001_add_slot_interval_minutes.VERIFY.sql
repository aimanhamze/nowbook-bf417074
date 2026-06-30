-- ============================================================================
-- VERIFICATION for 20260630000001_add_slot_interval_minutes.sql
-- Run in the Supabase SQL editor. NOT part of the migration.
-- ============================================================================

-- BEFORE (run before applying the migration): column should be ABSENT → 0 rows.
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'provider_profiles'
  AND column_name = 'slot_interval_minutes';
-- expect BEFORE: (0 rows)

-- AFTER (run after applying): column PRESENT, integer, NOT NULL, default 15.
-- expect AFTER: slot_interval_minutes | integer | NO | 15
--   (re-run the SELECT above)

-- AFTER: every existing row backfilled to 15 (no NULLs, no out-of-range values).
SELECT
  count(*)                                                              AS total_rows,
  count(*) FILTER (WHERE slot_interval_minutes IS NULL)                 AS nulls,          -- expect: 0
  count(*) FILTER (WHERE slot_interval_minutes = 15)                    AS at_default_15,  -- expect: total_rows
  count(*) FILTER (WHERE slot_interval_minutes NOT IN (15,30,45,60))    AS out_of_range    -- expect: 0
FROM public.provider_profiles;

-- AFTER: spot-check a sample row shows 15.
SELECT id, business_name, slot_interval_minutes  -- expect: slot_interval_minutes = 15
FROM public.provider_profiles
LIMIT 1;

-- AFTER: the CHECK constraint exists and rejects out-of-range writes.
-- (Optional) this should ERROR with a check_violation, proving the guard works:
--   UPDATE public.provider_profiles SET slot_interval_minutes = 20 WHERE id = (SELECT id FROM public.provider_profiles LIMIT 1);

-- ============================================================================
-- POST-APPLY: regenerate the generated types so the column is typed in the app:
--   supabase gen types typescript --linked > src/integrations/supabase/types.ts
-- (Until then, the app reads/writes the column via a defensive cast, matching
--  the existing booking_window_days / cancellation_notice_hours pattern.)
-- ============================================================================
