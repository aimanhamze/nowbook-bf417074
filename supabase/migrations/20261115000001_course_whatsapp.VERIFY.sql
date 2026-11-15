-- VERIFY for 20261115000001_course_whatsapp.sql.
-- Order: §0 BEFORE applying -> apply the migration -> §A -> §B (DEV only).
-- §0 and §A are read-only. §B writes test rows inside a transaction that
-- ROLLS BACK. §C (cron) is Phase 3 — do not run it now.

-- ═════════════════════════════════════════════════════════════════════════════
-- §0 BEFORE applying
-- ═════════════════════════════════════════════════════════════════════════════

-- 0.1 New names are free. Expect one row, every column NULL.
SELECT to_regclass('public.course_whatsapp_log')                                   AS log_table,
       to_regprocedure('public.course_whatsapp_capture()')                         AS capture_fn,
       to_regprocedure('public.course_whatsapp_due_reminders(timestamptz,integer)') AS due_fn,
       to_regprocedure('public.course_whatsapp_claim(integer,timestamptz)')        AS claim_fn,
       to_regprocedure('public.course_whatsapp_has_work(timestamptz)')             AS has_work_fn;

-- 0.2 What it depends on exists. Expect one row, every column true.
SELECT to_regprocedure('public.waitlist_is_quiet_hours(timestamptz)') IS NOT NULL AS quiet_hours_fn,
       to_regprocedure('public.set_updated_at()') IS NOT NULL                     AS set_updated_at_fn,
       EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema = 'public' AND table_name = 'provider_profiles'
                 AND column_name = 'whatsapp_confirm_enabled')                    AS confirm_switch,
       EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema = 'public' AND table_name = 'provider_profiles'
                 AND column_name = 'whatsapp_reminder_enabled')                   AS reminder_switch,
       EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema = 'public' AND table_name = 'academy_course_sessions'
                 AND column_name = 'period')                                       AS session_period;

-- 0.3 Triggers on course_registrations today. Expect exactly one:
--     trg_course_registrations_updated_at
SELECT tgname FROM pg_trigger
WHERE tgrelid = 'public.course_registrations'::regclass AND NOT tgisinternal
ORDER BY tgname;

-- 0.4 Fingerprint of the three registration RPCs. SAVE these three values:
--     §A repeats the query and they must be identical (this migration does
--     not replace them).
SELECT p.proname, md5(replace(p.prosrc, E'\r', '')) AS body_md5
FROM pg_proc p
WHERE p.pronamespace = 'public'::regnamespace
  AND p.proname IN ('register_for_course', 'decide_course_registration', 'cancel_course_registration')
ORDER BY p.proname;

-- ═════════════════════════════════════════════════════════════════════════════
-- §A AFTER applying (read-only)
-- ═════════════════════════════════════════════════════════════════════════════

-- A1. Columns. Expect 16, in this order:
--     id, registration_id, course_id, provider_id, user_id, message_kind,
--     status ('queued'), phone_digits, template_name, language_code,
--     sendpulse_message_id, missing_message_id (false), error_code,
--     claimed_at, created_at, updated_at
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'course_whatsapp_log'
ORDER BY ordinal_position;

-- A2. Constraints + indexes. Expect: pkey; FK provider_id -> provider_profiles
--     CASCADE; FK user_id -> auth.users CASCADE; CHECK message_kind (4);
--     CHECK status (5); NO FK on registration_id or course_id.
--     Indexes: pkey, registration_kind_key (UNIQUE), queued_idx (partial),
--     provider_created_idx.
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint WHERE conrelid = 'public.course_whatsapp_log'::regclass
ORDER BY conname;
SELECT indexname, indexdef FROM pg_indexes
WHERE schemaname = 'public' AND tablename = 'course_whatsapp_log'
ORDER BY indexname;

-- A3. RLS on, zero policies, nothing granted to anon / authenticated.
--     Expect: true | 0 | 0
SELECT c.relrowsecurity AS rls_enabled,
       (SELECT count(*) FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'course_whatsapp_log') AS policies,
       (SELECT count(*) FROM information_schema.role_table_grants
        WHERE table_schema = 'public' AND table_name = 'course_whatsapp_log'
          AND grantee IN ('anon', 'authenticated'))                         AS client_grants
FROM pg_class c WHERE c.oid = 'public.course_whatsapp_log'::regclass;

