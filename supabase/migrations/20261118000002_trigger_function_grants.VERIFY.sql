-- VERIFY for 20261118000002_trigger_function_grants.sql (a).
-- DEV first, then PROD.
--
-- HOW TO RUN. The SQL editor shows only the LAST statement's result, so run
-- ONE block at a time. Every block is a single statement; none ends on
-- ROLLBACK.
--   §0, §A  catalog SELECTs — read-only, DEV and PROD.
--   §B      ONE DO block, DEV ONLY. Builds its own fixtures; the final
--           exception rolls everything back. "PASS: …" or "FAIL Tn: …".
--   §E      rollback.
--
-- ORDER: §0 → apply 20261118000002 → §A → §B (DEV) → smoke list (PROD).


-- ── §0 BEFORE applying ────────────────────────────────────────────────────

-- 0a. EVERY trigger function in public, with its grants and its triggers.
--     KEEP THIS OUTPUT. Columns:
--       in_scope  'revoke' = this migration revokes it
--                 'SKIPPED ON PURPOSE' = handle_new_user, prevent_booking_conflicts
--                 'not listed' = already closed, or not in the audit
--     Expect BEFORE: every 'revoke' row has anon_exec = true and
--     auth_exec = true. A 'not listed' row with anon_exec = true is a trigger
--     function the audit did not cover: tell me its name.
--     no_trigger = true means the function is attached to nothing (dead).
SELECT p.proname                                                  AS function,
       CASE
         WHEN p.proname IN ('handle_new_user', 'prevent_booking_conflicts') THEN 'SKIPPED ON PURPOSE'
         WHEN p.proname IN (
           'enforce_class_requires_package', 'enforce_duration_override_permission',
           'enforce_package_detach_guard', 'enforce_staff_enable_no_future_bookings',
           'handle_package_booking', 'handle_package_cancellation', 'handle_package_reschedule',
           'link_walkin_to_account', 'update_provider_average_rating',
           'waitlist_capture_freed_slot', 'fill_customer_package_template_name',
           'academy_course_sessions_fill_from_course', 'academy_courses_require_active_instructor',
           'enforce_booking_approval_status', 'enforce_booking_lead_time',
           'enforce_customer_reschedule', 'set_updated_at', 'update_class_schedule_updated_at')
           THEN 'revoke'
         ELSE 'not listed'
       END                                                        AS in_scope,
       p.prosecdef                                                AS secdef,
       has_function_privilege('anon', p.oid, 'EXECUTE')           AS anon_exec,
       has_function_privilege('authenticated', p.oid, 'EXECUTE')  AS auth_exec,
       EXISTS (SELECT 1
               FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
               WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE') AS public_exec,
       NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgfoid = p.oid AND NOT t.tgisinternal) AS no_trigger,
       (SELECT string_agg(t.tgname || ' on ' || t.tgrelid::regclass::text, ', ' ORDER BY t.tgname)
        FROM pg_trigger t WHERE t.tgfoid = p.oid AND NOT t.tgisinternal) AS triggers
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.prorettype = 'pg_catalog.trigger'::regtype
  AND NOT EXISTS (SELECT 1 FROM pg_depend d
                  WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
ORDER BY in_scope, p.proname;

-- 0b. Every trigger in public and on auth.users, enabled or not. KEEP THIS
--     OUTPUT: §A2 must be IDENTICAL (this migration changes no trigger).
SELECT t.tgrelid::regclass::text AS on_table, t.tgname, p.proname AS function, t.tgenabled AS enabled
FROM pg_trigger t
JOIN pg_proc p ON p.oid = t.tgfoid
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE NOT t.tgisinternal
  AND (n.nspname = 'public' OR (n.nspname = 'auth' AND c.relname = 'users'))
ORDER BY 1, 2;


-- ── §A AFTER applying ─────────────────────────────────────────────────────

-- A1. Same list as 0a. Expect:
--       every 'revoke' row ............ anon_exec = false, auth_exec = false,
--                                       public_exec = false
--       the two 'SKIPPED ON PURPOSE' .. EXACTLY as in 0a (still open — that
--                                       is the ruling, not a miss)
--       'not listed' rows ............. exactly as in 0a
SELECT p.proname                                                  AS function,
       CASE
         WHEN p.proname IN ('handle_new_user', 'prevent_booking_conflicts') THEN 'SKIPPED ON PURPOSE'
         WHEN p.proname IN (
           'enforce_class_requires_package', 'enforce_duration_override_permission',
           'enforce_package_detach_guard', 'enforce_staff_enable_no_future_bookings',
           'handle_package_booking', 'handle_package_cancellation', 'handle_package_reschedule',
           'link_walkin_to_account', 'update_provider_average_rating',
           'waitlist_capture_freed_slot', 'fill_customer_package_template_name',
           'academy_course_sessions_fill_from_course', 'academy_courses_require_active_instructor',
           'enforce_booking_approval_status', 'enforce_booking_lead_time',
           'enforce_customer_reschedule', 'set_updated_at', 'update_class_schedule_updated_at')
           THEN 'revoke'
         ELSE 'not listed'
       END                                                        AS in_scope,
       p.prosecdef                                                AS secdef,
       has_function_privilege('anon', p.oid, 'EXECUTE')           AS anon_exec,
       has_function_privilege('authenticated', p.oid, 'EXECUTE')  AS auth_exec,
       EXISTS (SELECT 1
               FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
               WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE') AS public_exec,
       p.proacl::text                                             AS acl
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.prorettype = 'pg_catalog.trigger'::regtype
  AND NOT EXISTS (SELECT 1 FROM pg_depend d
                  WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
ORDER BY in_scope, p.proname;

-- A2. Triggers. Expect output IDENTICAL to 0b, row for row.
SELECT t.tgrelid::regclass::text AS on_table, t.tgname, p.proname AS function, t.tgenabled AS enabled
FROM pg_trigger t
JOIN pg_proc p ON p.oid = t.tgfoid
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE NOT t.tgisinternal
  AND (n.nspname = 'public' OR (n.nspname = 'auth' AND c.relname = 'users'))
ORDER BY 1, 2;

-- A3. One line. Expect:
--       listed_open = 0          (listed_found: 17 on PROD, 16 expected on DEV)
--       skipped_still_open = 2   (handle_new_user, prevent_booking_conflicts)
--       other_open = 0           (no other trigger function open to anon or
--                                 authenticated; if not 0, A1 shows which)
SELECT count(*) FILTER (WHERE s.in_scope = 'revoke')                               AS listed_found,
       count(*) FILTER (WHERE s.in_scope = 'revoke' AND (s.anon_exec OR s.auth_exec)) AS listed_open,
       count(*) FILTER (WHERE s.in_scope = 'skip'   AND (s.anon_exec OR s.auth_exec)) AS skipped_still_open,
       count(*) FILTER (WHERE s.in_scope = 'other'  AND (s.anon_exec OR s.auth_exec)) AS other_open
FROM (
  SELECT CASE
           WHEN p.proname IN ('handle_new_user', 'prevent_booking_conflicts') THEN 'skip'
           WHEN p.proname IN (
             'enforce_class_requires_package', 'enforce_duration_override_permission',
             'enforce_package_detach_guard', 'enforce_staff_enable_no_future_bookings',
             'handle_package_booking', 'handle_package_cancellation', 'handle_package_reschedule',
             'link_walkin_to_account', 'update_provider_average_rating',
             'waitlist_capture_freed_slot', 'fill_customer_package_template_name',
             'academy_course_sessions_fill_from_course', 'academy_courses_require_active_instructor',
             'enforce_booking_approval_status', 'enforce_booking_lead_time',
             'enforce_customer_reschedule', 'set_updated_at', 'update_class_schedule_updated_at')
             THEN 'revoke'
           ELSE 'other'
         END AS in_scope,
         has_function_privilege('anon', p.oid, 'EXECUTE')          AS anon_exec,
         has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_exec
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.prorettype = 'pg_catalog.trigger'::regtype
    AND NOT EXISTS (SELECT 1 FROM pg_depend d
                    WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
) s;


-- ── §B TRIGGERS STILL FIRE FOR A SIGNED-IN USER — DEV ONLY ────────────────
--     ONE DO block. Triggers stay ON. It creates a throw-away customer, two
--     owners, a normal provider with a 60-minute service, and a fitness
--     studio (approval required) with a class, a package template and an
--     ACTIVE 5-entry package for the customer. Every booking write below is
--     done AS authenticated (the customer, or the owner), never as the
--     editor's role. The final exception rolls ALL of it back.
--       ERROR: PASS: …      -> every trigger was seen firing
--       ERROR: FAIL Tn: …   -> that test failed; a database error is quoted
--     T0  fixtures build; and authenticated holds NO EXECUTE on any listed
--         trigger function that exists here (i.e. the migration is applied)
--     T1  customer books a class, sending status 'confirmed' and no package:
--           the row is stored 'pending'   -> enforce_booking_approval_status
--           the package is attached       -> enforce_class_requires_package
--           the package drops 5 → 4, with an 'entry_deducted' log row
--                                         -> handle_package_booking
--     T2  customer cancels it: the package is back at 5, with an
--         'entry_returned_cancellation' log row -> handle_package_cancellation
--     T3  owner adds a walk-in with the customer's phone: the booking gets
--         linked_user_id = the customer   -> link_walkin_to_account
--     T4  owner moves it, forcing updated_at to 2000-01-01: updated_at comes
--         back as now                     -> the updated_at trigger on bookings
--     T5  owner cancels it: a waitlist_events row records the freed slot
--                                         -> waitlist_capture_freed_slot
--     T6  where trg_update_provider_rating exists: the customer's 5-star
--         review sets average_rating = 5.00 -> update_provider_average_rating
--                                            (skipped on DEV today)
--     Seven triggers, DEFINER and INVOKER, fired by a role with no EXECUTE on
--     their functions.
DO $b$
DECLARE
  v_owner_std uuid := gen_random_uuid();
  v_owner_fit uuid := gen_random_uuid();
  v_cust      uuid := gen_random_uuid();
  v_std       uuid := gen_random_uuid();
  v_fit       uuid := gen_random_uuid();
  v_svc       uuid := gen_random_uuid();
  v_cls       uuid := gen_random_uuid();
  v_tpl       uuid := gen_random_uuid();
  v_pkg       uuid := gen_random_uuid();
  v_cbk       uuid := gen_random_uuid();   -- the customer's class booking
  v_wbk       uuid := gen_random_uuid();   -- the owner's walk-in
  v_day       date := CURRENT_DATE + 7;
  v_phone     text := '055-9' || lpad((floor(random() * 1000000))::int::text, 6, '0');
  v_open      text;
  v_err       text;
  v_rows      bigint;
  v_n         bigint;
  v_status    text;
  v_att       uuid;
  v_link      uuid;
  v_left      integer;
  v_ts        timestamptz;
  v_rate      numeric;
  v_upd_fn    text;
  v_note      text := '';
BEGIN
  -- T0a: the migration is applied — authenticated has no EXECUTE on any
  --      listed trigger function that exists on this database.
  SELECT string_agg(p.proname, ', ' ORDER BY p.proname) INTO v_open
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.prorettype = 'pg_catalog.trigger'::regtype
    AND p.proname IN (
      'enforce_class_requires_package', 'enforce_duration_override_permission',
      'enforce_package_detach_guard', 'enforce_staff_enable_no_future_bookings',
      'handle_package_booking', 'handle_package_cancellation', 'handle_package_reschedule',
      'link_walkin_to_account', 'update_provider_average_rating',
      'waitlist_capture_freed_slot', 'fill_customer_package_template_name',
      'academy_course_sessions_fill_from_course', 'academy_courses_require_active_instructor',
      'enforce_booking_approval_status', 'enforce_booking_lead_time',
      'enforce_customer_reschedule', 'set_updated_at', 'update_class_schedule_updated_at')
    AND (has_function_privilege('authenticated', p.oid, 'EXECUTE')
         OR has_function_privilege('anon', p.oid, 'EXECUTE'));
  IF v_open IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL T0: still executable by anon/authenticated — apply 20261118000002 first: %', v_open;
  END IF;

  -- T0b: fixtures (as the editor's role)
  BEGIN
    INSERT INTO auth.users (id, instance_id, aud, role, phone, phone_confirmed_at,
                            raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    SELECT u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
           u.ph || lpad((floor(random() * 100000))::int::text, 5, '0'), now(),
           '{"provider":"phone","providers":["phone"]}'::jsonb, '{}'::jsonb, now(), now()
    FROM (VALUES (v_owner_std, '9720003'), (v_owner_fit, '9720004'), (v_cust, '9720005')) AS u(id, ph);

    -- The customer's profile (made by handle_new_user) gets a phone no other
    -- profile has, in the app's stored format.
    INSERT INTO public.profiles (user_id, display_name, phone)
    VALUES (v_cust, 'trigger verify customer', v_phone)
    ON CONFLICT (user_id) DO UPDATE SET display_name = EXCLUDED.display_name, phone = EXCLUDED.phone;

    INSERT INTO public.provider_profiles (id, user_id, business_name)
    VALUES (v_std, v_owner_std, 'trigger verify provider');
    INSERT INTO public.provider_profiles (id, user_id, business_name, category, requires_booking_approval)
    VALUES (v_fit, v_owner_fit, 'trigger verify studio', 'fitness_studio', true);

    INSERT INTO public.provider_services (id, provider_id, name, duration, price)
    VALUES (v_svc, v_std, 'verify 60 min', 60, 0);

    INSERT INTO public.provider_class_schedule
      (id, provider_id, class_name, class_type, day_of_week, start_time, duration_minutes, max_capacity)
    VALUES (v_cls, v_fit, 'verify class', 'group', EXTRACT(dow FROM v_day)::int, '10:00', 60, 10);

    INSERT INTO public.package_templates (id, provider_id, name, price, total_entries, validity_days)
    VALUES (v_tpl, v_fit, 'verify 5 entries', 0, 5, 30);

    INSERT INTO public.customer_packages (id, customer_id, provider_id, template_id, entries_remaining, total_entries, status)
    VALUES (v_pkg, v_cust, v_fit, v_tpl, 5, 5, 'active');
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'FAIL T0 (fixtures): % [%]', SQLERRM, SQLSTATE;
  END;

  -- ══ AS THE CUSTOMER ══════════════════════════════════════════════════════
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_cust, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_cust::text, true);

  -- T1: class booking, sent as 'confirmed' with no package
  v_err := NULL;
  BEGIN
    SET LOCAL ROLE authenticated;
    INSERT INTO public.bookings
      (id, user_id, provider_id, class_schedule_id, booking_date, booking_time, service_ids, total_price, status)
    VALUES (v_cbk, v_cust, v_fit, v_cls, v_day, '10:00', '{}', 0, 'confirmed');
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM || ' [' || SQLSTATE || ']';
  END;
  RESET ROLE;
  IF v_err IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL T1: the customer''s class booking was refused: %', v_err;
  END IF;

  SELECT status, customer_package_id INTO v_status, v_att FROM public.bookings WHERE id = v_cbk;
  IF v_status IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'FAIL T1 approval: stored status is %, want pending — enforce_booking_approval_status did not fire', v_status;
  END IF;
  IF v_att IS DISTINCT FROM v_pkg THEN
    RAISE EXCEPTION 'FAIL T1 package attach: customer_package_id is %, want the active package — enforce_class_requires_package did not fire', v_att;
  END IF;
  SELECT entries_remaining INTO v_left FROM public.customer_packages WHERE id = v_pkg;
  SELECT count(*) INTO v_n FROM public.package_usage_log
   WHERE customer_package_id = v_pkg AND booking_id = v_cbk AND action_type = 'entry_deducted';
  IF v_left IS DISTINCT FROM 4 OR v_n <> 1 THEN
    RAISE EXCEPTION 'FAIL T1 deduct: package has % entries (want 4) and % entry_deducted log row(s) (want 1) — handle_package_booking did not fire', v_left, v_n;
  END IF;

  -- T2: the customer cancels it
  v_err := NULL; v_rows := 0;
  BEGIN
    SET LOCAL ROLE authenticated;
    UPDATE public.bookings SET status = 'cancelled' WHERE id = v_cbk;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM || ' [' || SQLSTATE || ']';
  END;
  RESET ROLE;
  IF v_err IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL T2: the customer''s cancellation was refused: %', v_err;
  END IF;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'FAIL T2: the customer''s cancellation changed % row(s), want 1', v_rows;
  END IF;
  SELECT entries_remaining INTO v_left FROM public.customer_packages WHERE id = v_pkg;
  SELECT count(*) INTO v_n FROM public.package_usage_log
   WHERE customer_package_id = v_pkg AND booking_id = v_cbk AND action_type = 'entry_returned_cancellation';
  IF v_left IS DISTINCT FROM 5 OR v_n <> 1 THEN
    RAISE EXCEPTION 'FAIL T2 refund: package has % entries (want 5) and % entry_returned_cancellation log row(s) (want 1) — handle_package_cancellation did not fire', v_left, v_n;
  END IF;

  -- ══ AS THE OWNER of the normal provider ═════════════════════════════════
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner_std, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_owner_std::text, true);

  -- T3: walk-in carrying the customer's phone
  v_err := NULL;
  BEGIN
    SET LOCAL ROLE authenticated;
    EXECUTE format(
      'INSERT INTO public.bookings (id, provider_id, user_id, customer_name, customer_phone, booking_date, booking_time, service_ids, total_price, status) '
      'VALUES (%L, %L, NULL, %L, %L, %L, %L, %L, 0, %L)',
      v_wbk, v_std, 'verify walk-in', v_phone, v_day, '10:00', '{' || v_svc || '}', 'confirmed');
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM || ' [' || SQLSTATE || ']';
  END;
  RESET ROLE;
  IF v_err IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL T3: the owner''s walk-in was refused: %', v_err;
  END IF;
  SELECT linked_user_id INTO v_link FROM public.bookings WHERE id = v_wbk;
  IF v_link IS DISTINCT FROM v_cust THEN
    RAISE EXCEPTION 'FAIL T3 link: linked_user_id is %, want the customer — link_walkin_to_account did not fire (or the phone % matched another profile)', v_link, v_phone;
  END IF;

  -- T4: the owner moves it; updated_at is forced back to 2000
  v_err := NULL; v_rows := 0;
  BEGIN
    SET LOCAL ROLE authenticated;
    UPDATE public.bookings SET booking_time = '11:00', updated_at = TIMESTAMPTZ '2000-01-01' WHERE id = v_wbk;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM || ' [' || SQLSTATE || ']';
  END;
  RESET ROLE;
  IF v_err IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL T4: the owner''s reschedule was refused: %', v_err;
  END IF;
  SELECT updated_at INTO v_ts FROM public.bookings WHERE id = v_wbk;
  IF v_rows <> 1 OR v_ts IS NULL OR v_ts < now() - interval '1 hour' THEN
    RAISE EXCEPTION 'FAIL T4: % row(s) updated, updated_at = % — the updated_at trigger on bookings did not fire', v_rows, v_ts;
  END IF;
  SELECT string_agg(DISTINCT p.proname, ', ') INTO v_upd_fn
  FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
  WHERE t.tgrelid = 'public.bookings'::regclass AND NOT t.tgisinternal
    AND p.proname IN ('set_updated_at', 'update_updated_at_column');
  v_note := v_note || format(' bookings.updated_at by %s;', COALESCE(v_upd_fn, '(a function with another name)'));

  -- T5: the owner cancels it; the freed slot is captured
  v_err := NULL; v_rows := 0;
  BEGIN
    SET LOCAL ROLE authenticated;
    UPDATE public.bookings SET status = 'cancelled' WHERE id = v_wbk;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM || ' [' || SQLSTATE || ']';
  END;
  RESET ROLE;
  IF v_err IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL T5: the owner''s cancellation was refused: %', v_err;
  END IF;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'FAIL T5: the owner''s cancellation changed % row(s), want 1', v_rows;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
             WHERE t.tgrelid = 'public.bookings'::regclass AND NOT t.tgisinternal
               AND p.proname = 'waitlist_capture_freed_slot') THEN
    SELECT count(*) INTO v_n FROM public.waitlist_events
     WHERE booking_id = v_wbk AND new_status = 'cancelled';
    IF v_n < 1 THEN
      RAISE EXCEPTION 'FAIL T5 capture: no waitlist_events row for the cancelled walk-in — waitlist_capture_freed_slot did not fire';
    END IF;
  ELSE
    v_note := v_note || ' [T5 capture SKIPPED: no waitlist_capture_freed_slot trigger here];';
  END IF;

  -- ══ AS THE CUSTOMER again: a review, where the rating trigger exists ═════
  IF EXISTS (SELECT 1 FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
             WHERE t.tgrelid = 'public.reviews'::regclass AND NOT t.tgisinternal
               AND p.proname = 'update_provider_average_rating') THEN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_cust, 'role', 'authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub', v_cust::text, true);
    v_err := NULL;
    BEGIN
      SET LOCAL ROLE authenticated;
      INSERT INTO public.reviews (provider_id, user_id, rating) VALUES (v_std, v_cust, 5);
    EXCEPTION WHEN OTHERS THEN v_err := SQLERRM || ' [' || SQLSTATE || ']';
    END;
    RESET ROLE;
    IF v_err IS NOT NULL THEN
      RAISE EXCEPTION 'FAIL T6: the customer''s review was refused: %', v_err;
    END IF;
    SELECT average_rating INTO v_rate FROM public.provider_profiles WHERE id = v_std;
    IF v_rate IS DISTINCT FROM 5 THEN
      RAISE EXCEPTION 'FAIL T6: average_rating is % after one 5-star review, want 5.00 — update_provider_average_rating did not fire', v_rate;
    END IF;
    v_note := v_note || ' rating trigger fired;';
  ELSE
    v_note := v_note || ' [T6 SKIPPED: no update_provider_average_rating trigger on reviews here];';
  END IF;

  RAISE EXCEPTION 'PASS: as authenticated, with no EXECUTE on any of them — approval status, package attach, package deduct, package refund, walk-in link, updated_at and freed-slot capture all fired;% all fixtures rolled back', v_note;
END;
$b$;


-- ── SMOKE LIST after PROD (in the app) ────────────────────────────────────
--   1. Customer books at a provider that requires approval → "pending".
--   2. Provider approves it, then reschedules it → both succeed.
--   3. Provider adds a walk-in, then cancels it.
--   4. Fitness studio: customer with a package books a class → the package
--      count drops by one; customer cancels → it comes back.
--   5. A customer leaves a review → the provider's rating updates.
--   6. A new sign-up gets a profile (handle_new_user was NOT touched — this
--      is only the usual check).
--   7. Security Advisor: the anon/authenticated "security definer function
--      executable" counts drop; handle_new_user and prevent_booking_conflicts
--      remain listed, as ruled.


-- ── §E ROLLBACK (only if needed; do NOT run as part of verification) ──────
--     Restores the grants a trigger function had before. It cannot fix a
--     trigger problem — firing never depended on these grants — so if
--     something looks wrong after applying, send me the error first.
--     One function, as an example:
--
--   GRANT EXECUTE ON FUNCTION public.set_updated_at() TO PUBLIC, anon, authenticated;
--
--     All of them (missing ones are skipped):
--
--   DO $undo$
--   DECLARE fn regprocedure;
--   BEGIN
--     FOR fn IN
--       SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--       WHERE n.nspname = 'public' AND p.prorettype = 'pg_catalog.trigger'::regtype
--         AND p.proname IN (
--           'enforce_class_requires_package', 'enforce_duration_override_permission',
--           'enforce_package_detach_guard', 'enforce_staff_enable_no_future_bookings',
--           'handle_package_booking', 'handle_package_cancellation', 'handle_package_reschedule',
--           'link_walkin_to_account', 'update_provider_average_rating',
--           'waitlist_capture_freed_slot', 'fill_customer_package_template_name',
--           'academy_course_sessions_fill_from_course', 'academy_courses_require_active_instructor',
--           'enforce_booking_approval_status', 'enforce_booking_lead_time',
--           'enforce_customer_reschedule', 'set_updated_at', 'update_class_schedule_updated_at')
--     LOOP
--       EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO PUBLIC, anon, authenticated', fn);
--     END LOOP;
--   END;
--   $undo$;
