-- ============================================================================
-- VERIFICATION for 20260617000002_admin_last_logins.sql
-- Run in the Supabase SQL editor. NOT part of the migration.
-- ============================================================================

-- Function exists, is SECURITY DEFINER, returns exactly (user_id, last_sign_in_at).
SELECT proname,
       prosecdef                                   AS is_security_definer,  -- expect: true
       proconfig,                                                            -- expect: {search_path=public, auth, pg_temp}
       pg_get_function_result(oid)                 AS returns                -- expect: TABLE(user_id uuid, last_sign_in_at timestamp with time zone)
FROM pg_proc
WHERE pronamespace = 'public'::regnamespace
  AND proname = 'admin_provider_last_logins';

-- Grants: authenticated only; anon/public revoked.
SELECT grantee, privilege_type
FROM information_schema.role_routine_grants
WHERE routine_name = 'admin_provider_last_logins';

-- Sample call. In the SQL editor auth.uid() is NULL, so the admin gate fires:
--   expect ERROR:  admin only  (SQLSTATE 42501)
-- That confirms the gate. Real data comes back when called from the app as an
-- authenticated admin.
SELECT * FROM public.admin_provider_last_logins();
