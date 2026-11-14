-- VERIFY for 20261108000003_academy_courses.sql. Run on DEV.
-- §A is read-only. §B writes test rows inside a transaction that ROLLS BACK;
-- run it in the SQL editor (execute_sql via MCP gets declined for it).

-- §0 BEFORE applying — expect NULL (table does not exist yet).
SELECT to_regclass('public.academy_courses');

-- §A AFTER applying.

-- A1. Columns. Expect 15:
--     id uuid NO gen_random_uuid() | provider_id uuid NO | instructor_id uuid NO |
--     name text NO | description text YES | image_url text YES |
--     location_type text NO | address text YES | online_url text YES |
--     price numeric(10,2) YES | max_seats integer NO | cancellation_hours integer NO 24 |
--     is_active boolean NO true | created_at timestamptz NO now() | updated_at timestamptz NO now()
SELECT column_name, data_type, numeric_precision, numeric_scale, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'academy_courses'
ORDER BY ordinal_position;

-- A2. Constraints. Expect: pkey; FK provider_id -> provider_profiles ON DELETE CASCADE;
--     FK (instructor_id, provider_id) -> academy_instructors(id, provider_id);
--     UNIQUE (id, provider_id); UNIQUE (id, instructor_id);
--     CHECKs: name, description, location_type IN, location_consistency,
--     price >= 0, max_seats > 0, cancellation_hours >= 0.
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'public.academy_courses'::regclass
ORDER BY conname;

-- A3. Triggers. Expect two, both BEFORE ... FOR EACH ROW:
--     trg_academy_courses_require_active_instructor (INSERT OR UPDATE OF instructor_id, is_active)
--     trg_academy_courses_updated_at (UPDATE)
SELECT tgname, pg_get_triggerdef(oid)
FROM pg_trigger
WHERE tgrelid = 'public.academy_courses'::regclass AND NOT tgisinternal
ORDER BY tgname;

-- A4. Guard function: SECURITY INVOKER, search_path pinned to ''.
--     Expect: prosecdef = false, proconfig = {search_path=""}
SELECT proname, prosecdef, proconfig
FROM pg_proc
WHERE oid = 'public.academy_courses_require_active_instructor()'::regprocedure;

-- A5. RLS on, two policies:
--     "Anyone can view active academy courses"   SELECT {public}
--         USING is_active AND provider is_visible
--     "Providers can manage own academy courses" ALL    {authenticated}
--         USING owner; WITH CHECK owner AND category = 'academy'
SELECT relrowsecurity AS rls_enabled
FROM pg_class WHERE oid = 'public.academy_courses'::regclass;
SELECT policyname, cmd, roles, qual, with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'academy_courses'
ORDER BY policyname;

-- A6. Grants. Expect anon: SELECT. authenticated: DELETE, INSERT, SELECT, UPDATE.
SELECT grantee, string_agg(privilege_type, ', ' ORDER BY privilege_type) AS privs
FROM information_schema.role_table_grants
WHERE table_schema = 'public' AND table_name = 'academy_courses'
  AND grantee IN ('anon', 'authenticated')
GROUP BY grantee ORDER BY grantee;

-- §B BEHAVIOUR (rolled back). Owner A = the oldest provider with an owner,
--     temporarily made a visible 'academy' branch for the test (rolled back
--     with everything else); B = a provider with a different owner.
--     Each check RAISEs '<Bn> FAILED'
--     on failure, which aborts the whole block. A clean run returns ONE row:
--     result = 'academy_courses VERIFY §B: all checks passed', leftover = 0.
BEGIN;
DO $$
DECLARE
  a_id uuid; a_user uuid; b_id uuid;
  ia uuid; ia_off uuid; ib uuid;
  c1 uuid; c_off uuid; n int;
