-- VERIFY for 20260712000001_add_monthly_availability.sql
-- Read-only checks to run AFTER applying the migration. Each should return the
-- described result; none of these mutate data.

-- 1. New provider_profiles columns present with correct defaults.
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'provider_profiles'
  AND column_name IN ('availability_mode','monthly_default_start',
                      'monthly_default_end','monthly_default_available')
ORDER BY column_name;
-- Expect 4 rows:
--   availability_mode          text    NO  'weekly'::text
--   monthly_default_available  boolean NO  true
--   monthly_default_end        text    NO  '17:00'::text
--   monthly_default_start      text    NO  '09:00'::text

-- 2. CHECK constraint on availability_mode exists.
SELECT conname, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'public.provider_profiles'::regclass
  AND conname = 'provider_profiles_availability_mode_check';
-- Expect: CHECK (availability_mode = ANY (ARRAY['weekly','monthly']))

-- 3. THE SAFETY CHECK: every existing provider is 'weekly' (zero behavior change).
SELECT availability_mode, COUNT(*) AS providers
FROM public.provider_profiles
GROUP BY availability_mode;
-- Expect a single row: weekly | <total provider count>. Any 'monthly' here would
-- be unexpected in Phase 1 (no UI writes it yet).

-- 4. New table + unique constraint exist.
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'provider_date_overrides'
ORDER BY ordinal_position;

SELECT tc.constraint_type, kcu.column_name
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
  ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
WHERE tc.table_schema = 'public'
  AND tc.table_name = 'provider_date_overrides'
  AND tc.constraint_type IN ('PRIMARY KEY','UNIQUE','FOREIGN KEY')
ORDER BY tc.constraint_type, kcu.column_name;
-- Expect UNIQUE on (provider_id, override_date), PK on id, FK on provider_id.

-- 5. RLS enabled + policies mirror provider_availability (public SELECT + owner ALL).
SELECT polname, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'provider_date_overrides'
ORDER BY polname;
-- Expect:
--   "Anyone can view date overrides"       SELECT  qual = true
--   "Provider manages own date overrides"  ALL     owner check in USING + WITH CHECK
