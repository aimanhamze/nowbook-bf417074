-- VERIFY for 20261117000005_profiles_no_anon.sql (P1). DEV first, then PROD.
--
-- HOW TO RUN. The SQL editor shows only the LAST statement's result, so run
-- ONE block at a time (select it, then Run). Every block here is a single
-- statement; none ends on ROLLBACK.
--   §0, §A  catalog SELECTs — read-only, DEV and PROD.
--   §B1     ONE DO block, read-only, DEV and PROD. Ends in an ERROR on
--           purpose: "PASS: …" or "FAIL …".
--   §B2     ONE DO block, DEV ONLY (it inserts a test user; everything is
--           rolled back by the final exception). Ends "PASS: …" / "FAIL …".
--   §E      rollback.
--
-- ORDER: §0 → curl (before) → apply 20261117000005 → §A → §B1 → §B2 (DEV)
--        → curl (after) → smoke list.
--
-- THE REAL API ANSWER (run before and after; <ANON_KEY> is
-- VITE_SUPABASE_ANON_KEY, <REF> the project ref). In PowerShell use curl.exe.
--
--   curl.exe -s -i "https://<REF>.supabase.co/rest/v1/profiles?select=id&limit=1" -H "apikey: <ANON_KEY>" -H "Authorization: Bearer <ANON_KEY>"
--
--   BEFORE: HTTP 200 and a body like [{"id":"…"}]
--   AFTER:  HTTP 401 and {"code":"42501", … "message":"permission denied for table profiles"}
--   (An empty [] with 200 after applying would mean the grant is still there
--   and only the policy changed — tell me.)


-- ── §0 BEFORE applying ────────────────────────────────────────────────────

-- 0a. Table grants. Expect BEFORE: anon = SELECT,INSERT,UPDATE,DELETE,
--     TRUNCATE,REFERENCES,TRIGGER and authenticated the same list; rls = true.
--     Keep the authenticated list: §A1 must show it unchanged.
--     public_privs must be EMPTY (a grant to PUBLIC would survive a revoke
--     from anon — if it is not empty, stop and tell me).
SELECT c.relrowsecurity AS rls,
       array_to_string(ARRAY(
         SELECT p FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p
         WHERE has_table_privilege('anon', c.oid, p)), ',')          AS anon_privs,
       array_to_string(ARRAY(
         SELECT p FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p
         WHERE has_table_privilege('authenticated', c.oid, p)), ',') AS authenticated_privs,
       COALESCE((SELECT string_agg(a.privilege_type, ',')
                 FROM aclexplode(c.relacl) a WHERE a.grantee = 0), '') AS public_privs,
       c.relacl::text                                                AS acl
FROM pg_class c
WHERE c.oid = 'public.profiles'::regclass;

-- 0b. Every policy on profiles. Expect BEFORE on PROD, three rows:
--       "Users can view any profile"  SELECT  {public}  USING true
--       one UPDATE policy and one INSERT policy scoped to auth.uid() = user_id
--     Keep this output: §A2 must differ ONLY in the roles of the first row.
SELECT policyname, cmd, roles, permissive, qual AS using_expr, with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'profiles'
ORDER BY cmd, policyname;

-- 0c. Does a policy on ANOTHER table (public or storage) read profiles? Such
--     a policy runs as the querying role, so an anon read of that table would
--     start failing. Expect ZERO rows. Any row: stop and send it to me.
SELECT schemaname, tablename, policyname, cmd, roles, qual, with_check
FROM pg_policies
WHERE NOT (schemaname = 'public' AND tablename = 'profiles')
  AND (COALESCE(qual, '') || ' ' || COALESCE(with_check, '')) ~* '(^|[^_a-z])profiles([^_a-z]|$)';

-- 0d. Does anon call anything that reads profiles AS anon? Lists functions in
--     public whose body mentions profiles, that are SECURITY INVOKER, are not
--     trigger functions, and that anon may EXECUTE. Expect ZERO rows.
--     (SECURITY DEFINER functions are unaffected and not listed.)
SELECT p.oid::regprocedure AS function
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.prokind IN ('f', 'p')
  AND NOT p.prosecdef
  AND p.prorettype <> 'pg_catalog.trigger'::regtype
  AND has_function_privilege('anon', p.oid, 'EXECUTE')
  AND p.prosrc ~* '(^|[^_a-z])profiles([^_a-z]|$)';

