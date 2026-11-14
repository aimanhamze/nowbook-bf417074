-- VERIFY for 20261108000006_course_registration_rpcs.sql. Run on DEV.
-- §A is read-only. §B calls the RPCs inside a transaction that ROLLS BACK;
-- run it in the SQL editor (execute_sql via MCP gets declined for it).

-- §0 BEFORE applying — expect ZERO rows.
SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND proname IN ('register_for_course', 'cancel_course_registration',
                  'decide_course_registration', 'get_course_seat_counts');

-- §A AFTER applying.

-- A1. Signatures, SECURITY DEFINER, pinned search_path, and who can EXECUTE.
--     Expect 4 rows, all secdef = true, config = {search_path=""}:
--     cancel_course_registration (p_registration_id uuid) void           anon f  auth t
--     decide_course_registration (p_registration_id uuid, p_decision text) void anon f auth t
--     get_course_seat_counts (p_course_ids uuid[]) TABLE(course_id uuid, max_seats integer,
--         taken integer, free integer)  STABLE                         anon t  auth t
--     register_for_course (p_course_id uuid) uuid                        anon f  auth t
--     PUBLIC must not appear in any acl (no '=X/' entry).
SELECT p.proname,
       pg_get_function_identity_arguments(p.oid) AS args,
       pg_get_function_result(p.oid)             AS result,
       p.prosecdef                               AS secdef,
       p.proconfig                               AS config,
       p.provolatile                             AS volatility,
       has_function_privilege('anon', p.oid, 'EXECUTE')          AS anon_exec,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_exec,
       p.proacl::text                            AS acl
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('register_for_course', 'cancel_course_registration',
                    'decide_course_registration', 'get_course_seat_counts')
ORDER BY p.proname;

-- A2. course_registrations is still read-only for clients (unchanged by this
--     migration). Expect ONE row: authenticated | SELECT.
SELECT grantee, string_agg(privilege_type, ', ' ORDER BY privilege_type) AS privs
FROM information_schema.role_table_grants
WHERE table_schema = 'public' AND table_name = 'course_registrations'
  AND grantee IN ('anon', 'authenticated')
GROUP BY grantee;

-- §B BEHAVIOUR (rolled back). Branch A (owner a_user) is made a visible
--     academy branch; owner b_user runs another branch; u1, u2, u3 own no
--     branch. All dates are relative to Asia/Jerusalem "today" (ln):
--       c1     max 2 seats, 24h window, session ln+10d 10:00-11:00
--       c2     max 5 seats,             session ln+12d 10:00-11:00
--       c_win  48h window,              session ln+1d 23:00-23:30 (always 23-47h ahead)
--       c_past                          sessions ln-1d and ln+5d (already started)
--       c_empty no sessions; c_off inactive
--     P1  customer registers -> pending, owner notified (course_registration_new)
--     P2  seat limit counts pending: third customer on a 2-seat course -> COURSE_FULL
--     P3  duplicate active registration -> ALREADY_REGISTERED
--     P4  owner cannot register for own course -> CANNOT_REGISTER_OWN_COURSE
--     P5  another provider (other branch owner) can register
--     P6  decide: pending->confirmed; confirmed->rejected refused (NOT_PENDING);
--         bad decision -> INVALID_DECISION; pending->rejected
--     P7  non-owner cannot decide -> REGISTRATION_NOT_FOUND
--     P8  rejection frees a seat
--     P9  customer cancels inside the window
--     P10 re-register after rejected
--     P11 re-register after cancelled
--     P12 customer cancel past the window -> CANCELLATION_WINDOW_CLOSED
--     P13 owner cancels the same one -> ok, cancelled_by = 'provider'
--     P14 register for a started course -> COURSE_ALREADY_STARTED
--     P15 customer cancel after start -> COURSE_ALREADY_STARTED
--     P16 owner cancel after start -> ok
--     P17 no sessions -> COURSE_HAS_NO_SESSIONS; P18 inactive -> COURSE_NOT_AVAILABLE
--     P19 stranger cancel -> REGISTRATION_NOT_FOUND
--     P20 cancel an already-cancelled registration -> REGISTRATION_NOT_ACTIVE
--     P21 anon seat counts: counts only for active courses of visible branches
--     P22 anon cannot call register / cancel / decide
--     P23 hidden branch: no seat counts, registration refused
--     P24 non-academy branch: registration refused
--     P25 direct table writes still fail for customer and owner
--     P26 notification rows of all four types reach the right users
--     A clean run returns ONE row: result = 'course_registration_rpcs VERIFY §B:
--     all checks passed', leftover = 0. A failure stops with 'Pn FAILED: ...'.
BEGIN;
DO $$
DECLARE
  a_id uuid; a_user uuid; b_id uuid; b_user uuid;
  u1 uuid; u2 uuid; u3 uuid;
  ia uuid;
  c1 uuid; c2 uuid; c_win uuid; c_past uuid; c_empty uuid; c_off uuid;
  r1 uuid; r2 uuid; r3 uuid; r_b uuid; r_c2 uuid; r_w uuid; r_p uuid;
  v_ln timestamp := now() AT TIME ZONE 'Asia/Jerusalem';
  v_status text; v_by text; v_taken int; v_free int; n int;
