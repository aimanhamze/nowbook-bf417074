-- VERIFY / test plan for 20261101000001_waitlist_dispatch.sql
--
-- ORDER:
--   §0  BEFORE the migration. REQUIRED. Read-only. Run on DEV, and again on PROD
--       before the prod apply. SAVE THE OUTPUT — §A compares against it.
--   §A  after the migration. Read-only. DEV and PROD. (§A6/§A7 after the cron.)
--   §B  after the migration. Behaviour tests, all rolled back. DEV ONLY.
--   §C  end-to-end through the deployed function and the real app. DEV ONLY.
--   §D  ongoing monitoring.
--   §E  rollback script (commented out).
--
-- §B is DEV ONLY: it writes (and rolls back) bookings, services, staff, entries
-- and outbox rows, and its booking INSERTs take the provider/day advisory lock
-- prevent_booking_conflicts uses. Harmless on DEV, not something to do to a
-- live provider.


-- ═════════════════════════════════════════════════════════════════════════════
-- §0. PRE-APPLY — RUN BEFORE THE MIGRATION. REQUIRED. READ-ONLY.
-- ═════════════════════════════════════════════════════════════════════════════

-- 0.1 Phase 1 is in place. Expect three non-NULL tables, the capture function,
--     and 2 triggers with tgenabled = 'O'.
SELECT to_regclass('public.waitlist_entries')  AS entries,
       to_regclass('public.waitlist_events')   AS events,
       to_regclass('public.waitlist_send_log') AS send_log,
       to_regprocedure('public.waitlist_capture_freed_slot()') AS capture_fn;

SELECT tgname, tgenabled
FROM pg_trigger
WHERE tgrelid = 'public.bookings'::regclass AND tgname LIKE 'trg_waitlist_%'
ORDER BY tgname;

-- 0.2 Every name this migration creates is free.
--     Expect: every column NULL; 0 rows for notify_lang; 0 cron jobs.
SELECT to_regprocedure('public.waitlist_quiet_window(timestamptz)')                     AS quiet_window,
       to_regprocedure('public.waitlist_is_quiet_hours(timestamptz)')                   AS is_quiet,
       to_regprocedure('public.waitlist_event_age_anchor(timestamptz, timestamptz)')    AS age_anchor,
       to_regprocedure('public.waitlist_is_private_service(uuid, uuid, date)')          AS is_private,
       to_regprocedure('public.waitlist_staff_performs(uuid, uuid, uuid)')              AS staff_performs,
       to_regprocedure('public.waitlist_customer_has_booking(uuid, uuid, date)')        AS has_booking,
       to_regprocedure('public.waitlist_claim_events(integer)')                         AS claim_events,
       to_regprocedure('public.waitlist_slot_is_open(uuid, date, text, uuid, uuid)')    AS slot_is_open,
       to_regprocedure('public.waitlist_candidates(bigint[])')                          AS candidates,
       to_regprocedure('public.waitlist_claim_round(uuid, smallint, bigint, uuid, text, uuid, text, text, text, text)') AS claim_round,
       to_regprocedure('public.waitlist_housekeeping()')                                AS housekeeping;

SELECT column_name FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'waitlist_entries' AND column_name = 'notify_lang';

SELECT jobname FROM cron.job WHERE jobname LIKE 'waitlist%';

-- 0.3 Fingerprints. SAVE ALL FOUR. §A3 recomputes them and each must be
--     IDENTICAL: this migration touches no trigger, no existing function and
--     not whatsapp_send_log.
--     (a) EVERY bookings trigger, the two Phase 1 capture triggers included.
SELECT md5(string_agg(
         t.tgname || '|' || pg_get_triggerdef(t.oid) || '|' || md5(p.prosrc),
         E'\n' ORDER BY t.tgname)) AS bookings_triggers_fingerprint,
       count(*) AS trigger_count
FROM pg_trigger t
JOIN pg_proc p ON p.oid = t.tgfoid
WHERE t.tgrelid = 'public.bookings'::regclass
  AND NOT t.tgisinternal;

--     (b) prevent_booking_conflicts and (c) the Phase 1 capture function.
SELECT md5(prosrc) AS prevent_booking_conflicts_md5
FROM pg_proc WHERE oid = 'public.prevent_booking_conflicts()'::regprocedure;

SELECT md5(prosrc) AS waitlist_capture_freed_slot_md5
FROM pg_proc WHERE oid = 'public.waitlist_capture_freed_slot()'::regprocedure;

--     (d) whatsapp_send_log — the same query as Phase 1 §0.7.
SELECT md5(concat_ws(E'\n',
  (SELECT string_agg(column_name || ' ' || data_type || ' ' || is_nullable || ' ' || coalesce(column_default, ''), ',' ORDER BY ordinal_position)
     FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'whatsapp_send_log'),
  (SELECT string_agg(conname || ' ' || pg_get_constraintdef(oid), ',' ORDER BY conname)
     FROM pg_constraint WHERE conrelid = 'public.whatsapp_send_log'::regclass),
  (SELECT string_agg(indexdef, ',' ORDER BY indexname)
     FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'whatsapp_send_log'),
  (SELECT string_agg(policyname || ' ' || cmd, ',' ORDER BY policyname)
     FROM pg_policies WHERE schemaname = 'public' AND tablename = 'whatsapp_send_log'),
  (SELECT string_agg(tgname, ',' ORDER BY tgname)
     FROM pg_trigger WHERE tgrelid = 'public.whatsapp_send_log'::regclass AND NOT tgisinternal)
)) AS whatsapp_send_log_fingerprint;

-- 0.4 pg_cron and pg_net are installed (the cron job needs both).
--     Expect 2 rows.
SELECT extname, extversion FROM pg_extension WHERE extname IN ('pg_cron', 'pg_net') ORDER BY extname;

-- 0.5 Every column the new functions read, with its type. The SQL-language
--     functions are parsed at CREATE time, so a missing column aborts the
--     migration — this tells you which one before you try.
--     Expect 22 rows. Types to confirm:
--       bookings: booking_date date, booking_time text, duration_override
--         integer, linked_user_id uuid, service_ids uuid[], staff_id uuid,
--         status text, user_id uuid
--       provider_profiles: min_lead_time_minutes integer, staff_enabled boolean,
--         waitlist_enabled boolean, whatsapp_message_language text
--       provider_services: duration integer, is_active boolean, is_parallel
--         boolean, max_capacity integer, service_type text,
--         latest_start_time — RECORD ITS TYPE (no migration in the repo creates
--         it; the function casts it ::text, so text or time are both fine)
--       provider_staff: is_active boolean
--       provider_staff_services: service_id uuid, staff_id uuid
--       provider_sessions: session_date date
SELECT c.relname AS tbl, a.attname AS col, format_type(a.atttypid, a.atttypmod) AS type
FROM pg_attribute a
JOIN pg_class c ON c.oid = a.attrelid
JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
WHERE a.attnum > 0 AND NOT a.attisdropped
  AND (c.relname, a.attname) IN (
    ('bookings', 'booking_date'), ('bookings', 'booking_time'), ('bookings', 'duration_override'),
    ('bookings', 'linked_user_id'), ('bookings', 'service_ids'), ('bookings', 'staff_id'),
    ('bookings', 'status'), ('bookings', 'user_id'),
    ('provider_profiles', 'min_lead_time_minutes'), ('provider_profiles', 'staff_enabled'),
    ('provider_profiles', 'waitlist_enabled'), ('provider_profiles', 'whatsapp_message_language'),
    ('provider_services', 'duration'), ('provider_services', 'is_active'),
    ('provider_services', 'is_parallel'), ('provider_services', 'max_capacity'),
    ('provider_services', 'service_type'), ('provider_services', 'latest_start_time'),
    ('provider_staff', 'is_active'),
    ('provider_staff_services', 'service_id'), ('provider_staff_services', 'staff_id'),
    ('provider_sessions', 'session_date'))
ORDER BY 1, 2;

-- 0.6 booking_time_to_minutes(text) exists — §5 and §6 use it exactly the way
--     prevent_booking_conflicts does. Expect 1 row, an IMMUTABLE sql function
--     splitting on ':'.
SELECT p.oid::regprocedure, p.provolatile, p.prosrc
FROM pg_proc p
WHERE p.oid = to_regprocedure('public.booking_time_to_minutes(text)');

-- 0.7 service_role can read and write what the function touches (Supabase's
--     default privileges; Phase 1 revoked anon/authenticated only).
--     Expect every cell true.
SELECT t.tbl,
       has_table_privilege('service_role', t.tbl, 'SELECT') AS sel,
       has_table_privilege('service_role', t.tbl, 'INSERT') AS ins,
       has_table_privilege('service_role', t.tbl, 'UPDATE') AS upd
FROM (VALUES ('public.waitlist_entries'), ('public.waitlist_events'),
             ('public.waitlist_send_log'), ('public.notifications'),
             ('public.push_subscriptions')) AS t(tbl)
ORDER BY 1;

-- 0.8 The outbox backlog since Phase 1. Informational: on the first run all of
--     it is closed as stale (or provider_off) without notifying anyone.
SELECT count(*) AS unprocessed, min(created_at), max(created_at)
FROM public.waitlist_events
WHERE processed_at IS NULL;

