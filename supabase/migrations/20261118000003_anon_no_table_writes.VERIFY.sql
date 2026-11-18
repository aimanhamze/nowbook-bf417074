-- VERIFY for 20261118000003_anon_no_table_writes.sql (e).
-- DEV first, then PROD.
--
-- HOW TO RUN. The SQL editor shows only the LAST statement's result, so run
-- ONE block at a time. Every block is a single statement; none ends on
-- ROLLBACK.
--   §0, §A  catalog SELECTs — read-only, DEV and PROD.
--   §B      ONE DO block, DEV ONLY by the usual rule. It writes nothing:
--           every statement either is refused or matches no row (WHERE
--           false), and the final exception rolls back regardless.
--           "PASS: …" or "FAIL Tn: …".
--   §E      rollback.
--
-- ORDER: §0 → curl (before) → apply 20261118000003 → §A → §B (DEV)
--        → curl (after) → smoke list (PROD).
--
-- THE REAL API ANSWER (before and after; <ANON_KEY> = VITE_SUPABASE_ANON_KEY,
-- <REF> = the project ref; curl.exe in PowerShell). It asks to DELETE a
-- favorite whose id is all zeros — it can match nothing on either side.
--
--   curl.exe -s -i -X DELETE "https://<REF>.supabase.co/rest/v1/favorites?id=eq.00000000-0000-0000-0000-000000000000" -H "apikey: <ANON_KEY>" -H "Authorization: Bearer <ANON_KEY>"
--
--   BEFORE: HTTP 204 (accepted; RLS matched no row — "success", nothing done)
--   AFTER:  HTTP 401 and {"code":"42501", … "message":"permission denied for table favorites"}


-- ── §0 BEFORE applying ────────────────────────────────────────────────────

