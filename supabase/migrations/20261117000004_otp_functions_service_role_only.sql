-- OTP functions: EXECUTE for service_role only.
--
-- ORDER: VERIFY §0 → this file → VERIFY §A → §B, on DEV and then on PROD.
-- Safe to re-run: REVOKE and GRANT are no-ops when already applied.
-- Rollback: VERIFY §E (not expected to be needed — see "WHO CALLS THEM").
--
-- WHY. The six otp_* functions are SECURITY DEFINER and were created with
-- "REVOKE ALL ... FROM PUBLIC" only. Supabase's default privileges on schema
-- public grant EXECUTE to anon and authenticated BY NAME, and a revoke from
-- PUBLIC does not remove a named grant. So anyone holding the public anon key
-- can call them through PostgREST today:
--   otp_find_user_by_phone(text)  returns the auth user id AND E-MAIL for any
--                                 phone number — phone enumeration plus an
--                                 e-mail leak. The worst of the six.
--   otp_create_request / otp_verify_attempt / otp_invalidate / otp_mark_sent
--                                 let a caller write, burn or invalidate OTP
--                                 requests and their rate-limit counters.
--   otp_cleanup()                 deletes OTP rows older than 24 hours.
--
-- WHO CALLS THEM (checked 2026-11-17):
--   * src/ on main ............. nothing. The only matches are the generated
--                                types.ts and a comment in packageTypes.ts.
--   * supabase/functions/ on main  nothing.
--   * every local and remote branch: one caller, the whatsapp-otp edge
--                                function on feat/whatsapp-otp-internal
--                                (create_request, invalidate, mark_sent,
--                                find_user_by_phone, verify_attempt). Every
--                                call goes through its SERVICE-ROLE client.
--                                That function IS deployed on PROD (v22,
--                                2026-08-12) although the OTP login is not
--                                live; the service_role grant below keeps it
--                                working exactly as before.
--   * otp_cleanup .............. only the pg_cron job
--                                'otp-requests-cleanup-hourly', which runs as
--                                the role that scheduled it (VERIFY §0c / §A3
--                                show that role keeps EXECUTE).
--   * make-otp (also deployed) . no otp_* call and no table access at all.
-- So no caller runs as anon or authenticated, and none is affected.
--
-- NOT IN main: the functions themselves are created by
-- 20260812000001_whatsapp_otp.sql on feat/whatsapp-otp-internal, applied by
-- hand to PROD. This file therefore does not name their signatures: it finds
-- every function in public with one of the six names — all overloads — so a
-- database where one is missing or has a different argument list (DEV drifts)
-- neither fails nor leaves an overload open. VERIFY §A asserts the result.
--
-- The table grants are untouched: otp_requests and sendpulse_token_cache
-- were created with RLS on, no policies, and anon / authenticated revoked
-- (VERIFY §0d confirms that on each database).

BEGIN;

DO $otp_grants$
DECLARE
  fn    regprocedure;
  found integer := 0;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('otp_cleanup', 'otp_create_request', 'otp_find_user_by_phone',
                        'otp_invalidate', 'otp_mark_sent', 'otp_verify_attempt')
    ORDER BY p.proname
  LOOP
    -- PUBLIC, anon and authenticated BY NAME: the named grants are the ones a
    -- revoke from PUBLIC alone leaves behind.
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
    found := found + 1;
    RAISE NOTICE 'service_role only: %', fn;
  END LOOP;

  IF found = 0 THEN
    RAISE NOTICE 'no otp_* function exists in public on this database — nothing to do';
  ELSIF found <> 6 THEN
    RAISE NOTICE 'expected 6 otp_* functions, found % — compare with VERIFY §0a', found;
  END IF;
END;
$otp_grants$;

COMMIT;
