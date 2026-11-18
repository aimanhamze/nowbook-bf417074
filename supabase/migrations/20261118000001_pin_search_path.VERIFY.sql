-- VERIFY for 20261118000001_pin_search_path.sql (c). DEV first, then PROD.
--
-- HOW TO RUN. The SQL editor shows only the LAST statement's result, so run
-- ONE block at a time. Every block is a single statement; none ends on
-- ROLLBACK.
--   §0, §A  catalog SELECTs — read-only, DEV and PROD.
--   §B      ONE DO block, DEV ONLY. Builds its own fixtures; the final
--           exception rolls everything back. "PASS: …" or "FAIL Tn: …".
--   §E      rollback.
--
-- ORDER: §0 → apply 20261118000001 → §A → §B (DEV) → smoke list (PROD).


-- ── §0 BEFORE applying ────────────────────────────────────────────────────

-- 0a. The five functions now. KEEP THIS OUTPUT — §A1 compares against it.
--     PROD, expected: FIVE rows, config NULL (no search_path) on all five.
--     DEV, expected: THREE rows — update_provider_average_rating and
--       update_class_schedule_updated_at do not exist there; and
--       booking_time_to_minutes may already show {search_path=public}.
--     body_md5 is the fingerprint of the function body: it must be IDENTICAL
--     in §A1 (this migration changes no body).
SELECT p.oid::regprocedure                          AS function,
       p.prosecdef                                  AS secdef,
       p.prorettype = 'pg_catalog.trigger'::regtype AS is_trigger,
       p.proconfig                                  AS config,
       md5(p.prosrc)                                AS body_md5,
       (SELECT string_agg(t.tgname || ' on ' || t.tgrelid::regclass::text, ', ' ORDER BY t.tgname)
        FROM pg_trigger t WHERE t.tgfoid = p.oid AND NOT t.tgisinternal) AS triggers
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('get_slot_capacity', 'update_provider_average_rating', 'set_updated_at',
                    'update_class_schedule_updated_at', 'booking_time_to_minutes')
ORDER BY p.proname;

-- 0b. For the record: is booking_time_to_minutes used by an index, a
--     constraint or a column default? (A SQL function with a SET clause is
--     not inlined; inside an index expression that is still allowed and
--     still correct.) Expect ZERO rows. A row is NOT a reason to stop — send
--     it to me and apply anyway.
SELECT 'index' AS used_by, c.relname::text AS object, pg_get_indexdef(c.oid) AS definition
FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
WHERE pg_get_indexdef(c.oid) ~* '\mbooking_time_to_minutes\M'
UNION ALL
SELECT 'constraint', con.conname::text, pg_get_constraintdef(con.oid)
FROM pg_constraint con
WHERE pg_get_constraintdef(con.oid) ~* '\mbooking_time_to_minutes\M'
UNION ALL
SELECT 'column default', d.adrelid::regclass::text, pg_get_expr(d.adbin, d.adrelid)
FROM pg_attrdef d
WHERE pg_get_expr(d.adbin, d.adrelid) ~* '\mbooking_time_to_minutes\M';

