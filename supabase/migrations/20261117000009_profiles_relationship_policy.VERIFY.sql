-- VERIFY for 20261117000009_profiles_relationship_policy.sql (P2).
-- DEV first, then PROD.
--
-- HOW TO RUN. The SQL editor shows only the LAST statement's result, so run
-- ONE block at a time. Every block is a single statement; none ends on
-- ROLLBACK.
--   §0, §A  catalog SELECTs — read-only, DEV and PROD.
--   §B1     ONE DO block, read-only, DEV and PROD, with REAL users.
--           Ends in an ERROR on purpose: "PASS: …" or "FAIL Tn: …".
--   §B2     ONE DO block, DEV ONLY. Builds its own fixtures; the final
--           exception rolls everything back. "PASS: …" or "FAIL Tn: …".
--   §B3     ONE DO block, read-only, DEV and PROD, with a REAL multi-branch
--           owner. "PASS: …", "FAIL: …" or "SKIP: …".
--   §C      ONE DO block, read-only, DEV and PROD. Ends in an ERROR whose
--           text IS the query plan.
--   §E      rollback.
--
-- ORDER: 20261117000008 applied and its §A checked
--        → §0 → apply 20261117000009 → §A → §B1 → §B2 (DEV) → §B3 → §C
--        → smoke list (PROD).


-- ── §0 BEFORE applying — the LIVE database, not the repo ──────────────────

-- 0a. The seven columns the helper uses exist, with these names, as uuid.
--     Expect SEVEN rows, every one found = true and data_type = uuid.
--     Any found = false: do NOT apply — the helper would not compile.
SELECT w.tbl, w.col, (c.column_name IS NOT NULL) AS found, c.data_type
FROM (VALUES
        ('bookings', 'user_id'),              ('bookings', 'provider_id'),
        ('customer_packages', 'customer_id'), ('customer_packages', 'provider_id'),
        ('course_registrations', 'user_id'),  ('course_registrations', 'provider_id'),
        ('provider_profiles', 'user_id')
     ) AS w(tbl, col)
LEFT JOIN information_schema.columns c
       ON c.table_schema = 'public' AND c.table_name = w.tbl AND c.column_name = w.col
ORDER BY w.tbl, w.col;

-- 0b. The five indexes. For each lookup the policy makes, lists every VALID
--     index whose FIRST column is that column.
--     Expect FIVE rows, every one ok = true:
--       profiles.user_id              (the unique constraint)
--       provider_profiles.user_id     (idx_provider_profiles_user_id)
--       bookings.user_id              (idx_bookings_user_id — 20261117000008)
--       customer_packages.customer_id
--       course_registrations.user_id  (idx_course_registrations_user_status
--                                      or the one-active-per-user index)
--     Any ok = false: tell me before applying — the policy would still be
--     correct but would scan that table once per profile row.
SELECT w.tbl, w.col,
       count(i.indexrelid) > 0                                   AS ok,
       COALESCE(string_agg(ic.relname, ', ' ORDER BY ic.relname), '(none)') AS indexes
FROM (VALUES
        ('profiles', 'user_id'), ('provider_profiles', 'user_id'), ('bookings', 'user_id'),
        ('customer_packages', 'customer_id'), ('course_registrations', 'user_id')
     ) AS w(tbl, col)
JOIN pg_class t      ON t.relname = w.tbl AND t.relnamespace = 'public'::regnamespace
JOIN pg_attribute a  ON a.attrelid = t.oid AND a.attname = w.col
LEFT JOIN pg_index i ON i.indrelid = t.oid AND i.indkey[0] = a.attnum
                    AND i.indisvalid AND i.indpred IS NULL
LEFT JOIN pg_class ic ON ic.oid = i.indexrelid
GROUP BY w.tbl, w.col
ORDER BY w.tbl;

-- 0c. Everything that reads profiles AS THE CALLER, i.e. under this policy:
--     SECURITY INVOKER functions that authenticated may execute (trigger
--     functions excluded), views, and policies of other tables.
--     Expect EXACTLY ONE row:  function  provider_customers(uuid)
--     It asks only for the user_ids of the provider's own bookings — the
--     booking relationship — and §B1 T3 proves its output does not change.
--     ANY other row: do not apply; send it to me so it gets a relationship
--     or moves behind a definer function first.
SELECT 'function' AS kind, p.oid::regprocedure::text AS object
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.prokind IN ('f', 'p')
  AND NOT p.prosecdef
  AND p.prorettype <> 'pg_catalog.trigger'::regtype
  AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
  AND p.prosrc ~* '(^|[^_a-z])profiles([^_a-z]|$)'
