-- ============================================================================
-- SECURITY AUDIT REPORT — READ-ONLY
-- ============================================================================
-- ONE statement (a single SELECT), so the SQL editor shows the whole report as
-- one result grid. It reads catalogs only: no DDL, no DML, no function calls
-- into public. Safe to run on PROD and DEV as often as needed.
--
-- Run it on PROD, export the grid as CSV, then the same on DEV.
--
-- Columns
--   severity   CRITICAL / HIGH / MEDIUM / LOW / INFO / OK
--   section    A functions · B1 table RLS · B2 policies · C views ·
--              D1 buckets · D2 storage policies · E anon table grants ·
--              F default privileges
--   object     what the row is about
--   facts      what the catalog says
--   app_usage  cross-reference with the repo (src/ and supabase/functions/)
--              as of 2026-11-17, branch security/notifications-and-grants
--   note       why it has that severity / what to look at
--
-- Severity rules
--   A  CRITICAL  SECURITY DEFINER and anon can EXECUTE (even when the app
--                calls it logged-out on purpose: the note says so — those
--                need their OUTPUT reviewed, not a revoke).
--      HIGH      SECURITY DEFINER, authenticated can EXECUTE, and the client
--                never calls it (cron / edge-function / helper only).
--      MEDIUM    SECURITY DEFINER client RPC for logged-in users — correct
--                grant, but its internal ownership checks are the only guard.
--      LOW       SECURITY INVOKER but anon can EXECUTE and the app never
--                calls it logged-out (RLS still applies).
--      OK        trigger functions (cannot be called directly, EXECUTE is not
--                checked when a trigger fires) and everything else.
--   B1 CRITICAL  RLS off while anon or authenticated holds any privilege.
--   B2 CRITICAL  write policy that is literally `true`, reaches anon, and anon
--                holds the table privilege.
--      HIGH      write policy that is literally `true` for authenticated.
--      MEDIUM    write policy with no reference to auth.* / has_role / a
--                subquery (e.g. `user_id IS NOT NULL`).
--      INFO      SELECT policies that are literally `true` (listed, not
--                judged — many are intended public reads).
--   C  HIGH      view WITHOUT security_invoker readable by anon.
--      MEDIUM    view WITHOUT security_invoker readable by authenticated.
--   D2 HIGH      storage write policy that is `true` or has no auth reference.
--   E  LOW       anon holds INSERT / UPDATE / DELETE / TRUNCATE on a table
--                (the app never writes logged-out; RLS still applies, except
--                TRUNCATE, which PostgREST does not expose).
--   F  HIGH      default privileges that hand EXECUTE on new functions to
--                anon — the root cause of the function findings.
--
-- "reads" / "writes" in section A are a TEXT MATCH of public table names in
-- the function body. Good enough to see what a function touches; it is not a
-- parser (dynamic SQL and comments can fool it).
-- ============================================================================

