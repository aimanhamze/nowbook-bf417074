-- VERIFY for 20261108000004_academy_course_sessions.sql. Run on DEV.
-- §A is read-only. §B writes test rows inside a transaction that ROLLS BACK;
-- run it in the SQL editor (execute_sql via MCP gets declined for it).

-- §0 BEFORE applying — expect NULL (table does not exist yet).
SELECT to_regclass('public.academy_course_sessions');

-- §A AFTER applying.

-- A1. Columns. Expect 9; period is GENERATED ALWAYS (STORED) as
--     CASE WHEN (end_time > start_time)
--          THEN tsrange((session_date + start_time), (session_date + end_time), '[)')
--          ELSE NULL END
--     (the guard lets the CHECK, not tsrange, reject end-before-start rows).
SELECT column_name, data_type, is_nullable, column_default, is_generated, generation_expression
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'academy_course_sessions'
ORDER BY ordinal_position;

-- A2. Constraints. Expect:
--     FK (course_id, instructor_id) -> academy_courses(id, instructor_id) ON UPDATE CASCADE ON DELETE CASCADE
--     FK (course_id, provider_id)   -> academy_courses(id, provider_id)   ON DELETE CASCADE
--     CHECK (end_time > start_time)
--     EXCLUDE USING gist (instructor_id WITH =, period WITH &&)
--     PRIMARY KEY (id)
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'public.academy_course_sessions'::regclass
ORDER BY conname;

-- A3. Trigger. Expect one: trg_academy_course_sessions_fill_from_course BEFORE INSERT FOR EACH ROW.
SELECT tgname, pg_get_triggerdef(oid)
FROM pg_trigger
WHERE tgrelid = 'public.academy_course_sessions'::regclass AND NOT tgisinternal;

-- A4. Fill function: SECURITY INVOKER, search_path pinned to ''.
SELECT proname, prosecdef, proconfig
FROM pg_proc
WHERE oid = 'public.academy_course_sessions_fill_from_course()'::regprocedure;

-- A5. RLS on, two policies:
--     "Anyone can view academy course sessions"          SELECT {public}
--         USING course is_active AND provider is_visible
--     "Providers can manage own academy course sessions" ALL {authenticated}
--         USING owner; WITH CHECK owner AND category = 'academy'
SELECT relrowsecurity AS rls_enabled
FROM pg_class WHERE oid = 'public.academy_course_sessions'::regclass;
SELECT policyname, cmd, roles, qual, with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'academy_course_sessions'
ORDER BY policyname;

-- A6. Grants. Expect anon: SELECT. authenticated: DELETE, INSERT, SELECT, UPDATE.
SELECT grantee, string_agg(privilege_type, ', ' ORDER BY privilege_type) AS privs
FROM information_schema.role_table_grants
WHERE table_schema = 'public' AND table_name = 'academy_course_sessions'
  AND grantee IN ('anon', 'authenticated')
GROUP BY grantee ORDER BY grantee;

-- A7. Indexes. Expect pkey, the gist index behind the EXCLUDE on
--     (instructor_id, period), and btree (course_id, session_date).
SELECT indexdef FROM pg_indexes
WHERE schemaname = 'public' AND tablename = 'academy_course_sessions';

-- §B BEHAVIOUR (rolled back). Owner A = oldest provider with an owner, made a
--     visible 'academy' branch for the test; B = a provider with a different
--     owner, made visible so its course is readable (S10 must fail on RLS, not
--     on "course not found"). Instructors ia, ib2 on A; ib on B. Courses c1, c3, c_off (ia),
--     c2 (ib2), cb (B). All sessions on 2030-01-07 unless stated.
--     S1  client-sent instructor_id/provider_id are overwritten
--     S2  back-to-back (12:00 end / 12:00 start) allowed
--     S3  overlap, same instructor, different course -> 23P01
--     S4  overlap inside the same course -> 23P01
--     S5  different instructors may overlap
--     S6  reassigning a course to a busy instructor -> 23P01, nothing changed
--     S7  reassigning to a free instructor succeeds; sessions follow
--     S8  end_time <= start_time rejected
--     S9  client cannot edit a session's instructor_id directly
--     S10 owner cannot add a session to another branch's course
--     S11 anon: reads active/visible, not inactive course's session; cannot write
--     S12 stranger changes nothing
--     S13 non-academy branch cannot insert/update; owner still sees
--     S14 hidden branch: anon sees nothing, owner still sees
--     S15 deleting a course cascades to its sessions
--     A clean run returns ONE row: result = 'academy_course_sessions VERIFY §B:
--     all checks passed', leftover = 0. A failure stops with 'Sn FAILED: ...'.
BEGIN;
DO $$
DECLARE
  a_id uuid; a_user uuid; b_id uuid;
  ia uuid; ib2 uuid; ib uuid;
  c1 uuid; c2 uuid; c3 uuid; c_off uuid; cb uuid;
  s1 uuid; s2 uuid; s5 uuid; s_off uuid;
  d date := date '2030-01-07';
  got_i uuid; got_p uuid; n int;
