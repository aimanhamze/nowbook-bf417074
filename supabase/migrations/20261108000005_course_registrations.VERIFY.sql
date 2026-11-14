-- VERIFY for 20261108000005_course_registrations.sql. Run on DEV.
-- §A is read-only. §B writes test rows inside a transaction that ROLLS BACK;
-- run it in the SQL editor (execute_sql via MCP gets declined for it).

-- §0 BEFORE applying — expect NULL (table does not exist yet).
SELECT to_regclass('public.course_registrations');

-- §A AFTER applying.

-- A1. Columns. Expect 9:
--     id uuid NO gen_random_uuid() | course_id uuid NO | provider_id uuid NO |
--     user_id uuid NO | status text NO 'pending' | cancelled_by text YES |
--     decided_at timestamptz YES | created_at timestamptz NO now() |
--     updated_at timestamptz NO now()
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'course_registrations'
ORDER BY ordinal_position;

-- A2. Constraints. Expect: pkey; FK user_id -> auth.users ON DELETE CASCADE;
--     FK (course_id, provider_id) -> academy_courses(id, provider_id) ON DELETE CASCADE;
--     CHECKs: status IN (4), cancelled_by IN (customer, provider),
--     cancelled_by_iff_cancelled, decided_has_decided_at.
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'public.course_registrations'::regclass
ORDER BY conname;

-- A3. Indexes. Expect pkey; UNIQUE (course_id, user_id) WHERE status IN
--     ('pending','confirmed'); btree (course_id, status); btree (user_id, status).
SELECT indexname, indexdef FROM pg_indexes
WHERE schemaname = 'public' AND tablename = 'course_registrations'
ORDER BY indexname;

-- A4. Trigger. Expect trg_course_registrations_updated_at BEFORE UPDATE -> set_updated_at().
SELECT tgname, pg_get_triggerdef(oid)
FROM pg_trigger
WHERE tgrelid = 'public.course_registrations'::regclass AND NOT tgisinternal;

-- A5. RLS on; exactly two policies, both SELECT TO authenticated, none for writes:
--     "Customers can view own course registrations"        user_id = auth.uid()
--     "Providers can view own branch course registrations" caller owns provider_id
SELECT relrowsecurity AS rls_enabled
FROM pg_class WHERE oid = 'public.course_registrations'::regclass;
SELECT policyname, cmd, roles, qual, with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'course_registrations'
ORDER BY policyname;

-- A6. Grants. Expect ONE row: authenticated | SELECT. anon has nothing.
SELECT grantee, string_agg(privilege_type, ', ' ORDER BY privilege_type) AS privs
FROM information_schema.role_table_grants
WHERE table_schema = 'public' AND table_name = 'course_registrations'
  AND grantee IN ('anon', 'authenticated')
GROUP BY grantee ORDER BY grantee;