WITH
-- ── Repo cross-reference: who calls each function ───────────────────────────
-- client:anon = called from src/ on screens reachable while logged out
-- client:auth = called from src/ only with a session
-- server      = called only from supabase/functions/ with the service role
fn_usage (fn, usage, caller) AS (
  VALUES
    ('get_provider_busy_slots',       'client:anon', 'useAllProviders, useRecurringSeries — slot availability'),
    ('get_class_booking_counts',      'client:auth', 'BookAppointment — class capacity (route is behind ProtectedRoute)'),
    ('get_course_seat_counts',        'client:anon', 'usePublicCourses — seats left'),
    ('admin_dashboard_counts',        'client:auth', 'useAdminDashboard (admin)'),
    ('admin_pending_bookings',        'client:auth', 'useAdminDashboard (admin)'),
    ('admin_today_bookings',          'client:auth', 'useAdminDashboard (admin)'),
    ('admin_recent_bookings',         'client:auth', 'useAdminDashboard (admin)'),
    ('admin_provider_booking_counts', 'client:auth', 'useAdminDashboard (admin)'),
    ('admin_bookings_over_time',      'client:auth', 'useAdminDashboard (admin)'),
    ('admin_provider_last_logins',    'client:auth', 'useAdminDashboard (admin)'),
    ('provider_customers',            'client:auth', 'useProviderCustomers (provider)'),
    ('save_date_openings',            'client:auth', 'useProviderAvailability (provider)'),
    ('create_recurring_series',       'client:auth', 'useRecurringSeries (provider)'),
    ('cancel_recurring_series',       'client:auth', 'useRecurringSeries (provider)'),
    ('waitlist_provider_counts',      'client:auth', 'useProviderWaitlist (provider)'),
    ('waitlist_provider_day',         'client:auth', 'useProviderWaitlist (provider)'),
    ('package_activate',              'client:auth', 'usePackageActions (provider)'),
    ('package_add_entries',           'client:auth', 'usePackageActions (provider)'),
    ('package_return_entry',          'client:auth', 'usePackageActions (provider)'),
    ('package_cancel',                'client:auth', 'usePackageActions (provider)'),
    ('decide_course_registration',    'client:auth', 'useAcademyRegistrations (provider)'),
    ('cancel_course_registration',    'client:auth', 'useAcademyRegistrations (provider or customer)'),
    ('register_for_course',           'client:auth', 'usePublicCourses (customer)'),
    ('package_request_purchase',      'client:auth', 'usePublicPackages (customer)'),
    ('waitlist_join',                 'client:auth', 'useWaitlist (customer)'),
    ('waitlist_leave',                'client:auth', 'useWaitlist (customer)'),
    ('link_my_walkins',               'client:auth', 'Auth.tsx after sign-in (customer)'),
    ('unread_notification_count',     'client:auth', 'useUnreadNotificationCount (any logged-in user)'),
    ('get_due_whatsapp_reminders',    'server',      'edge fn whatsapp-booking-reminder (cron)'),
    ('waitlist_candidates',           'server',      'edge fn waitlist-dispatch (cron)'),
    ('waitlist_claim_events',         'server',      'edge fn waitlist-dispatch (cron)'),
    ('waitlist_claim_round',          'server',      'edge fn waitlist-dispatch (cron)'),
    ('waitlist_housekeeping',         'server',      'edge fn waitlist-dispatch (cron)'),
    -- The otp_* functions are not defined on main: their migration and the
    -- whatsapp-otp edge function live on feat/whatsapp-otp-internal. The edge
    -- function IS deployed on PROD and calls them with the service role.
    ('otp_create_request',            'server',      'edge fn whatsapp-otp (deployed; code on feat/whatsapp-otp-internal)'),
    ('otp_mark_sent',                 'server',      'edge fn whatsapp-otp (deployed; code on feat/whatsapp-otp-internal)'),
    ('otp_invalidate',                'server',      'edge fn whatsapp-otp (deployed; code on feat/whatsapp-otp-internal)'),
    ('otp_verify_attempt',            'server',      'edge fn whatsapp-otp (deployed; code on feat/whatsapp-otp-internal)'),
    ('otp_find_user_by_phone',        'server',      'edge fn whatsapp-otp (deployed; code on feat/whatsapp-otp-internal)'),
    ('otp_cleanup',                   'server',      'pg_cron job otp-requests-cleanup-hourly')
),

-- ── Repo cross-reference: tables and views the client touches ───────────────
tbl_usage (tbl) AS (
  VALUES
    ('academy_course_sessions'), ('academy_courses'), ('academy_instructors'),
    ('bookings'), ('course_registrations'), ('customer_packages'), ('favorites'),
    ('notifications'), ('package_templates'), ('package_usage_log'), ('profiles'),
    ('provider_availability'), ('provider_blocked_dates'), ('provider_class_schedule'),
    ('provider_date_overrides'), ('provider_photos'), ('provider_profiles'),
    ('provider_services'), ('provider_sessions'), ('provider_staff'),
    ('provider_staff_availability'), ('provider_staff_blocked_dates'),
    ('provider_staff_services'), ('push_subscriptions'), ('reviews'),
    ('user_roles'), ('waitlist_entries')
),