UNION ALL
SELECT 'view', n.nspname || '.' || c.relname
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind IN ('v', 'm')
  AND n.nspname = 'public'
  AND pg_get_viewdef(c.oid) ~* '(^|[^_a-z])profiles([^_a-z]|$)'
UNION ALL
SELECT 'policy', pol.schemaname || '.' || pol.tablename || ' — ' || pol.policyname
FROM pg_policies pol
WHERE NOT (pol.schemaname = 'public' AND pol.tablename = 'profiles')
  AND (COALESCE(pol.qual, '') || ' ' || COALESCE(pol.with_check, ''))
      ~* '(^|[^_a-z])profiles([^_a-z]|$)';

-- 0d. The policies on profiles now (the state P1 left). Expect three rows:
--       "Users can view any profile"  SELECT  {authenticated}  USING true
--       one UPDATE and one INSERT policy scoped to auth.uid() = user_id
--     Keep this output: §A2 must differ ONLY in the first row.
SELECT policyname, cmd, roles, qual AS using_expr, with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'profiles'
ORDER BY cmd, policyname;

-- 0e. The helper does not exist yet. Expect ZERO rows.
SELECT p.oid::regprocedure AS function
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'is_my_customer';

-- 0f. has_role is callable by authenticated (the policy calls it as the
--     querying role). Expect: auth_exec = true.
SELECT has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_exec,
       p.oid::regprocedure AS function
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'has_role';


-- ── §A AFTER applying ─────────────────────────────────────────────────────