-- A4. Function access. Expect: anon and authenticated false everywhere;
--     service_role true for due_reminders, claim, has_work, and false for
--     capture (it only ever runs as a trigger).
SELECT f AS function,
       has_function_privilege('anon',          f, 'EXECUTE') AS anon,
       has_function_privilege('authenticated', f, 'EXECUTE') AS authenticated,
       has_function_privilege('service_role',  f, 'EXECUTE') AS service_role
FROM unnest(ARRAY[
  'public.course_whatsapp_capture()',
  'public.course_whatsapp_due_reminders(timestamptz, integer)',
  'public.course_whatsapp_claim(integer, timestamptz)',
  'public.course_whatsapp_has_work(timestamptz)'
]) AS f;

-- A5. Triggers on course_registrations. Expect exactly two:
--     trg_course_registrations_updated_at, trg_course_whatsapp_capture (enabled 'O').
SELECT tgname, tgenabled FROM pg_trigger
WHERE tgrelid = 'public.course_registrations'::regclass AND NOT tgisinternal
ORDER BY tgname;

-- A6. Same query as 0.4. The three md5 values must equal the ones you saved.
SELECT p.proname, md5(replace(p.prosrc, E'\r', '')) AS body_md5
FROM pg_proc p
WHERE p.pronamespace = 'public'::regnamespace
  AND p.proname IN ('register_for_course', 'decide_course_registration', 'cancel_course_registration')
ORDER BY p.proname;

-- ═════════════════════════════════════════════════════════════════════════════
-- §B BEHAVIOUR — DEV only, rolled back
-- ═════════════════════════════════════════════════════════════════════════════
-- Needs on DEV: one academy branch with an owner, and one other auth user.
-- Builds its own instructor and three courses, drives the REAL registration
-- RPCs as the owner / the customer, and calls the claim with fixed times
-- (p_now) 60 days ahead so the result does not depend on when you run it.
-- Success = the final SELECT says "all checks passed" and leftover = 0.

BEGIN;
DO $$
DECLARE
  v_owner uuid; v_branch uuid; v_cust uuid; v_ins uuid;
  v_a uuid; v_b uuid; v_c uuid;            -- courses: A events, B reminder, C inactive
  r1 uuid; r2 uuid; r3 uuid; r4 uuid; r5 uuid; r6 uuid; r7 uuid;
  v_gone uuid := gen_random_uuid();
  d date := current_date + 60;
  t_noon  timestamptz;                      -- D 12:00 Israel: not quiet
  t_night timestamptz;                      -- D 23:00 Israel: quiet
  t_start timestamptz;                      -- course B's first session, D+1 16:00
  n int; s text; e text; k text;
  claimed uuid[];