rels AS (
  SELECT c.oid, c.relname, c.relkind, c.relrowsecurity, c.relforcerowsecurity,
         c.reloptions, c.relowner
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind IN ('r', 'p', 'v', 'm')
    AND NOT EXISTS (SELECT 1 FROM pg_depend d
                    WHERE d.classid = 'pg_class'::regclass
                      AND d.objid = c.oid AND d.deptype = 'e')
),

rel_privs AS (
  SELECT r.*,
         array_to_string(ARRAY(
           SELECT p FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p
           WHERE has_table_privilege('anon', r.oid, p)), ',')          AS anon_privs,
         array_to_string(ARRAY(
           SELECT p FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p
           WHERE has_table_privilege('authenticated', r.oid, p)), ',') AS auth_privs,
         array_to_string(ARRAY(
           SELECT p FROM unnest(ARRAY['INSERT','UPDATE','DELETE','TRUNCATE']) p
           WHERE has_table_privilege('anon', r.oid, p)), ',')          AS anon_write_privs,
         (SELECT count(*) FROM pg_policy pol WHERE pol.polrelid = r.oid) AS policy_count
  FROM rels r
),

-- ── A. Functions ────────────────────────────────────────────────────────────
fns AS (
  SELECT p.oid,
         p.proname,
         p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' AS signature,
         p.prosecdef                                                   AS secdef,
         p.prorettype = 'pg_catalog.trigger'::regtype                  AS is_trigger,
         has_function_privilege('anon', p.oid, 'EXECUTE')              AS anon_exec,
         has_function_privilege('authenticated', p.oid, 'EXECUTE')     AS auth_exec,
         has_function_privilege('service_role', p.oid, 'EXECUTE')      AS service_exec,
         EXISTS (SELECT 1
                 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
                 WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE') AS public_exec,
         COALESCE((SELECT cfg FROM unnest(p.proconfig) cfg
                   WHERE cfg LIKE 'search_path=%' LIMIT 1), 'search_path NOT SET') AS search_path,
         COALESCE(p.proacl::text, '(default acl)')                     AS acl,
         (SELECT string_agg(r.relname, ', ' ORDER BY r.relname)
          FROM rels r
          WHERE p.prosrc ~* ('\m' || r.relname || '\M'))               AS touches,
         (SELECT string_agg(r.relname, ', ' ORDER BY r.relname)
          FROM rels r
          WHERE p.prosrc ~* ('(insert\s+into|update|delete\s+from)\s+(only\s+)?(public\.)?"?' || r.relname || '\M')) AS writes,
         (SELECT string_agg(DISTINCT pol.tablename, ', ')
          FROM pg_policies pol
          WHERE (COALESCE(pol.qual, '') || ' ' || COALESCE(pol.with_check, ''))
                ~ ('\m' || p.proname || '\s*\('))                      AS in_policies_of,
         (SELECT string_agg(DISTINCT t.tgrelid::regclass::text, ', ')
          FROM pg_trigger t
          WHERE t.tgfoid = p.oid AND NOT t.tgisinternal)               AS trigger_on,
         u.usage,
         u.caller
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  LEFT JOIN fn_usage u ON u.fn = p.proname
  WHERE n.nspname = 'public'
    AND p.prokind IN ('f', 'p')
    AND NOT EXISTS (SELECT 1 FROM pg_depend d
                    WHERE d.classid = 'pg_proc'::regclass
                      AND d.objid = p.oid AND d.deptype = 'e')
),

sec_a AS (
  SELECT
    CASE
      WHEN is_trigger                                            THEN 'OK'
      WHEN secdef AND anon_exec                                  THEN 'CRITICAL'
      WHEN secdef AND auth_exec AND usage IS DISTINCT FROM 'client:auth'
                                AND usage IS DISTINCT FROM 'client:anon' THEN 'HIGH'
      WHEN secdef AND auth_exec                                  THEN 'MEDIUM'
      WHEN NOT secdef AND anon_exec AND usage IS DISTINCT FROM 'client:anon' THEN 'LOW'
      ELSE 'OK'
    END AS severity,
    'A function' AS section,
    signature AS object,
    format('%s | EXECUTE anon=%s authenticated=%s PUBLIC=%s service_role=%s | %s | touches: %s | writes: %s | acl: %s',
           CASE WHEN secdef THEN 'SECURITY DEFINER' ELSE 'security invoker' END,
           anon_exec, auth_exec, public_exec, service_exec, search_path,
           COALESCE(touches, '-'), COALESCE(writes, '-'), acl) AS facts,
    CASE
      WHEN is_trigger THEN 'trigger function on: ' || COALESCE(trigger_on, '(no trigger attached)')
      WHEN usage IS NOT NULL THEN usage || ' — ' || caller
      WHEN in_policies_of IS NOT NULL THEN 'not called by the app directly; used inside RLS policies of: ' || in_policies_of
      ELSE 'NOT called from src/ or supabase/functions/ (helper called by other functions, or dead)'
    END AS app_usage,
    concat_ws(' · ',
      CASE WHEN is_trigger THEN 'cannot be called directly; grants are irrelevant' END,
      CASE WHEN NOT is_trigger AND secdef AND anon_exec AND usage = 'client:anon'
           THEN 'anon EXECUTE is intended (app calls it logged-out): review what it RETURNS, do not revoke' END,
      CASE WHEN NOT is_trigger AND secdef AND anon_exec AND usage IS DISTINCT FROM 'client:anon' AND in_policies_of IS NULL
           THEN 'anon has no reason to call this: revoke from PUBLIC and anon by name' END,
      CASE WHEN NOT is_trigger AND secdef AND auth_exec AND usage = 'server'
           THEN 'service-role only: revoke from PUBLIC, anon, authenticated' END,
      CASE WHEN NOT is_trigger AND secdef AND auth_exec AND usage IS NULL AND in_policies_of IS NULL
           THEN 'no client caller: revoke unless another INVOKER function calls it on the caller''s behalf' END,
      CASE WHEN NOT is_trigger AND in_policies_of IS NOT NULL AND (anon_exec OR auth_exec)
           THEN 'referenced by RLS policies: the roles those policies apply to NEED EXECUTE — revoking breaks the policy; judge by what a direct call can reveal' END,
      CASE WHEN NOT is_trigger AND secdef AND usage = 'client:auth'
           THEN 'its own auth.uid() / ownership checks are the only guard: read the body' END,
      CASE WHEN secdef AND search_path = 'search_path NOT SET'
           THEN 'SECURITY DEFINER without a pinned search_path' END
    ) AS note
  FROM fns
),

-- ── B1. Tables: RLS on / off ────────────────────────────────────────────────
sec_b1 AS (
  SELECT
    CASE
      WHEN NOT relrowsecurity AND (anon_privs <> '' OR auth_privs <> '') THEN 'CRITICAL'
      WHEN NOT relrowsecurity THEN 'MEDIUM'
      WHEN policy_count = 0   THEN 'INFO'
      ELSE 'OK'
    END AS severity,
    'B1 table RLS' AS section,
    relname::text AS object,
    format('RLS %s%s | policies=%s | anon: %s | authenticated: %s',
           CASE WHEN relrowsecurity THEN 'ON' ELSE 'OFF' END,
           CASE WHEN relforcerowsecurity THEN ' (forced)' ELSE '' END,
           policy_count,
           COALESCE(NULLIF(anon_privs, ''), '-'),
           COALESCE(NULLIF(auth_privs, ''), '-')) AS facts,
    CASE WHEN EXISTS (SELECT 1 FROM tbl_usage t WHERE t.tbl = relname)
         THEN 'client reads/writes it from src/'
         ELSE 'NOT touched by src/ directly (RPC / trigger / edge function only)' END AS app_usage,
    CASE
      WHEN NOT relrowsecurity AND (anon_privs <> '' OR auth_privs <> '')
        THEN 'RLS is OFF and API roles hold privileges: every granted action applies to every row'
      WHEN NOT relrowsecurity THEN 'RLS is OFF; no API role holds a privilege today'
      WHEN policy_count = 0   THEN 'RLS on with zero policies: only service_role and SECURITY DEFINER code can reach it (fine if intended)'
      ELSE ''
    END AS note
  FROM rel_privs
  WHERE relkind IN ('r', 'p')
),

-- ── B2. Policies ────────────────────────────────────────────────────────────
pols AS (
  SELECT pol.tablename, pol.policyname, pol.cmd, pol.permissive,
         pol.roles::text[] AS roles, pol.qual, pol.with_check,
         rp.oid AS reloid,
         (pol.roles::text[] && ARRAY['public', 'anon'])                  AS reaches_anon,
         (pol.roles::text[] && ARRAY['public', 'anon', 'authenticated']) AS reaches_api,
         -- the expression that decides what may be WRITTEN
         CASE pol.cmd
           WHEN 'INSERT' THEN pol.with_check
           WHEN 'DELETE' THEN pol.qual
           ELSE COALESCE(pol.with_check, pol.qual)
         END AS write_expr,
         CASE pol.cmd
           WHEN 'INSERT' THEN has_table_privilege('anon', rp.oid, 'INSERT')
           WHEN 'UPDATE' THEN has_table_privilege('anon', rp.oid, 'UPDATE')
           WHEN 'DELETE' THEN has_table_privilege('anon', rp.oid, 'DELETE')
           WHEN 'ALL'    THEN rp.anon_write_privs <> ''
           ELSE has_table_privilege('anon', rp.oid, 'SELECT')
         END AS anon_has_priv
  FROM pg_policies pol
  JOIN rel_privs rp ON rp.relname = pol.tablename
  WHERE pol.schemaname = 'public'
),

pols_flagged AS (
  SELECT *,
         (cmd <> 'SELECT'
          AND (write_expr = 'true' OR (cmd IN ('UPDATE', 'ALL') AND qual = 'true'))) AS write_true,
         (cmd <> 'SELECT'
          AND COALESCE(write_expr, '') !~* '(auth\.|has_role|current_setting|select )') AS write_no_auth
  FROM pols
),

sec_b2 AS (
  SELECT
    CASE
      WHEN write_true AND reaches_anon AND anon_has_priv THEN 'CRITICAL'
      WHEN write_true AND reaches_api                    THEN 'HIGH'
      WHEN write_true                                    THEN 'INFO'
      WHEN write_no_auth AND reaches_api                 THEN 'MEDIUM'
      ELSE 'INFO'
    END AS severity,
    'B2 policy' AS section,
    tablename || ' — "' || policyname || '"' AS object,
    format('%s %s TO {%s} | USING (%s) | WITH CHECK (%s)',
           permissive, cmd, array_to_string(roles, ','),
           COALESCE(qual, '-'), COALESCE(with_check, '-')) AS facts,
    CASE WHEN EXISTS (SELECT 1 FROM tbl_usage t WHERE t.tbl = tablename)
         THEN 'client reads/writes this table from src/'
         ELSE 'table NOT touched by src/ directly' END AS app_usage,
    CASE
      WHEN write_true AND reaches_anon AND anon_has_priv
        THEN 'logged-out callers can write any row: anon holds the table privilege and the policy is `true`'
      WHEN write_true AND reaches_anon
        THEN 'policy is `true` for {public}/anon; anon lacks the table privilege today, so it reaches every AUTHENTICATED user'
      WHEN write_true AND reaches_api
        THEN 'any authenticated user can write any row'
      WHEN write_true
        THEN 'policy is `true` but only for non-API roles (service_role bypasses RLS anyway — the policy does nothing)'
      WHEN write_no_auth AND reaches_api
        THEN 'write check never references the caller (auth.*): it does not tie the row to who is writing'
      ELSE 'SELECT policy that is literally `true`: confirm every column of this table is meant to be readable by these roles'
    END AS note
  FROM pols_flagged
  WHERE write_true
     OR (write_no_auth AND reaches_api)
     OR (cmd = 'SELECT' AND qual = 'true' AND reaches_api)
),

-- ── C. Views ────────────────────────────────────────────────────────────────
views AS (
  SELECT rp.*,
         rp.relkind = 'm' AS is_matview,
         EXISTS (SELECT 1 FROM unnest(COALESCE(rp.reloptions, '{}'::text[])) o
                 WHERE lower(o) IN ('security_invoker=true', 'security_invoker=on', 'security_invoker=1')) AS sec_invoker
  FROM rel_privs rp
  WHERE rp.relkind IN ('v', 'm')
),

sec_c AS (
  SELECT
    CASE
      WHEN NOT sec_invoker AND anon_privs <> '' THEN 'HIGH'
      WHEN NOT sec_invoker AND auth_privs <> '' THEN 'MEDIUM'
      ELSE 'OK'
    END AS severity,
    'C view' AS section,
    relname::text AS object,
    format('%s | security_invoker=%s | owner=%s | anon: %s | authenticated: %s',
           CASE WHEN is_matview THEN 'MATERIALIZED VIEW' ELSE 'VIEW' END,
           sec_invoker, pg_get_userbyid(relowner),
           COALESCE(NULLIF(anon_privs, ''), '-'),
           COALESCE(NULLIF(auth_privs, ''), '-')) AS facts,
    CASE relname
      WHEN 'profiles_public' THEN 'defined in the repo (migration grants SELECT to anon); check src/ usage when fixing'
      ELSE 'NOT defined in any repo migration — created by hand or by tooling'
    END AS app_usage,
    CASE
      WHEN NOT sec_invoker AND (anon_privs <> '' OR auth_privs <> '')
        THEN 'runs with its OWNER''s rights, so the base tables'' RLS is bypassed: every row and column the view selects is exposed to these roles. Review the view definition (pg_get_viewdef)'
      ELSE ''
    END AS note
  FROM views
),

-- ── D. Storage ──────────────────────────────────────────────────────────────
sec_d1 AS (
  SELECT
    CASE WHEN b.public THEN 'LOW' ELSE 'OK' END AS severity,
    'D1 bucket' AS section,
    b.id::text AS object,
    format('public=%s | file_size_limit=%s | allowed_mime_types=%s',
           b.public, COALESCE(b.file_size_limit::text, 'none'),
           COALESCE(array_to_string(b.allowed_mime_types, ','), 'any')) AS facts,
    CASE WHEN b.id IN ('provider-images', 'provider-photos')
         THEN 'used by src/ (useProviderProfile / useProviderPhotos)'
         ELSE 'NOT referenced in src/' END AS app_usage,
    concat_ws(' · ',
      CASE WHEN b.public THEN 'public bucket: every object is downloadable by URL without any policy' END,
      CASE WHEN b.file_size_limit IS NULL THEN 'no size limit' END,
      CASE WHEN b.allowed_mime_types IS NULL THEN 'any file type accepted' END
    ) AS note
  FROM storage.buckets b
),

storage_pols AS (
  SELECT pol.tablename, pol.policyname, pol.cmd, pol.roles::text[] AS roles,
         pol.qual, pol.with_check,
         CASE pol.cmd
           WHEN 'INSERT' THEN pol.with_check
           WHEN 'DELETE' THEN pol.qual
           ELSE COALESCE(pol.with_check, pol.qual)
         END AS write_expr
  FROM pg_policies pol
  WHERE pol.schemaname = 'storage'
),

sec_d2 AS (
  SELECT
    CASE
      WHEN cmd <> 'SELECT' AND (write_expr = 'true' OR write_expr !~* '(auth\.|has_role|select )') THEN 'HIGH'
      WHEN cmd <> 'SELECT' THEN 'INFO'
      ELSE 'INFO'
    END AS severity,
    'D2 storage policy' AS section,
    'storage.' || tablename || ' — "' || policyname || '"' AS object,
    format('%s TO {%s} | USING (%s) | WITH CHECK (%s)',
           cmd, array_to_string(roles, ','), COALESCE(qual, '-'), COALESCE(with_check, '-')) AS facts,
    'uploads/deletes come from useProviderProfile (provider-images) and useProviderPhotos (provider-photos)' AS app_usage,
    CASE
      WHEN cmd <> 'SELECT' AND (write_expr = 'true' OR write_expr !~* '(auth\.|has_role|select )')
        THEN 'write policy does not tie the object to the caller: any role it applies to can upload / overwrite / delete in that bucket'
      WHEN cmd = 'SELECT'
        THEN 'a SELECT policy on storage.objects also allows LISTING the bucket''s files'
      ELSE 'write policy references the caller — read the expression to confirm it scopes to the caller''s own folder'
    END AS note
  FROM storage_pols
),

-- ── E. anon table grants beyond what the app needs ──────────────────────────
sec_e AS (
  SELECT
    'LOW' AS severity,
    'E anon table grant' AS section,
    relname::text AS object,
    format('anon holds: %s | RLS %s | policies=%s',
           anon_write_privs,
           CASE WHEN relrowsecurity THEN 'ON' ELSE 'OFF' END, policy_count) AS facts,
    'the app never writes while logged out (every client write follows a session check)' AS app_usage,
    'not needed: REVOKE INSERT, UPDATE, DELETE, TRUNCATE FROM anon. RLS still applies today, so this is defence in depth — unless a row in B2 is CRITICAL for the same table' AS note
  FROM rel_privs
  WHERE relkind IN ('r', 'p') AND anon_write_privs <> ''
),

-- ── F. Default privileges (root cause) ──────────────────────────────────────
sec_f AS (
  SELECT
    CASE WHEN d.defaclobjtype = 'f' AND d.defaclacl::text ~ '(^|[{,])anon=' THEN 'HIGH'
         WHEN d.defaclobjtype = 'f' AND d.defaclacl::text ~ '(^|[{,])authenticated=' THEN 'MEDIUM'
         ELSE 'INFO' END AS severity,
    'F default privileges' AS section,
    format('objects created by %s in schema %s: %s',
           pg_get_userbyid(d.defaclrole),
           COALESCE(n.nspname, '(all schemas)'),
           CASE d.defaclobjtype WHEN 'f' THEN 'FUNCTIONS' WHEN 'r' THEN 'TABLES'
                                WHEN 'S' THEN 'SEQUENCES' WHEN 'T' THEN 'TYPES'
                                ELSE d.defaclobjtype::text END) AS object,
    d.defaclacl::text AS facts,
    'applies to every future migration run as that role' AS app_usage,
    CASE WHEN d.defaclobjtype = 'f'
         THEN 'every new function gets these grants BY NAME; REVOKE ... FROM PUBLIC does not remove them. Changing it needs its own ruling (ALTER DEFAULT PRIVILEGES)'
         ELSE '' END AS note
  FROM pg_default_acl d
  LEFT JOIN pg_namespace n ON n.oid = d.defaclnamespace
  WHERE n.nspname = 'public' OR d.defaclnamespace = 0
),

report AS (
  SELECT * FROM sec_a
  UNION ALL SELECT * FROM sec_b1
  UNION ALL SELECT * FROM sec_b2
  UNION ALL SELECT * FROM sec_c
  UNION ALL SELECT * FROM sec_d1
  UNION ALL SELECT * FROM sec_d2
  UNION ALL SELECT * FROM sec_e
  UNION ALL SELECT * FROM sec_f
)

SELECT severity, section, object, facts, app_usage, note
FROM report
ORDER BY
  CASE severity WHEN 'CRITICAL' THEN 1 WHEN 'HIGH' THEN 2 WHEN 'MEDIUM' THEN 3
                WHEN 'LOW' THEN 4 WHEN 'INFO' THEN 5 ELSE 6 END,
  section,
  object;