-- A1. The helper. Expect ONE row:
--       args p_user_id uuid   result boolean   secdef true
--       volatility s (STABLE)   config {search_path=""}
--       anon_exec false   auth_exec true   public_exec false
SELECT p.proname,
       pg_get_function_identity_arguments(p.oid) AS args,
       pg_get_function_result(p.oid)             AS result,
       p.prosecdef                               AS secdef,
       p.provolatile                             AS volatility,
       p.proconfig                               AS config,
       has_function_privilege('anon', p.oid, 'EXECUTE')          AS anon_exec,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_exec,
       EXISTS (SELECT 1
               FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
               WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE') AS public_exec,
       p.proacl::text                            AS acl
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'is_my_customer';

-- A2. Policies. Expect the same three rows as 0d, with ONE changed:
--       name   "Profiles: own row, admin, or my customers"
--       cmd SELECT   roles {authenticated}
--       using_expr mentions auth.uid(), has_role(…, 'admin') and
--                  is_my_customer(user_id) — and is NOT "true"
--     No row named "Users can view any profile" may remain.
--     The UPDATE and INSERT policies are byte-for-byte as in 0d.
SELECT policyname, cmd, roles, qual AS using_expr, with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'profiles'
ORDER BY cmd, policyname;

-- A3. One line. Expect: select_policies = 1, still_open = false,
--     uses_helper = true, anon_can_select = false (P1 intact).
SELECT count(*)                                           AS select_policies,
       bool_or(qual = 'true')                             AS still_open,
       bool_and(qual LIKE '%is_my_customer%')             AS uses_helper,
       has_table_privilege('anon', 'public.profiles', 'SELECT') AS anon_can_select
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'profiles' AND cmd = 'SELECT';


-- ── §B1 BEHAVIOUR WITH REAL USERS, read-only — DEV and PROD ───────────────
--     ONE DO block. It only reads, and ends in an exception on purpose:
--       ERROR: PASS: …      -> every test passed (the text carries the numbers)
--       ERROR: FAIL Tn: …   -> that test failed
--     It picks, on its own: an admin, the provider branch with the most
--     registered customers, and one ordinary customer.
--     T1 admin sees ALL profiles.
--     T2 the provider's owner sees the profile of EVERY registered customer
--        who booked at that branch.
--     T3 provider_customers() returns for that owner exactly what it returns
--        with row-level security out of the way — i.e. unchanged by P2.
--     T4 an ordinary customer sees exactly ONE row: their own.
--     T5 anon is still refused (P1).
--     (If a database has no admin / no bookings, that test is reported as
--     "skipped" inside the PASS text rather than failed.)
DO $b1$
DECLARE
  v_total    bigint;
  v_admin    uuid;
  v_pid      uuid;
  v_owner    uuid;
  v_ids      uuid[];
  v_cust     uuid;
  v_n        bigint;
  v_truth    text;
  v_seen     text;
  v_denied   boolean := false;
  v_note     text := '';
BEGIN
  SELECT count(*) INTO v_total FROM public.profiles;

  -- T1: admin
  SELECT r.user_id INTO v_admin FROM public.user_roles r WHERE r.role::text = 'admin' LIMIT 1;
  IF v_admin IS NULL THEN
    v_note := v_note || ' [T1 skipped: no admin here]';
  ELSE
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_n FROM public.profiles;
    RESET ROLE;
    IF v_n <> v_total THEN
      RAISE EXCEPTION 'FAIL T1: admin sees % of % profiles', v_n, v_total;
    END IF;
    v_note := v_note || format(' admin sees all %s;', v_total);
  END IF;

  -- The branch with the most registered customers, and its owner.
  SELECT pp.id, pp.user_id INTO v_pid, v_owner
  FROM public.provider_profiles pp
  JOIN public.bookings b ON b.provider_id = pp.id
  WHERE b.user_id IS NOT NULL
  GROUP BY pp.id, pp.user_id
  ORDER BY count(DISTINCT b.user_id) DESC
  LIMIT 1;

  IF v_pid IS NULL THEN
    v_note := v_note || ' [T2/T3 skipped: no customer bookings here]';
  ELSE
    SELECT array_agg(DISTINCT b.user_id) INTO v_ids
    FROM public.bookings b
    JOIN public.profiles pr ON pr.user_id = b.user_id
    WHERE b.provider_id = v_pid;

    -- The OWNER's claims are set BEFORE the truth is computed, so both calls
    -- below run with the same auth.uid() and differ only in the role.
    -- provider_customers() has no auth.uid() / ownership check in its body
    -- (it is SECURITY INVOKER and leaves that to RLS — checked in the repo
    -- definition, 20261117000001), so the claims do not change its answer
    -- today; setting them first keeps T3 honest if a check is ever added,
    -- instead of comparing against a truth computed as T1's admin.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);

    -- What provider_customers returns with RLS out of the way: same claims,
    -- but as the editor's role, which owns the tables and bypasses RLS.
    SELECT count(*)::text || ':' || md5(COALESCE(string_agg(e::text, ',' ORDER BY e::text), ''))
      INTO v_truth
    FROM jsonb_array_elements(public.provider_customers(v_pid)) e;

    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_n FROM public.profiles WHERE user_id = ANY (v_ids);
    SELECT count(*)::text || ':' || md5(COALESCE(string_agg(e::text, ',' ORDER BY e::text), ''))
      INTO v_seen
    FROM jsonb_array_elements(public.provider_customers(v_pid)) e;
    RESET ROLE;

    -- T2
    IF v_n <> COALESCE(cardinality(v_ids), 0) THEN
      RAISE EXCEPTION 'FAIL T2: the owner sees % of the % registered customers who booked at branch %',
        v_n, COALESCE(cardinality(v_ids), 0), v_pid;
    END IF;
    -- T3
    IF v_seen IS DISTINCT FROM v_truth THEN
      RAISE EXCEPTION 'FAIL T3: provider_customers(%) differs for its owner — got % (rows:md5), want %',
        v_pid, v_seen, v_truth;
    END IF;
    v_note := v_note || format(' owner sees all %s booking customers; provider_customers unchanged (%s rows);',
                               COALESCE(cardinality(v_ids), 0), split_part(v_truth, ':', 1));
  END IF;

  -- T4: an ordinary customer (books, owns no branch, has no staff role)
  SELECT b.user_id INTO v_cust
  FROM public.bookings b
  JOIN public.profiles pr ON pr.user_id = b.user_id
  WHERE NOT EXISTS (SELECT 1 FROM public.provider_profiles pp WHERE pp.user_id = b.user_id)
    AND NOT EXISTS (SELECT 1 FROM public.user_roles r
                    WHERE r.user_id = b.user_id AND r.role::text IN ('admin', 'provider'))
  LIMIT 1;
  IF v_cust IS NULL THEN
    v_note := v_note || ' [T4 skipped: no ordinary customer here]';
  ELSE
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_cust, 'role', 'authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub', v_cust::text, true);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_n FROM public.profiles;
    RESET ROLE;
    IF v_n <> 1 THEN
      RAISE EXCEPTION 'FAIL T4: an ordinary customer sees % profiles, want exactly 1 (their own)', v_n;
    END IF;
    v_note := v_note || ' a customer sees 1 row;';
  END IF;

  -- T5: anon
  BEGIN
    SET LOCAL ROLE anon;
    PERFORM 1 FROM public.profiles LIMIT 1;
  EXCEPTION WHEN insufficient_privilege THEN
    v_denied := true;
  END;
  RESET ROLE;
  IF NOT v_denied THEN
    RAISE EXCEPTION 'FAIL T5: anon can SELECT from profiles again — P1 was undone';
  END IF;

  RAISE EXCEPTION 'PASS:% anon refused', v_note;