BEGIN
  t_noon  := (d + time '12:00') AT TIME ZONE 'Asia/Jerusalem';
  t_night := (d + time '23:00') AT TIME ZONE 'Asia/Jerusalem';
  t_start := ((d + 1) + time '16:00') AT TIME ZONE 'Asia/Jerusalem';

  -- ── Fixtures ──────────────────────────────────────────────────────────────
  SELECT pp.id, pp.user_id INTO v_branch, v_owner
  FROM public.provider_profiles pp
  WHERE pp.category = 'academy' AND pp.user_id IS NOT NULL
  ORDER BY pp.created_at LIMIT 1;
  IF v_branch IS NULL THEN RAISE EXCEPTION 'SETUP: need one academy branch with an owner on DEV'; END IF;

  SELECT u.id INTO v_cust FROM auth.users u
  WHERE u.id <> v_owner
    AND NOT EXISTS (SELECT 1 FROM public.provider_profiles p WHERE p.user_id = u.id)
  ORDER BY u.created_at LIMIT 1;
  IF v_cust IS NULL THEN RAISE EXCEPTION 'SETUP: need one non-provider auth user on DEV'; END IF;

  UPDATE public.provider_profiles
     SET whatsapp_confirm_enabled = true, whatsapp_reminder_enabled = true
   WHERE id = v_branch;

  INSERT INTO public.academy_instructors (provider_id, name)
  VALUES (v_branch, 'VERIFY instructor') RETURNING id INTO v_ins;

  INSERT INTO public.academy_courses (provider_id, instructor_id, name, location_type, address, max_seats, cancellation_hours)
  VALUES (v_branch, v_ins, 'VERIFY A', 'physical', 'VERIFY address', 10, 0) RETURNING id INTO v_a;
  INSERT INTO public.academy_courses (provider_id, instructor_id, name, location_type, address, max_seats, cancellation_hours)
  VALUES (v_branch, v_ins, 'VERIFY B', 'physical', 'VERIFY address', 10, 0) RETURNING id INTO v_b;
  INSERT INTO public.academy_courses (provider_id, instructor_id, name, location_type, address, max_seats, is_active)
  VALUES (v_branch, v_ins, 'VERIFY C', 'physical', 'VERIFY address', 10, false) RETURNING id INTO v_c;

  INSERT INTO public.academy_course_sessions (course_id, provider_id, instructor_id, session_date, start_time, end_time) VALUES
    (v_a, v_branch, v_ins, current_date + 40, '10:00', '12:00'),
    (v_b, v_branch, v_ins, d + 1,             '16:00', '18:00'),
    (v_b, v_branch, v_ins, d + 3,             '16:00', '18:00'),
    (v_c, v_branch, v_ins, current_date + 45, '10:00', '12:00');

  -- ── B1. Owner approves -> one queued course_approved ──────────────────────
  INSERT INTO public.course_registrations (course_id, provider_id, user_id)
  VALUES (v_a, v_branch, v_cust) RETURNING id INTO r1;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM public.decide_course_registration(r1, 'confirmed');
  RESET ROLE;
  SELECT count(*) INTO n FROM public.course_whatsapp_log
  WHERE registration_id = r1 AND message_kind = 'course_approved' AND status = 'queued'
    AND course_id = v_a AND provider_id = v_branch AND user_id = v_cust;
  IF n <> 1 THEN RAISE EXCEPTION 'B1 FAILED: approve queued % matching row(s)', n; END IF;

  -- ── B2. The same transition again queues nothing new ──────────────────────
  UPDATE public.course_registrations SET status = 'pending' WHERE id = r1;
  UPDATE public.course_registrations SET status = 'confirmed' WHERE id = r1;
  SELECT count(*) INTO n FROM public.course_whatsapp_log WHERE registration_id = r1;
  IF n <> 1 THEN RAISE EXCEPTION 'B2 FAILED: repeat approve left % row(s), want 1', n; END IF;

  -- ── B3. Owner cancels a confirmed registration -> course_cancelled ───────
  SET LOCAL ROLE authenticated;
  PERFORM public.cancel_course_registration(r1);
  RESET ROLE;
  SELECT count(*) INTO n FROM public.course_whatsapp_log
  WHERE registration_id = r1 AND message_kind = 'course_cancelled' AND status = 'queued';
  IF n <> 1 THEN RAISE EXCEPTION 'B3 FAILED: provider cancel queued % row(s)', n; END IF;

  -- ── B4. Owner declines -> course_declined ─────────────────────────────────
  INSERT INTO public.course_registrations (course_id, provider_id, user_id)
  VALUES (v_a, v_branch, v_cust) RETURNING id INTO r2;
  SET LOCAL ROLE authenticated;
  PERFORM public.decide_course_registration(r2, 'rejected');
  RESET ROLE;
  SELECT count(*) INTO n FROM public.course_whatsapp_log
  WHERE registration_id = r2 AND message_kind = 'course_declined';
  IF n <> 1 THEN RAISE EXCEPTION 'B4 FAILED: decline queued % row(s)', n; END IF;

  -- ── B5. Owner cancels a PENDING registration -> course_cancelled ─────────
  INSERT INTO public.course_registrations (course_id, provider_id, user_id)
  VALUES (v_a, v_branch, v_cust) RETURNING id INTO r3;
  SET LOCAL ROLE authenticated;
  PERFORM public.cancel_course_registration(r3);
  RESET ROLE;
  SELECT count(*) INTO n FROM public.course_whatsapp_log
  WHERE registration_id = r3 AND message_kind = 'course_cancelled';
  IF n <> 1 THEN RAISE EXCEPTION 'B5 FAILED: provider cancel of pending queued % row(s)', n; END IF;

  -- ── B6. The CUSTOMER cancels -> nothing queued ────────────────────────────
  INSERT INTO public.course_registrations (course_id, provider_id, user_id)
  VALUES (v_a, v_branch, v_cust) RETURNING id INTO r4;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_cust, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM public.cancel_course_registration(r4);
  RESET ROLE;
  SELECT count(*) INTO n FROM public.course_whatsapp_log WHERE registration_id = r4;
  IF n <> 0 THEN RAISE EXCEPTION 'B6 FAILED: customer cancel queued % row(s)', n; END IF;

  -- ── B7. A queueing failure never blocks the approval ──────────────────────
  ALTER TABLE public.course_whatsapp_log ADD CONSTRAINT verify_block CHECK (false) NOT VALID;
  INSERT INTO public.course_registrations (course_id, provider_id, user_id)
  VALUES (v_a, v_branch, v_cust) RETURNING id INTO r5;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM public.decide_course_registration(r5, 'confirmed');   -- emits one WARNING
  RESET ROLE;
  ALTER TABLE public.course_whatsapp_log DROP CONSTRAINT verify_block;
  SELECT status INTO s FROM public.course_registrations WHERE id = r5;
  SELECT count(*) INTO n FROM public.course_whatsapp_log WHERE registration_id = r5;
  IF s <> 'confirmed' OR n <> 0 THEN
    RAISE EXCEPTION 'B7 FAILED: status %, % row(s) — the approval must stand with nothing queued', s, n;
  END IF;

  -- ── Claim fixtures, all relative to t_noon ────────────────────────────────
  --   r1 approved   -> registration is now cancelled         -> SUPERSEDED
  --   r1 cancelled  -> still cancelled                       -> CLAIMED
  --   r2 declined   -> queued 25 h ago                       -> STALE
  --   r3 cancelled  -> queued 30 s ago                       -> stays queued
  --   v_gone        -> no such registration                  -> REGISTRATION_GONE
  --   r6 approved   -> course C is inactive                  -> COURSE_INACTIVE
  UPDATE public.course_whatsapp_log SET created_at = t_noon - interval '5 minutes'
  WHERE registration_id IN (r1, r2, r3);
  UPDATE public.course_whatsapp_log SET created_at = t_noon - interval '25 hours'
  WHERE registration_id = r2;
  UPDATE public.course_whatsapp_log SET created_at = t_noon - interval '30 seconds'
  WHERE registration_id = r3;
  INSERT INTO public.course_whatsapp_log (registration_id, course_id, provider_id, user_id, message_kind, created_at)
  VALUES (v_gone, v_a, v_branch, v_cust, 'course_approved', t_noon - interval '5 minutes');
  INSERT INTO public.course_registrations (course_id, provider_id, user_id, status, decided_at)
  VALUES (v_c, v_branch, v_cust, 'confirmed', now()) RETURNING id INTO r6;
  INSERT INTO public.course_whatsapp_log (registration_id, course_id, provider_id, user_id, message_kind, created_at)
  VALUES (r6, v_c, v_branch, v_cust, 'course_approved', t_noon - interval '5 minutes');

  -- ── C1. Quiet hours: nothing claimed, nothing changed ─────────────────────
  SELECT count(*) INTO n FROM public.course_whatsapp_claim(500, t_night);
  IF n <> 0 THEN RAISE EXCEPTION 'C1 FAILED: claimed % row(s) at 23:00', n; END IF;
  SELECT count(*) INTO n FROM public.course_whatsapp_log
  WHERE registration_id IN (r1, r2, r3, r6, v_gone) AND status <> 'queued';
  IF n <> 0 THEN RAISE EXCEPTION 'C1 FAILED: % row(s) changed during quiet hours', n; END IF;
  IF public.course_whatsapp_has_work(t_night) THEN RAISE EXCEPTION 'C1 FAILED: has_work true at 23:00'; END IF;
  IF NOT public.course_whatsapp_has_work(t_noon) THEN RAISE EXCEPTION 'C1 FAILED: has_work false at noon'; END IF;

  -- ── C2. Claim at noon ─────────────────────────────────────────────────────
  SELECT array_agg(c.r_log_id) INTO claimed FROM public.course_whatsapp_claim(500, t_noon) c;
  FOR k, s, e, n IN
    SELECT x.k, l.status, coalesce(l.error_code, ''),
           CASE WHEN l.id = ANY (coalesce(claimed, '{}')) THEN 1 ELSE 0 END
    FROM (VALUES ('r1 approved',  r1,     'course_approved',  'skipped', 'SUPERSEDED',        0),
                 ('r1 cancelled', r1,     'course_cancelled', 'sending', '',                  1),
                 ('r2 declined',  r2,     'course_declined',  'skipped', 'STALE',             0),
                 ('r3 cancelled', r3,     'course_cancelled', 'queued',  '',                  0),
                 ('gone',         v_gone, 'course_approved',  'skipped', 'REGISTRATION_GONE', 0),
                 ('r6 approved',  r6,     'course_approved',  'skipped', 'COURSE_INACTIVE',   0))
         AS x(k, reg, kind, want_status, want_code, want_claimed)
    JOIN public.course_whatsapp_log l ON l.registration_id = x.reg AND l.message_kind = x.kind
    WHERE l.status <> x.want_status OR coalesce(l.error_code, '') <> x.want_code
       OR (CASE WHEN l.id = ANY (coalesce(claimed, '{}')) THEN 1 ELSE 0 END) <> x.want_claimed
  LOOP
    RAISE EXCEPTION 'C2 FAILED: % is % / "%" (returned by claim: %)', k, s, e, n;
  END LOOP;

  -- ── C3. Switch off -> PROVIDER_DISABLED ───────────────────────────────────
  INSERT INTO public.course_whatsapp_log (registration_id, course_id, provider_id, user_id, message_kind, created_at)
  VALUES (r5, v_a, v_branch, v_cust, 'course_approved', t_noon - interval '5 minutes');
  UPDATE public.provider_profiles SET whatsapp_confirm_enabled = false WHERE id = v_branch;
  PERFORM public.course_whatsapp_claim(500, t_noon);
  SELECT status, coalesce(error_code, '') INTO s, e FROM public.course_whatsapp_log
  WHERE registration_id = r5 AND message_kind = 'course_approved';
  IF s <> 'skipped' OR e <> 'PROVIDER_DISABLED' THEN RAISE EXCEPTION 'C3 FAILED: % / %', s, e; END IF;
  UPDATE public.provider_profiles SET whatsapp_confirm_enabled = true WHERE id = v_branch;

  -- ── Reminder fixture: r7 confirmed on course B (first session D+1 16:00),
  --    approved 48 h before the start.
  INSERT INTO public.course_registrations (course_id, provider_id, user_id, status, decided_at)
  VALUES (v_b, v_branch, v_cust, 'confirmed', t_start - interval '48 hours') RETURNING id INTO r7;

  -- R1. 28 h before: not yet.
  SELECT count(*) INTO n FROM public.course_whatsapp_due_reminders(t_start - interval '28 hours', 500) WHERE r_registration_id = r7;
  IF n <> 0 THEN RAISE EXCEPTION 'R1 FAILED: due 28 h before'; END IF;
  -- R2. 2 h before: under the 3-hour floor.
  SELECT count(*) INTO n FROM public.course_whatsapp_due_reminders(t_start - interval '2 hours', 500) WHERE r_registration_id = r7;
  IF n <> 0 THEN RAISE EXCEPTION 'R2 FAILED: due 2 h before'; END IF;
  -- R3. Approved 10 h before the start: no reminder.
  UPDATE public.course_registrations SET decided_at = t_start - interval '10 hours' WHERE id = r7;
  SELECT count(*) INTO n FROM public.course_whatsapp_due_reminders(t_start - interval '6 hours', 500) WHERE r_registration_id = r7;
  IF n <> 0 THEN RAISE EXCEPTION 'R3 FAILED: due though approved inside the 24 h'; END IF;
  UPDATE public.course_registrations SET decided_at = t_start - interval '48 hours' WHERE id = r7;
  -- R4. Course inactive, then reminder switch off: no reminder.
  UPDATE public.academy_courses SET is_active = false WHERE id = v_b;
  SELECT count(*) INTO n FROM public.course_whatsapp_due_reminders(t_start - interval '6 hours', 500) WHERE r_registration_id = r7;
  IF n <> 0 THEN RAISE EXCEPTION 'R4 FAILED: due on an inactive course'; END IF;
  UPDATE public.academy_courses SET is_active = true WHERE id = v_b;
  UPDATE public.provider_profiles SET whatsapp_reminder_enabled = false WHERE id = v_branch;
  SELECT count(*) INTO n FROM public.course_whatsapp_due_reminders(t_start - interval '6 hours', 500) WHERE r_registration_id = r7;
  IF n <> 0 THEN RAISE EXCEPTION 'R4 FAILED: due with the reminder switch off'; END IF;
  UPDATE public.provider_profiles SET whatsapp_reminder_enabled = true WHERE id = v_branch;
  -- R5. 17 h before is in the window, but it is 23:00: claim gives nothing.
  SELECT count(*) INTO n FROM public.course_whatsapp_claim(500, t_start - interval '17 hours') WHERE r_registration_id = r7;
  IF n <> 0 THEN RAISE EXCEPTION 'R5 FAILED: reminder claimed in quiet hours'; END IF;
  -- R6. 6 h before (10:00): claimed once, as 'sending'; a second claim gives nothing.
  SELECT count(*) INTO n FROM public.course_whatsapp_claim(500, t_start - interval '6 hours')
  WHERE r_registration_id = r7 AND r_message_kind = 'course_reminder';
  IF n <> 1 THEN RAISE EXCEPTION 'R6 FAILED: first claim returned % reminder(s)', n; END IF;
  SELECT count(*) INTO n FROM public.course_whatsapp_claim(500, t_start - interval '5 hours') WHERE r_registration_id = r7;
  IF n <> 0 THEN RAISE EXCEPTION 'R6 FAILED: second claim returned the reminder again'; END IF;
  SELECT count(*) INTO n FROM public.course_whatsapp_log
  WHERE registration_id = r7 AND message_kind = 'course_reminder' AND status = 'sending';
  IF n <> 1 THEN RAISE EXCEPTION 'R6 FAILED: % reminder row(s) in sending', n; END IF;
  -- R7. Once claimed it is no longer "due" (else the cron would wake every minute for nothing).
  SELECT count(*) INTO n FROM public.course_whatsapp_due_reminders(t_start - interval '5 hours', 500) WHERE r_registration_id = r7;
  IF n <> 0 THEN RAISE EXCEPTION 'R7 FAILED: still listed as due after the claim'; END IF;

  -- ── P. Clients can neither read the log nor call the functions ───────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_cust, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM 1 FROM public.course_whatsapp_log;
    RAISE EXCEPTION 'P FAILED: authenticated can read the log';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.course_whatsapp_claim(1);
    RAISE EXCEPTION 'P FAILED: authenticated can claim';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.course_whatsapp_has_work();
    RAISE EXCEPTION 'P FAILED: authenticated can call has_work';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RESET ROLE;
  SET LOCAL ROLE anon;
  BEGIN
    PERFORM public.course_whatsapp_due_reminders();
    RAISE EXCEPTION 'P FAILED: anon can list due reminders';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RESET ROLE;

  RAISE NOTICE 'course_whatsapp VERIFY §B: all checks passed';