BEGIN
  SELECT id, user_id INTO a_id, a_user FROM public.provider_profiles
    WHERE user_id IS NOT NULL ORDER BY created_at LIMIT 1;
  SELECT id, user_id INTO b_id, b_user FROM public.provider_profiles
    WHERE user_id IS NOT NULL AND user_id <> a_user ORDER BY created_at LIMIT 1;
  SELECT u.id INTO u1 FROM auth.users u
    WHERE NOT EXISTS (SELECT 1 FROM public.provider_profiles p WHERE p.user_id = u.id)
    ORDER BY u.created_at LIMIT 1;
  SELECT u.id INTO u2 FROM auth.users u
    WHERE NOT EXISTS (SELECT 1 FROM public.provider_profiles p WHERE p.user_id = u.id)
      AND u.id <> u1
    ORDER BY u.created_at LIMIT 1;
  SELECT u.id INTO u3 FROM auth.users u
    WHERE NOT EXISTS (SELECT 1 FROM public.provider_profiles p WHERE p.user_id = u.id)
      AND u.id NOT IN (u1, u2)
    ORDER BY u.created_at LIMIT 1;
  IF a_id IS NULL OR b_id IS NULL OR u1 IS NULL OR u2 IS NULL OR u3 IS NULL THEN
    RAISE EXCEPTION 'need two provider owners and three non-provider users on DEV';
  END IF;

  UPDATE public.provider_profiles SET category = 'academy', is_visible = true WHERE id = a_id;
  INSERT INTO public.academy_instructors (provider_id, name) VALUES (a_id, 'VERIFY ia') RETURNING id INTO ia;
  INSERT INTO public.academy_courses (provider_id, instructor_id, name, location_type, address, max_seats, cancellation_hours)
    VALUES (a_id, ia, 'VERIFY c1', 'physical', 'a', 2, 24) RETURNING id INTO c1;
  INSERT INTO public.academy_courses (provider_id, instructor_id, name, location_type, address, max_seats)
    VALUES (a_id, ia, 'VERIFY c2', 'physical', 'a', 5) RETURNING id INTO c2;
  INSERT INTO public.academy_courses (provider_id, instructor_id, name, location_type, address, max_seats, cancellation_hours)
    VALUES (a_id, ia, 'VERIFY c_win', 'physical', 'a', 5, 48) RETURNING id INTO c_win;
  INSERT INTO public.academy_courses (provider_id, instructor_id, name, location_type, address, max_seats)
    VALUES (a_id, ia, 'VERIFY c_past', 'physical', 'a', 5) RETURNING id INTO c_past;
  INSERT INTO public.academy_courses (provider_id, instructor_id, name, location_type, address, max_seats)
    VALUES (a_id, ia, 'VERIFY c_empty', 'physical', 'a', 5) RETURNING id INTO c_empty;
  INSERT INTO public.academy_courses (provider_id, instructor_id, name, location_type, address, max_seats, is_active)
    VALUES (a_id, ia, 'VERIFY c_off', 'physical', 'a', 5, false) RETURNING id INTO c_off;
  INSERT INTO public.academy_course_sessions (course_id, session_date, start_time, end_time) VALUES
    (c1,     v_ln::date + 10, '10:00', '11:00'),
    (c2,     v_ln::date + 12, '10:00', '11:00'),
    (c_win,  v_ln::date + 1,  '23:00', '23:30'),
    (c_past, v_ln::date - 1,  '10:00', '11:00'),
    (c_past, v_ln::date + 5,  '10:00', '11:00'),
    (c_off,  v_ln::date + 14, '10:00', '11:00');
  INSERT INTO public.course_registrations (course_id, provider_id, user_id, status, decided_at)
    VALUES (c_past, a_id, u1, 'confirmed', now()) RETURNING id INTO r_p;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', u1, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  r1 := public.register_for_course(c1);
  SELECT status INTO v_status FROM public.course_registrations WHERE id = r1;
  IF v_status IS DISTINCT FROM 'pending' THEN RAISE EXCEPTION 'P1 FAILED: status %', v_status; END IF;

  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u2, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  r2 := public.register_for_course(c1);

  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u3, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.register_for_course(c1);
    RAISE EXCEPTION 'P2 FAILED: no error';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'COURSE_FULL' THEN RAISE EXCEPTION 'P2 FAILED: got %', SQLERRM; END IF;
  END;

  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u1, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.register_for_course(c1);
    RAISE EXCEPTION 'P3 FAILED: no error';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'ALREADY_REGISTERED' THEN RAISE EXCEPTION 'P3 FAILED: got %', SQLERRM; END IF;
  END;

  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', a_user, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.register_for_course(c2);
    RAISE EXCEPTION 'P4 FAILED: no error';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'CANNOT_REGISTER_OWN_COURSE' THEN RAISE EXCEPTION 'P4 FAILED: got %', SQLERRM; END IF;
  END;

  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', b_user, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  r_b := public.register_for_course(c2);
  IF r_b IS NULL THEN RAISE EXCEPTION 'P5 FAILED: other provider could not register'; END IF;

  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', a_user, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM public.decide_course_registration(r1, 'confirmed');
  SELECT status INTO v_status FROM public.course_registrations WHERE id = r1;
  IF v_status <> 'confirmed' THEN RAISE EXCEPTION 'P6 FAILED: r1 status %', v_status; END IF;
  BEGIN
    PERFORM public.decide_course_registration(r1, 'rejected');
    RAISE EXCEPTION 'P6 FAILED: no error';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'REGISTRATION_NOT_PENDING' THEN RAISE EXCEPTION 'P6 FAILED: got %', SQLERRM; END IF;
  END;
  BEGIN
    PERFORM public.decide_course_registration(r2, 'maybe');
    RAISE EXCEPTION 'P6 FAILED: no error';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'INVALID_DECISION' THEN RAISE EXCEPTION 'P6 FAILED: got %', SQLERRM; END IF;
  END;
  PERFORM public.decide_course_registration(r2, 'rejected');
  SELECT status INTO v_status FROM public.course_registrations WHERE id = r2;
  IF v_status <> 'rejected' THEN RAISE EXCEPTION 'P6 FAILED: r2 status %', v_status; END IF;

  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u1, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.decide_course_registration(r_b, 'confirmed');
    RAISE EXCEPTION 'P7 FAILED: no error';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'REGISTRATION_NOT_FOUND' THEN RAISE EXCEPTION 'P7 FAILED: got %', SQLERRM; END IF;
  END;

  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u3, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  r3 := public.register_for_course(c1);
  PERFORM public.cancel_course_registration(r3);
  SELECT status, cancelled_by INTO v_status, v_by FROM public.course_registrations WHERE id = r3;
  IF v_status <> 'cancelled' OR v_by <> 'customer' THEN
    RAISE EXCEPTION 'P9 FAILED: % / %', v_status, v_by;
  END IF;
  r_c2 := public.register_for_course(c2);
  PERFORM public.cancel_course_registration(r_c2);
  PERFORM public.register_for_course(c2);

  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u2, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM public.register_for_course(c1);
  BEGIN
    PERFORM public.register_for_course(c_past);
    RAISE EXCEPTION 'P14 FAILED: no error';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'COURSE_ALREADY_STARTED' THEN RAISE EXCEPTION 'P14 FAILED: got %', SQLERRM; END IF;
  END;

  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u1, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  r_w := public.register_for_course(c_win);
  BEGIN
    PERFORM public.cancel_course_registration(r_w);
    RAISE EXCEPTION 'P12 FAILED: no error';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'CANCELLATION_WINDOW_CLOSED' THEN RAISE EXCEPTION 'P12 FAILED: got %', SQLERRM; END IF;
  END;
  BEGIN
    PERFORM public.cancel_course_registration(r_p);
    RAISE EXCEPTION 'P15 FAILED: no error';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'COURSE_ALREADY_STARTED' THEN RAISE EXCEPTION 'P15 FAILED: got %', SQLERRM; END IF;
  END;
  BEGIN
    PERFORM public.register_for_course(c_empty);
    RAISE EXCEPTION 'P17 FAILED: no error';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'COURSE_HAS_NO_SESSIONS' THEN RAISE EXCEPTION 'P17 FAILED: got %', SQLERRM; END IF;
  END;
  BEGIN
    PERFORM public.register_for_course(c_off);
    RAISE EXCEPTION 'P18 FAILED: no error';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'COURSE_NOT_AVAILABLE' THEN RAISE EXCEPTION 'P18 FAILED: got %', SQLERRM; END IF;
  END;

  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', a_user, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM public.cancel_course_registration(r_w);
  SELECT status, cancelled_by INTO v_status, v_by FROM public.course_registrations WHERE id = r_w;
  IF v_status <> 'cancelled' OR v_by <> 'provider' THEN
    RAISE EXCEPTION 'P13 FAILED: % / %', v_status, v_by;
  END IF;
  PERFORM public.cancel_course_registration(r_p);
  SELECT status, cancelled_by INTO v_status, v_by FROM public.course_registrations WHERE id = r_p;
  IF v_status <> 'cancelled' OR v_by <> 'provider' THEN
    RAISE EXCEPTION 'P16 FAILED: % / %', v_status, v_by;
  END IF;

  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.cancel_course_registration(r1);
    RAISE EXCEPTION 'P19 FAILED: no error';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'REGISTRATION_NOT_FOUND' THEN RAISE EXCEPTION 'P19 FAILED: got %', SQLERRM; END IF;
  END;

  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u1, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.cancel_course_registration(r_w);
    RAISE EXCEPTION 'P20 FAILED: no error';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'REGISTRATION_NOT_ACTIVE' THEN RAISE EXCEPTION 'P20 FAILED: got %', SQLERRM; END IF;
  END;

  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  SET LOCAL ROLE anon;
  SELECT taken, free INTO v_taken, v_free FROM public.get_course_seat_counts(ARRAY[c1, c_off]) s WHERE s.course_id = c1;
  IF v_taken IS DISTINCT FROM 2 OR v_free IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'P21 FAILED: c1 taken % free %', v_taken, v_free;
  END IF;
  SELECT count(*) INTO n FROM public.get_course_seat_counts(ARRAY[c1, c_off]);
  IF n <> 1 THEN RAISE EXCEPTION 'P21 FAILED: % rows (inactive course leaked?)', n; END IF;
  BEGIN
    PERFORM public.register_for_course(c2);
    RAISE EXCEPTION 'P22 FAILED: anon register accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.cancel_course_registration(r1);
    RAISE EXCEPTION 'P22 FAILED: anon cancel accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.decide_course_registration(r_b, 'confirmed');
    RAISE EXCEPTION 'P22 FAILED: anon decide accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  RESET ROLE;
  UPDATE public.provider_profiles SET is_visible = false WHERE id = a_id;
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  SET LOCAL ROLE anon;
  SELECT count(*) INTO n FROM public.get_course_seat_counts(ARRAY[c1, c2]);
  IF n <> 0 THEN RAISE EXCEPTION 'P23 FAILED: hidden branch returned % seat rows', n; END IF;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u1, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.register_for_course(c2);
    RAISE EXCEPTION 'P23 FAILED: no error';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'COURSE_NOT_AVAILABLE' THEN RAISE EXCEPTION 'P23 FAILED: got %', SQLERRM; END IF;
  END;

  RESET ROLE;
  UPDATE public.provider_profiles SET is_visible = true, category = 'barber' WHERE id = a_id;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u1, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.register_for_course(c2);
    RAISE EXCEPTION 'P24 FAILED: no error';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'COURSE_NOT_AVAILABLE' THEN RAISE EXCEPTION 'P24 FAILED: got %', SQLERRM; END IF;
  END;
  RESET ROLE;
  UPDATE public.provider_profiles SET category = 'academy' WHERE id = a_id;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', u1, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO public.course_registrations (course_id, provider_id, user_id) VALUES (c2, a_id, u1);
    RAISE EXCEPTION 'P25 FAILED: customer INSERT accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', a_user, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    UPDATE public.course_registrations SET status = 'confirmed', decided_at = now() WHERE id = r_b;
    RAISE EXCEPTION 'P25 FAILED: owner UPDATE accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  RESET ROLE;
  SELECT count(*) INTO n FROM public.notifications
    WHERE created_at = now() AND user_id = a_user AND type = 'course_registration_new';
  IF n < 1 THEN RAISE EXCEPTION 'P26 FAILED: owner got no course_registration_new'; END IF;
  SELECT count(*) INTO n FROM public.notifications
    WHERE created_at = now() AND user_id = u1 AND type = 'course_registration_confirmed';
  IF n <> 1 THEN RAISE EXCEPTION 'P26 FAILED: u1 course_registration_confirmed count %', n; END IF;
  SELECT count(*) INTO n FROM public.notifications
    WHERE created_at = now() AND user_id = u2 AND type = 'course_registration_rejected';
  IF n <> 1 THEN RAISE EXCEPTION 'P26 FAILED: u2 course_registration_rejected count %', n; END IF;
  SELECT count(*) INTO n FROM public.notifications
    WHERE created_at = now() AND user_id = a_user AND type = 'course_registration_cancelled';
  IF n < 1 THEN RAISE EXCEPTION 'P26 FAILED: owner got no course_registration_cancelled'; END IF;
  SELECT count(*) INTO n FROM public.notifications
    WHERE created_at = now() AND user_id = u1 AND type = 'course_registration_cancelled';
  IF n <> 2 THEN RAISE EXCEPTION 'P26 FAILED: u1 course_registration_cancelled count % (expected 2)', n; END IF;
  SELECT count(*) INTO n FROM public.notifications
    WHERE created_at = now() AND type = 'course_registration_new' AND user_id <> a_user;
  IF n <> 0 THEN RAISE EXCEPTION 'P26 FAILED: course_registration_new sent to % non-owner(s)', n; END IF;
END $$;
ROLLBACK;

SELECT 'course_registration_rpcs VERIFY §B: all checks passed' AS result,
       (SELECT count(*) FROM public.course_registrations)
     + (SELECT count(*) FROM public.academy_course_sessions)
     + (SELECT count(*) FROM public.academy_courses)
     + (SELECT count(*) FROM public.academy_instructors WHERE name LIKE 'VERIFY %')
     + (SELECT count(*) FROM public.notifications WHERE type LIKE 'course_registration_%') AS leftover;

-- §R ROLLBACK (only before migration 6 exists). Run by hand; these are DROPs.
-- DROP FUNCTION IF EXISTS public.register_for_course(uuid);
-- DROP FUNCTION IF EXISTS public.cancel_course_registration(uuid);
-- DROP FUNCTION IF EXISTS public.decide_course_registration(uuid, text);
-- DROP FUNCTION IF EXISTS public.get_course_seat_counts(uuid[]);
