-- VERIFY for 20261108000007_academy_category_guard.sql. Run on DEV.
-- §A is read-only. §B writes test rows inside a transaction that ROLLS BACK;
-- run it in the SQL editor (execute_sql via MCP gets declined for it).

-- §0 BEFORE applying — expect ZERO rows.
SELECT tgname FROM pg_trigger
WHERE tgrelid = 'public.provider_profiles'::regclass
  AND tgname = 'trg_provider_profiles_academy_category_guard';

-- §A AFTER applying.

-- A1. Trigger: BEFORE UPDATE OF category, FOR EACH ROW,
--     WHEN ((old.category = 'academy') AND (new.category IS DISTINCT FROM 'academy')),
--     enabled ('O').
SELECT tgname, tgenabled, pg_get_triggerdef(oid)
FROM pg_trigger
WHERE tgrelid = 'public.provider_profiles'::regclass
  AND tgname = 'trg_provider_profiles_academy_category_guard';

-- A2. Function: SECURITY DEFINER, search_path = "", not executable by
--     anon/authenticated (trigger firing does not need EXECUTE).
SELECT prosecdef, proconfig, proacl::text,
       has_function_privilege('anon', oid, 'EXECUTE')          AS anon_exec,
       has_function_privilege('authenticated', oid, 'EXECUTE') AS auth_exec
FROM pg_proc
WHERE oid = 'public.guard_academy_category_change()'::regprocedure;

-- A3. Existing provider_profiles triggers are untouched. Expect 4:
--     trg_enforce_staff_enable_no_future_bookings, trg_provider_profiles_academy_category_guard,
--     trg_provider_profiles_updated_at, trg_waitlist_close_on_disable
SELECT tgname FROM pg_trigger
WHERE tgrelid = 'public.provider_profiles'::regclass AND NOT tgisinternal
ORDER BY tgname;

-- §B BEHAVIOUR (rolled back). Branch A is made a visible academy branch with
--     four courses:
--       cF  future session        pending u1 + confirmed u2   (live)
--       cE  no sessions           pending u3                  (live)
--       cP  session 3 days ago    confirmed u1                (finished, not live)
--       cR  future session        rejected u1 + cancelled u2  (not live)
--     Branch B is set to 'barber'.
--     G1  owner blocked, DETAIL starts with '3 live course registration(s)'
--     G2  admin blocked (proves SECURITY DEFINER: admins cannot read registrations)
--     G3  service_role blocked; postgres blocked
--     G4  unrelated updates on the academy branch still work, incl. category = same value
--     G5  only the no-sessions course is live -> still blocked, DETAIL '1 ...'
--     G6  only finished + rejected/cancelled remain -> change allowed
--     G7  back to academy; a pending on the future cR blocks; cancelling it unblocks
--     G8  non-academy branch changes category freely
--     A clean run returns ONE row: result = 'academy_category_guard VERIFY §B:
--     all checks passed', leftover = 0. A failure stops with 'Gn FAILED: ...'.
BEGIN;
DO $$
DECLARE
  a_id uuid; a_user uuid; b_id uuid; adm uuid;
  u1 uuid; u2 uuid; u3 uuid;
  ia uuid; cF uuid; cE uuid; cP uuid; cR uuid;
  rF1 uuid; rF2 uuid; rE uuid; rX uuid;
  v_ln timestamp := now() AT TIME ZONE 'Asia/Jerusalem';
  v_msg text; v_detail text; v_cat text; n int;
