-- ============================================================================
-- VERIFICATION for 20260617000001_admin_dashboard_rpcs.sql
-- Run these snippets in the Supabase SQL editor. NOT part of the migration.
-- ============================================================================

-- ---- BEFORE applying the migration -----------------------------------------
-- Expect: ZERO rows (none of these functions exist yet).
SELECT proname
FROM pg_proc
WHERE pronamespace = 'public'::regnamespace
  AND proname LIKE 'admin_%'
ORDER BY proname;


-- ---- AFTER applying the migration ------------------------------------------
-- Expect exactly these 6 rows:
--   admin_bookings_over_time
--   admin_dashboard_counts
--   admin_pending_bookings
--   admin_provider_booking_counts
--   admin_recent_bookings
--   admin_today_bookings
SELECT proname,
       prosecdef                         AS is_security_definer,  -- expect: true
       pg_get_function_identity_arguments(oid) AS args
FROM pg_proc
WHERE pronamespace = 'public'::regnamespace
  AND proname LIKE 'admin_%'
ORDER BY proname;

-- Confirm each has the hardened search_path (expect: {search_path=public, pg_temp}).
SELECT proname, proconfig
FROM pg_proc
WHERE pronamespace = 'public'::regnamespace
  AND proname LIKE 'admin_%'
ORDER BY proname;


-- ---- FUNCTIONAL SMOKE TEST (run while logged in as an ADMIN) ----------------
-- The SQL editor runs as a superuser/owner, so has_role(auth.uid(),'admin')
-- may be NULL/false there and raise 'admin only'. To exercise the real gate,
-- call from the app (or an admin JWT). The owner can still confirm the bodies
-- return data by temporarily wrapping in a role that passes the gate, OR by
-- trusting the app-side call. Sample calls once authorized as admin:

-- KPI bundle — should now show NON-ZERO bookings_today/pending/etc.
SELECT * FROM public.admin_dashboard_counts();

-- 14-day booking series (adjust dates as needed), one row per day incl. zeros:
SELECT * FROM public.admin_bookings_over_time(
  (now() AT TIME ZONE 'Asia/Jerusalem')::date - 13,
  (now() AT TIME ZONE 'Asia/Jerusalem')::date
);

-- Provider ranking incl. dormant (count 0) providers:
SELECT * FROM public.admin_provider_booking_counts();

-- Operational lists (no price, no phone):
SELECT * FROM public.admin_recent_bookings(20);
SELECT * FROM public.admin_today_bookings();
SELECT * FROM public.admin_pending_bookings();

-- ---- NEGATIVE TEST: non-admin must be rejected -----------------------------
-- Calling any function without the admin role should raise:
--   ERROR:  admin only  (SQLSTATE 42501)
