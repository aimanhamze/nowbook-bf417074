-- VERIFY for 20261117000002_notification_bell.sql and the manual index in
-- 20261117000003_notifications_unread_index.sql. Run on DEV, then on PROD.
-- Everything here is read-only: §B and §C3 run inside transactions that ROLL
-- BACK and contain only SELECT / EXPLAIN. Run them in the SQL editor.
--
-- ORDER: §0 → apply 20261117000002 → §A → §B
--        → run 20261117000003 by hand, alone → §C.
-- §D is the "before" plan for comparison, §E the rollback.

-- ── §0 BEFORE applying ────────────────────────────────────────────────────

-- 0a. The function does not exist yet. Expect ZERO rows.
SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND proname = 'unread_notification_count';

-- 0b. The index does not exist yet. Expect ZERO rows.
SELECT indexname FROM pg_indexes
WHERE schemaname = 'public' AND indexname = 'idx_notifications_user_unread';

-- 0c. The anon revoke was already applied by hand. Expect anon_insert = false
--     BEFORE this migration too (true means the hand-applied step is missing
--     on this database; the migration then applies it).
SELECT has_table_privilege('anon', 'public.notifications', 'INSERT') AS anon_insert;


-- ── §A AFTER applying 20261117000002 ──────────────────────────────────────

-- A1. Table INSERT privilege. Expect: anon_insert = false, auth_insert = true.
--     (authenticated must keep INSERT — the app writes bell rows as the
--     signed-in user.)
SELECT has_table_privilege('anon', 'public.notifications', 'INSERT')          AS anon_insert,
       has_table_privilege('authenticated', 'public.notifications', 'INSERT') AS auth_insert;

-- A2. anon's remaining table grants, for the record. INSERT must NOT be in
--     the list. (Nothing else was changed; whatever else shows is as before.)
SELECT grantee, string_agg(privilege_type, ', ' ORDER BY privilege_type) AS privs
FROM information_schema.role_table_grants
WHERE table_schema = 'public' AND table_name = 'notifications'
  AND grantee IN ('anon', 'authenticated')
GROUP BY grantee;

-- A3. The function. Expect ONE row:
--     args ''  result integer  secdef f (SECURITY INVOKER)  volatility s (STABLE)
--     config {search_path=""}  anon_exec f  auth_exec t
--     acl has no '=X/' entry (PUBLIC) and no 'anon=' entry.
SELECT p.proname,
       pg_get_function_identity_arguments(p.oid) AS args,
       pg_get_function_result(p.oid)             AS result,
       p.prosecdef                               AS secdef,
       p.provolatile                             AS volatility,
       p.proconfig                               AS config,
       has_function_privilege('anon', p.oid, 'EXECUTE')          AS anon_exec,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_exec,
       p.proacl::text                            AS acl
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'unread_notification_count';


-- ── §B BEHAVIOUR (read-only, rolled back) ─────────────────────────────────

-- B1. Pick the users to test with: the heaviest, one in the 1..9 range, and
--     note any user id with no unread rows for B4. Read the ids off this list.
SELECT user_id, count(*) FILTER (WHERE NOT is_read) AS unread, count(*) AS total
FROM public.notifications
GROUP BY user_id
ORDER BY unread DESC
LIMIT 5;

SELECT user_id, count(*) FILTER (WHERE NOT is_read) AS unread
FROM public.notifications
GROUP BY user_id
HAVING count(*) FILTER (WHERE NOT is_read) BETWEEN 1 AND 9
LIMIT 3;

-- B2. As the HEAVIEST user (replace every <TOP_USER> — three places).
--     Expect: rpc_count = 10, real_unread = the big number, badge_same = true.
--     badge_same compares what the bell renders ("9+" above 9) for both.
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"<TOP_USER>","role":"authenticated"}';
SET LOCAL request.jwt.claim.sub = '<TOP_USER>';
SELECT r.rpc_count, u.real_unread,
       (CASE WHEN r.rpc_count  > 9 THEN '9+' ELSE r.rpc_count::text  END) =
       (CASE WHEN u.real_unread > 9 THEN '9+' ELSE u.real_unread::text END) AS badge_same
FROM (SELECT public.unread_notification_count() AS rpc_count) r,
     (SELECT count(*) AS real_unread FROM public.notifications
       WHERE user_id = '<TOP_USER>' AND is_read = false) u;
ROLLBACK;