END;
$b1$;


-- ── §B2 BEHAVIOUR WITH FIXTURES — DEV ONLY ────────────────────────────────
--     ONE DO block. It builds its own world and the final exception rolls
--     ALL of it back:
--       11 profiles: customers A and B, a package customer, a course
--       customer, a cancelled-only customer, a customer of the second branch,
--       provider 2's customer, a stranger, owner 1, owner 2, an admin;
--       3 branches: owner 1 has two, owner 2 has one.
--     Triggers and foreign keys are switched off for the fixtures
--     (session_replication_role = replica, local to this block), so the test
--     depends only on the tables the policy reads — not on booking rules,
--     lead times, package or academy guards. Row-level security stays ON.
--       ERROR: PASS: …      -> all tests passed
--       ERROR: FAIL Tn: …   -> that test failed
--     T1  customer A, unfiltered, sees exactly one row: their own
--     T2  customer A cannot see customer B (both booked at the same branch),
--         and is_my_customer(B) is false for A
--     T3  owner 1 sees: the booking customers A and B, the package customer,
--         the course customer, the cancelled-only customer
--     T4  owner 1 does NOT see the stranger
--     T5  owner 2 sees NONE of owner 1's customers, and does see their own
--     T6  the admin sees every profile
--     T7  multi-branch: owner 1 sees the customer who booked at branch 2
--     T8  owner 1, unfiltered, sees exactly self + their customers
--     T9  owner 1 reads the customer's PHONE (the column the calendar needs)
--     T10 anon is refused
DO $b2$
DECLARE
  v_a uuid := gen_random_uuid();        v_b uuid := gen_random_uuid();
  v_pkg uuid := gen_random_uuid();      v_course uuid := gen_random_uuid();
  v_cancel uuid := gen_random_uuid();   v_stranger uuid := gen_random_uuid();
  v_b2cust uuid := gen_random_uuid();   v_p2cust uuid := gen_random_uuid();
  v_owner1 uuid := gen_random_uuid();   v_owner2 uuid := gen_random_uuid();
  v_admin uuid := gen_random_uuid();
  v_br1 uuid := gen_random_uuid();      v_br2 uuid := gen_random_uuid();
  v_br3 uuid := gen_random_uuid();
  v_day    date := CURRENT_DATE + 30;
  v_multi  boolean := true;
  v_total  bigint;
  v_n      bigint;
  v_bool   boolean;
  v_phone  text;
  v_denied boolean := false;
  v_want   bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'public' AND p.proname = 'is_my_customer') THEN
    RAISE EXCEPTION 'FAIL T0: is_my_customer does not exist — apply 20261117000009 first';
  END IF;

  -- Fixtures only: no triggers, no FK checks. RLS is unaffected.
  BEGIN
    SET LOCAL session_replication_role = replica;
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE EXCEPTION 'FAIL T0: this role may not set session_replication_role — tell me, the fixtures need another way in';
  END;

  INSERT INTO public.profiles (user_id, display_name, phone) VALUES
    (v_a, 'P2 cust A', '050-000-0001'),        (v_b, 'P2 cust B', '050-000-0002'),
    (v_pkg, 'P2 package', '050-000-0003'),     (v_course, 'P2 course', '050-000-0004'),
    (v_cancel, 'P2 cancelled', '050-000-0005'),(v_stranger, 'P2 stranger', '050-000-0006'),
    (v_b2cust, 'P2 branch2', '050-000-0007'),  (v_p2cust, 'P2 other provider', '050-000-0008'),
    (v_owner1, 'P2 owner 1', NULL),            (v_owner2, 'P2 owner 2', NULL),
    (v_admin, 'P2 admin', NULL);

  INSERT INTO public.user_roles (user_id, role) VALUES (v_admin, 'admin');

  INSERT INTO public.provider_profiles (id, user_id, business_name) VALUES
    (v_br1, v_owner1, 'P2 verify branch 1'),
    (v_br3, v_owner2, 'P2 verify other provider');
  BEGIN
    INSERT INTO public.provider_profiles (id, user_id, business_name)
    VALUES (v_br2, v_owner1, 'P2 verify branch 2');
  EXCEPTION WHEN unique_violation THEN
    v_multi := false;   -- provider_profiles.user_id is still UNIQUE on this database
  END;

  INSERT INTO public.bookings (provider_id, user_id, booking_date, booking_time, service_ids, total_price, status) VALUES
    (v_br1, v_a,      v_day, '09:00', '{}', 0, 'confirmed'),
    (v_br1, v_b,      v_day, '10:00', '{}', 0, 'confirmed'),
    (v_br1, v_cancel, v_day, '11:00', '{}', 0, 'cancelled'),
    (v_br3, v_p2cust, v_day, '09:00', '{}', 0, 'confirmed');
  IF v_multi THEN
    INSERT INTO public.bookings (provider_id, user_id, booking_date, booking_time, service_ids, total_price, status)
    VALUES (v_br2, v_b2cust, v_day, '09:00', '{}', 0, 'confirmed');
  END IF;

  INSERT INTO public.customer_packages (customer_id, provider_id, template_id, entries_remaining, total_entries)
  VALUES (v_pkg, v_br1, gen_random_uuid(), 5, 5);

  INSERT INTO public.course_registrations (course_id, provider_id, user_id)
  VALUES (gen_random_uuid(), v_br1, v_course);

  SELECT count(*) INTO v_total FROM public.profiles;

  -- ── as customer A ────────────────────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_a, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_a::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_n FROM public.profiles;
  IF v_n <> 1 THEN
    RESET ROLE; RAISE EXCEPTION 'FAIL T1: customer A sees % profiles unfiltered, want 1', v_n;
  END IF;
  SELECT count(*) INTO v_n FROM public.profiles WHERE user_id = v_a;
  IF v_n <> 1 THEN
    RESET ROLE; RAISE EXCEPTION 'FAIL T1: customer A does not see their own row';
  END IF;
  SELECT count(*) INTO v_n FROM public.profiles WHERE user_id = v_b;
  IF v_n <> 0 THEN
    RESET ROLE; RAISE EXCEPTION 'FAIL T2: customer A sees customer B (same branch) — got % row(s), want 0', v_n;
  END IF;
  SELECT public.is_my_customer(v_b) INTO v_bool;
  IF v_bool THEN
    RESET ROLE; RAISE EXCEPTION 'FAIL T2: is_my_customer(B) is true for customer A';
  END IF;
  RESET ROLE;

  -- ── as owner 1 ───────────────────────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner1, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_owner1::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_n FROM public.profiles WHERE user_id IN (v_a, v_b);
  IF v_n <> 2 THEN
    RESET ROLE; RAISE EXCEPTION 'FAIL T3 booking: owner 1 sees % of 2 booking customers', v_n;
  END IF;
  SELECT count(*) INTO v_n FROM public.profiles WHERE user_id = v_pkg;
  IF v_n <> 1 THEN
    RESET ROLE; RAISE EXCEPTION 'FAIL T3 package: owner 1 does not see the package customer';
  END IF;
  SELECT count(*) INTO v_n FROM public.profiles WHERE user_id = v_course;
  IF v_n <> 1 THEN
    RESET ROLE; RAISE EXCEPTION 'FAIL T3 course: owner 1 does not see the course customer';
  END IF;
  SELECT count(*) INTO v_n FROM public.profiles WHERE user_id = v_cancel;
  IF v_n <> 1 THEN
    RESET ROLE; RAISE EXCEPTION 'FAIL T3 cancelled: owner 1 does not see the cancelled-only customer';
  END IF;
  SELECT count(*) INTO v_n FROM public.profiles WHERE user_id = v_stranger;
  IF v_n <> 0 THEN
    RESET ROLE; RAISE EXCEPTION 'FAIL T4: owner 1 sees a user with no relationship';
  END IF;
  SELECT count(*) INTO v_n FROM public.profiles WHERE user_id = v_p2cust;
  IF v_n <> 0 THEN
    RESET ROLE; RAISE EXCEPTION 'FAIL T5: owner 1 sees provider 2''s customer';
  END IF;
  IF v_multi THEN
    SELECT count(*) INTO v_n FROM public.profiles WHERE user_id = v_b2cust;
    IF v_n <> 1 THEN
      RESET ROLE; RAISE EXCEPTION 'FAIL T7: owner 1 does not see the customer who booked at their second branch';
    END IF;
  END IF;
  -- self + A, B, package, course, cancelled (+ branch-2 customer)
  v_want := 6 + CASE WHEN v_multi THEN 1 ELSE 0 END;
  SELECT count(*) INTO v_n FROM public.profiles;
  IF v_n <> v_want THEN
    RESET ROLE; RAISE EXCEPTION 'FAIL T8: owner 1 sees % profiles unfiltered, want % (self + own customers)', v_n, v_want;
  END IF;
  SELECT phone INTO v_phone FROM public.profiles WHERE user_id = v_a;
  IF v_phone IS DISTINCT FROM '050-000-0001' THEN
    RESET ROLE; RAISE EXCEPTION 'FAIL T9: owner 1 reads phone % for customer A, want 050-000-0001', v_phone;
  END IF;
  RESET ROLE;

  -- ── as owner 2 ───────────────────────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner2, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_owner2::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_n FROM public.profiles
  WHERE user_id IN (v_a, v_b, v_pkg, v_course, v_cancel, v_b2cust);
  IF v_n <> 0 THEN
    RESET ROLE; RAISE EXCEPTION 'FAIL T5: owner 2 sees % of owner 1''s customers, want 0', v_n;
  END IF;
  SELECT count(*) INTO v_n FROM public.profiles WHERE user_id = v_p2cust;
  IF v_n <> 1 THEN
    RESET ROLE; RAISE EXCEPTION 'FAIL T5: owner 2 does not see their own customer';
  END IF;
  RESET ROLE;

  -- ── as the admin ─────────────────────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_n FROM public.profiles;
  RESET ROLE;
  IF v_n <> v_total THEN
    RAISE EXCEPTION 'FAIL T6: the admin sees % of % profiles', v_n, v_total;
  END IF;

  -- ── as anon ──────────────────────────────────────────────────────────────
  BEGIN
    SET LOCAL ROLE anon;
    PERFORM 1 FROM public.profiles LIMIT 1;
  EXCEPTION WHEN insufficient_privilege THEN
    v_denied := true;
  END;
  RESET ROLE;
  IF NOT v_denied THEN
    RAISE EXCEPTION 'FAIL T10: anon can SELECT from profiles';
  END IF;

  RAISE EXCEPTION 'PASS: T1–T10 passed%; all fixtures rolled back',
    CASE WHEN v_multi THEN '' ELSE ' EXCEPT T7 SKIPPED — provider_profiles.user_id is still UNIQUE here, so a second branch could not be created (T8 adjusted)' END;