-- §B BEHAVIOUR (rolled back). Branch A and branch B have different owners;
--     u1 and u2 are two customers who own no branch. Fixtures are written as
--     postgres, since clients have no write path until migration 5.
--     R1  customer sees only own registrations
--     R2  stranger (authenticated, no rows) sees none
--     R3  owner A sees A's registrations, not B's; owner B the reverse
--     R4  customer cannot INSERT / UPDATE / DELETE
--     R5  provider owner cannot INSERT / UPDATE / DELETE
--     R6  anon cannot SELECT / INSERT / UPDATE / DELETE
--     R7  second active registration (pending or confirmed) for the same
--         course + user rejected
--     R8  after cancelled, and after rejected, a new one is allowed
--     R9  invalid status / inconsistent cancelled_by / decided_at rejected
--     R10 provider_id must match the course's branch (composite FK)
--     R11 deleting a course cascades its registrations
--     A clean run returns ONE row: result = 'course_registrations VERIFY §B:
--     all checks passed', leftover = 0. A failure stops with 'Rn FAILED: ...'.
BEGIN;
DO $$
DECLARE
  a_id uuid; a_user uuid; b_id uuid; b_user uuid;
  u1 uuid; u2 uuid;
  ia uuid; ib uuid; c1 uuid; cb uuid;
  r1 uuid; r2 uuid; r_new uuid; n int;
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
  IF a_id IS NULL OR b_id IS NULL OR u1 IS NULL OR u2 IS NULL THEN
    RAISE EXCEPTION 'need two provider owners and two non-provider users on DEV';
  END IF;

  INSERT INTO public.academy_instructors (provider_id, name) VALUES (a_id, 'VERIFY ia') RETURNING id INTO ia;
  INSERT INTO public.academy_instructors (provider_id, name) VALUES (b_id, 'VERIFY ib') RETURNING id INTO ib;
  INSERT INTO public.academy_courses (provider_id, instructor_id, name, location_type, address, max_seats)
    VALUES (a_id, ia, 'VERIFY c1', 'physical', 'a', 5) RETURNING id INTO c1;
  INSERT INTO public.academy_courses (provider_id, instructor_id, name, location_type, address, max_seats)
    VALUES (b_id, ib, 'VERIFY cb', 'physical', 'a', 5) RETURNING id INTO cb;
  INSERT INTO public.course_registrations (course_id, provider_id, user_id)
    VALUES (c1, a_id, u1) RETURNING id INTO r1;
  INSERT INTO public.course_registrations (course_id, provider_id, user_id, status, decided_at)
    VALUES (cb, b_id, u2, 'confirmed', now()) RETURNING id INTO r2;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', u1, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.course_registrations WHERE id = r1;
  IF n <> 1 THEN RAISE EXCEPTION 'R1 FAILED: customer cannot see own registration'; END IF;
  SELECT count(*) INTO n FROM public.course_registrations WHERE id = r2;
  IF n <> 0 THEN RAISE EXCEPTION 'R1 FAILED: customer sees someone else''s registration'; END IF;

  BEGIN
    INSERT INTO public.course_registrations (course_id, provider_id, user_id) VALUES (cb, b_id, u1);
    RAISE EXCEPTION 'R4 FAILED: customer INSERT accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    UPDATE public.course_registrations SET status = 'confirmed', decided_at = now() WHERE id = r1;
    RAISE EXCEPTION 'R4 FAILED: customer UPDATE accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    DELETE FROM public.course_registrations WHERE id = r1;
    RAISE EXCEPTION 'R4 FAILED: customer DELETE accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  RESET ROLE;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.course_registrations WHERE id IN (r1, r2);
  IF n <> 0 THEN RAISE EXCEPTION 'R2 FAILED: stranger sees % registration(s)', n; END IF;

  RESET ROLE;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', a_user, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.course_registrations WHERE id = r1;
  IF n <> 1 THEN RAISE EXCEPTION 'R3 FAILED: owner A cannot see own branch registration'; END IF;
  SELECT count(*) INTO n FROM public.course_registrations WHERE id = r2;
  IF n <> 0 THEN RAISE EXCEPTION 'R3 FAILED: owner A sees branch B registration'; END IF;

  BEGIN
    INSERT INTO public.course_registrations (course_id, provider_id, user_id) VALUES (c1, a_id, u2);
    RAISE EXCEPTION 'R5 FAILED: provider INSERT accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    UPDATE public.course_registrations SET status = 'confirmed', decided_at = now() WHERE id = r1;
    RAISE EXCEPTION 'R5 FAILED: provider UPDATE accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    DELETE FROM public.course_registrations WHERE id = r1;
    RAISE EXCEPTION 'R5 FAILED: provider DELETE accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  RESET ROLE;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', b_user, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.course_registrations WHERE id = r2;
  IF n <> 1 THEN RAISE EXCEPTION 'R3 FAILED: owner B cannot see own branch registration'; END IF;
  SELECT count(*) INTO n FROM public.course_registrations WHERE id = r1;
  IF n <> 0 THEN RAISE EXCEPTION 'R3 FAILED: owner B sees branch A registration'; END IF;

  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  SET LOCAL ROLE anon;
  BEGIN
    SELECT count(*) INTO n FROM public.course_registrations;
    RAISE EXCEPTION 'R6 FAILED: anon SELECT accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO public.course_registrations (course_id, provider_id, user_id) VALUES (c1, a_id, u2);
    RAISE EXCEPTION 'R6 FAILED: anon INSERT accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    UPDATE public.course_registrations SET status = 'cancelled', cancelled_by = 'customer' WHERE id = r1;
    RAISE EXCEPTION 'R6 FAILED: anon UPDATE accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    DELETE FROM public.course_registrations WHERE id = r1;
    RAISE EXCEPTION 'R6 FAILED: anon DELETE accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  RESET ROLE;

  BEGIN
    INSERT INTO public.course_registrations (course_id, provider_id, user_id) VALUES (c1, a_id, u1);
    RAISE EXCEPTION 'R7 FAILED: second pending registration accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.course_registrations (course_id, provider_id, user_id, status, decided_at)
      VALUES (c1, a_id, u1, 'confirmed', now());
    RAISE EXCEPTION 'R7 FAILED: confirmed next to pending accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  UPDATE public.course_registrations SET status = 'cancelled', cancelled_by = 'customer' WHERE id = r1;
  INSERT INTO public.course_registrations (course_id, provider_id, user_id)
    VALUES (c1, a_id, u1) RETURNING id INTO r_new;
  UPDATE public.course_registrations SET status = 'rejected', decided_at = now() WHERE id = r_new;
  INSERT INTO public.course_registrations (course_id, provider_id, user_id)
    VALUES (c1, a_id, u1);
  SELECT count(*) INTO n FROM public.course_registrations WHERE course_id = c1 AND user_id = u1;
  IF n <> 3 THEN RAISE EXCEPTION 'R8 FAILED: expected 3 rows of history, got %', n; END IF;

  BEGIN
    INSERT INTO public.course_registrations (course_id, provider_id, user_id, status)
      VALUES (c1, a_id, u2, 'waiting');
    RAISE EXCEPTION 'R9 FAILED: invalid status accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.course_registrations (course_id, provider_id, user_id, status)
      VALUES (c1, a_id, u2, 'cancelled');
    RAISE EXCEPTION 'R9 FAILED: cancelled without cancelled_by accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.course_registrations (course_id, provider_id, user_id, cancelled_by)
      VALUES (c1, a_id, u2, 'customer');
    RAISE EXCEPTION 'R9 FAILED: pending with cancelled_by accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.course_registrations (course_id, provider_id, user_id, status)
      VALUES (c1, a_id, u2, 'confirmed');
    RAISE EXCEPTION 'R9 FAILED: confirmed without decided_at accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.course_registrations (course_id, provider_id, user_id, status, cancelled_by)
      VALUES (c1, a_id, u2, 'cancelled', 'admin');
    RAISE EXCEPTION 'R9 FAILED: invalid cancelled_by accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO public.course_registrations (course_id, provider_id, user_id)
      VALUES (c1, b_id, u2);
    RAISE EXCEPTION 'R10 FAILED: provider_id not matching the course accepted';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;

  DELETE FROM public.academy_courses WHERE id = c1;
  SELECT count(*) INTO n FROM public.course_registrations WHERE course_id = c1;
  IF n <> 0 THEN RAISE EXCEPTION 'R11 FAILED: % registration(s) survived course delete', n; END IF;
END $$;
ROLLBACK;

SELECT 'course_registrations VERIFY §B: all checks passed' AS result,
       (SELECT count(*) FROM public.course_registrations)
     + (SELECT count(*) FROM public.academy_courses)
     + (SELECT count(*) FROM public.academy_instructors WHERE name LIKE 'VERIFY %') AS leftover;

-- §R ROLLBACK (only before migration 5 exists). Run by hand; it is a DROP.
-- DROP TABLE IF EXISTS public.course_registrations;