-- 0c. Every SECURITY DEFINER function in public that has NO search_path of
--     its own — the complete list, not just the five. Expect on PROD exactly
--     two rows: get_slot_capacity and update_provider_average_rating.
--     Anything else is a function this commit does not cover: tell me.
SELECT p.oid::regprocedure AS definer_without_search_path
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.prokind IN ('f', 'p')
  AND p.prosecdef
  AND NOT EXISTS (SELECT 1 FROM unnest(COALESCE(p.proconfig, '{}'::text[])) c WHERE c LIKE 'search_path=%')
  AND NOT EXISTS (SELECT 1 FROM pg_depend d
                  WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
ORDER BY 1;


-- ── §A AFTER applying ─────────────────────────────────────────────────────

-- A1. Same rows as 0a. Expect on every row:
--       config = {"search_path=public, pg_temp"}
--       body_md5 IDENTICAL to 0a   (no body changed)
--       secdef, is_trigger and triggers IDENTICAL to 0a
SELECT p.oid::regprocedure                          AS function,
       p.prosecdef                                  AS secdef,
       p.prorettype = 'pg_catalog.trigger'::regtype AS is_trigger,
       p.proconfig                                  AS config,
       md5(p.prosrc)                                AS body_md5,
       (SELECT string_agg(t.tgname || ' on ' || t.tgrelid::regclass::text, ', ' ORDER BY t.tgname)
        FROM pg_trigger t WHERE t.tgfoid = p.oid AND NOT t.tgisinternal) AS triggers
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('get_slot_capacity', 'update_provider_average_rating', 'set_updated_at',
                    'update_class_schedule_updated_at', 'booking_time_to_minutes')
ORDER BY p.proname;

-- A2. One line. Expect: pinned = functions (5 on PROD, 3 on DEV),
--     not_pinned = 0, definers_without_search_path = 0 for the whole schema.
SELECT count(*)                                                        AS functions,
       count(*) FILTER (WHERE 'search_path=public, pg_temp' = ANY (p.proconfig)) AS pinned,
       count(*) FILTER (WHERE NOT EXISTS (
         SELECT 1 FROM unnest(COALESCE(p.proconfig, '{}'::text[])) c WHERE c LIKE 'search_path=%')) AS not_pinned,
       (SELECT count(*)
        FROM pg_proc q JOIN pg_namespace m ON m.oid = q.pronamespace
        WHERE m.nspname = 'public' AND q.prokind IN ('f', 'p') AND q.prosecdef
          AND NOT EXISTS (SELECT 1 FROM unnest(COALESCE(q.proconfig, '{}'::text[])) c WHERE c LIKE 'search_path=%')
          AND NOT EXISTS (SELECT 1 FROM pg_depend d
                          WHERE d.classid = 'pg_proc'::regclass AND d.objid = q.oid AND d.deptype = 'e')
       )                                                               AS definers_without_search_path
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('get_slot_capacity', 'update_provider_average_rating', 'set_updated_at',
                    'update_class_schedule_updated_at', 'booking_time_to_minutes');


-- ── §B BEHAVIOUR — DEV ONLY ───────────────────────────────────────────────
--     ONE DO block. Triggers stay ON (they are what is being tested). It
--     creates a throw-away owner, customer, provider and 60-minute service,
--     then books against them; the final exception rolls ALL of it back.
--       ERROR: PASS: …      -> all tests passed (skipped ones are named)
--       ERROR: FAIL Tn: …   -> that test failed; a database error is quoted
--     T0  fixtures build
--     T1  booking_time_to_minutes('10:30') = 630
--     T2  a walk-in booking at 10:00 is accepted (every INSERT trigger ran)
--     T3  moving it to 11:00 with updated_at forced to 2000-01-01: the row's
--         updated_at comes back as now — the updated_at trigger on bookings
--         fired (the PASS text names the function that trigger uses)
--     T4  a second booking at 11:30 is REFUSED — the conflict logic, which
--         converts times with booking_time_to_minutes, still sees the overlap
--     T5  a booking at 13:00 is accepted — it does not refuse everything
--     T6  get_slot_capacity for the 11:00 slot reports booked_count = 1
--     T7  where trg_update_provider_rating exists: a 4-star review sets the
--         provider's average_rating to 4.00         (skipped on DEV today)
--     T8  where update_class_schedule_updated_at exists: updating a class
--         row resets its updated_at                  (skipped on DEV today)
DO $b$
DECLARE
  v_owner uuid := gen_random_uuid();
  v_cust  uuid := gen_random_uuid();
  v_std   uuid := gen_random_uuid();
  v_svc   uuid := gen_random_uuid();
  v_bk1   uuid := gen_random_uuid();
  v_bk2   uuid := gen_random_uuid();
  v_bk3   uuid := gen_random_uuid();
  v_cls   uuid := gen_random_uuid();
  v_day   date := CURRENT_DATE + 7;
  v_ins   text;
  v_err   text;
  v_n     bigint;
  v_ts    timestamptz;
  v_rate  numeric;
  v_upd_fn text;
  v_note  text := '';
BEGIN
  -- T0: fixtures
  BEGIN
    INSERT INTO auth.users (id, instance_id, aud, role, phone, phone_confirmed_at,
                            raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    VALUES
      (v_owner, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       '9720001' || lpad((floor(random() * 100000))::int::text, 5, '0'), now(),
       '{"provider":"phone","providers":["phone"]}'::jsonb, '{}'::jsonb, now(), now()),
      (v_cust, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       '9720002' || lpad((floor(random() * 100000))::int::text, 5, '0'), now(),
       '{"provider":"phone","providers":["phone"]}'::jsonb, '{}'::jsonb, now(), now());
    INSERT INTO public.provider_profiles (id, user_id, business_name)
    VALUES (v_std, v_owner, 'search_path verify');
    INSERT INTO public.provider_services (id, provider_id, name, duration, price)
    VALUES (v_svc, v_std, 'verify 60 min', 60, 0);
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'FAIL T0 (fixtures): % [%]', SQLERRM, SQLSTATE;
  END;

  -- T1
  IF public.booking_time_to_minutes('10:30') IS DISTINCT FROM 630 THEN
    RAISE EXCEPTION 'FAIL T1: booking_time_to_minutes(''10:30'') = %, want 630', public.booking_time_to_minutes('10:30');
  END IF;

  -- One INSERT text for all three bookings: id and time are the parameters.
  v_ins := 'INSERT INTO public.bookings (id, provider_id, user_id, customer_name, booking_date, booking_time, service_ids, total_price, status) '
        || 'VALUES (%L, ' || quote_literal(v_std) || ', NULL, ''verify walk-in'', ' || quote_literal(v_day)
        || ', %L, ' || quote_literal('{' || v_svc || '}') || ', 0, ''confirmed'')';

  -- T2
  v_err := NULL;
  BEGIN
    EXECUTE format(v_ins, v_bk1, '10:00');
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM || ' [' || SQLSTATE || ']';
  END;
  IF v_err IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL T2: the walk-in booking at 10:00 was refused: %', v_err;
  END IF;

  -- T3
  v_err := NULL;
  BEGIN
    UPDATE public.bookings SET booking_time = '11:00', updated_at = TIMESTAMPTZ '2000-01-01' WHERE id = v_bk1;
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM || ' [' || SQLSTATE || ']';
  END;
  IF v_err IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL T3: moving the booking to 11:00 was refused: %', v_err;
  END IF;
  SELECT updated_at INTO v_ts FROM public.bookings WHERE id = v_bk1;
  IF v_ts IS NULL OR v_ts < now() - interval '1 hour' THEN
    RAISE EXCEPTION 'FAIL T3: updated_at is % after the update — the updated_at trigger on bookings did not run', v_ts;
  END IF;
  SELECT string_agg(DISTINCT p.proname, ', ') INTO v_upd_fn
  FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
  WHERE t.tgrelid = 'public.bookings'::regclass AND NOT t.tgisinternal
    AND p.proname IN ('set_updated_at', 'update_updated_at_column');
  v_note := v_note || format(' bookings.updated_at maintained by %s;', COALESCE(v_upd_fn, '(a function with another name)'));

  -- T4: overlap must be refused
  v_err := NULL;
  BEGIN
    EXECUTE format(v_ins, v_bk2, '11:30');
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  IF v_err IS NULL THEN
    RAISE EXCEPTION 'FAIL T4: a booking at 11:30 was ACCEPTED on top of the 11:00–12:00 one — the conflict check did not see the overlap';
  END IF;
  v_note := v_note || format(' overlap refused ("%s");', left(v_err, 60));

  -- T5: a free slot is accepted
  v_err := NULL;
  BEGIN
    EXECUTE format(v_ins, v_bk3, '13:00');
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM || ' [' || SQLSTATE || ']';
  END;
  IF v_err IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL T5: a booking in a free slot (13:00) was refused: %', v_err;
  END IF;

  -- T6
  v_err := NULL;
  BEGIN
    SELECT booked_count INTO v_n FROM public.get_slot_capacity(v_std, v_day, '11:00', v_svc);
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM || ' [' || SQLSTATE || ']';
  END;
  IF v_err IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL T6: get_slot_capacity raised: %', v_err;
  END IF;
  IF v_n IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'FAIL T6: get_slot_capacity reports booked_count = % for the 11:00 slot, want 1', v_n;
  END IF;

  -- T7: rating trigger, where it exists
  IF EXISTS (SELECT 1 FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
             WHERE t.tgrelid = 'public.reviews'::regclass AND NOT t.tgisinternal
               AND p.proname = 'update_provider_average_rating') THEN
    v_err := NULL;
    BEGIN
      INSERT INTO public.reviews (provider_id, user_id, rating) VALUES (v_std, v_cust, 4);
    EXCEPTION WHEN OTHERS THEN v_err := SQLERRM || ' [' || SQLSTATE || ']';
    END;
    IF v_err IS NOT NULL THEN
      RAISE EXCEPTION 'FAIL T7: the review insert was refused: %', v_err;
    END IF;
    SELECT average_rating INTO v_rate FROM public.provider_profiles WHERE id = v_std;
    IF v_rate IS DISTINCT FROM 4 THEN
      RAISE EXCEPTION 'FAIL T7: average_rating is % after one 4-star review, want 4.00', v_rate;
    END IF;
    v_note := v_note || ' rating trigger set average_rating = 4.00;';
  ELSE
    v_note := v_note || ' [T7 SKIPPED: no update_provider_average_rating trigger on reviews here];';
  END IF;

  -- T8: class schedule updated_at, where the function exists
  IF EXISTS (SELECT 1 FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
             WHERE t.tgrelid = 'public.provider_class_schedule'::regclass AND NOT t.tgisinternal
               AND p.proname = 'update_class_schedule_updated_at') THEN
    v_err := NULL;
    BEGIN
      INSERT INTO public.provider_class_schedule (id, provider_id, class_name, class_type, day_of_week, start_time)
      VALUES (v_cls, v_std, 'verify class', 'group', EXTRACT(dow FROM v_day)::int, '10:00');
      UPDATE public.provider_class_schedule
         SET class_name = 'verify class 2', updated_at = TIMESTAMPTZ '2000-01-01'
       WHERE id = v_cls;
    EXCEPTION WHEN OTHERS THEN v_err := SQLERRM || ' [' || SQLSTATE || ']';
    END;
    IF v_err IS NOT NULL THEN
      RAISE EXCEPTION 'FAIL T8: the class row could not be written: %', v_err;
    END IF;
    SELECT updated_at INTO v_ts FROM public.provider_class_schedule WHERE id = v_cls;
    IF v_ts IS NULL OR v_ts < now() - interval '1 hour' THEN
      RAISE EXCEPTION 'FAIL T8: provider_class_schedule.updated_at is % after the update — the trigger did not run', v_ts;
    END IF;
    v_note := v_note || ' class updated_at trigger ran;';
  ELSE
    v_note := v_note || ' [T8 SKIPPED: no update_class_schedule_updated_at trigger here];';
  END IF;

  RAISE EXCEPTION 'PASS: booking insert, update, overlap refusal, free slot and get_slot_capacity all work;% all fixtures rolled back', v_note;
END;
$b$;


-- ── SMOKE LIST after PROD (in the app) ────────────────────────────────────
--   1. Customer books a normal appointment; the slot disappears for others.
--   2. Provider adds a walk-in on a taken slot → still refused as "taken".
--   3. Provider reschedules a booking → it moves.
--   4. Fitness provider edits a class in the weekly schedule → saves.
--   5. A customer leaves a review → the provider's star rating updates
--      (this is the average_rating trigger, PROD only).


-- ── §E ROLLBACK (only if needed; do NOT run as part of verification) ──────
--     Removes the setting again. Use the signatures 0a printed. On PROD:
--
--   BEGIN;
--   ALTER FUNCTION public.get_slot_capacity(uuid, date, text, uuid) RESET search_path;
--   ALTER FUNCTION public.update_provider_average_rating()           RESET search_path;
--   ALTER FUNCTION public.set_updated_at()                           RESET search_path;
--   ALTER FUNCTION public.update_class_schedule_updated_at()         RESET search_path;
--   ALTER FUNCTION public.booking_time_to_minutes(text)              RESET search_path;
--   COMMIT;
--
--     On a database where booking_time_to_minutes had {search_path=public}
--     in 0a, restore that instead of RESET:
--   ALTER FUNCTION public.booking_time_to_minutes(text) SET search_path = public;