-- 0.9 Who is opted in. Expect 0 on PROD (Phase 1 §A1).
SELECT count(*) FILTER (WHERE waitlist_enabled) AS opted_in FROM public.provider_profiles;

-- 0.10 Existing cron jobs (informational — confirm no clash, note the others).
SELECT jobid, jobname, schedule, active FROM cron.job ORDER BY jobid;


-- ═════════════════════════════════════════════════════════════════════════════
-- §A. OBJECT CHECKS — after the migration (read-only). DEV and PROD.
-- ═════════════════════════════════════════════════════════════════════════════

-- A1. The 11 functions: SECURITY INVOKER (prosecdef = false), search_path
--     pinned. Expect 11 rows, prosecdef false, proconfig
--     {"search_path=public, pg_temp"}.
SELECT p.oid::regprocedure AS fn, p.prosecdef, p.proconfig, p.provolatile
FROM pg_proc p
WHERE p.pronamespace = 'public'::regnamespace
  AND p.proname IN ('waitlist_quiet_window', 'waitlist_is_quiet_hours', 'waitlist_event_age_anchor',
                    'waitlist_is_private_service', 'waitlist_staff_performs',
                    'waitlist_customer_has_booking', 'waitlist_claim_events',
                    'waitlist_slot_is_open', 'waitlist_candidates', 'waitlist_claim_round',
                    'waitlist_housekeeping')
ORDER BY 1;

-- A2. EXECUTE: service_role only.
--     Expect 11 rows, anon = false, authenticated = false, service_role = true.
SELECT p.oid::regprocedure AS fn,
       has_function_privilege('anon', p.oid, 'EXECUTE')          AS anon,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated,
       has_function_privilege('service_role', p.oid, 'EXECUTE')  AS service_role
FROM pg_proc p
WHERE p.pronamespace = 'public'::regnamespace
  AND p.proname LIKE 'waitlist\_%'
  AND p.proname <> 'waitlist_capture_freed_slot'
ORDER BY 1;

-- A3. Nothing existing changed. Re-run the four §0.3 queries.
--     Expect each value IDENTICAL to the saved §0.3 output.

-- A4. notify_lang: nullable text with its CHECK. Expect
--       notify_lang | text | YES | NULL
--       waitlist_entries_notify_lang_check | CHECK (notify_lang IS NULL OR …)
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'waitlist_entries' AND column_name = 'notify_lang';

SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'public.waitlist_entries'::regclass AND conname = 'waitlist_entries_notify_lang_check';

-- A5. Read-only smoke test of the clock helpers. Expect is_quiet to match the
--     Israel wall clock right now (true between 22:00 and 08:00), and
--     quiet_ends_at to be an 08:00 Israel time.
SELECT q.is_quiet,
       q.quiet_started_at AT TIME ZONE 'Asia/Jerusalem' AS started_il,
       q.quiet_ends_at    AT TIME ZONE 'Asia/Jerusalem' AS ends_il,
       now()              AT TIME ZONE 'Asia/Jerusalem' AS now_il
FROM public.waitlist_quiet_window() q;

-- A6. AFTER §10 (the cron) — both jobs exist, are active, and their stored
--     commands contain NO carriage return. MUST PASS: a CR in the command is
--     the exact failure that has kept booking-reminder-every-15min from ever
--     running. Expect 2 rows, active = true, has_cr = false.
SELECT jobname, schedule, active,
       position(E'\r' IN command) > 0 AS has_cr,
       length(command) AS command_length
FROM cron.job
WHERE jobname IN ('waitlist-dispatch-1min', 'waitlist-housekeeping-15min')
ORDER BY jobname;

-- A7. AFTER the first cancellation on an opted-in provider (or on DEV, after
--     §C step 5): the dispatch job really reaches the function.
--     Expect status 200 rows. A row with status_code NULL and error_msg set,
--     or no row at all while cron.job_run_details says "succeeded", is the
--     booking-reminder failure mode: STOP and report.
SELECT r.id, r.status_code, r.error_msg, left(r.content, 200) AS content, r.created
FROM net._http_response r
ORDER BY r.id DESC
LIMIT 10;

SELECT d.jobid, d.status, d.return_message, d.start_time
FROM cron.job_run_details d
JOIN cron.job j ON j.jobid = d.jobid
WHERE j.jobname LIKE 'waitlist-%'
ORDER BY d.start_time DESC
LIMIT 10;