END $$;
ROLLBACK;
SELECT 'course_whatsapp VERIFY §B: all checks passed' AS result,
       (SELECT count(*) FROM public.course_whatsapp_log) AS leftover;

-- ═════════════════════════════════════════════════════════════════════════════
-- §C CRON — Phase 3. Do NOT run now. PROD only, after the function is
--     deployed and the templates are approved. Reuse CRON_SECRET as the
--     booking reminder's cron does (never rotate it inside this rollout).
-- ═════════════════════════════════════════════════════════════════════════════
-- SELECT cron.schedule('course-whatsapp-dispatch-1min', '* * * * *', 'SELECT net.http_post(url := ''https://<REF>.supabase.co/functions/v1/course-whatsapp-dispatch'', headers := jsonb_build_object(''Content-Type'', ''application/json'', ''Authorization'', ''Bearer <ANON_KEY>'', ''x-cron-secret'', ''<CRON_SECRET>''), body := ''{}''::jsonb) WHERE public.course_whatsapp_has_work()');
-- Kill switch (instant, no deploy): SELECT cron.unschedule('course-whatsapp-dispatch-1min');

-- ═════════════════════════════════════════════════════════════════════════════
-- §R ROLLBACK — removes everything this migration added. Unschedule the cron
--     first if §C was run. Registrations and the RPCs are untouched.
-- ═════════════════════════════════════════════════════════════════════════════
-- BEGIN;
-- DROP TRIGGER IF EXISTS trg_course_whatsapp_capture ON public.course_registrations;
-- DROP FUNCTION IF EXISTS public.course_whatsapp_has_work(timestamptz);
-- DROP FUNCTION IF EXISTS public.course_whatsapp_claim(integer, timestamptz);
-- DROP FUNCTION IF EXISTS public.course_whatsapp_due_reminders(timestamptz, integer);
-- DROP FUNCTION IF EXISTS public.course_whatsapp_capture();
-- DROP TABLE IF EXISTS public.course_whatsapp_log;
-- COMMIT;
