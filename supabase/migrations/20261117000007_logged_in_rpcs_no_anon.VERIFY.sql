-- VERIFY for 20261117000007_logged_in_rpcs_no_anon.sql (b2).
-- DEV first, then PROD.
--
-- HOW TO RUN. The SQL editor shows only the LAST statement's result, so run
-- ONE block at a time. Every block is a single statement; none ends on
-- ROLLBACK.
--   §0, §A  catalog SELECTs — read-only, DEV and PROD.
--   §B      ONE DO block, DEV ONLY. Ends in an ERROR on purpose, which rolls
--           everything back: "PASS: …" or "FAIL Tn: …".
--   §E      rollback.
--
-- ORDER: §0 → apply 20261117000007 → §A → §B (DEV) → smoke list (PROD).


-- ── §0 BEFORE applying ────────────────────────────────────────────────────

-- 0a. The seven functions now. Expect SEVEN rows, secdef = true, and BEFORE
--     on PROD: anon_exec = true on all seven; public_exec = true on six
--     (false on link_my_walkins, which is open through a named anon grant).
--     auth_exec = true on all seven — §A1 must show it unchanged.
--     Keep the service_exec column: §A1 must show it unchanged too.
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
  AND p.proname IN ('package_activate', 'package_add_entries', 'package_return_entry',
                    'package_cancel', 'package_request_purchase',
                    'link_my_walkins', 'get_class_booking_counts')
ORDER BY p.proname;

-- 0b. Is any of the seven used where a LOGGED-OUT caller would reach it —
--     inside an RLS policy, a view, or a SECURITY INVOKER function that anon
--     may execute? Expect ZERO rows. Any row: do not apply — send it to me.
SELECT 'policy' AS found_in,
       pol.schemaname || '.' || pol.tablename || ' — ' || pol.policyname AS object,
       pol.cmd || ' TO ' || array_to_string(pol.roles, ',')              AS detail
FROM pg_policies pol
WHERE (COALESCE(pol.qual, '') || ' ' || COALESCE(pol.with_check, ''))
      ~* '\m(package_activate|package_add_entries|package_return_entry|package_cancel|package_request_purchase|link_my_walkins|get_class_booking_counts)\M'
UNION ALL
SELECT 'view', n.nspname || '.' || c.relname, ''
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind IN ('v', 'm')
  AND n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND pg_get_viewdef(c.oid)
      ~* '\m(package_activate|package_add_entries|package_return_entry|package_cancel|package_request_purchase|link_my_walkins|get_class_booking_counts)\M'
UNION ALL
SELECT 'invoker function open to anon', p.oid::regprocedure::text, ''
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.prokind IN ('f', 'p')
  AND NOT p.prosecdef
  AND has_function_privilege('anon', p.oid, 'EXECUTE')
  AND p.proname NOT IN ('package_activate', 'package_add_entries', 'package_return_entry',
                        'package_cancel', 'package_request_purchase',
                        'link_my_walkins', 'get_class_booking_counts')
  AND p.prosrc
      ~* '\m(package_activate|package_add_entries|package_return_entry|package_cancel|package_request_purchase|link_my_walkins|get_class_booking_counts)\M';


-- ── §A AFTER applying ─────────────────────────────────────────────────────

-- A1. Per function. Expect the same seven rows, each now with
--       anon_exec = false   public_exec = false   auth_exec = true
--     service_exec as it was in 0a, and an acl with no '=X/' and no 'anon='
--     entry but WITH an 'authenticated=X/' entry.
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
  AND p.proname IN ('package_activate', 'package_add_entries', 'package_return_entry',
                    'package_cancel', 'package_request_purchase',
                    'link_my_walkins', 'get_class_booking_counts')
ORDER BY p.proname;

