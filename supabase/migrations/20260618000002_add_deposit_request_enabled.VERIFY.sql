-- ============================================================================
-- VERIFICATION for 20260618000002_add_deposit_request_enabled.sql
-- Run in the Supabase SQL editor. NOT part of the migration.
-- ============================================================================

-- BEFORE (run before applying the migration): column should be ABSENT → 0 rows.
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'provider_profiles'
  AND column_name = 'deposit_request_enabled';
-- expect BEFORE: (0 rows)

-- AFTER (run after applying): column PRESENT, boolean, NOT NULL, default false.
-- expect AFTER: deposit_request_enabled | boolean | NO | false
--   (re-run the SELECT above)

-- AFTER: every existing row backfilled to false (no NULLs, no true).
SELECT
  count(*)                                          AS total_rows,
  count(*) FILTER (WHERE deposit_request_enabled IS NULL)  AS nulls,        -- expect: 0
  count(*) FILTER (WHERE deposit_request_enabled IS TRUE)  AS opted_in,     -- expect: 0 (all start false)
  count(*) FILTER (WHERE deposit_request_enabled IS FALSE) AS opted_out     -- expect: total_rows
FROM public.provider_profiles;

-- AFTER: spot-check a sample row shows false.
SELECT id, business_name, deposit_request_enabled  -- expect: deposit_request_enabled = false
FROM public.provider_profiles
LIMIT 1;

-- ============================================================================
-- POST-APPLY: regenerate the generated types so the column is typed in the app:
--   supabase gen types typescript --linked > src/integrations/supabase/types.ts
-- (Until then, the app reads/writes the column via a defensive cast, matching
--  the existing booking_window_days pattern in BookingSettingsTab.tsx.)
-- ============================================================================
