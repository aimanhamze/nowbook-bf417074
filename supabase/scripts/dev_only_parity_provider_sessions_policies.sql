-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  DEV ONLY (ovpfjlqlfzxjfcbrtwra). NOT A MIGRATION.                       ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- Schema parity: DEV's provider_sessions has RLS enabled and ZERO policies, so
-- no signed-in user can read a single row. PROD has two policies (read by the
-- user 2026-11-10 from pg_policies):
--
--   authenticated_read_sessions    SELECT  {authenticated}  USING (true)
--   providers_manage_own_sessions  ALL     {public}
--     USING (provider_id IN (SELECT provider_profiles.id FROM provider_profiles
--                            WHERE provider_profiles.user_id = auth.uid()))
--
-- Neither is in any repo migration (provider_sessions itself has no CREATE
-- TABLE in the repo), so this cannot be "the migration that never reached
-- DEV" — it is copied from PROD as read.
--
-- WITH CHECK: not reported for providers_manage_own_sessions. This script
-- creates it WITHOUT one (Postgres then applies USING to writes). Step 0
-- below checks that assumption against PROD before you run anything on DEV.
--
-- Safe if pasted into PROD by mistake: the guard aborts before any change when
-- EITHER policy name already exists on provider_sessions — and PROD has both.
-- It also aborts if DEV has gained any other policy since, rather than mixing
-- with an unknown state.


-- ═════════════════════════════════════════════════════════════════════════════
-- STEP 0 — on PROD, READ-ONLY. Confirms the copy below is exact.
-- ═════════════════════════════════════════════════════════════════════════════
-- Expect 2 rows. providers_manage_own_sessions must show with_check NULL; if
-- it shows a WITH CHECK, STOP and send it to me — the script must change.
-- SAVE the fp column of both rows: the check at the end prints the same
-- column on DEV, and the values must match.
--
-- SELECT policyname, permissive, roles, cmd, qual, with_check,
--        md5(concat_ws('|', policyname, permissive, roles::text, cmd, qual, with_check)) AS fp
-- FROM pg_policies
-- WHERE schemaname = 'public' AND tablename = 'provider_sessions'
-- ORDER BY policyname;


-- ═════════════════════════════════════════════════════════════════════════════
-- STEP 1 — on DEV.
-- ═════════════════════════════════════════════════════════════════════════════
BEGIN;

SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF to_regclass('public.provider_sessions') IS NULL THEN
    RAISE EXCEPTION 'ABORT: public.provider_sessions does not exist. Nothing changed.';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_policies
              WHERE schemaname = 'public' AND tablename = 'provider_sessions'
                AND policyname IN ('authenticated_read_sessions', 'providers_manage_own_sessions')) THEN
    RAISE EXCEPTION 'ABORT: a provider_sessions policy with one of these names already exists (is this PROD?). Nothing changed.';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_policies
              WHERE schemaname = 'public' AND tablename = 'provider_sessions') THEN
    RAISE EXCEPTION 'ABORT: provider_sessions already has other policies — DEV is not in the state this script was written for. Nothing changed; investigate by hand.';
  END IF;

  IF NOT (SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = 'public.provider_sessions'::regclass) THEN
    RAISE EXCEPTION 'ABORT: RLS is not enabled on provider_sessions — not the reported DEV state. Nothing changed.';
  END IF;

  CREATE POLICY authenticated_read_sessions
    ON public.provider_sessions
    AS PERMISSIVE
    FOR SELECT
    TO authenticated
    USING (true);

  CREATE POLICY providers_manage_own_sessions
    ON public.provider_sessions
    AS PERMISSIVE
    FOR ALL
    TO public
    USING (provider_id IN (SELECT provider_profiles.id
                             FROM public.provider_profiles
                            WHERE provider_profiles.user_id = auth.uid()));
END
$$;

COMMIT;

-- Check (DEV). Expect 2 rows, identical to STEP 0 on PROD, fp included:
--   authenticated_read_sessions    PERMISSIVE {authenticated} SELECT true
--   providers_manage_own_sessions  PERMISSIVE {public}        ALL    (provider_id IN ( SELECT provider_profiles.id …)) with_check NULL
SELECT policyname, permissive, roles, cmd, qual, with_check,
       md5(concat_ws('|', policyname, permissive, roles::text, cmd, qual, with_check)) AS fp
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'provider_sessions'
ORDER BY policyname;