-- 0e. Views over profiles (a view would be a second way in). Expect ZERO rows.
SELECT c.relname AS view_name
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind IN ('v', 'm')
  AND pg_get_viewdef(c.oid) ~* '(^|[^_a-z])profiles([^_a-z]|$)';

-- 0f. For the record: how many rows are exposed right now.
SELECT count(*) AS profiles, count(phone) AS with_phone FROM public.profiles;


-- ── §A AFTER applying ─────────────────────────────────────────────────────

-- A1. Grants. Expect: anon_privs EMPTY, authenticated_privs IDENTICAL to 0a,
--     public_privs empty, rls = true, and no 'anon=' entry in acl.
SELECT c.relrowsecurity AS rls,
       array_to_string(ARRAY(
         SELECT p FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p
         WHERE has_table_privilege('anon', c.oid, p)), ',')          AS anon_privs,
       array_to_string(ARRAY(
         SELECT p FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p
         WHERE has_table_privilege('authenticated', c.oid, p)), ',') AS authenticated_privs,
       COALESCE((SELECT string_agg(a.privilege_type, ',')
                 FROM aclexplode(c.relacl) a WHERE a.grantee = 0), '') AS public_privs,
       c.relacl::text                                                AS acl
FROM pg_class c
WHERE c.oid = 'public.profiles'::regclass;

-- A2. Policies. Expect the SAME rows as 0b with ONE difference:
--       "Users can view any profile"  roles = {authenticated}   (was {public})
--     using_expr is still true; the UPDATE and INSERT policies are unchanged.
SELECT policyname, cmd, roles, permissive, qual AS using_expr, with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'profiles'
ORDER BY cmd, policyname;

-- A3. One line. Expect: anon_can_select = false, auth_can_select = true,
--     select_policy_roles = {authenticated}, select_policies = 1.
SELECT has_table_privilege('anon', 'public.profiles', 'SELECT')          AS anon_can_select,
       has_table_privilege('authenticated', 'public.profiles', 'SELECT') AS auth_can_select,
       (SELECT roles FROM pg_policies
         WHERE schemaname = 'public' AND tablename = 'profiles'
           AND policyname = 'Users can view any profile')                AS select_policy_roles,
       (SELECT count(*) FROM pg_policies
         WHERE schemaname = 'public' AND tablename = 'profiles' AND cmd = 'SELECT') AS select_policies;


-- ── §B1 BEHAVIOUR, read-only — DEV and PROD ───────────────────────────────
--     ONE DO block. It reads only, and ends in an exception on purpose so the
--     editor shows the verdict:
--       ERROR: PASS: …      -> all three tests passed
--       ERROR: FAIL Tn: …   -> that test failed
--     T1 anon cannot read profiles (permission denied).
--     T2 a signed-in user still reads EVERY profile (P1 must not narrow it).
--     T3 a signed-in user still reads their own row, phone included.
DO $b1$
DECLARE
  v_total  bigint;
  v_uid    uuid;
  v_seen   bigint;
  v_own    bigint;
  v_denied boolean := false;
