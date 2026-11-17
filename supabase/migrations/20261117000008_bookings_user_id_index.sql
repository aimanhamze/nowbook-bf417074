-- MANUAL STEP — run this file BY HAND, ALONE, as a single statement.
--
-- CREATE INDEX CONCURRENTLY cannot run inside a transaction block. Do not
-- paste it together with any other statement and do not wrap it in
-- BEGIN/COMMIT: a multi-statement script runs as one transaction and fails
-- with "CREATE INDEX CONCURRENTLY cannot run inside a transaction block".
-- In the SQL editor: this one statement on its own, then Run.
--
-- ORDER: VERIFY §0 → this file → VERIFY §A, on DEV and then on PROD.
--        BEFORE 20261117000009 (the profiles policy, P2), which probes
--        bookings by user_id once per profile row it checks.
-- CONCURRENTLY: bookings stays readable and writable while it builds.
-- IF IT FAILS OR IS INTERRUPTED it leaves an INVALID index behind, and
-- IF NOT EXISTS would then skip the rebuild. VERIFY §A shows indisvalid; if
-- false:  DROP INDEX CONCURRENTLY public.idx_bookings_user_id;
-- (also alone, by hand) and run this file again.
--
-- WHY IT IS A MIGRATION AT ALL. PROD already has an index with this name on
-- bookings (user_id) — seen in the index list of 2026-11-17 — but NO repo
-- migration creates it, and DEV was never checked. On PROD this statement is
-- expected to be a no-op ("relation already exists, skipping"); on a database
-- without it, it builds it. Either way the repo now records an index that
-- P2's policy helper and the customer's own bookings list rely on.
-- IF NOT EXISTS matches on the NAME only: VERIFY §0 shows the existing
-- definition, so a same-named index on other columns would be noticed there.
-- Rollback: VERIFY §E.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_bookings_user_id
  ON public.bookings (user_id);