END;
$b2$;


-- ── §B3 MULTI-BRANCH WITH A REAL OWNER, read-only — DEV and PROD ──────────
--     ONE DO block. It only reads, and ends in an exception on purpose:
--       ERROR: PASS: …      -> the owner sees every customer of every branch
--       ERROR: FAIL: …      -> some are missing (the text says how many and
--                              at which branch)
--       ERROR: SKIP: …      -> no owner has more than one branch here
--     It picks the REAL owner with the most branches (ties: the one with the
--     most bookings), collects every distinct bookings.user_id across ALL of
--     that owner's branches that has a profile row, then acts as that owner
--     and counts how many of those profiles they can read.
--     This is the proof that the policy follows the OWNER across branches;
--     §B2 T7 does the same with fixtures but is skipped where
--     provider_profiles.user_id is still UNIQUE. It replaces smoke item 8.
--     The text lists every branch: customers, how many the owner sees, and
--     only_here = customers who booked at NO other branch of this owner.
--     A branch with only_here > 0 and seen = customers is the strong case:
--     those customers are reachable through that branch alone. If every
--     only_here is 0 the PASS says so.
DO $b3$
DECLARE
  v_owner    uuid;
  v_branches integer;
  v_ids      uuid[];
  v_seen     bigint;
  v_branch   record;
  v_detail   text := '';
  v_only     bigint;
  v_only_sum bigint := 0;
  v_b_seen   bigint;
