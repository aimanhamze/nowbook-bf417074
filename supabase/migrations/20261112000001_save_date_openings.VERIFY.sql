-- VERIFY for 20261112000001_save_date_openings.sql. Run on DEV.
-- §A is read-only. §B calls the RPC inside a transaction that ROLLS BACK;
-- run it in the SQL editor (execute_sql via MCP gets declined for it).

-- §0 BEFORE applying — expect ZERO rows.
SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND proname = 'save_date_openings';

-- §A AFTER applying.

-- A1. Signature, SECURITY INVOKER, pinned search_path, who can EXECUTE.
--     Expect ONE row:
--     save_date_openings | p_provider_id uuid, p_dates date[], p_start text,
--       p_end text, p_break_start text, p_break_end text, p_replace_blocks boolean
--     | integer | secdef f | config {search_path=""} | volatility v
--     | anon_exec f | auth_exec t. PUBLIC must not appear in acl (no '=X/').
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
WHERE n.nspname = 'public' AND p.proname = 'save_date_openings';

-- A2. The RPC relies on these (unchanged by this migration). Expect 2 rows:
--     provider_blocked_dates  | UNIQUE (provider_id, blocked_date)
--     provider_date_overrides | UNIQUE (provider_id, override_date)
SELECT conrelid::regclass AS tbl, pg_get_constraintdef(oid) AS def
FROM pg_constraint
WHERE conrelid IN ('public.provider_blocked_dates'::regclass, 'public.provider_date_overrides'::regclass)
  AND contype = 'u'
ORDER BY 1;

-- A3. Owner RLS on both tables (unchanged). Expect 4 rows: one public SELECT
--     and one owner ALL policy per table.
SELECT tablename, policyname, cmd FROM pg_policies
WHERE schemaname = 'public' AND tablename IN ('provider_blocked_dates', 'provider_date_overrides')
ORDER BY 1, 2;

-- §B BEHAVIOUR (rolled back). Owner a_user runs branch a_id (set to 'nails');
--     owner b_user runs b_id. ln = Asia/Jerusalem today.
--     P1  anon cannot execute
--     P2  no sub in the JWT -> NOT_AUTHENTICATED
--     P3  another owner's branch -> PROVIDER_NOT_FOUND, nothing written
--     P4  range ln+3..ln+5, 10:00-14:00 -> 3 rows, open, no break
--     P5  same dates again, new hours + break -> 3 rows updated, no duplicates
--     P6  duplicate and NULL dates in the input are collapsed
--     P7  blocked date without replace -> DATES_BLOCKED; block kept, no override
--     P8  same with replace -> block deleted, override written; b's block on
--         the same date untouched
--     P9  an existing is_available=false override becomes open
--     P10 today is allowed; yesterday -> DATE_IN_PAST
--     P11 bad hours -> INVALID_HOURS (end<=start, 24:00, 'abc', NULL)
--     P12 bad break -> INVALID_BREAK (one side, reversed, outside, 'x');
--         a failed call with replace=true leaves the block in place
--     P13 NO_DATES (empty, all NULL); TOO_MANY_DATES (91)
--     P14 fitness_studio and academy -> OPENINGS_NOT_SUPPORTED
--     A clean run returns ONE row: result = 'save_date_openings VERIFY §B:
--     all checks passed', leftover = 0. A failure stops with 'Pn FAILED: ...'.
BEGIN;
DO $$
DECLARE
  a_id uuid; a_user uuid; b_id uuid; b_user uuid;
  v_ln date := (now() AT TIME ZONE 'Asia/Jerusalem')::date;
  n int; v_ok boolean;
  v_s text; v_e text; v_bs time; v_be time;