-- 0a. Every ordinary table in public: what anon and authenticated hold.
--     KEEP THIS OUTPUT — §A1 compares against it.
--     Expect BEFORE on PROD: 21 rows with listed = true, each with
--       anon_write = INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER
--     (notifications: the same without INSERT). DEV: 19 listed rows.
--     public_privs must be EMPTY on every row: a grant to PUBLIC would
--     survive a revoke from anon — if any row shows one, stop and tell me.
--     A row with listed = false and a non-empty anon_write is a table the
--     list does not cover: tell me its name.
SELECT c.relname                                                    AS table_name,
       c.relname = ANY (ARRAY[
         'bookings', 'customer_packages', 'favorites', 'notifications',
         'package_templates', 'package_usage_log',
         'provider_availability', 'provider_blocked_dates', 'provider_class_schedule',
         'provider_date_overrides', 'provider_photos', 'provider_profiles',
         'provider_services', 'provider_sessions', 'provider_staff',
         'provider_staff_availability', 'provider_staff_blocked_dates',
         'provider_staff_services', 'push_subscriptions', 'reviews', 'user_roles'])  AS listed,
       has_table_privilege('anon', c.oid, 'SELECT')                  AS anon_select,
       array_to_string(ARRAY(
         SELECT p FROM unnest(ARRAY['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p
         WHERE has_table_privilege('anon', c.oid, p)), ',')          AS anon_write,
       array_to_string(ARRAY(
         SELECT p FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p
         WHERE has_table_privilege('authenticated', c.oid, p)), ',') AS authenticated_privs,
       COALESCE((SELECT string_agg(a.privilege_type, ',')
                 FROM aclexplode(c.relacl) a WHERE a.grantee = 0), '') AS public_privs,
       c.relrowsecurity                                              AS rls
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
  AND NOT EXISTS (SELECT 1 FROM pg_depend d
                  WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e')
ORDER BY listed DESC, c.relname;

-- 0b. Does anything that RUNS AS anon write to a table? Lists SECURITY
--     INVOKER functions anon may execute whose body contains an INSERT INTO /
--     UPDATE / DELETE FROM on a public table (trigger functions excluded).
--     Expect ZERO rows. Any row: send it to me before applying — that
--     function would start failing for logged-out callers.
SELECT p.oid::regprocedure AS invoker_function_open_to_anon_that_writes
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.prokind IN ('f', 'p')
  AND NOT p.prosecdef
  AND p.prorettype <> 'pg_catalog.trigger'::regtype
  AND has_function_privilege('anon', p.oid, 'EXECUTE')
  AND NOT EXISTS (SELECT 1 FROM pg_depend d
                  WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
  AND p.prosrc ~* '(insert\s+into|update\s+(only\s+)?(public\.)?[a-z_]+\s+set|delete\s+from)';


-- ── §A AFTER applying ─────────────────────────────────────────────────────

-- A1. Same query as 0a. Expect:
--       every listed row ....... anon_write EMPTY
--       anon_select ............ IDENTICAL to 0a on every row
--       authenticated_privs .... IDENTICAL to 0a on every row
--       public_privs ........... empty
SELECT c.relname                                                    AS table_name,
       c.relname = ANY (ARRAY[
         'bookings', 'customer_packages', 'favorites', 'notifications',
         'package_templates', 'package_usage_log',
         'provider_availability', 'provider_blocked_dates', 'provider_class_schedule',
         'provider_date_overrides', 'provider_photos', 'provider_profiles',
         'provider_services', 'provider_sessions', 'provider_staff',
         'provider_staff_availability', 'provider_staff_blocked_dates',
         'provider_staff_services', 'push_subscriptions', 'reviews', 'user_roles'])  AS listed,
       has_table_privilege('anon', c.oid, 'SELECT')                  AS anon_select,
       array_to_string(ARRAY(
         SELECT p FROM unnest(ARRAY['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p
         WHERE has_table_privilege('anon', c.oid, p)), ',')          AS anon_write,
       array_to_string(ARRAY(
         SELECT p FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p
         WHERE has_table_privilege('authenticated', c.oid, p)), ',') AS authenticated_privs,
       COALESCE((SELECT string_agg(a.privilege_type, ',')
                 FROM aclexplode(c.relacl) a WHERE a.grantee = 0), '') AS public_privs,
       c.relrowsecurity                                              AS rls
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
  AND NOT EXISTS (SELECT 1 FROM pg_depend d
                  WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e')
ORDER BY listed DESC, c.relname;

-- A2. The WHOLE schema in one line. Expect:
--       tables_where_anon_can_write = 0     (any table, listed or not)
--       tables_where_anon_can_select        = the same number as before
--                                             (count the true values in 0a)
--       tables_where_authenticated_can_write = the same number as before
SELECT count(*) FILTER (WHERE has_table_privilege('anon', c.oid, 'INSERT')
                           OR has_table_privilege('anon', c.oid, 'UPDATE')
                           OR has_table_privilege('anon', c.oid, 'DELETE')
                           OR has_table_privilege('anon', c.oid, 'TRUNCATE')
                           OR has_table_privilege('anon', c.oid, 'REFERENCES')
                           OR has_table_privilege('anon', c.oid, 'TRIGGER'))  AS tables_where_anon_can_write,
       count(*) FILTER (WHERE has_table_privilege('anon', c.oid, 'SELECT'))   AS tables_where_anon_can_select,
       count(*) FILTER (WHERE has_table_privilege('authenticated', c.oid, 'INSERT')
                           OR has_table_privilege('authenticated', c.oid, 'UPDATE')
                           OR has_table_privilege('authenticated', c.oid, 'DELETE')) AS tables_where_authenticated_can_write,
       count(*)                                                               AS tables
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
  AND NOT EXISTS (SELECT 1 FROM pg_depend d
                  WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e');


-- ── §B BEHAVIOUR — DEV ONLY ───────────────────────────────────────────────
--     ONE DO block over every listed table that exists here. Nothing is
--     written: a refused statement does nothing, and the accepted ones carry
--     WHERE false. It ends in an exception on purpose:
--       ERROR: PASS: …      -> all tests passed on every table (count given)
--       ERROR: FAIL Tn: …   -> that test failed, with the table's name
--     Per table:
--       T1  anon  INSERT … DEFAULT VALUES     is REFUSED (permission denied)
--       T2  anon  DELETE … WHERE false        is REFUSED (permission denied)
--       T3  anon  SELECT                      still works where it worked
--                                             before (anon keeps SELECT)
--       T4  a signed-in user's DELETE … WHERE false is NOT refused
--           (authenticated keeps its grants; the row policies are untouched)
--     T5  the logged-out home page's read still works:
--           provider_profiles, provider_services and reviews return without
--           error for anon.
--     (UPDATE is covered by §A1/§A2 — it is the same grant mechanism as
--     DELETE, and a generic UPDATE needs a column name per table.)
DO $b$
DECLARE
  v_tables text[] := ARRAY[
    'bookings', 'customer_packages', 'favorites', 'notifications',
    'package_templates', 'package_usage_log',
    'provider_availability', 'provider_blocked_dates', 'provider_class_schedule',
    'provider_date_overrides', 'provider_photos', 'provider_profiles',
    'provider_services', 'provider_sessions', 'provider_staff',
    'provider_staff_availability', 'provider_staff_blocked_dates',
    'provider_staff_services', 'push_subscriptions', 'reviews', 'user_roles'
  ];
  v_table  text;
  v_denied boolean;
  v_err    text;
  v_done   integer := 0;
  v_skip   text := '';
BEGIN
  FOREACH v_table IN ARRAY v_tables LOOP
    IF to_regclass(format('public.%I', v_table)) IS NULL THEN
      v_skip := v_skip || ' ' || v_table;
      CONTINUE;
    END IF;

    -- T1: anon INSERT
    v_denied := false; v_err := NULL;
    BEGIN
      SET LOCAL ROLE anon;
      EXECUTE format('INSERT INTO public.%I DEFAULT VALUES', v_table);
    EXCEPTION
      WHEN insufficient_privilege THEN
        -- "permission denied for table" is the grant; a row-level-security
        -- refusal has the same SQLSTATE but a different message and would
        -- mean the grant is still there.
        v_denied := SQLERRM LIKE 'permission denied for table%';
        v_err := SQLERRM;
      WHEN OTHERS THEN
        v_err := SQLERRM;
    END;
    RESET ROLE;
    IF NOT v_denied THEN
      RAISE EXCEPTION 'FAIL T1 (%): anon INSERT was not refused by the grant — got: %', v_table, COALESCE(v_err, 'no error at all');
    END IF;

    -- T2: anon DELETE
    v_denied := false; v_err := NULL;
    BEGIN
      SET LOCAL ROLE anon;
      EXECUTE format('DELETE FROM public.%I WHERE false', v_table);
    EXCEPTION
      WHEN insufficient_privilege THEN
        v_denied := SQLERRM LIKE 'permission denied for table%';
        v_err := SQLERRM;
      WHEN OTHERS THEN
        v_err := SQLERRM;
    END;
    RESET ROLE;
    IF NOT v_denied THEN
      RAISE EXCEPTION 'FAIL T2 (%): anon DELETE was not refused by the grant — got: %', v_table, COALESCE(v_err, 'no error at all');
    END IF;

    -- T3: anon SELECT still works wherever anon holds SELECT
    IF has_table_privilege('anon', format('public.%I', v_table)::regclass, 'SELECT') THEN
      v_err := NULL;
      BEGIN
        SET LOCAL ROLE anon;
        EXECUTE format('SELECT 1 FROM public.%I LIMIT 1', v_table);
      EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
      END;
      RESET ROLE;
      IF v_err IS NOT NULL THEN
        RAISE EXCEPTION 'FAIL T3 (%): anon can no longer SELECT: %', v_table, v_err;
      END IF;
    END IF;

    -- T4: authenticated DELETE … WHERE false is not refused
    v_err := NULL;
    PERFORM set_config('request.jwt.claims',
                       '{"sub":"00000000-0000-4000-8000-0000000000cc","role":"authenticated"}', true);
    PERFORM set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000cc', true);
    BEGIN
      SET LOCAL ROLE authenticated;
      EXECUTE format('DELETE FROM public.%I WHERE false', v_table);
    EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
    END;
    RESET ROLE;
    IF v_err IS NOT NULL THEN
      RAISE EXCEPTION 'FAIL T4 (%): a signed-in user''s DELETE was refused — authenticated lost a grant: %', v_table, v_err;
    END IF;

    v_done := v_done + 1;
  END LOOP;

  -- T5: what the logged-out home page reads
  v_err := NULL;
  BEGIN
    SET LOCAL ROLE anon;
    PERFORM 1 FROM public.provider_profiles LIMIT 1;
    PERFORM 1 FROM public.provider_services LIMIT 1;
    PERFORM 1 FROM public.reviews LIMIT 1;
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  RESET ROLE;
  IF v_err IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL T5: a logged-out read of providers / services / reviews failed: %', v_err;
  END IF;

  RAISE EXCEPTION 'PASS: on % table(s) anon INSERT and DELETE are refused by the grant, anon SELECT is unchanged, authenticated is unaffected; logged-out reads work%',
    v_done, CASE WHEN v_skip = '' THEN '' ELSE ' [not on this database:' || v_skip || ']' END;
END;
$b$;


-- ── SMOKE LIST after PROD (in the app) ────────────────────────────────────
--   Logged OUT:
--     1. Home, explore, nearby, a provider page, an academy course page load
--        with providers, services, photos, staff, reviews and opening hours.
--     2. Tapping the heart on a provider while logged out behaves as before
--        (it never wrote anything logged out).
--   Logged in — one write per kind:
--     3. Customer: book, cancel, favourite a provider, mark a notification
--        read, leave a review.
--     4. Provider: edit a service, change opening hours, add a walk-in,
--        upload a photo.
--     5. Admin: edit a provider.
--   6. curl (top of this file) now answers 401 / 42501.
--   An error where a save used to "work" with nothing saved = a write that
--   was going out with a dead session. Tell me which screen.


-- ── §E ROLLBACK (only if needed; do NOT run as part of verification) ──────
--     Gives anon the write privileges back on ONE table, if something
--     logged-out turns out to write there — tell me what it is first; the
--     right fix is almost certainly not this. Example:
--
--   GRANT INSERT, UPDATE, DELETE ON TABLE public.favorites TO anon;
--
--     Everything, as it was (missing tables skipped; notifications without
--     INSERT, which was revoked separately on 2026-11-17):
--
--   DO $undo$
--   DECLARE t text;
--   BEGIN
--     FOREACH t IN ARRAY ARRAY[
--       'bookings', 'customer_packages', 'favorites', 'notifications',
--       'package_templates', 'package_usage_log',
--       'provider_availability', 'provider_blocked_dates', 'provider_class_schedule',
--       'provider_date_overrides', 'provider_photos', 'provider_profiles',
--       'provider_services', 'provider_sessions', 'provider_staff',
--       'provider_staff_availability', 'provider_staff_blocked_dates',
--       'provider_staff_services', 'push_subscriptions', 'reviews', 'user_roles']
--     LOOP
--       CONTINUE WHEN to_regclass(format('public.%I', t)) IS NULL;
--       EXECUTE format('GRANT UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.%I TO anon', t);
--       IF t <> 'notifications' THEN
--         EXECUTE format('GRANT INSERT ON TABLE public.%I TO anon', t);
--       END IF;
--     END LOOP;
--   END;
--   $undo$;