BEGIN
  SELECT pp.user_id, count(DISTINCT pp.id)::int INTO v_owner, v_branches
  FROM public.provider_profiles pp
  LEFT JOIN public.bookings b ON b.provider_id = pp.id
  GROUP BY pp.user_id
  HAVING count(DISTINCT pp.id) > 1
  ORDER BY count(DISTINCT pp.id) DESC, count(b.id) DESC
  LIMIT 1;

  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'SKIP: no owner has more than one branch on this database — nothing to test';
  END IF;

  SELECT array_agg(DISTINCT b.user_id) INTO v_ids
  FROM public.bookings b
  JOIN public.provider_profiles pp ON pp.id = b.provider_id
  JOIN public.profiles pr          ON pr.user_id = b.user_id
  WHERE pp.user_id = v_owner;

  IF v_ids IS NULL THEN
    RAISE EXCEPTION 'SKIP: the owner with the most branches (% branches) has no registered-customer bookings at any of them', v_branches;
  END IF;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);

  -- All branches together.
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_seen FROM public.profiles WHERE user_id = ANY (v_ids);
  RESET ROLE;

  -- Branch by branch: customers of that branch, how many the owner sees, and
  -- how many of them booked at NO other branch of this owner.
  FOR v_branch IN
    SELECT pp.id,
           ARRAY(SELECT DISTINCT b.user_id
                 FROM public.bookings b
                 JOIN public.profiles pr ON pr.user_id = b.user_id
                 WHERE b.provider_id = pp.id) AS ids
    FROM public.provider_profiles pp
    WHERE pp.user_id = v_owner
    ORDER BY pp.created_at, pp.id
  LOOP
    SELECT count(*) INTO v_only
    FROM unnest(v_branch.ids) u(user_id)
    WHERE NOT EXISTS (SELECT 1
                      FROM public.bookings b2
                      JOIN public.provider_profiles pp2 ON pp2.id = b2.provider_id
                      WHERE b2.user_id = u.user_id
                        AND pp2.user_id = v_owner
                        AND pp2.id <> v_branch.id);
    v_only_sum := v_only_sum + v_only;

    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_b_seen FROM public.profiles WHERE user_id = ANY (v_branch.ids);
    RESET ROLE;

    v_detail := v_detail || format(' [branch %s: customers=%s seen=%s only_here=%s]',
                                   left(v_branch.id::text, 8), cardinality(v_branch.ids), v_b_seen, v_only);

    IF v_b_seen <> cardinality(v_branch.ids) THEN
      RAISE EXCEPTION 'FAIL: the owner sees % of % customers of branch % —%',
        v_b_seen, cardinality(v_branch.ids), v_branch.id, v_detail;
    END IF;
  END LOOP;

  IF v_seen <> cardinality(v_ids) THEN
    RAISE EXCEPTION 'FAIL: the owner sees % of % customers across % branches —%',
      v_seen, cardinality(v_ids), v_branches, v_detail;
  END IF;

  RAISE EXCEPTION 'PASS: owner with % branches sees all % registered customers across them%;%',
    v_branches, cardinality(v_ids),
    CASE WHEN v_only_sum = 0
         THEN ' (NOTE: no customer booked at only one branch, so every customer is also reachable through another branch)'
         ELSE '' END,
    v_detail;
