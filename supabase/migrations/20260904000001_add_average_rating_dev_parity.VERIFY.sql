-- VERIFY for 20260904000001_add_average_rating_dev_parity.sql
-- Run on DEV after applying. All checks are read-only.

-- V1. The column exists with the PROD shape.
--     Expect exactly one row: numeric | YES | (null default)
SELECT data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name  = 'provider_profiles'
  AND column_name = 'average_rating';

-- V2. The query that was broken now parses and runs.
--     Expect: rows returned (average_rating will be NULL -- see the scope
--     limit note in the migration; NULL is the expected DEV value).
SELECT id, business_name, category, average_rating
FROM public.provider_profiles
LIMIT 5;

-- V3. Whole-table parity against PROD. Run this on BOTH projects and compare
--     the two strings; after this migration they should be identical.
SELECT string_agg(column_name || ':' || data_type, ', ' ORDER BY column_name)
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'provider_profiles';
