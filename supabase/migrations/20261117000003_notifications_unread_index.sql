-- MANUAL STEP — run this file BY HAND, ALONE, as a single statement.
--
-- CREATE INDEX CONCURRENTLY cannot run inside a transaction block. Do not
-- paste it together with any other statement, do not wrap it in BEGIN/COMMIT,
-- and do not append it to 20261117000002: a multi-statement script runs as one
-- transaction and fails with
--   "CREATE INDEX CONCURRENTLY cannot run inside a transaction block".
-- In the SQL editor: this one statement on its own, then Run.
--
-- ORDER: after 20261117000002 (any time — the function works without it),
--        DEV first, then PROD. Then VERIFY §C.
-- CONCURRENTLY: the table stays readable and writable while it builds
-- (seconds at ~20k rows).
-- IF IT FAILS OR IS INTERRUPTED it leaves an INVALID index behind, and
-- IF NOT EXISTS would then skip the rebuild. VERIFY §C1 shows indisvalid; if
-- false:  DROP INDEX CONCURRENTLY public.idx_notifications_user_unread;
-- (also alone, by hand) and run this file again.
--
-- WHAT. Only UNREAD rows, by user. The predicate is written exactly as
-- unread_notification_count() writes it (NOT is_read), and also serves the
-- "mark all read" UPDATE (is_read = false). Rows leave the index when read,
-- so it stays small.
-- Rollback: VERIFY §E.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notifications_user_unread
  ON public.notifications (user_id)
  WHERE NOT is_read;