-- ═════════════════════════════════════════════════════════════════════════════
-- §B. BEHAVIOUR TESTS — DEV ONLY. PERSISTS NOTHING.
-- ═════════════════════════════════════════════════════════════════════════════
-- One DO block. It opts a DEV provider in, creates its own services, staff,
-- entries, outbox events and walk-in bookings on far-future days, exercises
-- every function, and asserts the result after each step.
--
-- ⚠  THE BLOCK ALWAYS ENDS IN AN ERROR. That is how it rolls itself back.
--      SUCCESS  = an error whose message starts with  "PASS:".
--      FAILURE  = an error starting "FAIL", "SETUP" or "INCONCLUSIVE", or any
--                 other error (report the message).
--
-- RUN IT BETWEEN 08:00 AND 21:30 ISRAEL TIME. waitlist_claim_events does
-- nothing during quiet hours by design, so outside that window the block stops
-- with INCONCLUSIVE.
--
-- SETUP: set v_provider below to a DEV provider_profiles.id. Any provider
-- works: the block makes everything else it needs. DEV needs at least three
-- auth.users rows (any accounts — their entries are rolled back).
--
-- The parity section (P) is the one that matters most. For each scenario it
-- asks waitlist_slot_is_open, then really INSERTs the same booking through the
-- live prevent_booking_conflicts trigger inside a sub-transaction that is
-- always undone, and requires:  open  ⇒  the INSERT was accepted.
-- The two scenarios where we are deliberately stricter than the trigger (the
-- booking page's no-staff rule) are named and expected.

DO $verify$
DECLARE
  v_provider uuid := NULL;   -- ← SET THIS to a DEV provider_profiles.id

  v_checks  integer := 0;
  v_now_il  timestamp := now() AT TIME ZONE 'Asia/Jerusalem';
  v_today   date := (now() AT TIME ZONE 'Asia/Jerusalem')::date;
  v_base    date;
  u1 uuid; u2 uuid; u3 uuid;
  s30 uuid; s60 uuid; spar1 uuid; spar2 uuid; scap2 uuid; sgroup uuid; ssess uuid; sinact uuid;
  sx uuid; sy uuid; sz uuid;
  w1 uuid; w2 uuid; w3 uuid; w4 uuid;
  e1 bigint; e2 bigint; e3 bigint; e4 bigint; e5 bigint; e6 bigint; e7 bigint; e8 bigint; e9 bigint;
  v_ids bigint[];
  v_got text;
  v_txt text;
  v_bool boolean;
  v_ts timestamptz;
  v_n integer;
  v_log uuid;
  v_reason text;
  v_open boolean;
  v_ins boolean;
  v_err text;
  v_scn record;
BEGIN
  -- ── Setup ──────────────────────────────────────────────────────────────────
  IF v_provider IS NULL THEN
    RAISE EXCEPTION 'SETUP: set v_provider to a DEV provider id first';
  END IF;
  IF to_regprocedure('public.waitlist_claim_round(uuid, smallint, bigint, uuid, text, uuid, text, text, text, text)') IS NULL THEN
    RAISE EXCEPTION 'SETUP: the migration is not applied';
  END IF;
  IF public.waitlist_is_quiet_hours() OR v_now_il::time > time '21:30' THEN
    RAISE EXCEPTION 'INCONCLUSIVE: run between 08:00 and 21:30 Israel time (now %)', v_now_il;
  END IF;

  SELECT id INTO u1 FROM auth.users ORDER BY created_at, id LIMIT 1;
  SELECT id INTO u2 FROM auth.users ORDER BY created_at, id OFFSET 1 LIMIT 1;
  SELECT id INTO u3 FROM auth.users ORDER BY created_at, id OFFSET 2 LIMIT 1;
  IF u3 IS NULL THEN RAISE EXCEPTION 'SETUP: DEV needs at least 3 auth.users rows'; END IF;

  UPDATE public.provider_profiles
     SET waitlist_enabled = true, staff_enabled = true, min_lead_time_minutes = 15
   WHERE id = v_provider;
  IF NOT FOUND THEN RAISE EXCEPTION 'SETUP: provider % not found', v_provider; END IF;

  -- Far-future run of 40 days with no bookings for this provider and no
  -- waiting-list entries for the three users.
  v_base := v_today + 730;
  WHILE EXISTS (SELECT 1 FROM public.bookings b
                 WHERE b.provider_id = v_provider AND b.booking_date BETWEEN v_base AND v_base + 40)
     OR EXISTS (SELECT 1 FROM public.bookings b
                 WHERE (b.user_id IN (u1, u2, u3) OR b.linked_user_id IN (u1, u2, u3))
                   AND b.provider_id = v_provider AND b.booking_date = v_today)
  LOOP
    v_base := v_base + 41;
    IF v_base > v_today + 3000 THEN RAISE EXCEPTION 'SETUP: no free 40-day run found'; END IF;
  END LOOP;

  INSERT INTO public.provider_services (provider_id, name, duration, service_type, max_capacity, is_parallel)
    VALUES (v_provider, 'WL VERIFY 30', 30, 'private', 1, false) RETURNING id INTO s30;
  INSERT INTO public.provider_services (provider_id, name, duration, service_type, max_capacity, is_parallel)
    VALUES (v_provider, 'WL VERIFY 60', 60, 'private', 1, false) RETURNING id INTO s60;
  INSERT INTO public.provider_services (provider_id, name, duration, service_type, max_capacity, is_parallel)
    VALUES (v_provider, 'WL VERIFY PAR1', 30, 'private', 1, true) RETURNING id INTO spar1;
  INSERT INTO public.provider_services (provider_id, name, duration, service_type, max_capacity, is_parallel)
    VALUES (v_provider, 'WL VERIFY PAR2', 30, 'private', 1, true) RETURNING id INTO spar2;
  INSERT INTO public.provider_services (provider_id, name, duration, service_type, max_capacity, is_parallel)
    VALUES (v_provider, 'WL VERIFY CAP2', 30, 'private', 2, false) RETURNING id INTO scap2;
  INSERT INTO public.provider_services (provider_id, name, duration, service_type, max_capacity, is_parallel)
    VALUES (v_provider, 'WL VERIFY GROUP', 30, 'group', 10, false) RETURNING id INTO sgroup;
  INSERT INTO public.provider_services (provider_id, name, duration, service_type, max_capacity, is_parallel)
    VALUES (v_provider, 'WL VERIFY SESS', 30, 'private', 1, false) RETURNING id INTO ssess;
  INSERT INTO public.provider_services (provider_id, name, duration, service_type, max_capacity, is_parallel, is_active)
    VALUES (v_provider, 'WL VERIFY INACTIVE', 30, 'private', 1, false, false) RETURNING id INTO sinact;
  INSERT INTO public.provider_sessions (provider_id, service_id, session_date, session_time)
    VALUES (v_provider, ssess, v_base + 39, '10:00');

  -- X performs everything (no rows), Y only S60, Z is inactive.
  INSERT INTO public.provider_staff (provider_id, name) VALUES (v_provider, 'WL VERIFY X') RETURNING id INTO sx;
  INSERT INTO public.provider_staff (provider_id, name) VALUES (v_provider, 'WL VERIFY Y') RETURNING id INTO sy;
  INSERT INTO public.provider_staff (provider_id, name, is_active) VALUES (v_provider, 'WL VERIFY Z', false) RETURNING id INTO sz;
  INSERT INTO public.provider_staff_services (provider_id, staff_id, service_id) VALUES (v_provider, sy, s60);

  -- Labels for readable set comparisons. Rows for anything else on DEV are
  -- ignored by the joins.
  CREATE TEMP TABLE wl_label (id text PRIMARY KEY, label text) ON COMMIT DROP;

  -- ── Q. Quiet hours at fixed instants (winter, summer, DST night) ──────────
  IF (SELECT is_quiet FROM public.waitlist_quiet_window(timestamp '2026-11-05 21:59' AT TIME ZONE 'Asia/Jerusalem'))
     OR NOT (SELECT is_quiet FROM public.waitlist_quiet_window(timestamp '2026-11-05 22:00' AT TIME ZONE 'Asia/Jerusalem'))
     OR NOT (SELECT is_quiet FROM public.waitlist_quiet_window(timestamp '2026-11-06 07:59' AT TIME ZONE 'Asia/Jerusalem'))
     OR (SELECT is_quiet FROM public.waitlist_quiet_window(timestamp '2026-11-06 08:00' AT TIME ZONE 'Asia/Jerusalem'))
  THEN
    RAISE EXCEPTION 'FAIL Q1 quiet boundaries 21:59/22:00/07:59/08:00';
  END IF;
  v_checks := v_checks + 1;

  SELECT quiet_ends_at INTO v_ts FROM public.waitlist_quiet_window(timestamp '2026-07-01 23:00' AT TIME ZONE 'Asia/Jerusalem');
  IF v_ts <> timestamptz '2026-07-02 05:00+00' THEN   -- 08:00 IDT = 05:00 UTC
    RAISE EXCEPTION 'FAIL Q2 summer quiet_ends_at: %', v_ts;
  END IF;
  SELECT quiet_ends_at INTO v_ts FROM public.waitlist_quiet_window(timestamp '2026-11-05 23:00' AT TIME ZONE 'Asia/Jerusalem');
  IF v_ts <> timestamptz '2026-11-06 06:00+00' THEN   -- 08:00 IST = 06:00 UTC
    RAISE EXCEPTION 'FAIL Q2 winter quiet_ends_at: %', v_ts;
  END IF;
  v_checks := v_checks + 1;

  -- DST starts 2027-03-26 02:00 → 03:00. 03:30 local is quiet; the window
  -- started 22:00 IST (20:00 UTC) and ends 08:00 IDT (05:00 UTC).
  IF NOT EXISTS (SELECT 1 FROM public.waitlist_quiet_window(timestamptz '2027-03-26 00:30+00') q
                  WHERE q.is_quiet
                    AND q.quiet_started_at = timestamptz '2027-03-25 20:00+00'
                    AND q.quiet_ends_at    = timestamptz '2027-03-26 05:00+00') THEN
    RAISE EXCEPTION 'FAIL Q3 DST night window';
  END IF;
  v_checks := v_checks + 1;

  -- ── G. Event age anchor (now = 10:00 on 2026-11-06, Israel) ───────────────
  v_ts := timestamp '2026-11-06 10:00' AT TIME ZONE 'Asia/Jerusalem';
  IF public.waitlist_event_age_anchor(timestamp '2026-11-05 23:00' AT TIME ZONE 'Asia/Jerusalem', v_ts)
       <> timestamp '2026-11-06 08:00' AT TIME ZONE 'Asia/Jerusalem'
     OR public.waitlist_event_age_anchor(timestamp '2026-11-05 21:45' AT TIME ZONE 'Asia/Jerusalem', v_ts)
       <> timestamp '2026-11-06 08:00' AT TIME ZONE 'Asia/Jerusalem'
     OR public.waitlist_event_age_anchor(timestamp '2026-11-05 21:20' AT TIME ZONE 'Asia/Jerusalem', v_ts)
       <> timestamp '2026-11-05 21:20' AT TIME ZONE 'Asia/Jerusalem'
     OR public.waitlist_event_age_anchor(timestamp '2026-11-06 09:50' AT TIME ZONE 'Asia/Jerusalem', v_ts)
       <> timestamp '2026-11-06 09:50' AT TIME ZONE 'Asia/Jerusalem'
  THEN
    RAISE EXCEPTION 'FAIL G1 age anchor (23:00→08:00, 21:45→08:00, 21:20 kept, 09:50 kept)';
  END IF;
  v_checks := v_checks + 1;

  -- ── C. waitlist_claim_events: closes, leases, skips live leases ───────────
  IF (SELECT count(*) FROM public.waitlist_events WHERE processed_at IS NULL) > 900 THEN
    RAISE EXCEPTION 'INCONCLUSIVE: DEV outbox has >900 unprocessed events; step 1 might not reach the test rows';
  END IF;

  INSERT INTO public.waitlist_events (provider_id, booking_date, booking_time, staff_id, service_ids, old_status, change_kind)
    VALUES (v_provider, v_base, '10:00', sx, ARRAY[s30], 'confirmed', 'deactivated') RETURNING id INTO e1;  -- ok
  INSERT INTO public.waitlist_events (provider_id, booking_date, booking_time, staff_id, service_ids, old_status, change_kind)
    VALUES (v_provider, v_base, 'xx', sx, ARRAY[s30], 'confirmed', 'deactivated') RETURNING id INTO e2;    -- malformed
  INSERT INTO public.waitlist_events (provider_id, booking_date, booking_time, staff_id, service_ids, old_status, change_kind, created_at)
    VALUES (v_provider, v_base, '10:00', sx, ARRAY[s30], 'confirmed', 'deactivated', now() - interval '2 days') RETURNING id INTO e3; -- stale
  INSERT INTO public.waitlist_events (provider_id, booking_date, booking_time, staff_id, service_ids, old_status, change_kind)
    VALUES (v_provider, v_today - 1, '10:00', sx, ARRAY[s30], 'confirmed', 'deactivated') RETURNING id INTO e4; -- past
  INSERT INTO public.waitlist_events (provider_id, booking_date, booking_time, staff_id, service_ids, old_status, change_kind)
    VALUES (gen_random_uuid(), v_base, '10:00', NULL, ARRAY[s30], 'confirmed', 'deactivated') RETURNING id INTO e5; -- provider_off
  INSERT INTO public.waitlist_events (provider_id, booking_date, booking_time, staff_id, service_ids, old_status, change_kind)
    VALUES (v_provider, v_base, '10:00', NULL, ARRAY[sgroup], 'confirmed', 'deactivated') RETURNING id INTO e6; -- group
  INSERT INTO public.waitlist_events (provider_id, booking_date, booking_time, staff_id, service_ids, old_status, change_kind, attempts)
    VALUES (v_provider, v_base, '10:00', sx, ARRAY[s30], 'confirmed', 'deactivated', 3) RETURNING id INTO e7;  -- gave_up
  INSERT INTO public.waitlist_events (provider_id, booking_date, booking_time, staff_id, service_ids, old_status, change_kind, claimed_at, attempts)
    VALUES (v_provider, v_base, '10:00', sx, ARRAY[s30], 'confirmed', 'deactivated', now() - interval '1 minute', 1) RETURNING id INTO e8;  -- live lease
  INSERT INTO public.waitlist_events (provider_id, booking_date, booking_time, staff_id, service_ids, old_status, change_kind, claimed_at, attempts)
    VALUES (v_provider, v_base, '10:00', sx, ARRAY[ssess], 'confirmed', 'deactivated', now() - interval '10 minutes', 1) RETURNING id INTO e9;  -- expired lease, but session service

  SELECT array_agg(id ORDER BY id) INTO v_ids FROM public.waitlist_claim_events(1000);

  IF NOT (e1 = ANY (v_ids)) OR e8 = ANY (v_ids) OR e9 = ANY (v_ids) THEN
    RAISE EXCEPTION 'FAIL C1 lease set: e1 returned=% e8(live lease) returned=% e9 returned=%',
      e1 = ANY (v_ids), e8 = ANY (v_ids), e9 = ANY (v_ids);
  END IF;
  v_checks := v_checks + 1;

  SELECT string_agg(id::text || '=' || coalesce(outcome, 'NULL'), ',' ORDER BY id) INTO v_got
    FROM public.waitlist_events WHERE id IN (e2, e3, e4, e5, e6, e7, e9);
  IF v_got <> format('%s=malformed,%s=stale,%s=past,%s=provider_off,%s=group,%s=gave_up,%s=group',
                     e2, e3, e4, e5, e6, e7, e9) THEN
    RAISE EXCEPTION 'FAIL C2 close outcomes: %', v_got;
  END IF;
  v_checks := v_checks + 1;

  IF NOT EXISTS (SELECT 1 FROM public.waitlist_events
                  WHERE id = e1 AND processed_at IS NULL AND claimed_at = now() AND attempts = 1)
     OR NOT EXISTS (SELECT 1 FROM public.waitlist_events
                     WHERE id = e8 AND processed_at IS NULL AND attempts = 1
                       AND claimed_at = now() - interval '1 minute') THEN
    RAISE EXCEPTION 'FAIL C3 lease bookkeeping (e1 leased once; e8 untouched)';
  END IF;
  v_checks := v_checks + 1;

  -- A second call in the same transaction must not hand e1 out again.
  SELECT array_agg(id) INTO v_ids FROM public.waitlist_claim_events(1000);
  IF e1 = ANY (coalesce(v_ids, '{}')) THEN
    RAISE EXCEPTION 'FAIL C4 e1 leased twice';
  END IF;
  v_checks := v_checks + 1;

  -- ── W. Matching: time-of-day windows (day base+1) ─────────────────────────
  INSERT INTO public.waitlist_entries (user_id, provider_id, entry_date, service_id, wants_afternoon)
    VALUES (u1, v_provider, v_base + 1, s30, true) RETURNING id INTO w1;
  INSERT INTO public.waitlist_entries (user_id, provider_id, entry_date, service_id, wants_morning)
    VALUES (u2, v_provider, v_base + 1, s30, true) RETURNING id INTO w2;
  INSERT INTO public.waitlist_entries (user_id, provider_id, entry_date, service_id, wants_evening)
    VALUES (u3, v_provider, v_base + 1, s30, true) RETURNING id INTO w3;
  INSERT INTO wl_label VALUES (w1::text, 'aft'), (w2::text, 'morn'), (w3::text, 'eve');

  INSERT INTO public.waitlist_events (provider_id, booking_date, booking_time, staff_id, service_ids, old_status, change_kind)
    VALUES (v_provider, v_base + 1, '11:59', sx, ARRAY[s30], 'confirmed', 'deactivated') RETURNING id INTO e1;
  INSERT INTO public.waitlist_events (provider_id, booking_date, booking_time, staff_id, service_ids, old_status, change_kind)
    VALUES (v_provider, v_base + 1, '12:00', sx, ARRAY[s30], 'confirmed', 'deactivated') RETURNING id INTO e2;
  INSERT INTO public.waitlist_events (provider_id, booking_date, booking_time, staff_id, service_ids, old_status, change_kind)
    VALUES (v_provider, v_base + 1, '16:59', sx, ARRAY[s30], 'confirmed', 'deactivated') RETURNING id INTO e3;
  INSERT INTO public.waitlist_events (provider_id, booking_date, booking_time, staff_id, service_ids, old_status, change_kind)
    VALUES (v_provider, v_base + 1, '17:00', sx, ARRAY[s30], 'confirmed', 'deactivated') RETURNING id INTO e4;
  INSERT INTO wl_label VALUES (e1::text, '1159'), (e2::text, '1200'), (e3::text, '1659'), (e4::text, '1700');

  SELECT string_agg(le.label || ':' || lv.label, ',' ORDER BY le.label, lv.label) INTO v_got
    FROM public.waitlist_candidates(ARRAY[e1, e2, e3, e4]) c
    JOIN wl_label le ON le.id = c.entry_id::text
    JOIN wl_label lv ON lv.id = c.event_id::text;
  IF v_got IS DISTINCT FROM 'aft:1200,aft:1659,eve:1700,morn:1159' THEN
    RAISE EXCEPTION 'FAIL W1 windows: %', v_got;
  END IF;
  v_checks := v_checks + 1;

  -- The returned row carries the slot, the lane and the next round.
  IF NOT EXISTS (SELECT 1 FROM public.waitlist_candidates(ARRAY[e2]) c
                  WHERE c.entry_id = w1 AND c.slot_date = v_base + 1 AND c.slot_time = '12:00'
                    AND c.staff_lane = sx AND c.service_id = s30 AND c.service_duration = 30
                    AND c.next_round = 1) THEN
    RAISE EXCEPTION 'FAIL W2 candidate row contents';
  END IF;
  v_checks := v_checks + 1;

  -- ── D. Duration: entry for S60 needs a freed booking of >= 60 minutes ─────
  INSERT INTO public.waitlist_entries (user_id, provider_id, entry_date, service_id, wants_morning, wants_afternoon, wants_evening)
    VALUES (u1, v_provider, v_base + 2, s60, true, true, true) RETURNING id INTO w1;
  INSERT INTO wl_label VALUES (w1::text, 'w60');
  INSERT INTO public.waitlist_events (provider_id, booking_date, booking_time, staff_id, service_ids, old_status, change_kind)
    VALUES (v_provider, v_base + 2, '10:00', sx, ARRAY[s30], 'confirmed', 'deactivated') RETURNING id INTO e1;
  INSERT INTO public.waitlist_events (provider_id, booking_date, booking_time, staff_id, service_ids, duration_override, old_status, change_kind)
    VALUES (v_provider, v_base + 2, '11:00', sx, ARRAY[s30], 60, 'confirmed', 'deactivated') RETURNING id INTO e2;
  INSERT INTO public.waitlist_events (provider_id, booking_date, booking_time, staff_id, service_ids, old_status, change_kind)
    VALUES (v_provider, v_base + 2, '13:00', sx, ARRAY[s30, s60], 'confirmed', 'deactivated') RETURNING id INTO e3;
  INSERT INTO wl_label VALUES (e1::text, 'd30'), (e2::text, 'd30ovr60'), (e3::text, 'd90');

  SELECT string_agg(lv.label, ',' ORDER BY lv.label) INTO v_got
    FROM public.waitlist_candidates(ARRAY[e1, e2, e3]) c
    JOIN wl_label lv ON lv.id = c.event_id::text
   WHERE c.entry_id = w1;
  IF v_got IS DISTINCT FROM 'd30ovr60,d90' THEN
    RAISE EXCEPTION 'FAIL D1 duration rule: %', v_got;
  END IF;
  v_checks := v_checks + 1;

  -- ── T. Staff rules (day base+3) ───────────────────────────────────────────
  INSERT INTO public.waitlist_entries (user_id, provider_id, entry_date, service_id, staff_id, wants_morning, wants_afternoon, wants_evening)
    VALUES (u1, v_provider, v_base + 3, s30, sx, true, true, true) RETURNING id INTO w1;
  INSERT INTO public.waitlist_entries (user_id, provider_id, entry_date, service_id, wants_morning, wants_afternoon, wants_evening)
    VALUES (u2, v_provider, v_base + 3, s30, true, true, true) RETURNING id INTO w2;
  INSERT INTO wl_label VALUES (w1::text, 'namedX'), (w2::text, 'anyone');
  INSERT INTO public.waitlist_events (provider_id, booking_date, booking_time, staff_id, service_ids, old_status, change_kind)
    VALUES (v_provider, v_base + 3, '09:00', sx, ARRAY[s30], 'confirmed', 'deactivated') RETURNING id INTO e1;
  INSERT INTO public.waitlist_events (provider_id, booking_date, booking_time, staff_id, service_ids, old_status, change_kind)
    VALUES (v_provider, v_base + 3, '10:00', sy, ARRAY[s30], 'confirmed', 'deactivated') RETURNING id INTO e2;
  INSERT INTO public.waitlist_events (provider_id, booking_date, booking_time, staff_id, service_ids, old_status, change_kind)
    VALUES (v_provider, v_base + 3, '11:00', sz, ARRAY[s30], 'confirmed', 'deactivated') RETURNING id INTO e3;
  INSERT INTO public.waitlist_events (provider_id, booking_date, booking_time, staff_id, service_ids, old_status, change_kind)
    VALUES (v_provider, v_base + 3, '12:00', NULL, ARRAY[s30], 'confirmed', 'deactivated') RETURNING id INTO e4;
  INSERT INTO wl_label VALUES (e1::text, 'X'), (e2::text, 'Y-not-s30'), (e3::text, 'Z-inactive'), (e4::text, 'nostaff');

  SELECT string_agg(le.label || ':' || lv.label, ',' ORDER BY le.label, lv.label) INTO v_got
    FROM public.waitlist_candidates(ARRAY[e1, e2, e3, e4]) c
    JOIN wl_label le ON le.id = c.entry_id::text
    JOIN wl_label lv ON lv.id = c.event_id::text;
  IF v_got IS DISTINCT FROM 'anyone:X,namedX:X' THEN
    RAISE EXCEPTION 'FAIL T1 staff rules with staff enabled: %', v_got;
  END IF;
  v_checks := v_checks + 1;

  -- Staff turned off: the booking page has no staff step, every booking is
  -- NULL-lane. Only "anyone" + a no-staff freed booking matches.
  UPDATE public.provider_profiles SET staff_enabled = false WHERE id = v_provider;
  SELECT string_agg(le.label || ':' || lv.label, ',' ORDER BY le.label, lv.label) INTO v_got
    FROM public.waitlist_candidates(ARRAY[e1, e2, e3, e4]) c
    JOIN wl_label le ON le.id = c.entry_id::text
    JOIN wl_label lv ON lv.id = c.event_id::text;
  IF v_got IS DISTINCT FROM 'anyone:nostaff' THEN
    RAISE EXCEPTION 'FAIL T2 zero-staff path: %', v_got;
  END IF;
  UPDATE public.provider_profiles SET staff_enabled = true WHERE id = v_provider;
  v_checks := v_checks + 1;

  -- ── S. Service eligibility: inactive and session services never match ─────
  INSERT INTO public.waitlist_entries (user_id, provider_id, entry_date, service_id, wants_morning, wants_afternoon, wants_evening)
    VALUES (u1, v_provider, v_base + 4, sinact, true, true, true) RETURNING id INTO w1;
  INSERT INTO public.waitlist_entries (user_id, provider_id, entry_date, service_id, wants_morning, wants_afternoon, wants_evening)
    VALUES (u2, v_provider, v_base + 4, ssess, true, true, true) RETURNING id INTO w2;
  INSERT INTO public.waitlist_events (provider_id, booking_date, booking_time, staff_id, service_ids, old_status, change_kind)
    VALUES (v_provider, v_base + 4, '10:00', sx, ARRAY[s30], 'confirmed', 'deactivated') RETURNING id INTO e1;
  SELECT count(*) INTO v_n FROM public.waitlist_candidates(ARRAY[e1]) c WHERE c.entry_id IN (w1, w2);
  IF v_n <> 0 THEN RAISE EXCEPTION 'FAIL S1 inactive/session service matched (% rows)', v_n; END IF;
  v_checks := v_checks + 1;

  -- ── R. Rounds: cap of 2, 60 minutes apart ─────────────────────────────────
  INSERT INTO public.waitlist_entries (user_id, provider_id, entry_date, service_id, wants_morning, wants_afternoon, wants_evening)
    VALUES (u1, v_provider, v_base + 5, s30, true, true, true) RETURNING id INTO w1;
  INSERT INTO public.waitlist_events (provider_id, booking_date, booking_time, staff_id, service_ids, old_status, change_kind)
    VALUES (v_provider, v_base + 5, '10:00', sx, ARRAY[s30], 'confirmed', 'deactivated') RETURNING id INTO e1;

  UPDATE public.waitlist_entries SET notify_count = 1, last_notified_at = now() - interval '30 minutes' WHERE id = w1;
  SELECT count(*) INTO v_n FROM public.waitlist_candidates(ARRAY[e1]) WHERE entry_id = w1;
  IF v_n <> 0 THEN RAISE EXCEPTION 'FAIL R1 matched 30 minutes after round 1'; END IF;
  v_checks := v_checks + 1;

  UPDATE public.waitlist_entries SET last_notified_at = now() - interval '61 minutes' WHERE id = w1;
  SELECT max(next_round) INTO v_n FROM public.waitlist_candidates(ARRAY[e1]) WHERE entry_id = w1;
  IF v_n IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'FAIL R2 expected next_round 2 after 61 minutes, got %', v_n; END IF;
  v_checks := v_checks + 1;

  UPDATE public.waitlist_entries SET notify_count = 2 WHERE id = w1;
  SELECT count(*) INTO v_n FROM public.waitlist_candidates(ARRAY[e1]) WHERE entry_id = w1;
  IF v_n <> 0 THEN RAISE EXCEPTION 'FAIL R3 matched after round 2'; END IF;
  v_checks := v_checks + 1;

  -- ── K. Already booked that day (as booker, and as a linked walk-in) ───────
  INSERT INTO public.waitlist_entries (user_id, provider_id, entry_date, service_id, wants_morning, wants_afternoon, wants_evening)
    VALUES (u1, v_provider, v_base + 6, s30, true, true, true) RETURNING id INTO w1;
  INSERT INTO public.waitlist_entries (user_id, provider_id, entry_date, service_id, wants_morning, wants_afternoon, wants_evening)
    VALUES (u2, v_provider, v_base + 6, s30, true, true, true) RETURNING id INTO w2;
  INSERT INTO public.waitlist_entries (user_id, provider_id, entry_date, service_id, wants_morning, wants_afternoon, wants_evening)
    VALUES (u3, v_provider, v_base + 6, s30, true, true, true) RETURNING id INTO w3;
  INSERT INTO public.bookings (provider_id, user_id, service_ids, booking_date, booking_time, total_price, status, customer_name, staff_id)
    VALUES (v_provider, u1, ARRAY[s30], v_base + 6, '15:00', 0, 'confirmed', 'WAITLIST VERIFY', sx);
  INSERT INTO public.bookings (provider_id, linked_user_id, service_ids, booking_date, booking_time, total_price, status, customer_name, staff_id)
    VALUES (v_provider, u2, ARRAY[s30], v_base + 6, '16:00', 0, 'pending', 'WAITLIST VERIFY', sx);
  INSERT INTO public.waitlist_events (provider_id, booking_date, booking_time, staff_id, service_ids, old_status, change_kind)
    VALUES (v_provider, v_base + 6, '10:00', sx, ARRAY[s30], 'confirmed', 'deactivated') RETURNING id INTO e1;
  SELECT string_agg(CASE c.entry_id WHEN w1 THEN 'u1' WHEN w2 THEN 'u2' WHEN w3 THEN 'u3' END, ',' ORDER BY c.entry_id) INTO v_got
    FROM public.waitlist_candidates(ARRAY[e1]) c WHERE c.entry_id IN (w1, w2, w3);
  IF v_got IS DISTINCT FROM 'u3' THEN RAISE EXCEPTION 'FAIL K1 already-booked filter: %', v_got; END IF;
  v_checks := v_checks + 1;

  -- ── L. Lead time and the past (today, Israel) ─────────────────────────────
  INSERT INTO public.waitlist_entries (user_id, provider_id, entry_date, service_id, wants_morning, wants_afternoon, wants_evening)
    VALUES (u1, v_provider, v_today, s30, true, true, true) RETURNING id INTO w1;
  INSERT INTO public.waitlist_events (provider_id, booking_date, booking_time, staff_id, service_ids, old_status, change_kind)
    VALUES (v_provider, v_today, to_char(v_now_il - interval '60 minutes', 'HH24:MI'), sx, ARRAY[s30], 'confirmed', 'deactivated') RETURNING id INTO e1;
  INSERT INTO public.waitlist_events (provider_id, booking_date, booking_time, staff_id, service_ids, old_status, change_kind)
    VALUES (v_provider, v_today, to_char(v_now_il + interval '5 minutes', 'HH24:MI'), sx, ARRAY[s30], 'confirmed', 'deactivated') RETURNING id INTO e2;
  INSERT INTO public.waitlist_events (provider_id, booking_date, booking_time, staff_id, service_ids, old_status, change_kind)
    VALUES (v_provider, v_today, to_char(v_now_il + interval '60 minutes', 'HH24:MI'), sx, ARRAY[s30], 'confirmed', 'deactivated') RETURNING id INTO e3;
  SELECT string_agg(CASE c.event_id WHEN e1 THEN 'past' WHEN e2 THEN 'in_lead' WHEN e3 THEN 'ok' END, ',' ORDER BY c.event_id) INTO v_got
    FROM public.waitlist_candidates(ARRAY[e1, e2, e3]) c WHERE c.entry_id = w1;
  IF v_got IS DISTINCT FROM 'ok' THEN RAISE EXCEPTION 'FAIL L1 past/lead-time filter: %', v_got; END IF;
  v_checks := v_checks + 1;

  -- ── P. waitlist_slot_is_open vs the real trigger ──────────────────────────
  -- Each scenario on its own day: existing bookings (real INSERTs, walk-ins),
  -- then the question "S at 10:00 in lane L?" asked of both.
  FOR v_scn IN
    SELECT * FROM (VALUES
      -- tag,               day, existing service, existing staff, existing time, override, 2nd existing?, new service, lane, expect_open, expect_insert
      ('P1 empty day',        10, NULL::text, NULL::text, NULL::text, NULL::int, false, 's30',   'X',  true,  true),
      ('P2 same svc, X',      11, 's30',      'X',        '10:00',    NULL,      false, 's30',   'X',  false, false),
      ('P3 other svc, X',     12, 's60',      'X',        '09:30',    NULL,      false, 's30',   'X',  false, false),
      ('P4 other staff Y',    13, 's30',      'Y',        '10:00',    NULL,      false, 's30',   'X',  true,  true),
      ('P5 no-staff vs X',    14, 's30',      NULL,       '10:00',    NULL,      false, 's30',   'X',  false, true),   -- page stricter
      ('P6 X vs no lane',     15, 's30',      'X',        '10:00',    NULL,      false, 's30',   NULL, false, true),   -- page stricter
      ('P7 both parallel',    16, 'spar1',    'X',        '10:00',    NULL,      false, 'spar2', 'X',  true,  true),
      ('P8 cap 2, one in',    17, 'scap2',    'X',        '10:00',    NULL,      false, 'scap2', 'X',  true,  true),
      ('P9 cap 2, two in',    18, 'scap2',    'X',        '10:00',    NULL,      true,  'scap2', 'X',  false, false),
      ('P10 touching',        19, 's30',      'X',        '09:30',    NULL,      false, 's30',   'X',  true,  true),
      ('P11 override 90',     20, 's30',      'X',        '09:00',    90,        false, 's30',   'X',  false, false),
      ('P12 one parallel',    21, 's30',      'X',        '10:00',    NULL,      false, 'spar2', 'X',  false, false)
    ) AS t(tag, day, ex_svc, ex_staff, ex_time, ex_ovr, ex_twice, new_svc, lane, expect_open, expect_insert)
  LOOP
    IF v_scn.ex_svc IS NOT NULL THEN
      FOR v_n IN 1 .. CASE WHEN v_scn.ex_twice THEN 2 ELSE 1 END LOOP
        INSERT INTO public.bookings (provider_id, service_ids, booking_date, booking_time, total_price, status, customer_name, staff_id, duration_override)
        VALUES (v_provider,
                ARRAY[CASE v_scn.ex_svc WHEN 's30' THEN s30 WHEN 's60' THEN s60 WHEN 'spar1' THEN spar1 WHEN 'scap2' THEN scap2 END],
                v_base + v_scn.day, v_scn.ex_time, 0, 'confirmed', 'WAITLIST VERIFY',
                CASE v_scn.ex_staff WHEN 'X' THEN sx WHEN 'Y' THEN sy END,
                v_scn.ex_ovr);
      END LOOP;
    END IF;

    v_open := public.waitlist_slot_is_open(
      v_provider, v_base + v_scn.day, '10:00',
      CASE v_scn.new_svc WHEN 's30' THEN s30 WHEN 'spar2' THEN spar2 WHEN 'scap2' THEN scap2 END,
      CASE v_scn.lane WHEN 'X' THEN sx END);

    -- The probe INSERT always ends by raising, which undoes it; the message
    -- tells us whether the trigger accepted it.
    BEGIN
      INSERT INTO public.bookings (provider_id, service_ids, booking_date, booking_time, total_price, status, customer_name, staff_id)
      VALUES (v_provider,
              ARRAY[CASE v_scn.new_svc WHEN 's30' THEN s30 WHEN 'spar2' THEN spar2 WHEN 'scap2' THEN scap2 END],
              v_base + v_scn.day, '10:00', 0, 'confirmed', 'WAITLIST VERIFY PROBE',
              CASE v_scn.lane WHEN 'X' THEN sx END);
      RAISE EXCEPTION 'WL_PROBE_ACCEPTED';
    EXCEPTION WHEN OTHERS THEN
      v_ins := (SQLERRM = 'WL_PROBE_ACCEPTED');
      v_err := SQLERRM;
    END;

    IF v_open AND NOT v_ins THEN
      RAISE EXCEPTION 'FAIL %: slot_is_open said OPEN but the trigger rejected the booking (%)', v_scn.tag, v_err;
    END IF;
    IF v_open IS DISTINCT FROM v_scn.expect_open OR v_ins IS DISTINCT FROM v_scn.expect_insert THEN
      RAISE EXCEPTION 'FAIL %: open=% (expected %), insert=% (expected %; %)',
        v_scn.tag, v_open, v_scn.expect_open, v_ins, v_scn.expect_insert, v_err;
    END IF;
    v_checks := v_checks + 1;
  END LOOP;

  -- ── CR. waitlist_claim_round (day base+30) ────────────────────────────────
  INSERT INTO public.waitlist_entries (user_id, provider_id, entry_date, service_id, wants_morning, wants_afternoon, wants_evening)
    VALUES (u1, v_provider, v_base + 30, s30, true, true, true) RETURNING id INTO w1;
  INSERT INTO public.waitlist_entries (user_id, provider_id, entry_date, service_id, wants_morning, wants_afternoon, wants_evening)
    VALUES (u2, v_provider, v_base + 30, s30, true, true, true) RETURNING id INTO w2;
  INSERT INTO public.waitlist_entries (user_id, provider_id, entry_date, service_id, wants_morning, wants_afternoon, wants_evening)
    VALUES (u3, v_provider, v_base + 30, s30, true, true, true) RETURNING id INTO w3;
  INSERT INTO public.waitlist_events (provider_id, booking_date, booking_time, staff_id, service_ids, old_status, change_kind)
    VALUES (v_provider, v_base + 30, '10:00', sx, ARRAY[s30], 'confirmed', 'deactivated') RETURNING id INTO e1;

  -- CR1 success: ledger row 'sending', entry advanced.
  SELECT log_id, reason INTO v_log, v_reason
    FROM public.waitlist_claim_round(w1, 1::smallint, e1, NULL, '10:00', sx, '972500000000', 'waitlist_slot_available_hebrew', 'he');
  IF v_log IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.waitlist_send_log l
                     WHERE l.id = v_log AND l.waitlist_entry_id = w1 AND l.message_kind = 'waitlist_slot:1'
                       AND l.status = 'sending' AND l.event_id = e1 AND l.slot_date = v_base + 30
                       AND l.slot_time = '10:00' AND l.provider_id = v_provider)
     OR NOT EXISTS (SELECT 1 FROM public.waitlist_entries
                     WHERE id = w1 AND notify_count = 1 AND last_notified_at = now()) THEN
    RAISE EXCEPTION 'FAIL CR1 claim: log=% reason=%', v_log, v_reason;
  END IF;
  v_checks := v_checks + 1;

  -- CR2 same round again → ROUND_MISMATCH (the entry moved on).
  SELECT reason INTO v_reason FROM public.waitlist_claim_round(w1, 1::smallint, e1, NULL, '10:00', sx, NULL, NULL, NULL);
  IF v_reason IS DISTINCT FROM 'ROUND_MISMATCH' THEN RAISE EXCEPTION 'FAIL CR2: %', v_reason; END IF;
  v_checks := v_checks + 1;

  -- CR3 the ledger is the last word: rewind the entry, round 1 is still taken.
  UPDATE public.waitlist_entries SET notify_count = 0, last_notified_at = NULL WHERE id = w1;
  SELECT reason INTO v_reason FROM public.waitlist_claim_round(w1, 1::smallint, e1, NULL, '10:00', sx, NULL, NULL, NULL);
  IF v_reason IS DISTINCT FROM 'ALREADY_CLAIMED'
     OR NOT EXISTS (SELECT 1 FROM public.waitlist_entries WHERE id = w1 AND notify_count = 0) THEN
    RAISE EXCEPTION 'FAIL CR3: % (and the entry must be left unchanged)', v_reason;
  END IF;
  v_checks := v_checks + 1;

  -- CR4 round 2 too soon, then CR5 after 61 minutes with WhatsApp skipped.
  UPDATE public.waitlist_entries SET notify_count = 1, last_notified_at = now() - interval '10 minutes' WHERE id = w1;
  SELECT reason INTO v_reason FROM public.waitlist_claim_round(w1, 2::smallint, e1, NULL, '10:00', sx, NULL, NULL, NULL);
  IF v_reason IS DISTINCT FROM 'TOO_SOON' THEN RAISE EXCEPTION 'FAIL CR4: %', v_reason; END IF;
  v_checks := v_checks + 1;

  UPDATE public.waitlist_entries SET last_notified_at = now() - interval '61 minutes' WHERE id = w1;
  SELECT log_id, reason INTO v_log, v_reason
    FROM public.waitlist_claim_round(w1, 2::smallint, e1, NULL, '10:00', sx, NULL, NULL, NULL, 'NO_NAME');
  IF v_log IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.waitlist_send_log
                     WHERE id = v_log AND status = 'skipped' AND error_code = 'NO_NAME' AND message_kind = 'waitlist_slot:2')
     OR NOT EXISTS (SELECT 1 FROM public.waitlist_entries WHERE id = w1 AND notify_count = 2) THEN
    RAISE EXCEPTION 'FAIL CR5 skipped-WhatsApp claim: log=% reason=%', v_log, v_reason;
  END IF;
  v_checks := v_checks + 1;

  -- CR6 a round 3 is impossible.
  SELECT reason INTO v_reason FROM public.waitlist_claim_round(w1, 3::smallint, e1, NULL, '10:00', sx, NULL, NULL, NULL);
  IF v_reason IS DISTINCT FROM 'ROUND_MISMATCH' THEN RAISE EXCEPTION 'FAIL CR6 round 3: %', v_reason; END IF;
  v_checks := v_checks + 1;

  -- CR7 someone booked the slot → SLOT_TAKEN, nothing written.
  INSERT INTO public.bookings (provider_id, service_ids, booking_date, booking_time, total_price, status, customer_name, staff_id)
    VALUES (v_provider, ARRAY[s30], v_base + 30, '10:00', 0, 'confirmed', 'WAITLIST VERIFY', sx);
  SELECT log_id, reason INTO v_log, v_reason FROM public.waitlist_claim_round(w2, 1::smallint, e1, NULL, '10:00', sx, NULL, NULL, NULL);
  IF v_reason IS DISTINCT FROM 'SLOT_TAKEN' OR v_log IS NOT NULL
     OR EXISTS (SELECT 1 FROM public.waitlist_send_log WHERE waitlist_entry_id = w2)
     OR NOT EXISTS (SELECT 1 FROM public.waitlist_entries WHERE id = w2 AND notify_count = 0) THEN
    RAISE EXCEPTION 'FAIL CR7 slot taken: %', v_reason;
  END IF;
  v_checks := v_checks + 1;

  -- CR8 the customer booked something that day → ALREADY_BOOKED.
  INSERT INTO public.bookings (provider_id, user_id, service_ids, booking_date, booking_time, total_price, status, customer_name, staff_id)
    VALUES (v_provider, u3, ARRAY[s30], v_base + 30, '15:00', 0, 'confirmed', 'WAITLIST VERIFY', sx);
  SELECT reason INTO v_reason FROM public.waitlist_claim_round(w3, 1::smallint, e1, NULL, '11:00', sx, NULL, NULL, NULL);
  IF v_reason IS DISTINCT FROM 'ALREADY_BOOKED' THEN RAISE EXCEPTION 'FAIL CR8: %', v_reason; END IF;
  v_checks := v_checks + 1;

  -- CR9 provider switched off → PROVIDER_OFF.
  UPDATE public.provider_profiles SET waitlist_enabled = false WHERE id = v_provider;
  SELECT reason INTO v_reason FROM public.waitlist_claim_round(w2, 1::smallint, e1, NULL, '11:00', sx, NULL, NULL, NULL);
  UPDATE public.provider_profiles SET waitlist_enabled = true WHERE id = v_provider;
  IF v_reason IS DISTINCT FROM 'PROVIDER_OFF' THEN RAISE EXCEPTION 'FAIL CR9: %', v_reason; END IF;
  v_checks := v_checks + 1;

  -- CR10 left the list → ENTRY_INACTIVE.
  UPDATE public.waitlist_entries SET status = 'left', ended_at = now() WHERE id = w2;
  SELECT reason INTO v_reason FROM public.waitlist_claim_round(w2, 1::smallint, e1, NULL, '11:00', sx, NULL, NULL, NULL);
  IF v_reason IS DISTINCT FROM 'ENTRY_INACTIVE' THEN RAISE EXCEPTION 'FAIL CR10: %', v_reason; END IF;
  v_checks := v_checks + 1;

  -- CR11 inside the lead time today → TOO_LATE.
  INSERT INTO public.waitlist_entries (user_id, provider_id, entry_date, service_id, wants_morning, wants_afternoon, wants_evening)
    VALUES (u2, v_provider, v_today, s30, true, true, true) RETURNING id INTO w4;
  SELECT reason INTO v_reason
    FROM public.waitlist_claim_round(w4, 1::smallint, e1, NULL, to_char(v_now_il + interval '5 minutes', 'HH24:MI'), sx, NULL, NULL, NULL);
  IF v_reason IS DISTINCT FROM 'TOO_LATE' THEN RAISE EXCEPTION 'FAIL CR11: %', v_reason; END IF;
  v_checks := v_checks + 1;

  -- ── H. Housekeeping ───────────────────────────────────────────────────────
  INSERT INTO public.waitlist_entries (user_id, provider_id, entry_date, service_id, wants_morning)
    VALUES (u3, v_provider, v_today - 1, s30, true) RETURNING id INTO w1;                -- past → expired
  INSERT INTO public.waitlist_entries (user_id, provider_id, entry_date, service_id, wants_morning)
    VALUES (u1, v_provider, v_base + 31, s30, true) RETURNING id INTO w2;                -- booked → fulfilled
  INSERT INTO public.waitlist_entries (user_id, provider_id, entry_date, service_id, wants_morning)
    VALUES (u2, v_provider, v_base + 32, s30, true) RETURNING id INTO w3;                -- linked walk-in → fulfilled
  INSERT INTO public.waitlist_entries (user_id, provider_id, entry_date, service_id, wants_morning)
    VALUES (u3, v_provider, v_base + 33, s30, true) RETURNING id INTO w4;                -- untouched
  INSERT INTO public.bookings (provider_id, user_id, service_ids, booking_date, booking_time, total_price, status, customer_name, staff_id)
    VALUES (v_provider, u1, ARRAY[s30], v_base + 31, '10:00', 0, 'confirmed', 'WAITLIST VERIFY', sx);
  INSERT INTO public.bookings (provider_id, linked_user_id, service_ids, booking_date, booking_time, total_price, status, customer_name, staff_id)
    VALUES (v_provider, u2, ARRAY[s30], v_base + 32, '10:00', 0, 'pending', 'WAITLIST VERIFY', sx);
  INSERT INTO public.bookings (provider_id, user_id, service_ids, booking_date, booking_time, total_price, status, customer_name, staff_id)
    VALUES (v_provider, u3, ARRAY[s30], v_base + 33, '10:00', 0, 'cancelled', 'WAITLIST VERIFY', sx);  -- cancelled ≠ booked
  INSERT INTO public.waitlist_events (provider_id, processed_at, outcome)
    VALUES (v_provider, now() - interval '31 days', 'no_match') RETURNING id INTO e1;   -- purged
  INSERT INTO public.waitlist_events (provider_id, processed_at, outcome)
    VALUES (v_provider, now() - interval '29 days', 'no_match') RETURNING id INTO e2;   -- kept

  PERFORM * FROM public.waitlist_housekeeping();

  SELECT string_agg(x.s, ',' ORDER BY x.s) INTO v_got
    FROM (SELECT CASE id WHEN w1 THEN 'past' WHEN w2 THEN 'booked' WHEN w3 THEN 'linked' WHEN w4 THEN 'cancelled' END
                 || '=' || status || ':' || (ended_at IS NOT NULL)::text AS s
            FROM public.waitlist_entries WHERE id IN (w1, w2, w3, w4)) x;
  IF v_got IS DISTINCT FROM 'booked=fulfilled:true,cancelled=active:false,linked=fulfilled:true,past=expired:true' THEN
    RAISE EXCEPTION 'FAIL H1 entry housekeeping: %', v_got;
  END IF;
  v_checks := v_checks + 1;

  IF EXISTS (SELECT 1 FROM public.waitlist_events WHERE id = e1)
     OR NOT EXISTS (SELECT 1 FROM public.waitlist_events WHERE id = e2) THEN
    RAISE EXCEPTION 'FAIL H2 purge (31 days gone, 29 days kept)';
  END IF;
  v_checks := v_checks + 1;

  -- ── Done. Roll everything back. ────────────────────────────────────────────
  RAISE EXCEPTION 'PASS: all % checks passed (expected 44). This error is deliberate — it rolled back every test service, staff member, entry, event, booking and ledger row. Nothing was persisted.', v_checks;
