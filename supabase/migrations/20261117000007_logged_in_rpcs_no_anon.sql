-- (b2) Logged-in RPCs: no EXECUTE for PUBLIC or anon.
--
-- ORDER: VERIFY §0 → this file → VERIFY §A → §B, on DEV and then on PROD.
-- Safe to re-run: REVOKE and GRANT are no-ops when already applied.
-- Rollback: VERIFY §E.
-- Grants only. No function body is changed.
--
-- THE SEVEN FUNCTIONS — all SECURITY DEFINER, all called by the app only
-- with a session:
--   package_activate, package_add_entries, package_return_entry,
--   package_cancel ............ provider (usePackageActions)
--   package_request_purchase .. customer (usePublicPackages)
--   link_my_walkins ........... customer, right after sign-in (Auth.tsx)
--   get_class_booking_counts .. BookAppointment, a ProtectedRoute
--
-- WHY. On PROD every one of them is executable by anon: six through PUBLIC
-- plus a named anon grant, link_my_walkins through a named anon grant alone.
-- The repo already says "REVOKE EXECUTE ... FROM anon" for the package
-- functions (20260905000009, 20260906000004) and "FROM PUBLIC" for
-- link_my_walkins (20260714000003) — neither is what the audit found live,
-- and get_class_booking_counts was never revoked at all.
--
-- Nothing is exploitable through them today: each package function checks
-- ownership or auth.uid() and raises for a logged-out caller, link_my_walkins
-- returns 0 without a caller, and get_class_booking_counts returns counts
-- only. But the function body is then the ONLY guard on a SECURITY DEFINER
-- function reachable with the public anon key. After this, a logged-out call
-- is refused before the body runs.
--
-- WHAT CHANGES FOR THE APP: nothing. authenticated keeps EXECUTE (granted
-- again here explicitly, so it never depends on PUBLIC), and no screen calls
-- any of the seven while logged out. service_role is not touched.
--
-- By name, every overload — same approach as 20261117000004 / …06 — so DEV's
-- drift cannot leave one open. VERIFY §A asserts the result.

BEGIN;

DO $b2_grants$
DECLARE
  fn    regprocedure;
  found integer := 0;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('package_activate', 'package_add_entries', 'package_return_entry',
                        'package_cancel', 'package_request_purchase',
                        'link_my_walkins', 'get_class_booking_counts')
    ORDER BY p.proname
  LOOP
    -- PUBLIC and anon BY NAME: a named anon grant survives a revoke from
    -- PUBLIC, and a PUBLIC grant survives a revoke from anon.
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', fn);
    found := found + 1;
    RAISE NOTICE 'authenticated only (no PUBLIC, no anon): %', fn;
  END LOOP;

  IF found <> 7 THEN
    RAISE NOTICE 'expected 7 functions, found % — compare with VERIFY §0a', found;
  END IF;
END;
$b2_grants$;

COMMIT;
