-- VERIFY for 20261003000001_multi_branch_provider_profiles.sql
-- Every check here is READ-ONLY; nothing below mutates data.
--
-- Check 0 runs BEFORE applying (it captures what the migration drops).
-- Checks 1–8 run AFTER applying. Check 8 is the SAFETY check: the claim of this
-- migration is "zero behaviour change", and that claim rests on every owner
-- still having exactly one row until an admin runs create-branch.

-- 0) PRE-APPLY — save this output. The two provider_availability policies the
--    migration drops exist in no migration file, so this is the only record of
--    their exact definitions. Expect two rows, both with
--      provider_id = ( SELECT provider_profiles.id FROM provider_profiles
--                      WHERE (provider_profiles.user_id = auth.uid()))
--    in qual and/or with_check.
SELECT policyname, cmd, roles, permissive, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename  = 'provider_availability'
  AND policyname IN ('Provider can insert own availability',
                     'Provider can update own availability');

-- For the record, the two provider_profiles policies the migration drops, as
-- they were live at Phase 0 (2026-10-03):
--   "Providers can insert own profile"  INSERT  TO public  WITH CHECK (auth.uid() = user_id)
--   "Providers can delete own profile"  DELETE  TO public  USING      (auth.uid() = user_id)


-- 1) The UNIQUE on user_id is gone. Expect exactly one row:
--      provider_profiles_pkey : PRIMARY KEY (id)
--    If provider_profiles_user_id_key still appears, the migration did not apply.
SELECT conname, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'public.provider_profiles'::regclass
  AND contype IN ('u', 'p')
ORDER BY conname;

-- 2) The plain (NON-unique) owner index exists. Expect a row:
--      idx_provider_profiles_user_id : CREATE INDEX ... USING btree (user_id)
--    The word UNIQUE must NOT appear in its indexdef. provider_profiles_pkey is
--    listed too; no provider_profiles_user_id_key index may remain.
SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public' AND tablename = 'provider_profiles'
ORDER BY indexname;

-- 3) provider_availability policies. Expect exactly two rows:
--      "Anyone can view availability"       SELECT  qual = true
--      "Provider manages own availability"  ALL     PERMISSIVE
--          qual and with_check both: provider_id IN ( SELECT provider_profiles.id ... )
--    Neither "Provider can insert own availability" nor "Provider can update own
--    availability" may appear.
SELECT policyname, cmd, permissive, roles, qual, with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'provider_availability'
ORDER BY cmd, policyname;

-- 4) provider_profiles policies. Expect exactly four rows:
--      "Admins can delete any provider profile"  DELETE  {authenticated}  admin EXISTS
--      "Anyone can view provider profiles"       SELECT  {public}         true
--      "Admins can update any provider_profile"  UPDATE  {authenticated}  admin EXISTS
--      "Providers can update own profile"        UPDATE  {public}         auth.uid() = user_id
--    NO INSERT row: creation is service-role only (create-provider,
--    create-branch), which bypasses RLS.
--    NOTE the SELECT policy exposes user_id publicly (`select *`), so anyone can
--    already see which listings share an owner. Known, ticketed separately —
--    not changed here.
SELECT policyname, cmd, roles, qual, with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'provider_profiles'
ORDER BY cmd, policyname;

-- 5) No policy anywhere still resolves the caller's provider row through a
--    scalar subquery. Expect ZERO rows. (The migration also guards this; this is
--    the after-the-fact confirmation.)
SELECT tablename, policyname, cmd
FROM pg_policies
WHERE schemaname = 'public'
  AND (   coalesce(qual, '')       ~* '=\s*\(\s*SELECT[^)]*FROM\s+(public\.)?provider_profiles[^)]*user_id\s*=\s*auth\.uid\(\)'
       OR coalesce(with_check, '') ~* '=\s*\(\s*SELECT[^)]*FROM\s+(public\.)?provider_profiles[^)]*user_id\s*=\s*auth\.uid\(\)');

-- 6) REVIEW, not pass/fail: functions that look up provider_profiles by the
--    caller. A plpgsql `SELECT ... INTO v FROM provider_profiles WHERE user_id =
--    auth.uid()` does not error with two rows — it silently takes ONE, which is
--    worse. Expect only EXISTS (... pp.id = X AND pp.user_id = auth.uid())
--    ownership checks (package RPCs, duration-override trigger). Read the
--    `snippet` of each row; anything that is not an EXISTS by provider id is a
--    multi-branch bug.
SELECT p.proname,
       substring(p.prosrc FROM '(?i)[^;]{0,120}provider_profiles[^;]{0,160}auth\.uid\(\)[^;]{0,40}') AS snippet
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.prosrc ~* 'provider_profiles'
  AND p.prosrc ~* 'auth\.uid\(\)'
ORDER BY p.proname;

-- 7) KNOWN DRIFT, deliberately untouched: provider_class_schedule has duplicate
--    ALL policies. Listed here only so their presence is not mistaken for a
--    regression from this migration. Expect the same rows as before applying.
SELECT policyname, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'provider_class_schedule'
ORDER BY cmd, policyname;

-- 8) SAFETY: every owner still has exactly one row. Expect ZERO rows.
--    Until an admin runs create-branch for a real owner this must stay empty.
--    After that, the only rows here should be owners an admin deliberately
--    gave a second branch.
SELECT user_id, count(*) AS branches, array_agg(business_name ORDER BY created_at) AS names
FROM public.provider_profiles
GROUP BY user_id
HAVING count(*) > 1;