END;
$b3$;


-- ── §C THE PLAN of the provider calendar's profiles read — DEV and PROD ───
--     ONE DO block, read-only. It runs, AS THE OWNER of the branch with the
--     most registered customers, the exact statement useProviderBookings
--     sends (user_id, display_name, phone, avatar_url for a batch of up to
--     100 customer ids) under EXPLAIN (ANALYZE, BUFFERS), and ends in an
--     exception whose text IS the plan:
--       ERROR: PLAN (N ids): …
--     Expect:
--       * Index Scan (or Bitmap) on profiles using the user_id unique index —
--         NOT a Seq Scan of profiles driven by the policy;
--       * a Filter line containing is_my_customer(user_id);
--       * rows = N (every requested customer is returned);
--       * Execution Time in the low milliseconds for N = 100
--         (roughly 0.02–0.05 ms per customer).
--     Send me the text if the time is above ~20 ms or a Seq Scan appears.
DO $c$
DECLARE
  v_pid   uuid;
  v_owner uuid;
  v_ids   uuid[];
  v_plan  text := '';
  v_line  record;
BEGIN
  SELECT pp.id, pp.user_id INTO v_pid, v_owner
  FROM public.provider_profiles pp
  JOIN public.bookings b ON b.provider_id = pp.id
  WHERE b.user_id IS NOT NULL
  GROUP BY pp.id, pp.user_id
  ORDER BY count(DISTINCT b.user_id) DESC
  LIMIT 1;
  IF v_pid IS NULL THEN
    RAISE EXCEPTION 'PLAN: skipped — no customer bookings on this database';
  END IF;

  SELECT array_agg(u) INTO v_ids
  FROM (SELECT DISTINCT b.user_id AS u
        FROM public.bookings b
        JOIN public.profiles pr ON pr.user_id = b.user_id
        WHERE b.provider_id = v_pid
        LIMIT 100) s;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  SET LOCAL ROLE authenticated;
  FOR v_line IN EXECUTE format(
    'EXPLAIN (ANALYZE, BUFFERS) SELECT user_id, display_name, phone, avatar_url FROM public.profiles WHERE user_id = ANY (%L::uuid[])',
    v_ids)
  LOOP
    v_plan := v_plan || E'\n' || v_line."QUERY PLAN";
  END LOOP;
  RESET ROLE;

  RAISE EXCEPTION 'PLAN (% ids):%', cardinality(v_ids), v_plan;
