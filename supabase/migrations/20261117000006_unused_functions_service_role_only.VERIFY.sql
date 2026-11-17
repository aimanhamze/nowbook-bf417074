-- VERIFY for 20261117000006_unused_functions_service_role_only.sql (b1).
-- DEV first, then PROD.
--
-- HOW TO RUN. The SQL editor shows only the LAST statement's result, so run
-- ONE block at a time. Every block is a single statement; none ends on
-- ROLLBACK.
--   §0, §A  catalog SELECTs — read-only, DEV and PROD.
--   §B      ONE DO block, DEV ONLY by the usual rule. It calls the two
--           functions and writes nothing; it ends in an ERROR on purpose:
--           "PASS: …" or "FAIL Tn: …".
--   §E      rollback.
--
-- ORDER: §0 → apply 20261117000006 → §A → §B.


-- ── §0 BEFORE applying ────────────────────────────────────────────────────

-- 0a. The two functions now. Expect TWO rows, secdef = true, and BEFORE:
--     anon_exec = true, auth_exec = true, public_exec = true.
--     More than two rows = an overload exists (the migration covers it; tell
--     me). Fewer = the function is missing on this database.
SELECT p.oid::regprocedure                                        AS function,
       p.prosecdef                                                AS secdef,
       has_function_privilege('anon', p.oid, 'EXECUTE')           AS anon_exec,
       has_function_privilege('authenticated', p.oid, 'EXECUTE')  AS auth_exec,
       has_function_privilege('service_role', p.oid, 'EXECUTE')   AS service_exec,
       EXISTS (SELECT 1
               FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
               WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE') AS public_exec,
       p.proacl::text                                             AS acl
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('get_slot_capacity', 'get_display_name')
ORDER BY p.proname;

-- 0b. NOTHING ELSE CALLS THEM. Looks for either name in: every other function
--     body in public, every RLS policy (public and storage), every view,
--     every column default / generated column, and every cron job.
--     Expect ZERO rows. ANY row: do not apply — send it to me. A caller that
--     runs as anon or authenticated (an INVOKER function, a policy, a view)
--     would start failing with "permission denied for function …".
SELECT 'function body' AS found_in, p.oid::regprocedure::text AS object,
       CASE WHEN p.prosecdef THEN 'SECURITY DEFINER (keeps working)' ELSE 'security invoker (WOULD BREAK for anon/authenticated)' END AS detail
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.prokind IN ('f', 'p')
  AND p.proname NOT IN ('get_slot_capacity', 'get_display_name')
  AND p.prosrc ~* '\m(get_slot_capacity|get_display_name)\M'
UNION ALL
SELECT 'policy', pol.schemaname || '.' || pol.tablename || ' — ' || pol.policyname,
       pol.cmd || ' TO ' || array_to_string(pol.roles, ',')
FROM pg_policies pol
WHERE (COALESCE(pol.qual, '') || ' ' || COALESCE(pol.with_check, ''))
      ~* '\m(get_slot_capacity|get_display_name)\M'
UNION ALL
SELECT 'view', n.nspname || '.' || c.relname, ''
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind IN ('v', 'm')
  AND n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND pg_get_viewdef(c.oid) ~* '\m(get_slot_capacity|get_display_name)\M'
UNION ALL
SELECT 'column default', d.adrelid::regclass::text, pg_get_expr(d.adbin, d.adrelid)
FROM pg_attrdef d
WHERE pg_get_expr(d.adbin, d.adrelid) ~* '\m(get_slot_capacity|get_display_name)\M'
UNION ALL
SELECT 'cron job', j.jobname, j.command
FROM cron.job j
WHERE j.command ~* '\m(get_slot_capacity|get_display_name)\M';


-- ── §A AFTER applying ─────────────────────────────────────────────────────

-- A1. Per function. Expect the same rows as 0a, each now with
--       anon_exec = false   auth_exec = false   service_exec = true
--       public_exec = false
--     and an acl with no '=X/', no 'anon=' and no 'authenticated=' entry.
SELECT p.oid::regprocedure                                        AS function,
       has_function_privilege('anon', p.oid, 'EXECUTE')           AS anon_exec,
       has_function_privilege('authenticated', p.oid, 'EXECUTE')  AS auth_exec,
       has_function_privilege('service_role', p.oid, 'EXECUTE')   AS service_exec,
       EXISTS (SELECT 1
               FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
               WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE') AS public_exec,
       p.proacl::text                                             AS acl
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('get_slot_capacity', 'get_display_name')
ORDER BY p.proname;

-- A2. One line. Expect:
--       functions = 2   open_to_anon = 0   open_to_authenticated = 0
--       open_to_public = 0   service_role_can_execute = 2
SELECT count(*)                                                                          AS functions,
       count(*) FILTER (WHERE has_function_privilege('anon', p.oid, 'EXECUTE'))          AS open_to_anon,
       count(*) FILTER (WHERE has_function_privilege('authenticated', p.oid, 'EXECUTE')) AS open_to_authenticated,
       count(*) FILTER (WHERE EXISTS (
         SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
         WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'))                          AS open_to_public,
       count(*) FILTER (WHERE has_function_privilege('service_role', p.oid, 'EXECUTE'))  AS service_role_can_execute
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('get_slot_capacity', 'get_display_name');


-- ── §B BEHAVIOUR — DEV ONLY ───────────────────────────────────────────────
--     ONE DO block. It only CALLS the two functions (both are read-only) with
--     ids that match nothing, and ends in an exception on purpose:
--       ERROR: PASS: …      -> all tests passed
--       ERROR: FAIL Tn: …   -> that test failed
--     T1/T2  anon is refused on both functions.
--     T3/T4  a signed-in user is refused on both.
--     T5/T6  service_role can still call both.
--     T7     the app's own slot query still works for anon
--            (get_provider_busy_slots must NOT have been touched).
DO $b$
DECLARE
  v_calls text[] := ARRAY[
    'SELECT public.get_display_name(''00000000-0000-4000-8000-000000000001''::uuid)',
    'SELECT * FROM public.get_slot_capacity(''00000000-0000-4000-8000-000000000001''::uuid, CURRENT_DATE, ''00:00'', ''00000000-0000-4000-8000-000000000002''::uuid)'
  ];
  v_call   text;
  v_denied boolean;
  v_t      integer := 0;
BEGIN
  -- T1, T2: anon
  SET LOCAL ROLE anon;
  FOREACH v_call IN ARRAY v_calls LOOP
    v_t := v_t + 1;
    v_denied := false;
    BEGIN
      EXECUTE v_call;
    EXCEPTION WHEN insufficient_privilege THEN
      v_denied := true;
    END;
    IF NOT v_denied THEN
      RESET ROLE;
      RAISE EXCEPTION 'FAIL T%: anon can still run: %', v_t, v_call;
    END IF;
  END LOOP;
  RESET ROLE;

  -- T3, T4: authenticated
  PERFORM set_config('request.jwt.claims',
                     '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
  SET LOCAL ROLE authenticated;
  FOREACH v_call IN ARRAY v_calls LOOP
    v_t := v_t + 1;
    v_denied := false;
    BEGIN
      EXECUTE v_call;
    EXCEPTION WHEN insufficient_privilege THEN
      v_denied := true;
    END;
    IF NOT v_denied THEN
      RESET ROLE;
      RAISE EXCEPTION 'FAIL T%: authenticated can still run: %', v_t, v_call;
    END IF;
  END LOOP;
  RESET ROLE;

  -- T5, T6: service_role
  SET LOCAL ROLE service_role;
  FOREACH v_call IN ARRAY v_calls LOOP
    v_t := v_t + 1;
    BEGIN
      EXECUTE v_call;
    EXCEPTION WHEN insufficient_privilege THEN
      RESET ROLE;
      RAISE EXCEPTION 'FAIL T%: service_role is refused: %', v_t, v_call;
    END;
  END LOOP;
  RESET ROLE;

  -- T7: the function the app really uses is untouched.
  v_t := v_t + 1;
  SET LOCAL ROLE anon;
  BEGIN
    PERFORM * FROM public.get_provider_busy_slots(
      '00000000-0000-4000-8000-000000000001'::uuid, CURRENT_DATE, CURRENT_DATE);
  EXCEPTION WHEN insufficient_privilege THEN
    RESET ROLE;
    RAISE EXCEPTION 'FAIL T%: anon can no longer call get_provider_busy_slots — the home page needs it', v_t;
  END;
  RESET ROLE;

  RAISE EXCEPTION 'PASS: anon and authenticated refused on both functions; service_role works; get_provider_busy_slots still open to anon (% tests)', v_t;
END;
$b$;


-- ── §E ROLLBACK (only if needed; do NOT run as part of verification) ──────
--     Only if a caller this investigation did not find turns up. Grant back
--     the ONE function and the ONE role that caller needs — tell me which
--     first. The lines below restore the previous state in full.
--     Use the signatures 0a printed if they differ on this database.
--
--   GRANT EXECUTE ON FUNCTION public.get_display_name(uuid)                  TO PUBLIC, anon, authenticated;
--   GRANT EXECUTE ON FUNCTION public.get_slot_capacity(uuid, date, text, uuid) TO PUBLIC, anon, authenticated;
