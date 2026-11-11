-- VERIFY for 20261110000001_course_push_log.sql. Run on DEV.
-- §A is read-only. §B writes test rows inside a transaction that ROLLS BACK.

-- §0 BEFORE applying — expect NULL (table does not exist yet).
SELECT to_regclass('public.course_push_log');

-- §A AFTER applying.

-- A1. Columns. Expect exactly 4:
--     registration_id uuid NO | event text NO | notification_id uuid YES |
--     created_at timestamptz NO now()
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'course_push_log'
ORDER BY ordinal_position;

-- A2. Constraints. Expect: pkey (registration_id, event);
--     FK registration_id -> course_registrations(id) ON DELETE CASCADE;
--     CHECK event IN (5 events).
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'public.course_push_log'::regclass
ORDER BY conname;

-- A3. RLS on, ZERO policies.
SELECT c.relrowsecurity AS rls_enabled,
       (SELECT count(*) FROM pg_policies WHERE tablename = 'course_push_log') AS policies
FROM pg_class c WHERE c.oid = 'public.course_push_log'::regclass;

-- A4. Grants. Expect NO rows (anon / authenticated have nothing).
SELECT grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public' AND table_name = 'course_push_log'
  AND grantee IN ('anon', 'authenticated');

-- §B BEHAVIOUR (rolled back). Uses one existing course registration.
BEGIN;
DO $$
DECLARE
  reg uuid; n int;
BEGIN
  SELECT id INTO reg FROM public.course_registrations ORDER BY created_at LIMIT 1;
  IF reg IS NULL THEN RAISE EXCEPTION 'need one course registration on DEV'; END IF;

  -- B1. First claim inserts; the same claim again inserts nothing.
  INSERT INTO public.course_push_log (registration_id, event) VALUES (reg, 'confirmed')
    ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'B1 FAILED: first claim inserted % row(s)', n; END IF;
  INSERT INTO public.course_push_log (registration_id, event) VALUES (reg, 'confirmed')
    ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'B1 FAILED: duplicate claim inserted % row(s)', n; END IF;

  -- B2. A different event for the same registration is its own claim.
  INSERT INTO public.course_push_log (registration_id, event) VALUES (reg, 'cancelled_by_provider')
    ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'B2 FAILED: second event inserted % row(s)', n; END IF;

  -- B3. Unknown event rejected.
  BEGIN
    INSERT INTO public.course_push_log (registration_id, event) VALUES (reg, 'approved');
    RAISE EXCEPTION 'B3 FAILED: unknown event accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- B4. authenticated and anon can neither read nor write.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM 1 FROM public.course_push_log;
    RAISE EXCEPTION 'B4 FAILED: authenticated can read';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO public.course_push_log (registration_id, event) VALUES (reg, 'new');
    RAISE EXCEPTION 'B4 FAILED: authenticated can insert';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RESET ROLE;
  SET LOCAL ROLE anon;
  BEGIN
    PERFORM 1 FROM public.course_push_log;
    RAISE EXCEPTION 'B4 FAILED: anon can read';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RESET ROLE;

  RAISE NOTICE 'course_push_log VERIFY §B: all checks passed';
END $$;
ROLLBACK;
SELECT 'course_push_log VERIFY §B: all checks passed' AS result,
       (SELECT count(*) FROM public.course_push_log) AS leftover;

-- §R ROLLBACK (drops the claim log; the Edge Function then cannot claim and
--     sends nothing).
-- DROP TABLE public.course_push_log;