-- A2. One line. Expect:
--       functions = 7   open_to_anon = 0   open_to_public = 0
--       authenticated_can_execute = 7
SELECT count(*)                                                                          AS functions,
       count(*) FILTER (WHERE has_function_privilege('anon', p.oid, 'EXECUTE'))          AS open_to_anon,
       count(*) FILTER (WHERE EXISTS (
         SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
         WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'))                          AS open_to_public,
       count(*) FILTER (WHERE has_function_privilege('authenticated', p.oid, 'EXECUTE')) AS authenticated_can_execute
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('package_activate', 'package_add_entries', 'package_return_entry',
                    'package_cancel', 'package_request_purchase',
                    'link_my_walkins', 'get_class_booking_counts');


-- ── §B BEHAVIOUR — DEV ONLY ───────────────────────────────────────────────
--     ONE DO block. Each function is called with ids that match nothing, so
--     no call can change a row: the package functions stop at
--     PACKAGE_NOT_FOUND / TEMPLATE_NOT_AVAILABLE, link_my_walkins finds no
--     phone for the made-up user and returns 0, get_class_booking_counts
--     gets empty arrays. The block ends in an exception on purpose, which
--     also rolls everything back:
--       ERROR: PASS: …      -> all 14 tests passed
--       ERROR: FAIL Tn: …   -> that test failed
--     T1–T7    anon is REFUSED on each of the seven ("permission denied"),
--              i.e. before the function body runs.
--     T8–T14   a signed-in user is NOT refused on any of the seven. The
--              function's own answer (PACKAGE_NOT_FOUND, …) counts as a pass:
--              it proves the body ran.
DO $b$
DECLARE
  v_calls text[] := ARRAY[
    'SELECT public.package_activate(''00000000-0000-4000-8000-0000000000aa''::uuid)',
    'SELECT public.package_add_entries(''00000000-0000-4000-8000-0000000000aa''::uuid, 1, 0, NULL)',
    'SELECT public.package_return_entry(''00000000-0000-4000-8000-0000000000aa''::uuid, NULL)',
    'SELECT public.package_cancel(''00000000-0000-4000-8000-0000000000aa''::uuid, NULL)',
    'SELECT public.package_request_purchase(''00000000-0000-4000-8000-0000000000aa''::uuid)',
    'SELECT public.link_my_walkins()',
    'SELECT * FROM public.get_class_booking_counts(ARRAY[]::uuid[], ARRAY[]::date[])'
  ];
  v_call   text;
  v_denied boolean;
  v_t      integer := 0;
BEGIN
  -- T1–T7: anon
  SET LOCAL ROLE anon;
  FOREACH v_call IN ARRAY v_calls LOOP
    v_t := v_t + 1;
    v_denied := false;
    BEGIN
      EXECUTE v_call;
    EXCEPTION
      WHEN insufficient_privilege THEN v_denied := true;
      WHEN OTHERS THEN v_denied := false;   -- the body ran: anon got in
    END;
    IF NOT v_denied THEN
      RESET ROLE;
      RAISE EXCEPTION 'FAIL T%: anon is not refused: %', v_t, v_call;
    END IF;
  END LOOP;
  RESET ROLE;

  -- T8–T14: authenticated, as a user id that exists nowhere
  PERFORM set_config('request.jwt.claims',
                     '{"sub":"00000000-0000-4000-8000-0000000000bb","role":"authenticated"}', true);
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000bb', true);
  SET LOCAL ROLE authenticated;
  FOREACH v_call IN ARRAY v_calls LOOP
    v_t := v_t + 1;
    v_denied := false;
    BEGIN
      EXECUTE v_call;
    EXCEPTION
      WHEN insufficient_privilege THEN v_denied := true;
      WHEN OTHERS THEN v_denied := false;   -- the function's own refusal: it ran
    END;
    IF v_denied THEN
      RESET ROLE;
      RAISE EXCEPTION 'FAIL T%: authenticated is refused — the app would break: %', v_t, v_call;
    END IF;
  END LOOP;
  RESET ROLE;

  RAISE EXCEPTION 'PASS: anon refused on all 7; authenticated can still call all 7 (% tests, nothing written)', v_t;
END;
$b$;


-- ── SMOKE LIST after PROD (in the app) ────────────────────────────────────
--   1. Customer signs in → lands in the app (link_my_walkins runs on every
--      sign-in; a failure is only logged, so also check the browser console
--      for "link_my_walkins failed").
--   2. Fitness studio: open a class in the booking flow → spots left shows
--      real numbers (get_class_booking_counts).
--   3. Provider → Packages: activate a pending package, or add an entry.
--   4. Customer → a fitness studio's packages: "request purchase" works.


-- ── §E ROLLBACK (only if needed; do NOT run as part of verification) ──────
--     Only if a logged-out caller this investigation did not find turns up;
--     tell me which function first and grant back that one alone.
--     Example for one function:
--
--   GRANT EXECUTE ON FUNCTION public.get_class_booking_counts(uuid[], date[]) TO anon;
--
--     The full previous state (anon + PUBLIC on all seven; link_my_walkins
--     had anon only). Use the signatures 0a printed if they differ here.
--
--   GRANT EXECUTE ON FUNCTION public.package_activate(uuid)                         TO PUBLIC, anon;
--   GRANT EXECUTE ON FUNCTION public.package_add_entries(uuid, integer, integer, text) TO PUBLIC, anon;
--   GRANT EXECUTE ON FUNCTION public.package_return_entry(uuid, text)               TO PUBLIC, anon;
--   GRANT EXECUTE ON FUNCTION public.package_cancel(uuid, text)                     TO PUBLIC, anon;
--   GRANT EXECUTE ON FUNCTION public.package_request_purchase(uuid)                 TO PUBLIC, anon;
--   GRANT EXECUTE ON FUNCTION public.get_class_booking_counts(uuid[], date[])       TO PUBLIC, anon;
--   GRANT EXECUTE ON FUNCTION public.link_my_walkins()                              TO anon;