END;
$c$;


-- ── SMOKE LIST after PROD (in the app) ────────────────────────────────────
--   Provider (use one with packages and, if possible, an academy):
--     1. Calendar, day and week: every customer booking shows NAME and PHONE;
--        walk-ins show theirs as before.
--     2. Pending tab: names on the requests.
--     3. Booking history / a past cancelled booking: the name is still there.
--     4. Customers page: same list, same counts as before.
--     5. Packages: every package row has its customer's name and phone.
--     6. Academy → registrations: names and phones of registrants.
--     7. Waiting list for a day: names (comes from a definer RPC — should be
--        untouched; listed to be sure).
--     8. MULTI-BRANCH — covered by §B3 on PROD (a real owner with several
--        branches sees every customer of every branch), which replaces the
--        in-app check: signing in as another provider is not possible.
--        §B3 must end in PASS on PROD, not SKIP.
--   Customer:
--     9. Sign in: no name screen; name on home and /profile.
--    10. Book, cancel, reschedule: the provider's bell text still carries the
--        customer's name ("… קבע תור …").
--   Admin:
--    11. Users page lists everyone; dashboard lists show customer names.
--   12. Tomorrow's real sign-ups: each has a profile row and passes the name
--       screen (also still owed from P1).
--   A blank name where there used to be one = a relationship this policy
--   does not cover. Tell me which screen; do not roll back first unless it
--   is widespread.


-- ── §E ROLLBACK (only if needed; do NOT run as part of verification) ──────
--     Returns to the state P1 left: any SIGNED-IN user can read every
--     profile again (logged-out stays closed). Policy first, then the helper
--     — the helper cannot be dropped while the policy uses it.
--
--   BEGIN;
--   ALTER POLICY "Profiles: own row, admin, or my customers" ON public.profiles
--     USING (true);
--   ALTER POLICY "Profiles: own row, admin, or my customers" ON public.profiles
--     RENAME TO "Users can view any profile";
--   DROP FUNCTION IF EXISTS public.is_my_customer(uuid);
--   COMMIT;