BEGIN
  SELECT id, user_id INTO a_id, a_user FROM public.provider_profiles
    WHERE user_id IS NOT NULL ORDER BY created_at LIMIT 1;
  SELECT id INTO b_id FROM public.provider_profiles
    WHERE user_id IS DISTINCT FROM a_user ORDER BY created_at LIMIT 1;
  IF a_id IS NULL OR b_id IS NULL THEN
    RAISE EXCEPTION 'need two providers with different owners on DEV';
  END IF;

  -- Fixtures, as postgres (bypasses RLS).
  UPDATE public.provider_profiles SET category = 'academy', is_visible = true WHERE id = a_id;
  INSERT INTO public.academy_instructors (provider_id, name)
    VALUES (a_id, 'VERIFY active') RETURNING id INTO ia;
  INSERT INTO public.academy_instructors (provider_id, name, is_active)
    VALUES (a_id, 'VERIFY inactive', false) RETURNING id INTO ia_off;
  INSERT INTO public.academy_instructors (provider_id, name)
    VALUES (b_id, 'VERIFY other branch') RETURNING id INTO ib;

  -- Act as owner A.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', a_user, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  -- B1. Owner creates a physical course with an active own instructor.
  INSERT INTO public.academy_courses
    (provider_id, instructor_id, name, location_type, address, max_seats, price)
    VALUES (a_id, ia, 'VERIFY course', 'physical', 'Main St 1', 10, 250)
    RETURNING id INTO c1;

  -- B1b. Online course with an https link and a NULL price is fine.
  INSERT INTO public.academy_courses
    (provider_id, instructor_id, name, location_type, online_url, max_seats)
    VALUES (a_id, ia, 'VERIFY online', 'online', 'https://meet.example.com/abc', 5);

  -- B2. Inactive instructor refused on insert.
  BEGIN
    INSERT INTO public.academy_courses
      (provider_id, instructor_id, name, location_type, address, max_seats)
      VALUES (a_id, ia_off, 'x', 'physical', 'a', 1);
    RAISE EXCEPTION 'B2 FAILED: inactive instructor accepted on insert';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM <> 'academy_instructor_inactive' THEN
      RAISE EXCEPTION 'B2 FAILED: wrong error %', SQLERRM;
    END IF;
  END;

  -- B3. Switching an active course to an inactive instructor refused.
  BEGIN
    UPDATE public.academy_courses SET instructor_id = ia_off WHERE id = c1;
    RAISE EXCEPTION 'B3 FAILED: switch to inactive instructor accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- B4. Inactive course may reference an inactive instructor (drafts/archive),
  --     but re-activating it is refused.
  INSERT INTO public.academy_courses
    (provider_id, instructor_id, name, location_type, address, max_seats, is_active)
    VALUES (a_id, ia_off, 'VERIFY archived', 'physical', 'a', 1, false)
    RETURNING id INTO c_off;
  BEGIN
    UPDATE public.academy_courses SET is_active = true WHERE id = c_off;
    RAISE EXCEPTION 'B4 FAILED: re-activation under inactive instructor accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- B5. Instructor from another branch refused by the composite FK.
  BEGIN
    INSERT INTO public.academy_courses
      (provider_id, instructor_id, name, location_type, address, max_seats)
      VALUES (a_id, ib, 'x', 'physical', 'a', 1);
    RAISE EXCEPTION 'B5 FAILED: cross-branch instructor accepted';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;

  -- B6. Location consistency.
  BEGIN
    INSERT INTO public.academy_courses (provider_id, instructor_id, name, location_type, max_seats)
      VALUES (a_id, ia, 'x', 'physical', 1);
    RAISE EXCEPTION 'B6 FAILED: physical without address accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.academy_courses (provider_id, instructor_id, name, location_type, address, online_url, max_seats)
      VALUES (a_id, ia, 'x', 'physical', 'a', 'https://x.example', 1);
    RAISE EXCEPTION 'B6 FAILED: physical with a link accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.academy_courses (provider_id, instructor_id, name, location_type, online_url, address, max_seats)
      VALUES (a_id, ia, 'x', 'online', 'https://x.example', 'a', 1);
    RAISE EXCEPTION 'B6 FAILED: online with an address accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.academy_courses (provider_id, instructor_id, name, location_type, online_url, max_seats)
      VALUES (a_id, ia, 'x', 'online', 'javascript:alert(1)', 1);
    RAISE EXCEPTION 'B6 FAILED: non-https link accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- B7. Numeric bounds.
  BEGIN
    INSERT INTO public.academy_courses (provider_id, instructor_id, name, location_type, address, max_seats, price)
      VALUES (a_id, ia, 'x', 'physical', 'a', 1, -1);
    RAISE EXCEPTION 'B7 FAILED: negative price accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.academy_courses (provider_id, instructor_id, name, location_type, address, max_seats)
      VALUES (a_id, ia, 'x', 'physical', 'a', 0);
    RAISE EXCEPTION 'B7 FAILED: max_seats = 0 accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.academy_courses (provider_id, instructor_id, name, location_type, address, max_seats, cancellation_hours)
      VALUES (a_id, ia, 'x', 'physical', 'a', 1, -1);
    RAISE EXCEPTION 'B7 FAILED: negative cancellation_hours accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- B8. Owner cannot create a course under another branch (WITH CHECK).
  BEGIN
    INSERT INTO public.academy_courses (provider_id, instructor_id, name, location_type, address, max_seats)
      VALUES (b_id, ib, 'x', 'physical', 'a', 1);
    RAISE EXCEPTION 'B8 FAILED: course under foreign branch accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  -- B9. Owner sees own inactive course.
  SELECT count(*) INTO n FROM public.academy_courses WHERE id = c_off;
  IF n <> 1 THEN RAISE EXCEPTION 'B9 FAILED: owner cannot see own inactive course'; END IF;

  -- B10. Instructor with courses cannot be hard-deleted.
  BEGIN
    DELETE FROM public.academy_instructors WHERE id = ia;
    RAISE EXCEPTION 'B10 FAILED: instructor with courses was deleted';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;

  -- B11. Anonymous: sees active course, not the inactive one; cannot write.
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  SET LOCAL ROLE anon;
  SELECT count(*) INTO n FROM public.academy_courses WHERE id = c1;
  IF n <> 1 THEN RAISE EXCEPTION 'B11 FAILED: anon cannot see active course'; END IF;
  SELECT count(*) INTO n FROM public.academy_courses WHERE id = c_off;
  IF n <> 0 THEN RAISE EXCEPTION 'B11 FAILED: anon sees inactive course'; END IF;
  BEGIN
    INSERT INTO public.academy_courses (provider_id, instructor_id, name, location_type, address, max_seats)
      VALUES (a_id, ia, 'anon', 'physical', 'a', 1);
    RAISE EXCEPTION 'B11 FAILED: anon insert accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  -- B12. A stranger (authenticated, not the owner) changes nothing.
  RESET ROLE;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  UPDATE public.academy_courses SET name = 'hijacked' WHERE id = c1;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'B12 FAILED: stranger updated % row(s)', n; END IF;
  DELETE FROM public.academy_courses WHERE id = c1;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'B12 FAILED: stranger deleted % row(s)', n; END IF;

  -- B13. A non-academy branch cannot create or save a course (WITH CHECK
  --      requires category = 'academy'), but its owner still sees and can
  --      delete existing ones (USING is owner-only).
  RESET ROLE;
  UPDATE public.provider_profiles SET category = 'barber' WHERE id = a_id;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', a_user, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO public.academy_courses (provider_id, instructor_id, name, location_type, address, max_seats)
      VALUES (a_id, ia, 'x', 'physical', 'a', 1);
    RAISE EXCEPTION 'B13 FAILED: non-academy branch created a course';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    UPDATE public.academy_courses SET name = 'renamed' WHERE id = c1;
    RAISE EXCEPTION 'B13 FAILED: non-academy branch updated a course';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  SELECT count(*) INTO n FROM public.academy_courses WHERE id = c1;
  IF n <> 1 THEN RAISE EXCEPTION 'B13 FAILED: owner lost sight of own course'; END IF;
  RESET ROLE;
  UPDATE public.provider_profiles SET category = 'academy' WHERE id = a_id;

  -- B14. Hidden branch: anon cannot read its active course; the owner can.
  UPDATE public.provider_profiles SET is_visible = false WHERE id = a_id;
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  SET LOCAL ROLE anon;
  SELECT count(*) INTO n FROM public.academy_courses WHERE id = c1;
  IF n <> 0 THEN RAISE EXCEPTION 'B14 FAILED: anon reads a hidden branch''s course'; END IF;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', a_user, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.academy_courses WHERE id = c1;
  IF n <> 1 THEN RAISE EXCEPTION 'B14 FAILED: owner cannot see own course on a hidden branch'; END IF;

  -- B15. Deactivating an instructor with active courses is allowed (by design).
  UPDATE public.academy_instructors SET is_active = false WHERE id = ia;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'B15 FAILED: could not deactivate instructor with courses'; END IF;

  RESET ROLE;
END $$;
ROLLBACK;

SELECT 'academy_courses VERIFY §B: all checks passed' AS result,
       (SELECT count(*) FROM public.academy_courses)
     + (SELECT count(*) FROM public.academy_instructors WHERE name LIKE 'VERIFY %') AS leftover;

-- §R ROLLBACK (only before migration 3 exists; sessions reference it).
-- DROP TABLE IF EXISTS public.academy_courses;
-- DROP FUNCTION IF EXISTS public.academy_courses_require_active_instructor();