BEGIN
  SELECT id, user_id INTO a_id, a_user FROM public.provider_profiles
    WHERE user_id IS NOT NULL ORDER BY created_at LIMIT 1;
  SELECT id, user_id INTO b_id, b_user FROM public.provider_profiles
    WHERE user_id IS NOT NULL AND user_id <> a_user ORDER BY created_at LIMIT 1;
  IF a_id IS NULL OR b_id IS NULL THEN
    RAISE EXCEPTION 'need two provider owners on DEV';
  END IF;
  UPDATE public.provider_profiles SET category = 'nails' WHERE id = a_id;
  INSERT INTO public.provider_blocked_dates (provider_id, blocked_date, reason) VALUES
    (a_id, v_ln + 20, 'VERIFY'), (a_id, v_ln + 21, 'VERIFY'), (b_id, v_ln + 20, 'VERIFY');
  INSERT INTO public.provider_date_overrides (provider_id, override_date, is_available)
    VALUES (a_id, v_ln + 30, false);

  PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  SET LOCAL ROLE anon;
  BEGIN
    PERFORM public.save_date_openings(a_id, ARRAY[v_ln + 3], '10:00', '14:00');
    RAISE EXCEPTION 'P1 FAILED: anon accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.save_date_openings(a_id, ARRAY[v_ln + 3], '10:00', '14:00');
    RAISE EXCEPTION 'P2 FAILED: no error';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'NOT_AUTHENTICATED' THEN RAISE EXCEPTION 'P2 FAILED: got %', SQLERRM; END IF;
  END;

  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', b_user, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.save_date_openings(a_id, ARRAY[v_ln + 3], '10:00', '14:00');
    RAISE EXCEPTION 'P3 FAILED: no error';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'PROVIDER_NOT_FOUND' THEN RAISE EXCEPTION 'P3 FAILED: got %', SQLERRM; END IF;
  END;

  RESET ROLE;
  SELECT count(*) INTO n FROM public.provider_date_overrides WHERE provider_id = a_id AND override_date = v_ln + 3;
  IF n <> 0 THEN RAISE EXCEPTION 'P3 FAILED: % rows written', n; END IF;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', a_user, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  n := public.save_date_openings(a_id, ARRAY[v_ln + 3, v_ln + 4, v_ln + 5], '10:00', '14:00');
  IF n <> 3 THEN RAISE EXCEPTION 'P4 FAILED: returned %', n; END IF;
  SELECT count(*) INTO n FROM public.provider_date_overrides
    WHERE provider_id = a_id AND override_date BETWEEN v_ln + 3 AND v_ln + 5
      AND is_available AND start_time = '10:00' AND end_time = '14:00'
      AND break_start IS NULL AND break_end IS NULL;
  IF n <> 3 THEN RAISE EXCEPTION 'P4 FAILED: % matching rows', n; END IF;

  n := public.save_date_openings(a_id, ARRAY[v_ln + 3, v_ln + 4, v_ln + 5], '08:00', '20:00', '12:00', '12:30');
  IF n <> 3 THEN RAISE EXCEPTION 'P5 FAILED: returned %', n; END IF;
  SELECT count(*) INTO n FROM public.provider_date_overrides
    WHERE provider_id = a_id AND override_date BETWEEN v_ln + 3 AND v_ln + 5;
  IF n <> 3 THEN RAISE EXCEPTION 'P5 FAILED: % rows (duplicates?)', n; END IF;
  SELECT start_time, end_time, break_start, break_end INTO v_s, v_e, v_bs, v_be
    FROM public.provider_date_overrides WHERE provider_id = a_id AND override_date = v_ln + 4;
  IF v_s <> '08:00' OR v_e <> '20:00' OR v_bs <> '12:00' OR v_be <> '12:30' THEN
    RAISE EXCEPTION 'P5 FAILED: % % % %', v_s, v_e, v_bs, v_be;
  END IF;

  n := public.save_date_openings(a_id, ARRAY[v_ln + 6, v_ln + 6, NULL], '10:00', '14:00');
  IF n <> 1 THEN RAISE EXCEPTION 'P6 FAILED: returned %', n; END IF;

  BEGIN
    PERFORM public.save_date_openings(a_id, ARRAY[v_ln + 19, v_ln + 20], '10:00', '14:00');
    RAISE EXCEPTION 'P7 FAILED: no error';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'DATES_BLOCKED' THEN RAISE EXCEPTION 'P7 FAILED: got %', SQLERRM; END IF;
  END;
  SELECT count(*) INTO n FROM public.provider_blocked_dates WHERE provider_id = a_id AND blocked_date = v_ln + 20;
  IF n <> 1 THEN RAISE EXCEPTION 'P7 FAILED: block gone'; END IF;
  SELECT count(*) INTO n FROM public.provider_date_overrides
    WHERE provider_id = a_id AND override_date IN (v_ln + 19, v_ln + 20);
  IF n <> 0 THEN RAISE EXCEPTION 'P7 FAILED: % overrides written', n; END IF;

  n := public.save_date_openings(a_id, ARRAY[v_ln + 19, v_ln + 20], '10:00', '14:00', NULL, NULL, true);
  IF n <> 2 THEN RAISE EXCEPTION 'P8 FAILED: returned %', n; END IF;
  SELECT count(*) INTO n FROM public.provider_blocked_dates WHERE provider_id = a_id AND blocked_date = v_ln + 20;
  IF n <> 0 THEN RAISE EXCEPTION 'P8 FAILED: block kept'; END IF;
  SELECT count(*) INTO n FROM public.provider_date_overrides
    WHERE provider_id = a_id AND override_date = v_ln + 20 AND is_available;
  IF n <> 1 THEN RAISE EXCEPTION 'P8 FAILED: no override'; END IF;
  RESET ROLE;
  SELECT count(*) INTO n FROM public.provider_blocked_dates WHERE provider_id = b_id AND blocked_date = v_ln + 20;
  IF n <> 1 THEN RAISE EXCEPTION 'P8 FAILED: other provider''s block touched'; END IF;
  SET LOCAL ROLE authenticated;

  PERFORM public.save_date_openings(a_id, ARRAY[v_ln + 30], '10:00', '14:00');
  SELECT is_available INTO v_ok FROM public.provider_date_overrides WHERE provider_id = a_id AND override_date = v_ln + 30;
  IF v_ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'P9 FAILED: still closed'; END IF;

  n := public.save_date_openings(a_id, ARRAY[v_ln], '10:00', '14:00');
  IF n <> 1 THEN RAISE EXCEPTION 'P10 FAILED: today refused'; END IF;
  BEGIN
    PERFORM public.save_date_openings(a_id, ARRAY[v_ln - 1, v_ln + 7], '10:00', '14:00');
    RAISE EXCEPTION 'P10 FAILED: no error';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'DATE_IN_PAST' THEN RAISE EXCEPTION 'P10 FAILED: got %', SQLERRM; END IF;
  END;

  BEGIN
    PERFORM public.save_date_openings(a_id, ARRAY[v_ln + 8], '14:00', '14:00');
    RAISE EXCEPTION 'P11 FAILED: equal times accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'INVALID_HOURS' THEN RAISE EXCEPTION 'P11 FAILED: got %', SQLERRM; END IF;
  END;
  BEGIN
    PERFORM public.save_date_openings(a_id, ARRAY[v_ln + 8], '10:00', '24:00');
    RAISE EXCEPTION 'P11 FAILED: 24:00 accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'INVALID_HOURS' THEN RAISE EXCEPTION 'P11 FAILED: got %', SQLERRM; END IF;
  END;
  BEGIN
    PERFORM public.save_date_openings(a_id, ARRAY[v_ln + 8], 'abc', '14:00');
    RAISE EXCEPTION 'P11 FAILED: abc accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'INVALID_HOURS' THEN RAISE EXCEPTION 'P11 FAILED: got %', SQLERRM; END IF;
  END;
  BEGIN
    PERFORM public.save_date_openings(a_id, ARRAY[v_ln + 8], NULL, '14:00');
    RAISE EXCEPTION 'P11 FAILED: NULL accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'INVALID_HOURS' THEN RAISE EXCEPTION 'P11 FAILED: got %', SQLERRM; END IF;
  END;

  BEGIN
    PERFORM public.save_date_openings(a_id, ARRAY[v_ln + 8], '10:00', '14:00', '12:00', NULL);
    RAISE EXCEPTION 'P12 FAILED: one-sided break accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'INVALID_BREAK' THEN RAISE EXCEPTION 'P12 FAILED: got %', SQLERRM; END IF;
  END;
  BEGIN
    PERFORM public.save_date_openings(a_id, ARRAY[v_ln + 8], '10:00', '14:00', '12:30', '12:00');
    RAISE EXCEPTION 'P12 FAILED: reversed break accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'INVALID_BREAK' THEN RAISE EXCEPTION 'P12 FAILED: got %', SQLERRM; END IF;
  END;
  BEGIN
    PERFORM public.save_date_openings(a_id, ARRAY[v_ln + 8], '10:00', '14:00', '13:30', '14:30');
    RAISE EXCEPTION 'P12 FAILED: break outside accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'INVALID_BREAK' THEN RAISE EXCEPTION 'P12 FAILED: got %', SQLERRM; END IF;
  END;
  BEGIN
    PERFORM public.save_date_openings(a_id, ARRAY[v_ln + 21], '10:00', '14:00', 'x', '12:00', true);
    RAISE EXCEPTION 'P12 FAILED: bad break accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'INVALID_BREAK' THEN RAISE EXCEPTION 'P12 FAILED: got %', SQLERRM; END IF;
  END;
  SELECT count(*) INTO n FROM public.provider_blocked_dates WHERE provider_id = a_id AND blocked_date = v_ln + 21;
  IF n <> 1 THEN RAISE EXCEPTION 'P12 FAILED: block deleted by a failed call'; END IF;

  BEGIN
    PERFORM public.save_date_openings(a_id, ARRAY[]::date[], '10:00', '14:00');
    RAISE EXCEPTION 'P13 FAILED: empty accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'NO_DATES' THEN RAISE EXCEPTION 'P13 FAILED: got %', SQLERRM; END IF;
  END;
  BEGIN
    PERFORM public.save_date_openings(a_id, ARRAY[NULL]::date[], '10:00', '14:00');
    RAISE EXCEPTION 'P13 FAILED: all-NULL accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'NO_DATES' THEN RAISE EXCEPTION 'P13 FAILED: got %', SQLERRM; END IF;
  END;
  BEGIN
    PERFORM public.save_date_openings(a_id, ARRAY(SELECT v_ln + g FROM generate_series(1, 91) g), '10:00', '14:00');
    RAISE EXCEPTION 'P13 FAILED: 91 dates accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'TOO_MANY_DATES' THEN RAISE EXCEPTION 'P13 FAILED: got %', SQLERRM; END IF;
  END;

  RESET ROLE;
  UPDATE public.provider_profiles SET category = 'fitness_studio' WHERE id = a_id;
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.save_date_openings(a_id, ARRAY[v_ln + 9], '10:00', '14:00');
    RAISE EXCEPTION 'P14 FAILED: studio accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'OPENINGS_NOT_SUPPORTED' THEN RAISE EXCEPTION 'P14 FAILED: got %', SQLERRM; END IF;
  END;
  RESET ROLE;
  UPDATE public.provider_profiles SET category = 'academy' WHERE id = a_id;
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.save_date_openings(a_id, ARRAY[v_ln + 9], '10:00', '14:00');
    RAISE EXCEPTION 'P14 FAILED: academy accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'OPENINGS_NOT_SUPPORTED' THEN RAISE EXCEPTION 'P14 FAILED: got %', SQLERRM; END IF;
  END;
  RESET ROLE;
END $$;
ROLLBACK;

SELECT 'save_date_openings VERIFY §B: all checks passed' AS result,
       (SELECT count(*) FROM public.provider_date_overrides)
     + (SELECT count(*) FROM public.provider_blocked_dates WHERE reason = 'VERIFY') AS leftover;

-- §R ROLLBACK. Run by hand; this is a DROP.
-- DROP FUNCTION IF EXISTS public.save_date_openings(uuid, date[], text, text, text, text, boolean);