BEGIN
  SELECT count(*) INTO v_total FROM public.profiles;
  SELECT user_id INTO v_uid FROM public.profiles ORDER BY created_at LIMIT 1;
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'FAIL T0: profiles is empty on this database — nothing to test with';
  END IF;

  -- T1: anon
  BEGIN
    SET LOCAL ROLE anon;
    PERFORM 1 FROM public.profiles LIMIT 1;
  EXCEPTION WHEN insufficient_privilege THEN
    v_denied := true;
  END;
  RESET ROLE;
  IF NOT v_denied THEN
    RAISE EXCEPTION 'FAIL T1: anon can still SELECT from profiles — want permission denied';
  END IF;

  -- T2 + T3: authenticated, as an existing user
  PERFORM set_config('request.jwt.claims',
                     json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_seen FROM public.profiles;
  SELECT count(*) INTO v_own  FROM public.profiles WHERE user_id = v_uid;
  RESET ROLE;

  IF v_seen <> v_total THEN
    RAISE EXCEPTION 'FAIL T2: authenticated sees % of % profiles — P1 must not narrow it', v_seen, v_total;
  END IF;
  IF v_own <> 1 THEN
    RAISE EXCEPTION 'FAIL T3: authenticated sees % row(s) for its own user_id, want 1', v_own;
  END IF;

  RAISE EXCEPTION 'PASS: anon denied; authenticated reads all % profiles and its own row', v_total;
END;
$b1$;


-- ── §B2 SIGN-UP STILL CREATES A PROFILE — DEV ONLY ────────────────────────
--     ONE DO block. It inserts a throw-away row into auth.users the way a
--     sign-up does, so on_auth_user_created → handle_new_user fires, then
--     checks the profile row exists and that the new user can read it.
--     It ends in an exception on purpose, which rolls EVERYTHING back — no
--     user and no profile is left behind:
--       ERROR: PASS: …      -> sign-up still gets its profile row
--       ERROR: FAIL Tn: …   -> that test failed
--     DO NOT run on PROD: the same check there is the fresh sign-up in the
--     smoke list. (The insert runs as the editor's role, not as GoTrue's;
--     handle_new_user is SECURITY DEFINER, so what it does is the same.)
DO $b2$
DECLARE
  v_id    uuid := gen_random_uuid();
  v_phone text := '9720000' || lpad((floor(random() * 100000))::int::text, 5, '0');
  v_n     bigint;
BEGIN
  INSERT INTO auth.users (id, instance_id, aud, role, phone, phone_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  VALUES (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          v_phone, now(), '{"provider":"phone","providers":["phone"]}'::jsonb,
          '{}'::jsonb, now(), now());

  -- T1: the trigger wrote the profile row.
  SELECT count(*) INTO v_n FROM public.profiles WHERE user_id = v_id;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'FAIL T1: sign-up produced % profile row(s), want 1 — handle_new_user did not run', v_n;
  END IF;

  -- T2: the new user reads their own profile.
  PERFORM set_config('request.jwt.claims',
                     json_build_object('sub', v_id, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_id::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_n FROM public.profiles WHERE user_id = v_id;
  RESET ROLE;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'FAIL T2: the new user sees % row(s) for itself, want 1', v_n;
  END IF;

  -- T3: the new user can still save a name (the "update own" policy and the
  --     authenticated UPDATE grant are untouched).
  SET LOCAL ROLE authenticated;
  UPDATE public.profiles SET display_name = 'P1 verify' WHERE user_id = v_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RESET ROLE;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'FAIL T3: the new user updated % row(s) of its own profile, want 1', v_n;
  END IF;

  RAISE EXCEPTION 'PASS: sign-up created the profile; the new user can read and update it (all rolled back)';
END;
$b2$;


-- ── SMOKE LIST after PROD (in the app, not SQL) ───────────────────────────
--   1. Logged OUT: home, a provider page, an academy course page load as
--      before (none of them reads profiles).
--   2. Log in as a customer: lands in the app with no name screen; the home
--      header and /profile show the name.
--   3. Provider: calendar and pending list show customer names and phones;
--      Customers page and Packages show names.
--   4. Admin: Users page lists everyone.
--   5. A fresh sign-up: OTP → name screen → name saves → app opens.
--   6. curl (top of this file) now answers 401 / 42501.


-- ── §E ROLLBACK (only if needed; do NOT run as part of verification) ──────
--     This re-exposes every customer's name and phone to logged-out callers.
--     If something logged-out turns out to need a profile, tell me what it
--     is first — the fix is to give it that one thing, not this.
--     It restores SELECT only; anon's write grants are not coming back.
--
--   BEGIN;
--   ALTER POLICY "Users can view any profile" ON public.profiles TO public;
--   GRANT SELECT ON public.profiles TO anon;
--   COMMIT;
