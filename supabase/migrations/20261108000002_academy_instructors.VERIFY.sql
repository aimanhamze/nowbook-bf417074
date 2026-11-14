-- VERIFY for 20261108000002_academy_instructors.sql. Run on DEV.
-- §A is read-only. §B writes test rows inside a transaction that ROLLS BACK.

-- §0 BEFORE applying — expect NULL (table does not exist yet).
SELECT to_regclass('public.academy_instructors');

-- §A AFTER applying.

-- A1. Columns. Expect exactly 8, and no phone/email/contact column:
--     id uuid NO gen_random_uuid() | provider_id uuid NO | name text NO |
--     bio text YES | photo_url text YES | is_active boolean NO true |
--     display_order integer NO 0 | created_at timestamptz NO now()
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'academy_instructors'
ORDER BY ordinal_position;

-- A2. Constraints. Expect: pkey (id); UNIQUE (id, provider_id);
--     FK provider_id -> provider_profiles(id) ON DELETE CASCADE;
--     CHECKs on name length and bio length.
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'public.academy_instructors'::regclass
ORDER BY conname;

-- A3. RLS on, two policies:
--     "Anyone can view academy instructors"          SELECT {public}        true
--     "Providers can manage own academy instructors" ALL    {authenticated} owner / owner
SELECT c.relrowsecurity AS rls_enabled
FROM pg_class c WHERE c.oid = 'public.academy_instructors'::regclass;
SELECT policyname, cmd, roles, qual, with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'academy_instructors'
ORDER BY policyname;

-- A4. Grants. Expect anon: SELECT only. authenticated: SELECT, INSERT, UPDATE,
--     DELETE (no TRUNCATE / TRIGGER / REFERENCES).
SELECT grantee, string_agg(privilege_type, ', ' ORDER BY privilege_type) AS privs
FROM information_schema.role_table_grants
WHERE table_schema = 'public' AND table_name = 'academy_instructors'
  AND grantee IN ('anon', 'authenticated')
GROUP BY grantee ORDER BY grantee;

-- §B BEHAVIOUR (rolled back). Uses two existing providers: A = owner under
--     test, B = someone else's branch. Each check RAISEs on failure; a clean
--     run ends with NOTICE 'academy_instructors VERIFY §B: all checks passed'.
BEGIN;
DO $$
DECLARE
  a_id uuid; a_user uuid; b_id uuid; ins_id uuid; n int;
BEGIN
  SELECT id, user_id INTO a_id, a_user FROM public.provider_profiles
    WHERE user_id IS NOT NULL ORDER BY created_at LIMIT 1;
  SELECT id INTO b_id FROM public.provider_profiles
    WHERE user_id IS DISTINCT FROM a_user ORDER BY created_at LIMIT 1;
  IF a_id IS NULL OR b_id IS NULL THEN
    RAISE EXCEPTION 'need two providers with different owners on DEV';
  END IF;

  -- Act as owner A.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', a_user, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  -- B1. Owner can insert into own branch.
  INSERT INTO public.academy_instructors (provider_id, name)
    VALUES (a_id, 'Verify Instructor') RETURNING id INTO ins_id;

  -- B2. Owner cannot insert into another branch (WITH CHECK).
  BEGIN
    INSERT INTO public.academy_instructors (provider_id, name) VALUES (b_id, 'x');
    RAISE EXCEPTION 'B2 FAILED: insert into foreign branch was allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  -- B3. Owner cannot move own row to another branch (WITH CHECK on UPDATE).
  BEGIN
    UPDATE public.academy_instructors SET provider_id = b_id WHERE id = ins_id;
    RAISE EXCEPTION 'B3 FAILED: moving a row to a foreign branch was allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  -- B4. Blank name rejected.
  BEGIN
    INSERT INTO public.academy_instructors (provider_id, name) VALUES (a_id, '   ');
    RAISE EXCEPTION 'B4 FAILED: blank name accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- B5. Anonymous caller: can read, cannot write.
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  SET LOCAL ROLE anon;
  SELECT count(*) INTO n FROM public.academy_instructors WHERE id = ins_id;
  IF n <> 1 THEN RAISE EXCEPTION 'B5 FAILED: anon cannot read instructor'; END IF;
  BEGIN
    INSERT INTO public.academy_instructors (provider_id, name) VALUES (a_id, 'anon');
    RAISE EXCEPTION 'B5 FAILED: anon insert allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  -- B6. Another authenticated user (not A) cannot update or delete A's row:
  --     RLS hides it from the write, so 0 rows are affected.
  RESET ROLE;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  UPDATE public.academy_instructors SET name = 'hijacked' WHERE id = ins_id;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'B6 FAILED: stranger updated % row(s)', n; END IF;
  DELETE FROM public.academy_instructors WHERE id = ins_id;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'B6 FAILED: stranger deleted % row(s)', n; END IF;

  RESET ROLE;
  RAISE NOTICE 'academy_instructors VERIFY §B: all checks passed';
END $$;
ROLLBACK;

-- §R ROLLBACK (only before migration 2 exists; academy_courses references it).
-- DROP TABLE IF EXISTS public.academy_instructors;