BEGIN
  SELECT id, user_id INTO a_id, a_user FROM public.provider_profiles
    WHERE user_id IS NOT NULL ORDER BY created_at LIMIT 1;
  SELECT id INTO b_id FROM public.provider_profiles
    WHERE user_id IS DISTINCT FROM a_user ORDER BY created_at LIMIT 1;
  IF a_id IS NULL OR b_id IS NULL THEN
    RAISE EXCEPTION 'need two providers with different owners on DEV';
  END IF;

  UPDATE public.provider_profiles SET category = 'academy', is_visible = true WHERE id = a_id;
  UPDATE public.provider_profiles SET is_visible = true WHERE id = b_id;
  INSERT INTO public.academy_instructors (provider_id, name) VALUES (a_id, 'VERIFY ia') RETURNING id INTO ia;
  INSERT INTO public.academy_instructors (provider_id, name) VALUES (a_id, 'VERIFY ib2') RETURNING id INTO ib2;
  INSERT INTO public.academy_instructors (provider_id, name) VALUES (b_id, 'VERIFY ib') RETURNING id INTO ib;
  INSERT INTO public.academy_courses (provider_id, instructor_id, name, location_type, address, max_seats)
    VALUES (a_id, ia, 'VERIFY c1', 'physical', 'a', 5) RETURNING id INTO c1;
  INSERT INTO public.academy_courses (provider_id, instructor_id, name, location_type, address, max_seats)
    VALUES (a_id, ib2, 'VERIFY c2', 'physical', 'a', 5) RETURNING id INTO c2;
  INSERT INTO public.academy_courses (provider_id, instructor_id, name, location_type, address, max_seats)
    VALUES (a_id, ia, 'VERIFY c3', 'physical', 'a', 5) RETURNING id INTO c3;
  INSERT INTO public.academy_courses (provider_id, instructor_id, name, location_type, address, max_seats, is_active)
    VALUES (a_id, ia, 'VERIFY c_off', 'physical', 'a', 5, false) RETURNING id INTO c_off;
  INSERT INTO public.academy_courses (provider_id, instructor_id, name, location_type, address, max_seats)
    VALUES (b_id, ib, 'VERIFY cb', 'physical', 'a', 5) RETURNING id INTO cb;
  INSERT INTO public.academy_course_sessions (course_id, session_date, start_time, end_time)
    VALUES (c_off, d + 1, '10:00', '11:00') RETURNING id INTO s_off;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', a_user, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  INSERT INTO public.academy_course_sessions (course_id, provider_id, instructor_id, session_date, start_time, end_time)
    VALUES (c1, b_id, ib2, d, '10:00', '12:00')
    RETURNING id, instructor_id, provider_id INTO s1, got_i, got_p;
  IF got_i <> ia OR got_p <> a_id THEN
    RAISE EXCEPTION 'S1 FAILED: client values kept (instructor %, provider %)', got_i, got_p;
  END IF;

  INSERT INTO public.academy_course_sessions (course_id, session_date, start_time, end_time)
    VALUES (c3, d, '12:00', '13:00') RETURNING id INTO s2;

  BEGIN
    INSERT INTO public.academy_course_sessions (course_id, session_date, start_time, end_time)
      VALUES (c3, d, '11:00', '12:30');
    RAISE EXCEPTION 'S3 FAILED: overlapping session for the same instructor accepted';
  EXCEPTION WHEN exclusion_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO public.academy_course_sessions (course_id, session_date, start_time, end_time)
      VALUES (c1, d, '11:00', '11:30');
    RAISE EXCEPTION 'S4 FAILED: overlapping session inside the same course accepted';
  EXCEPTION WHEN exclusion_violation THEN NULL;
  END;

  INSERT INTO public.academy_course_sessions (course_id, session_date, start_time, end_time)
    VALUES (c2, d, '10:00', '12:00') RETURNING id INTO s5;

  BEGIN
    UPDATE public.academy_courses SET instructor_id = ia WHERE id = c2;
    RAISE EXCEPTION 'S6 FAILED: course reassigned to a busy instructor';
  EXCEPTION WHEN exclusion_violation THEN NULL;
  END;
  SELECT instructor_id INTO got_i FROM public.academy_courses WHERE id = c2;
  IF got_i <> ib2 THEN RAISE EXCEPTION 'S6 FAILED: course instructor changed to %', got_i; END IF;
  SELECT instructor_id INTO got_i FROM public.academy_course_sessions WHERE id = s5;
  IF got_i <> ib2 THEN RAISE EXCEPTION 'S6 FAILED: session instructor changed to %', got_i; END IF;

  UPDATE public.academy_courses SET instructor_id = ib2 WHERE id = c3;
  SELECT count(*) INTO n FROM public.academy_course_sessions WHERE course_id = c3 AND instructor_id = ib2;
  IF n <> 1 THEN RAISE EXCEPTION 'S7 FAILED: sessions did not follow the reassignment (% rows)', n; END IF;

  BEGIN
    INSERT INTO public.academy_course_sessions (course_id, session_date, start_time, end_time)
      VALUES (c1, d + 2, '10:00', '10:00');
    RAISE EXCEPTION 'S8 FAILED: end_time = start_time accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.academy_course_sessions (course_id, session_date, start_time, end_time)
      VALUES (c1, d + 2, '11:00', '10:00');
    RAISE EXCEPTION 'S8 FAILED: end_time < start_time accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  BEGIN
    UPDATE public.academy_course_sessions SET instructor_id = ia WHERE id = s2;
    RAISE EXCEPTION 'S9 FAILED: session instructor_id edited directly';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO public.academy_course_sessions (course_id, session_date, start_time, end_time)
      VALUES (cb, d + 3, '10:00', '11:00');
    RAISE EXCEPTION 'S10 FAILED: session added to another branch''s course';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  SET LOCAL ROLE anon;
  SELECT count(*) INTO n FROM public.academy_course_sessions WHERE id = s1;
  IF n <> 1 THEN RAISE EXCEPTION 'S11 FAILED: anon cannot read an active course''s session'; END IF;
  SELECT count(*) INTO n FROM public.academy_course_sessions WHERE id = s_off;
  IF n <> 0 THEN RAISE EXCEPTION 'S11 FAILED: anon reads an inactive course''s session'; END IF;
  BEGIN
    INSERT INTO public.academy_course_sessions (course_id, session_date, start_time, end_time)
      VALUES (c1, d + 4, '10:00', '11:00');
    RAISE EXCEPTION 'S11 FAILED: anon insert accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  RESET ROLE;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  UPDATE public.academy_course_sessions SET start_time = '09:00' WHERE id = s1;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'S12 FAILED: stranger updated % row(s)', n; END IF;
  DELETE FROM public.academy_course_sessions WHERE id = s1;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'S12 FAILED: stranger deleted % row(s)', n; END IF;

  RESET ROLE;
  UPDATE public.provider_profiles SET category = 'barber' WHERE id = a_id;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', a_user, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO public.academy_course_sessions (course_id, session_date, start_time, end_time)
      VALUES (c1, d + 5, '10:00', '11:00');
    RAISE EXCEPTION 'S13 FAILED: non-academy branch inserted a session';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    UPDATE public.academy_course_sessions SET start_time = '09:00' WHERE id = s1;
    RAISE EXCEPTION 'S13 FAILED: non-academy branch updated a session';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  SELECT count(*) INTO n FROM public.academy_course_sessions WHERE id = s1;
  IF n <> 1 THEN RAISE EXCEPTION 'S13 FAILED: owner lost sight of own session'; END IF;
  RESET ROLE;
  UPDATE public.provider_profiles SET category = 'academy', is_visible = false WHERE id = a_id;

  PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  SET LOCAL ROLE anon;
  SELECT count(*) INTO n FROM public.academy_course_sessions WHERE id = s1;
  IF n <> 0 THEN RAISE EXCEPTION 'S14 FAILED: anon reads a hidden branch''s session'; END IF;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', a_user, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.academy_course_sessions WHERE id = s1;
  IF n <> 1 THEN RAISE EXCEPTION 'S14 FAILED: owner cannot see own session on a hidden branch'; END IF;

  DELETE FROM public.academy_courses WHERE id = c1;
  SELECT count(*) INTO n FROM public.academy_course_sessions WHERE course_id = c1;
  IF n <> 0 THEN RAISE EXCEPTION 'S15 FAILED: % session(s) survived course delete', n; END IF;

  RESET ROLE;
END $$;
ROLLBACK;

SELECT 'academy_course_sessions VERIFY §B: all checks passed' AS result,
       (SELECT count(*) FROM public.academy_course_sessions)
     + (SELECT count(*) FROM public.academy_courses)
     + (SELECT count(*) FROM public.academy_instructors WHERE name LIKE 'VERIFY %') AS leftover;

-- §R ROLLBACK (only before migration 4 exists). Run by hand; it is a DROP.
-- DROP TABLE IF EXISTS public.academy_course_sessions;
-- DROP FUNCTION IF EXISTS public.academy_course_sessions_fill_from_course();
