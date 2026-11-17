-- VERIFY for 20261117000004_otp_functions_service_role_only.sql.
-- Run on DEV, then on PROD, in the SQL editor.
-- Read-only: §0 and §A are catalog SELECTs; §B runs inside transactions that
-- ROLL BACK and calls only otp_find_user_by_phone, which is a plain SELECT.
--
-- ORDER: §0 → apply 20261117000004 → §A → §B.   §E is the rollback.

-- ── §0 BEFORE applying ────────────────────────────────────────────────────

-- 0a. The six functions as they are now. Expect on PROD: SIX rows, one per
--     name, secdef = true, and anon_exec = true / auth_exec = true (the hole).
--     Fewer rows, or two rows for one name (an overload), is fine for the
--     migration — it handles both — but tell me, because it means this
--     database differs from PROD.
--     The acl shows WHY: 'anon=X/...' and 'authenticated=X/...' are named
--     grants; there is no '=X/...' entry because PUBLIC was already revoked.
SELECT p.oid::regprocedure                                        AS function,
       p.prosecdef                                                AS secdef,
       has_function_privilege('anon', p.oid, 'EXECUTE')           AS anon_exec,
       has_function_privilege('authenticated', p.oid, 'EXECUTE')  AS auth_exec,
       has_function_privilege('service_role', p.oid, 'EXECUTE')   AS service_exec,
       p.proacl::text                                             AS acl
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('otp_cleanup', 'otp_create_request', 'otp_find_user_by_phone',
                    'otp_invalidate', 'otp_mark_sent', 'otp_verify_attempt')
ORDER BY p.proname;

-- 0b. The leak itself, for the record (optional — it returns a real user's
--     id and e-mail, so do not paste the output anywhere). Put any customer's
--     phone in place of <PHONE>. Expect BEFORE: one row, as anon.
--     After the migration this same block is §B1 and must fail.
-- BEGIN;
-- SET LOCAL ROLE anon;
-- SELECT * FROM public.otp_find_user_by_phone('<PHONE>');
-- ROLLBACK;

-- 0c. The cleanup cron job and the role it runs as. Expect on PROD: ONE row,
--     jobname otp-requests-cleanup-hourly, and runs_as_can_execute = true.
--     That role is not anon / authenticated, so the migration does not
--     change this value (§A3 re-checks). ZERO rows = no such job here (DEV).
SELECT j.jobname, j.schedule, j.username AS runs_as, j.active, j.command,
       has_function_privilege(j.username, to_regprocedure('public.otp_cleanup()'), 'EXECUTE') AS runs_as_can_execute
FROM cron.job j
WHERE j.command ILIKE '%otp_cleanup%';

-- 0d. The tables behind the functions are already closed. Expect TWO rows,
--     rls = true, policies = 0, anon_privs and auth_privs both empty.
SELECT c.relname,
       c.relrowsecurity AS rls,
       (SELECT count(*) FROM pg_policy pol WHERE pol.polrelid = c.oid) AS policies,
       array_to_string(ARRAY(
         SELECT p FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE']) p
         WHERE has_table_privilege('anon', c.oid, p)), ',')          AS anon_privs,
       array_to_string(ARRAY(
         SELECT p FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE']) p
         WHERE has_table_privilege('authenticated', c.oid, p)), ',') AS auth_privs
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname IN ('otp_requests', 'sendpulse_token_cache')
ORDER BY c.relname;


-- ── §A AFTER applying ─────────────────────────────────────────────────────

-- A1. Per function. Expect the SAME rows as 0a, each now with
--       anon_exec = false   auth_exec = false   service_exec = true
--       public_exec = false
--     and an acl with no 'anon=' and no 'authenticated=' entry.
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
  AND p.proname IN ('otp_cleanup', 'otp_create_request', 'otp_find_user_by_phone',
                    'otp_invalidate', 'otp_mark_sent', 'otp_verify_attempt')
ORDER BY p.proname;

-- A2. The same as one line. Expect on PROD:
--       functions = 6   open_to_anon = 0   open_to_authenticated = 0
--       service_role_can_execute = 6
SELECT count(*)                                                                    AS functions,
       count(*) FILTER (WHERE has_function_privilege('anon', p.oid, 'EXECUTE'))          AS open_to_anon,
       count(*) FILTER (WHERE has_function_privilege('authenticated', p.oid, 'EXECUTE')) AS open_to_authenticated,
       count(*) FILTER (WHERE has_function_privilege('service_role', p.oid, 'EXECUTE'))  AS service_role_can_execute
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('otp_cleanup', 'otp_create_request', 'otp_find_user_by_phone',
                    'otp_invalidate', 'otp_mark_sent', 'otp_verify_attempt');

-- A3. The cleanup cron job can still run. Expect the same row as 0c with
--     runs_as_can_execute = true.
SELECT j.jobname, j.username AS runs_as,
       has_function_privilege(j.username, to_regprocedure('public.otp_cleanup()'), 'EXECUTE') AS runs_as_can_execute
FROM cron.job j
WHERE j.command ILIKE '%otp_cleanup%';


-- ── §B BEHAVIOUR (read-only, rolled back) ─────────────────────────────────
--     Run each block on its own. The phone is deliberately impossible, so no
--     block can return a real user.

-- B1. anon is refused. Expect an ERROR:
--     "permission denied for function otp_find_user_by_phone".
--     (The error aborts the transaction; the ROLLBACK closes it.)
BEGIN;
SET LOCAL ROLE anon;
SELECT * FROM public.otp_find_user_by_phone('000');
ROLLBACK;

-- B2. A signed-in user is refused. Expect the same ERROR.
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}';
SELECT * FROM public.otp_find_user_by_phone('000');
ROLLBACK;

-- B3. service_role still works — this is what the whatsapp-otp edge function
--     uses. Expect NO error and matches = 0.
BEGIN;
SET LOCAL ROLE service_role;
SELECT count(*) AS matches FROM public.otp_find_user_by_phone('000');
ROLLBACK;


-- ── §E ROLLBACK (only if needed; do NOT run as part of verification) ──────
--     This reopens the phone-enumeration leak. Nothing in the app or in any
--     edge function calls these as anon or authenticated, so the only reason
--     to run it is a caller this investigation did not find — in that case
--     grant back the ONE function that caller needs, never all six.
--     The signatures are the ones in 20260812000001_whatsapp_otp.sql; if 0a
--     showed different ones on this database, use those.
--
--   GRANT EXECUTE ON FUNCTION public.otp_create_request(uuid, text, text, text, text, integer, integer, integer, integer, integer, integer) TO anon, authenticated;
--   GRANT EXECUTE ON FUNCTION public.otp_mark_sent(uuid)                  TO anon, authenticated;
--   GRANT EXECUTE ON FUNCTION public.otp_invalidate(uuid)                 TO anon, authenticated;
--   GRANT EXECUTE ON FUNCTION public.otp_verify_attempt(uuid, text, text) TO anon, authenticated;
--   GRANT EXECUTE ON FUNCTION public.otp_find_user_by_phone(text)         TO anon, authenticated;
--   GRANT EXECUTE ON FUNCTION public.otp_cleanup()                        TO anon, authenticated;
