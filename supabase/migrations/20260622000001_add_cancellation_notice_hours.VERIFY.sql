-- ============================================================================
-- VERIFICATION for 20260622000001_add_cancellation_notice_hours.sql
-- Run in the Supabase SQL editor. NOT part of the migration.
-- ============================================================================

-- BEFORE (run before applying the migration): column should be ABSENT → 0 rows.
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'provider_profiles'
  AND column_name = 'cancellation_notice_hours';
-- expect BEFORE: (0 rows)

-- AFTER (run after applying): column PRESENT, integer, NOT NULL, default 5.
-- expect AFTER: cancellation_notice_hours | integer | NO | 5
--   (re-run the SELECT above)

-- AFTER: every existing row backfilled to 5 (no NULLs, no out-of-range values).
SELECT
  count(*)                                                          AS total_rows,
  count(*) FILTER (WHERE cancellation_notice_hours IS NULL)         AS nulls,         -- expect: 0
  count(*) FILTER (WHERE cancellation_notice_hours = 5)             AS at_default_5,  -- expect: total_rows
  count(*) FILTER (WHERE cancellation_notice_hours NOT BETWEEN 0 AND 72) AS out_of_range -- expect: 0
FROM public.provider_profiles;

-- AFTER: spot-check a sample row shows 5.
SELECT id, business_name, cancellation_notice_hours  -- expect: cancellation_notice_hours = 5
FROM public.provider_profiles
LIMIT 1;

-- AFTER: the CHECK constraint exists and rejects out-of-range writes.
-- (Optional) this should ERROR with a check_violation, proving the guard works:
--   UPDATE public.provider_profiles SET cancellation_notice_hours = 99 WHERE id = (SELECT id FROM public.provider_profiles LIMIT 1);

-- ============================================================================
-- POST-APPLY: regenerate the generated types so the column is typed in the app:
--   supabase gen types typescript --linked > src/integrations/supabase/types.ts
-- (Until then, the app reads/writes the column via a defensive cast, matching
--  the existing booking_window_days / deposit_request_enabled pattern.)
-- ============================================================================