END
$verify$;

-- B-after. Confirm nothing persisted. Expect 0, 0, 0, and the provider's
-- waitlist_enabled / staff_enabled / min_lead_time_minutes as they were.
SELECT count(*) AS leftover_test_bookings FROM public.bookings WHERE customer_name LIKE 'WAITLIST VERIFY%';
SELECT count(*) AS leftover_test_services FROM public.provider_services WHERE name LIKE 'WL VERIFY%';
SELECT count(*) AS leftover_test_staff    FROM public.provider_staff    WHERE name LIKE 'WL VERIFY%';


-- ═════════════════════════════════════════════════════════════════════════════
-- §C. END-TO-END — DEV ONLY, through the deployed function and the real app
-- ═════════════════════════════════════════════════════════════════════════════
-- Prerequisites:
--   * waitlist-dispatch deployed to DEV:
--       supabase functions deploy waitlist-dispatch --project-ref ovpfljqlfzxjfcbrtwra
--   * DEV secrets (supabase secrets list --project-ref ovpfljqlfzxjfcbrtwra):
--       CRON_SECRET, SENDPULSE_CLIENT_ID + SENDPULSE_CLIENT_SECRET (or the bare
--       client_id/client_secret), SENDPULSE_BOT_ID, VAPID_KEYS, and
--       WHATSAPP_WAITLIST_PHONES = the two test phones below (comma-separated).
--   * Daytime, Israel (08:00–22:00), or nothing is sent — by design.
--   * The cron is NOT scheduled yet: steps 1–9 call the function by hand, so
--     every run is one you started.
--
-- People:
--   provider P  — a DEV provider; customers A, B, D book with it.
--   A — allowlisted phone, display_name set, push enabled on a real phone
--       (Profile → notifications).
--   B — allowlisted phone, display_name set.
--   C — NOT allowlisted.
--   D — any other account; makes and cancels the bookings.
--
-- Manual run (bash; the JSON reply is the run summary):
--   curl -s -X POST https://ovpfljqlfzxjfcbrtwra.supabase.co/functions/v1/waitlist-dispatch \
--     -H "Authorization: Bearer <DEV_ANON_KEY>" -H "x-cron-secret: <DEV_CRON_SECRET>" \
--     -H "Content-Type: application/json" -d '{}'
--
--  #   Step                                                          Expect
--  ──  ────────────────────────────────────────────────────────────  ─────────────────────────────────────
--  1   Run with NO x-cron-secret header                              401; log "cron secret rejected"
--  2   Run with the secret                                           200 {"ok":true,"claimed":0,...}
--  3   SQL: UPDATE provider_profiles SET waitlist_enabled = true,
--      whatsapp_message_language = 'he' WHERE id = '<P>';
--      Insert entries for TOMORROW (the Phase 3 join RPC does not
--      exist yet), using a private service S of P:
--        A: anyone, afternoon, notify_lang 'he'
--        B: named staff member (or anyone if P has no staff),
--           morning only
--        C: anyone, all windows
--      INSERT INTO public.waitlist_entries (user_id, provider_id,
--        entry_date, service_id, staff_id, wants_morning,
--        wants_afternoon, wants_evening, notify_lang) VALUES (…);
--  4   D books S tomorrow at 14:00 in the app, then cancels it.      +1 event (Phase 1 C-check)
--  5   Run the function.                                             A: WhatsApp (Hebrew; date, 14:00,
--                                                                    business), button opens
--                                                                    /provider/<P>; bell row; push.
--                                                                    B: nothing (morning only).
--                                                                    C: nothing on any channel (not
--                                                                    allowlisted), no ledger row.
--      SQL: SELECT * FROM waitlist_send_log ORDER BY created_at DESC LIMIT 5;
--           → A, waitlist_slot:1, status sent, sendpulse_message_id set
--      SQL: SELECT id, outcome FROM waitlist_events ORDER BY id DESC LIMIT 3;
--           → notified:1
--  6   D books + cancels tomorrow 15:00 (within 60 min of step 5)    A: nothing (TOO_SOON); event
--      and runs the function.                                          outcome no_match
--  7   SQL: UPDATE waitlist_entries SET last_notified_at =
--      now() - interval '61 minutes' WHERE id = '<A entry>';
--      D books + cancels tomorrow 16:00; run.                        A: round 2 (waitlist_slot:2)
--      Repeat once more after another rewind.                        A: nothing — 2 rounds max
--  8   Slot taken: D books 13:00 and cancels; BEFORE running,        Nobody notified; event outcome
--      another account books 13:00. Run.                             no_match
--  9   Fulfilment: A books any slot tomorrow in the app. Run.        A's entry status = fulfilled
--  10  Provider off: SET waitlist_enabled = false; D cancels a       Event outcome provider_off; nothing
--      booking; run.                                                 sent. Turn it back on.
--  11  Group: cancel a booking of a group service of P; run.         Event outcome group
--  12  English bell: new entry for B with notify_lang 'en'; free a   B: WhatsApp in Hebrew (provider
--      morning slot; run.                                            language), bell + push in English
--  13  Arabic: ONLY after the Arabic template's URL button is        WhatsApp waitlist_slot_available_
--      confirmed. SET whatsapp_message_language = 'ar'; new entry      arabic, bell/push Arabic when
--      for B with notify_lang NULL; free a morning slot; run.          notify_lang is NULL
--  14  No phone: an account with no phone, WHATSAPP_WAITLIST_PHONES  Ledger row skipped / INVALID_PHONE;
--      temporarily '*'. Free a slot; run. Restore the allowlist.       bell + push still delivered
--  15  Schedule BOTH cron jobs (migration §10, DEV values), then     Within a minute: §A7 shows 200s;
--      §A6. D cancels another booking; do NOT run by hand.             the event is processed
--  16  Leave it 10 minutes with no cancellations.                    net._http_response gains no rows
--                                                                    (the EXISTS guard holds the cron)
--
-- Clean up afterwards: set the test entries to 'left' (ended_at = now()), turn
-- waitlist_enabled back off if P should not stay opted in.


