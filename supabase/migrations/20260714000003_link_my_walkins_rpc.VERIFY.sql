-- VERIFY / test plan for 20260714000003_link_my_walkins_rpc.sql
-- Run AFTER applying the migration.

-- ─────────────────────────────────────────────────────────────────────────────
-- §A. Object checks (read-only)
-- ─────────────────────────────────────────────────────────────────────────────

-- A1. Function exists, SECURITY DEFINER, search_path pinned, returns integer.
--     Expect: prosecdef = true; proconfig contains 'search_path=public'.
SELECT proname, prosecdef, proconfig, pg_get_function_result(oid) AS returns
FROM pg_proc
WHERE proname = 'link_my_walkins' AND pronamespace = 'public'::regnamespace;

-- A2. EXECUTE granted to authenticated (and NOT to public/anon).
--     Expect: a row for 'authenticated' with privilege_type = 'EXECUTE'.
SELECT grantee, privilege_type
FROM information_schema.routine_privileges
WHERE routine_schema = 'public' AND routine_name = 'link_my_walkins'
ORDER BY grantee;

-- ─────────────────────────────────────────────────────────────────────────────
-- §B. Read-only MATCH PREVIEW (does NOT call the RPC — auth.uid() is NULL in the
-- SQL editor, so the RPC itself would return 0 here). This shows, for a given
-- verified phone, which unlinked walk-ins the RPC WOULD claim for that account.
-- Replace :user_id with a real account id whose auth.users.phone you want to test.
-- ─────────────────────────────────────────────────────────────────────────────
WITH me AS (
  SELECT id AS user_id, regexp_replace(phone, '\D', '', 'g') AS dphone
  FROM auth.users
  WHERE id = ':user_id'
)
SELECT b.id, b.booking_date, b.booking_time, b.customer_name, b.customer_phone
FROM public.bookings b, me
WHERE b.user_id IS NULL
  AND b.linked_user_id IS NULL
  AND b.customer_phone IS NOT NULL
  AND length(me.dphone) >= 9
  AND regexp_replace(b.customer_phone, '\D', '', 'g') = me.dphone;
--   These rows would get linked_user_id = :user_id when that user next logs in.

-- §B2. Shared-phone edge check: does any phone belong to 2+ accounts? If so, each
-- such account would claim the same walk-ins for itself on login (see report).
SELECT regexp_replace(phone, '\D', '', 'g') AS dphone, COUNT(*) AS accounts
FROM auth.users
WHERE phone IS NOT NULL AND regexp_replace(phone, '\D', '', 'g') <> ''
GROUP BY 1
HAVING COUNT(*) >= 2;

-- ─────────────────────────────────────────────────────────────────────────────
-- §C. End-to-end functional test (run via the APP, because the RPC keys on the
-- authenticated caller's auth.uid() / auth.users.phone — not reproducible as the
-- postgres SQL role).
-- ─────────────────────────────────────────────────────────────────────────────
--  1. As a PROVIDER, create a walk-in typing a phone that has NO account yet.
--     Confirm (SQL): the row has user_id NULL AND linked_user_id NULL.
--        SELECT id, user_id, linked_user_id, customer_phone FROM bookings
--        WHERE customer_phone = '<the phone>' ORDER BY created_at DESC LIMIT 1;
--  2. Sign up / log in via phone OTP with THAT phone. afterAuth() fires
--     link_my_walkins() (fire-and-forget).
--     Confirm (SQL): linked_user_id now = the new account's id.
--  3. Open the customer's Bookings — the walk-in now appears (Phase 3 reads
--     linked_user_id), view-only (no cancel button).
--  4. Log out and back in with the same account → link_my_walkins() runs again
--     and links NOTHING new (idempotent: rows are no longer linked_user_id NULL).
--     Confirm the RPC return value is 0 on the second call (check network/logs).
--  5. Log in as a PROVIDER or ADMIN → no-op (no walk-in's customer_phone matches
--     their number; and even if one did, providers don't use the customer view).
--
-- Cleanup (only if you created throwaway test rows and want them gone):
--   DELETE FROM public.bookings WHERE customer_phone = '<the test phone>';
