-- VERIFY for 20261117000008_bookings_user_id_index.sql. DEV first, then PROD.
-- Read-only catalog SELECTs; each block is a single statement. Run one at a
-- time (the editor shows only the last statement's result).
--
-- ORDER: §0 → run 20261117000008 by hand, alone → §A.   §E is the rollback.


-- ── §0 BEFORE ─────────────────────────────────────────────────────────────

-- 0. Every index on bookings whose FIRST column is user_id.
--    PROD, expected: ONE row, idx_bookings_user_id, valid = true,
--      definition "... USING btree (user_id)". The migration is then a no-op.
--    ZERO rows (possible on DEV): the migration builds it.
--    A row named idx_bookings_user_id whose definition is NOT plain
--    btree (user_id): stop and tell me — IF NOT EXISTS would skip it.
--    WRITE DOWN whether a row existed: §E depends on it.
SELECT c.relname AS index_name, i.indisvalid AS valid, i.indisready AS ready,
       pg_size_pretty(pg_relation_size(c.oid)) AS size,
       pg_get_indexdef(c.oid) AS definition
FROM pg_index i
JOIN pg_class c ON c.oid = i.indexrelid
JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = i.indkey[0]
WHERE i.indrelid = 'public.bookings'::regclass
  AND a.attname = 'user_id'
ORDER BY c.relname;


-- ── §A AFTER ──────────────────────────────────────────────────────────────

-- A. Expect ONE row for idx_bookings_user_id: valid = true, ready = true,
--    definition ending "USING btree (user_id)".
--    valid = false → a build failed: DROP INDEX CONCURRENTLY (see the header
--    of 20261117000008), then run that file again.
SELECT c.relname AS index_name, i.indisvalid AS valid, i.indisready AS ready,
       pg_size_pretty(pg_relation_size(c.oid)) AS size,
       pg_get_indexdef(c.oid) AS definition
FROM pg_index i
JOIN pg_class c ON c.oid = i.indexrelid
WHERE i.indrelid = 'public.bookings'::regclass
  AND c.relname = 'idx_bookings_user_id';


-- ── §E ROLLBACK (only if needed; do NOT run as part of verification) ──────
--    ONLY on a database where §0 returned ZERO rows, i.e. where this
--    migration created the index. NEVER on PROD if the index was already
--    there: it predates this migration and other queries use it.
--    Alone, by hand, not inside a transaction:
--
--   DROP INDEX CONCURRENTLY IF EXISTS public.idx_bookings_user_id;