-- ═════════════════════════════════════════════════════════════════════════════
-- §D. MONITORING (read-only)
-- ═════════════════════════════════════════════════════════════════════════════

-- D1. What happened to events, per day and outcome. Expect provider_off to
--     dominate while few providers are opted in. Any sustained 'gave_up' means
--     the function is crashing mid-run: read its logs.
SELECT processed_at::date AS day, outcome, count(*)
FROM public.waitlist_events
WHERE processed_at IS NOT NULL
GROUP BY 1, 2
ORDER BY 1 DESC, 2;

-- D2. Stuck work. Expect 0 rows older than a few minutes outside quiet hours.
SELECT id, created_at, claimed_at, attempts
FROM public.waitlist_events
WHERE processed_at IS NULL
ORDER BY id
LIMIT 20;

-- D3. Sends per day and status. A row stuck at 'sending' more than a few
--     minutes means the function died between claim and send: the customer
--     may or may not have the message — check SendPulse before touching it.
SELECT created_at::date AS day, status, error_code, count(*)
FROM public.waitlist_send_log
GROUP BY 1, 2, 3
ORDER BY 1 DESC, 2;

-- D4. Function logs: Dashboard → Edge Functions → waitlist-dispatch → Logs.
--     Every run logs one "run complete" line with counts and skip reasons.


