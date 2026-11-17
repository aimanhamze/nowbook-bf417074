-- Notification bell: one cheap count for the badge, and a record of the
-- anon INSERT revoke.
--
-- ORDER: VERIFY §0 → this file → VERIFY §A → §B, on DEV and then on PROD.
--        Then, as a SEPARATE manual step, the index in
--        20261117000003_notifications_unread_index.sql → VERIFY §C.
-- APPLY BEFORE THE APP THAT CALLS IT IS DEPLOYED: useUnreadNotificationCount
-- has no client-side fallback, so without the function the bell badge shows
-- nothing. Applying it early is safe — nothing calls it until that app ships.
-- Safe to re-run: the REVOKE is a no-op when already applied and the function
-- is CREATE OR REPLACE.
-- Rollback: VERIFY §E.
--
-- THE INDEX IS NOT IN THIS FILE. CREATE INDEX CONCURRENTLY cannot run inside
-- a transaction block, and a multi-statement script is one. It lives alone in
-- 20261117000003 and is run by hand as a single statement. The function works
-- without it (it then uses idx_notifications_user_id); the index is what makes
-- it cheap for users with hundreds of unread rows.


-- ── 1. RECORD: anon can no longer INSERT notifications ────────────────────
-- Applied by hand on DEV and PROD on 2026-11-17, both tested; recorded here
-- so the repo matches. anon held the table-level INSERT grant, and the policy
-- "Service role can insert notifications" is FOR INSERT to {public} WITH
-- CHECK (true) — so a logged-out caller could write a row into anyone's bell.
-- No client code inserts while logged out: every insert in src/ follows a
-- booking write that itself requires a session, and the edge functions insert
-- with the service role.
--
-- NOT fixed here: the same policy still lets any AUTHENTICATED user insert a
-- notification for any other user. The app relies on that today (client-side
-- inserts), so it needs its own branch — see the ticket.
REVOKE INSERT ON public.notifications FROM anon;


-- ── 2. unread_notification_count() ────────────────────────────────────────
-- WHY. The badge used a PostgREST head count: Postgres read every unread row
-- of the user at full width (up to max-rows = 1000) and then counted them a
-- second time — every 30 seconds per open app. 20% of all database time on
-- PROD; 284 ms for the heaviest user (710 unread).
--
-- SAME BADGE. Both bells (BottomNav and the home header) render
-- `count > 9 ? "9+" : count`, so any number above 9 looks the same. The count
-- therefore stops at 10: at most 10 index entries are read no matter how many
-- unread rows the user has.
--   0..9 unread → the exact number      10 or more → 10 (rendered "9+")
-- Do NOT use this where an exact number is needed.
--
-- SECURITY INVOKER: runs as the caller, under the table's RLS
-- (auth.uid() = user_id). The explicit user_id filter is what lets the planner
-- use the index; RLS alone would give the same rows. A caller with no session
-- has auth.uid() = NULL and gets 0.
CREATE OR REPLACE FUNCTION public.unread_notification_count()
RETURNS integer
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT count(*)::integer
  FROM (
    SELECT 1
    FROM public.notifications
    WHERE user_id = (SELECT auth.uid())
      AND NOT is_read
    LIMIT 10
  ) s;
$$;

-- PUBLIC and anon by name: Supabase's default privileges grant EXECUTE to
-- anon and authenticated as NAMED grantees, which REVOKE ... FROM PUBLIC alone
-- does not remove.
REVOKE ALL ON FUNCTION public.unread_notification_count() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.unread_notification_count() FROM anon;
GRANT EXECUTE ON FUNCTION public.unread_notification_count() TO authenticated;