-- B3. As a user with 1..9 unread (replace <SMALL_USER>).
--     Expect: rpc_count = real_unread exactly, badge_same = true.
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"<SMALL_USER>","role":"authenticated"}';
SET LOCAL request.jwt.claim.sub = '<SMALL_USER>';
SELECT r.rpc_count, u.real_unread,
       (CASE WHEN r.rpc_count  > 9 THEN '9+' ELSE r.rpc_count::text  END) =
       (CASE WHEN u.real_unread > 9 THEN '9+' ELSE u.real_unread::text END) AS badge_same
FROM (SELECT public.unread_notification_count() AS rpc_count) r,
     (SELECT count(*) AS real_unread FROM public.notifications
       WHERE user_id = '<SMALL_USER>' AND is_read = false) u;
ROLLBACK;

-- B4. A user who has no notifications at all sees 0 — and never anyone
--     else's rows. The uuid below is random on purpose. Expect: 0.
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}';
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';
SELECT public.unread_notification_count() AS expect_0;
ROLLBACK;

-- B5. anon cannot call it. Expect an ERROR:
--     "permission denied for function unread_notification_count".
--     (The error aborts the transaction; the ROLLBACK closes it.)
BEGIN;
SET LOCAL ROLE anon;
SELECT public.unread_notification_count();
ROLLBACK;


-- ── §C AFTER running 20261117000003 by hand (the index) ───────────────────

-- C1. The index exists and is usable. Expect ONE row: valid = true,
--     ready = true, and the definition ends with
--     "USING btree (user_id) WHERE (NOT is_read)".
--     valid = false → a build failed: drop it CONCURRENTLY (see the header of
--     20261117000003) and run that file again.
SELECT c.relname AS index_name, i.indisvalid AS valid, i.indisready AS ready,
       pg_size_pretty(pg_relation_size(c.oid)) AS size,
       pg_get_indexdef(c.oid) AS definition
FROM pg_index i
JOIN pg_class c ON c.oid = i.indexrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname = 'idx_notifications_user_unread';

-- C2. All indexes on the table, with usage. Expect three: notifications_pkey,
--     idx_notifications_user_id, idx_notifications_user_unread. (Re-run a day
--     after the app ships: idx_scan on the new one should be climbing.)
SELECT s.indexrelname, s.idx_scan, pg_size_pretty(pg_relation_size(s.indexrelid)) AS size
FROM pg_stat_user_indexes s
WHERE s.schemaname = 'public' AND s.relname = 'notifications'
ORDER BY s.indexrelname;

-- C3. THE NEW PLAN, as the heaviest user (replace <TOP_USER>).
--     First statement = exactly what the function runs. Expect:
--       Index Only Scan (or Index Scan) using idx_notifications_user_unread,
--       under a Limit, actual rows = 10, a handful of buffers,
--       Execution Time well under 1 ms   (was: Bitmap Heap Scan via
--       idx_notifications_user_id, 729 rows, 320 heap blocks, 284 ms).
--     auth.uid() must appear once as an InitPlan / One-Time value, not as a
--     per-row filter.
--     Second statement = the function call itself, for the end-to-end time.
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"<TOP_USER>","role":"authenticated"}';
SET LOCAL request.jwt.claim.sub = '<TOP_USER>';

EXPLAIN (ANALYZE, BUFFERS)
SELECT count(*)::integer
FROM (
  SELECT 1
  FROM public.notifications
  WHERE user_id = (SELECT auth.uid())
    AND NOT is_read
  LIMIT 10
) s;

EXPLAIN (ANALYZE, BUFFERS)
SELECT public.unread_notification_count();
ROLLBACK;


-- ── §D FOR COMPARISON: what the badge ran before (optional) ───────────────
--     The two halves of the PostgREST head count. Run before the index for
--     the "before" numbers, or after it to see that the old shape improves
--     too. Replace <TOP_USER>.
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"<TOP_USER>","role":"authenticated"}';
SET LOCAL request.jwt.claim.sub = '<TOP_USER>';

EXPLAIN (ANALYZE, BUFFERS)
SELECT n.* FROM public.notifications n
WHERE user_id = '<TOP_USER>' AND is_read = false
LIMIT 1000 OFFSET 0;

EXPLAIN (ANALYZE, BUFFERS)
SELECT count(*) FROM public.notifications
WHERE user_id = '<TOP_USER>' AND is_read = false;
ROLLBACK;


-- ── §E ROLLBACK (only if needed; do NOT run as part of verification) ──────
--     Roll the APP back first — the new badge has no fallback without the
--     function. The anon revoke is a security fix and is deliberately NOT
--     part of the rollback.
--
--   DROP FUNCTION IF EXISTS public.unread_notification_count();
--   -- alone, by hand, not inside a transaction:
--   DROP INDEX CONCURRENTLY IF EXISTS public.idx_notifications_user_unread;