-- ═════════════════════════════════════════════════════════════════════════════
-- §E. ROLLBACK — commented out.
-- ═════════════════════════════════════════════════════════════════════════════
-- Stop sending first (instant, keeps everything):
--   SELECT cron.unschedule('waitlist-dispatch-1min');
--   SELECT cron.unschedule('waitlist-housekeeping-15min');
-- Then delete the waitlist-dispatch function in the dashboard (or
-- `supabase functions delete waitlist-dispatch --project-ref <REF>`).
--
-- Full removal of this migration's objects. Phase 1 is untouched by this and
-- keeps capturing events.
--
-- BEGIN;
-- SET LOCAL lock_timeout = '3s';
-- DROP FUNCTION IF EXISTS public.waitlist_housekeeping();
-- DROP FUNCTION IF EXISTS public.waitlist_claim_round(uuid, smallint, bigint, uuid, text, uuid, text, text, text, text);
-- DROP FUNCTION IF EXISTS public.waitlist_candidates(bigint[]);
-- DROP FUNCTION IF EXISTS public.waitlist_slot_is_open(uuid, date, text, uuid, uuid);
-- DROP FUNCTION IF EXISTS public.waitlist_claim_events(integer);
-- DROP FUNCTION IF EXISTS public.waitlist_customer_has_booking(uuid, uuid, date);
-- DROP FUNCTION IF EXISTS public.waitlist_staff_performs(uuid, uuid, uuid);
-- DROP FUNCTION IF EXISTS public.waitlist_is_private_service(uuid, uuid, date);
-- DROP FUNCTION IF EXISTS public.waitlist_event_age_anchor(timestamptz, timestamptz);
-- DROP FUNCTION IF EXISTS public.waitlist_is_quiet_hours(timestamptz);
-- DROP FUNCTION IF EXISTS public.waitlist_quiet_window(timestamptz);
-- ALTER TABLE public.waitlist_entries DROP CONSTRAINT IF EXISTS waitlist_entries_notify_lang_check;
-- ALTER TABLE public.waitlist_entries DROP COLUMN IF EXISTS notify_lang;
-- COMMIT;
--
-- After rollback, re-run §0.2 (everything NULL again) and §0.3 (all four
-- fingerprints identical to the saved values).