BEGIN
  SELECT id, user_id INTO a_id, a_user FROM public.provider_profiles
    WHERE user_id IS NOT NULL ORDER BY created_at LIMIT 1;
  SELECT id INTO b_id FROM public.provider_profiles
    WHERE id <> a_id ORDER BY created_at LIMIT 1;
  SELECT ur.user_id INTO adm FROM public.user_roles ur
    WHERE ur.role = 'admin' AND ur.user_id <> a_user LIMIT 1;
  SELECT u.id INTO u1 FROM auth.users u
    WHERE NOT EXISTS (SELECT 1 FROM public.provider_profiles p WHERE p.user_id = u.id)
      AND NOT EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = u.id AND r.role = 'admin')
    ORDER BY u.created_at LIMIT 1;
  SELECT u.id INTO u2 FROM auth.users u
    WHERE NOT EXISTS (SELECT 1 FROM public.provider_profiles p WHERE p.user_id = u.id)
      AND NOT EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = u.id AND r.role = 'admin')
      AND u.id <> u1
    ORDER BY u.created_at LIMIT 1;
  SELECT u.id INTO u3 FROM auth.users u
    WHERE NOT EXISTS (SELECT 1 FROM public.provider_profiles p WHERE p.user_id = u.id)
      AND NOT EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = u.id AND r.role = 'admin')
      AND u.id NOT IN (u1, u2)
    ORDER BY u.created_at LIMIT 1;
  IF a_id IS NULL OR b_id IS NULL OR adm IS NULL OR u1 IS NULL OR u2 IS NULL OR u3 IS NULL THEN
    RAISE EXCEPTION 'need two providers, an admin and three plain customers on DEV';
  END IF;

  UPDATE public.provider_profiles SET category = 'academy', is_visible = true WHERE id = a_id;
  UPDATE public.provider_profiles SET category = 'barber' WHERE id = b_id;
  INSERT INTO public.academy_instructors (provider_id, name) VALUES (a_id, 'VERIFY ia') RETURNING id INTO ia;
  INSERT INTO public.academy_courses (provider_id, instructor_id, name, location_type, address, max_seats)
    VALUES (a_id, ia, 'VERIFY cF', 'physical', 'a', 5) RETURNING id INTO cF;
  INSERT INTO public.academy_courses (provider_id, instructor_id, name, location_type, address, max_seats)
    VALUES (a_id, ia, 'VERIFY cE', 'physical', 'a', 5) RETURNING id INTO cE;
  INSERT INTO public.academy_courses (provider_id, instructor_id, name, location_type, address, max_seats)
    VALUES (a_id, ia, 'VERIFY cP', 'physical', 'a', 5) RETURNING id INTO cP;
  INSERT INTO public.academy_courses (provider_id, instructor_id, name, location_type, address, max_seats)
    VALUES (a_id, ia, 'VERIFY cR', 'physical', 'a', 5) RETURNING id INTO cR;
  INSERT INTO public.academy_course_sessions (course_id, session_date, start_time, end_time) VALUES
    (cF, v_ln::date + 10, '10:00', '11:00'),
    (cP, v_ln::date - 3,  '10:00', '11:00'),
    (cR, v_ln::date + 20, '10:00', '11:00');
  INSERT INTO public.course_registrations (course_id, provider_id, user_id)
    VALUES (cF, a_id, u1) RETURNING id INTO rF1;
  INSERT INTO public.course_registrations (course_id, provider_id, user_id, status, decided_at)
    VALUES (cF, a_id, u2, 'confirmed', now()) RETURNING id INTO rF2;
  INSERT INTO public.course_registrations (course_id, provider_id, user_id)
    VALUES (cE, a_id, u3) RETURNING id INTO rE;
  INSERT INTO public.course_registrations (course_id, provider_id, user_id, status, decided_at)
    VALUES (cP, a_id, u1, 'confirmed', now());
  INSERT INTO public.course_registrations (course_id, provider_id, user_id, status, decided_at)
    VALUES (cR, a_id, u1, 'rejected', now());
  INSERT INTO public.course_registrations (course_id, provider_id, user_id, status, cancelled_by)
    VALUES (cR, a_id, u2, 'cancelled', 'customer');

  PERFORM set_config('request.jwt.claims', json_build_object('sub', a_user, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    UPDATE public.provider_profiles SET category = 'barber' WHERE id = a_id;
    RAISE EXCEPTION 'G1 FAILED: no error';
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT, v_detail = PG_EXCEPTION_DETAIL;
    IF v_msg <> 'CATEGORY_CHANGE_BLOCKED' THEN RAISE EXCEPTION 'G1 FAILED: got %', v_msg; END IF;
    IF v_detail IS NULL OR v_detail NOT LIKE '3 live course registration(s)%' THEN
      RAISE EXCEPTION 'G1 FAILED: detail %', v_detail;
    END IF;
  END;

  UPDATE public.provider_profiles SET is_visible = false WHERE id = a_id;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'G4 FAILED: unrelated update affected % rows', n; END IF;
  UPDATE public.provider_profiles SET category = 'academy', is_visible = true WHERE id = a_id;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'G4 FAILED: same-category update affected % rows', n; END IF;

  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    UPDATE public.provider_profiles SET category = 'nails' WHERE id = a_id;
    RAISE EXCEPTION 'G2 FAILED: no error';
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT, v_detail = PG_EXCEPTION_DETAIL;
    IF v_msg <> 'CATEGORY_CHANGE_BLOCKED' THEN RAISE EXCEPTION 'G2 FAILED: got %', v_msg; END IF;
    IF v_detail NOT LIKE '3 live course registration(s)%' THEN
      RAISE EXCEPTION 'G2 FAILED: detail %', v_detail;
    END IF;
  END;

  RESET ROLE;
  SET LOCAL ROLE service_role;
  BEGIN
    UPDATE public.provider_profiles SET category = 'nails' WHERE id = a_id;
    RAISE EXCEPTION 'G3 FAILED: service_role not blocked';
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    IF v_msg <> 'CATEGORY_CHANGE_BLOCKED' THEN RAISE EXCEPTION 'G3 FAILED: got %', v_msg; END IF;
  END;
  RESET ROLE;
  BEGIN
    UPDATE public.provider_profiles SET category = 'nails' WHERE id = a_id;
    RAISE EXCEPTION 'G3 FAILED: postgres not blocked';
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    IF v_msg <> 'CATEGORY_CHANGE_BLOCKED' THEN RAISE EXCEPTION 'G3 FAILED: got %', v_msg; END IF;
  END;
  SELECT category INTO v_cat FROM public.provider_profiles WHERE id = a_id;
  IF v_cat <> 'academy' THEN RAISE EXCEPTION 'G3 FAILED: category changed to %', v_cat; END IF;

  UPDATE public.course_registrations SET status = 'cancelled', cancelled_by = 'provider' WHERE id IN (rF1, rF2);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', a_user, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    UPDATE public.provider_profiles SET category = 'barber' WHERE id = a_id;
    RAISE EXCEPTION 'G5 FAILED: no error';
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT, v_detail = PG_EXCEPTION_DETAIL;
    IF v_msg <> 'CATEGORY_CHANGE_BLOCKED' THEN RAISE EXCEPTION 'G5 FAILED: got %', v_msg; END IF;
    IF v_detail NOT LIKE '1 live course registration(s)%' THEN
      RAISE EXCEPTION 'G5 FAILED: detail %', v_detail;
    END IF;
  END;

  RESET ROLE;
  UPDATE public.course_registrations SET status = 'cancelled', cancelled_by = 'provider' WHERE id = rE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', a_user, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  UPDATE public.provider_profiles SET category = 'barber' WHERE id = a_id;
  RESET ROLE;
  SELECT category INTO v_cat FROM public.provider_profiles WHERE id = a_id;
  IF v_cat <> 'barber' THEN RAISE EXCEPTION 'G6 FAILED: category is %', v_cat; END IF;

  UPDATE public.provider_profiles SET category = 'academy' WHERE id = a_id;
  INSERT INTO public.course_registrations (course_id, provider_id, user_id)
    VALUES (cR, a_id, u3) RETURNING id INTO rX;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', a_user, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    UPDATE public.provider_profiles SET category = 'barber' WHERE id = a_id;
    RAISE EXCEPTION 'G7 FAILED: no error';
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT, v_detail = PG_EXCEPTION_DETAIL;
    IF v_msg <> 'CATEGORY_CHANGE_BLOCKED' THEN RAISE EXCEPTION 'G7 FAILED: got %', v_msg; END IF;
    IF v_detail NOT LIKE '1 live course registration(s)%' THEN
      RAISE EXCEPTION 'G7 FAILED: detail %', v_detail;
    END IF;
  END;
  RESET ROLE;
  UPDATE public.course_registrations SET status = 'cancelled', cancelled_by = 'customer' WHERE id = rX;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', a_user, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  UPDATE public.provider_profiles SET category = 'nails' WHERE id = a_id;
  RESET ROLE;
  SELECT category INTO v_cat FROM public.provider_profiles WHERE id = a_id;
  IF v_cat <> 'nails' THEN RAISE EXCEPTION 'G7 FAILED: category is %', v_cat; END IF;

  UPDATE public.provider_profiles SET category = 'spa' WHERE id = b_id;
  SELECT category INTO v_cat FROM public.provider_profiles WHERE id = b_id;
  IF v_cat <> 'spa' THEN RAISE EXCEPTION 'G8 FAILED: non-academy category is %', v_cat; END IF;
END $$;
ROLLBACK;

SELECT 'academy_category_guard VERIFY §B: all checks passed' AS result,
       (SELECT count(*) FROM public.course_registrations)
     + (SELECT count(*) FROM public.academy_course_sessions)
     + (SELECT count(*) FROM public.academy_courses)
     + (SELECT count(*) FROM public.academy_instructors WHERE name LIKE 'VERIFY %')
     + (SELECT count(*) FROM public.provider_profiles WHERE category = 'academy') AS leftover;

-- §R ROLLBACK (only if needed). Run by hand; these are DROPs.
-- DROP TRIGGER IF EXISTS trg_provider_profiles_academy_category_guard ON public.provider_profiles;
-- DROP FUNCTION IF EXISTS public.guard_academy_category_change();
