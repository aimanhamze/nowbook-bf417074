-- VERIFY / test plan for 20261103000001_waitlist_dispatch_hidden_provider.sql
--
-- ORDER:
--   §0  BEFORE the migration. REQUIRED. Read-only. Run on DEV, and again on PROD
--       before the prod apply. SAVE THE OUTPUT — §A compares against it.
--   §A  after the migration. Read-only. DEV and PROD.
--   §B  after the migration. Behaviour tests, all rolled back. DEV ONLY.
--   §C  optional, PROD: hide Test1 and cancel a booking — nothing is sent.
--   §D  ongoing monitoring.
--   §E  rollback script (commented out).
--
-- §B is DEV ONLY: it opts a provider in, hides and shows it, and writes (and
-- rolls back) a service, entries, outbox events and a ledger row. Its
-- waitlist_claim_events calls lock unprocessed outbox rows for the length of
-- the block. Harmless on DEV, not something to do to the live outbox.


-- ═════════════════════════════════════════════════════════════════════════════
-- §0. PRE-APPLY — RUN BEFORE THE MIGRATION. REQUIRED. READ-ONLY.
-- ═════════════════════════════════════════════════════════════════════════════

-- 0.1 DRIFT GATE. The three live function bodies are EXACTLY the Phase 2
--     file's (20261101000001_waitlist_dispatch.sql §4, §6, §7). CR characters
--     are stripped first, so a CRLF paste still matches.
--     Expect 3 rows, every "matches" = true.
--     ANY false: STOP. The live function is not what this migration assumes it
--     replaces — CREATE OR REPLACE would silently overwrite an unknown change.
--     Report the live_md5 and do not apply.
SELECT x.fn,
       md5(replace(p.prosrc, E'\r', '')) AS live_md5,
       x.expected_md5,
       md5(replace(p.prosrc, E'\r', '')) = x.expected_md5 AS matches
FROM (VALUES
  ('public.waitlist_claim_events(integer)',                                                         'cb61113ac2291ec8c1ff98ffa0163340'),
  ('public.waitlist_candidates(bigint[])',                                                          '82d1a7d351ab915303edbdd3880b82ac'),
  ('public.waitlist_claim_round(uuid, smallint, bigint, uuid, text, uuid, text, text, text, text)', '8805206caa774bc6142b0975fcdb7c40')
) AS x(fn, expected_md5)
LEFT JOIN pg_proc p ON p.oid = to_regprocedure(x.fn)
ORDER BY 1;

-- 0.2 provider_profiles.is_visible is what the admin switch writes and what
--     the new predicate reads. Expect 1 row:  is_visible | boolean | NO | true
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'provider_profiles' AND column_name = 'is_visible';

-- 0.3 RLS on provider_profiles — the one thing besides is_visible that could
--     hide a provider from the booking page. The repo has:
--       "Anyone can view provider profiles"      SELECT  PERMISSIVE  qual true
--       "Providers can view their own profile"   SELECT  PERMISSIVE  (auth.uid() = user_id)
--     plus INSERT/UPDATE/DELETE policies for providers and admins.
--     Expect relrowsecurity = true, relforcerowsecurity = false, and NO policy
--     with permissive = 'RESTRICTIVE' and no SELECT policy whose qual is
--     anything but true / own-row / admin. If there is one, STOP and report:
--     "available" would then mean more than is_visible, and this migration's
--     predicate would be incomplete.
SELECT relrowsecurity, relforcerowsecurity
FROM pg_class WHERE oid = 'public.provider_profiles'::regclass;

SELECT policyname, permissive, roles, cmd, qual
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'provider_profiles'
ORDER BY cmd, policyname;

-- 0.4 Fingerprints. SAVE ALL THREE RESULT SETS. §A2/§A3 must reproduce them.
--     (a) The three functions' attributes and grants — unchanged by this
--         migration. Expect 3 rows: prosecdef false, provolatile v / s / v
--         (claim_events / candidates / claim_round), proconfig
--         {"search_path=public, pg_temp"}.
SELECT p.oid::regprocedure AS fn, p.prosecdef, p.provolatile, p.proconfig, p.proacl
FROM pg_proc p
WHERE p.oid IN (to_regprocedure('public.waitlist_claim_events(integer)'),
                to_regprocedure('public.waitlist_candidates(bigint[])'),
                to_regprocedure('public.waitlist_claim_round(uuid, smallint, bigint, uuid, text, uuid, text, text, text, text)'))
ORDER BY 1;

--     (b) Every OTHER waitlist_ function (the eight other Phase 2 functions and
--         the Phase 1 capture function): body, config, security and grants.
--         Expect function_count = 9.
SELECT md5(string_agg(
         p.oid::regprocedure::text
         || '|' || md5(replace(p.prosrc, E'\r', ''))
         || '|' || coalesce(array_to_string(p.proconfig, ','), '')
         || '|' || p.prosecdef::text || '|' || p.provolatile::text
         || '|' || coalesce(p.proacl::text, ''),
         E'\n' ORDER BY p.oid::regprocedure::text)) AS other_waitlist_functions_fingerprint,
       count(*) AS function_count
FROM pg_proc p
WHERE p.pronamespace = 'public'::regnamespace
  AND p.proname LIKE 'waitlist\_%'
  AND p.proname NOT IN ('waitlist_claim_events', 'waitlist_candidates', 'waitlist_claim_round');

--     (c) EVERY bookings trigger and prevent_booking_conflicts — the same
--         queries as Phase 2 VERIFY §0.3 (a) and (b), so the values must also
--         equal the ones you saved then.
SELECT md5(string_agg(
         t.tgname || '|' || pg_get_triggerdef(t.oid) || '|' || md5(p.prosrc),
         E'\n' ORDER BY t.tgname)) AS bookings_triggers_fingerprint,
       count(*) AS trigger_count
FROM pg_trigger t
JOIN pg_proc p ON p.oid = t.tgfoid
WHERE t.tgrelid = 'public.bookings'::regclass
  AND NOT t.tgisinternal;

SELECT md5(prosrc) AS prevent_booking_conflicts_md5
FROM pg_proc WHERE oid = 'public.prevent_booking_conflicts()'::regprocedure;

-- 0.5 Who this changes anything for: opted-in providers that are hidden.
--     Informational. Expect on PROD: Test1 only, as an opted-in row; its
--     is_visible shows whether it is hidden right now.
SELECT p.id, p.business_name, p.waitlist_enabled, p.is_visible,
       (SELECT count(*) FROM public.waitlist_entries w
         WHERE w.provider_id = p.id AND w.status = 'active') AS active_entries
FROM public.provider_profiles p
WHERE p.waitlist_enabled OR NOT p.is_visible
ORDER BY p.waitlist_enabled DESC, p.business_name;


-- ═════════════════════════════════════════════════════════════════════════════
-- §A. OBJECT CHECKS — after the migration (read-only). DEV and PROD.
-- ═════════════════════════════════════════════════════════════════════════════

-- A1. The new bodies are exactly this file's, AND the only difference from the
--     Phase 2 bodies is the inserted text: deleting it gives back the Phase 2
--     md5. Expect 3 rows, new_matches = true AND only_insertion = true.
SELECT x.fn,
       md5(replace(p.prosrc, E'\r', '')) = x.new_md5 AS new_matches,
       md5(replace(replace(p.prosrc, E'\r', ''), x.inserted, '')) = x.old_md5 AS only_insertion
FROM (VALUES
  ('public.waitlist_claim_events(integer)',
     '274f5f2c610b4d127a83b1ef74087a16', 'cb61113ac2291ec8c1ff98ffa0163340', E'\n                                 AND p.is_visible IS TRUE'),
  ('public.waitlist_candidates(bigint[])',
     'fec38439e62c32f0a00cee6f5d142c54', '82d1a7d351ab915303edbdd3880b82ac', E'     AND p.is_visible IS TRUE\n'),
  ('public.waitlist_claim_round(uuid, smallint, bigint, uuid, text, uuid, text, text, text, text)',
     '93c7e310e8272a47f7b60404e376a9f3', '8805206caa774bc6142b0975fcdb7c40', E' AND p.is_visible IS TRUE')
) AS x(fn, new_md5, old_md5, inserted)
LEFT JOIN pg_proc p ON p.oid = to_regprocedure(x.fn)
ORDER BY 1;

-- A2. Attributes and grants unchanged. Re-run the §0.4(a) query: expect the
--     3 rows IDENTICAL to the saved output. And EXECUTE is service_role only:
--     expect 3 rows anon = false, authenticated = false, service_role = true.
SELECT p.oid::regprocedure AS fn,
       has_function_privilege('anon', p.oid, 'EXECUTE')          AS anon,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated,
       has_function_privilege('service_role', p.oid, 'EXECUTE')  AS service_role
FROM pg_proc p
WHERE p.oid IN (to_regprocedure('public.waitlist_claim_events(integer)'),
                to_regprocedure('public.waitlist_candidates(bigint[])'),
                to_regprocedure('public.waitlist_claim_round(uuid, smallint, bigint, uuid, text, uuid, text, text, text, text)'))
ORDER BY 1;

-- A3. Nothing else changed. Re-run §0.4(b) and §0.4(c): expect every value
--     IDENTICAL to the saved §0.4 output.


-- ═════════════════════════════════════════════════════════════════════════════
-- §B. BEHAVIOUR TESTS — DEV ONLY. PERSISTS NOTHING.
-- ═════════════════════════════════════════════════════════════════════════════
-- One DO block. It opts a DEV provider in (staff off), creates a service, two
-- entries and outbox events on a far-future day, then hides and shows the
-- provider and asserts what each of the three functions does.
--
-- ⚠  THE BLOCK ALWAYS ENDS IN AN ERROR. That is how it rolls itself back.
--      SUCCESS  = an error whose message starts with  "PASS:".
--      FAILURE  = an error starting "FAIL", "SETUP" or "INCONCLUSIVE", or any
--                 other error (report the message).
--
-- RUN IT BETWEEN 08:00 AND 21:30 ISRAEL TIME: waitlist_claim_events and
-- waitlist_claim_round do nothing / answer QUIET_HOURS in quiet hours by design.
--
-- SETUP: set v_provider below to a DEV provider_profiles.id. Any provider
-- works; its waitlist_enabled / staff_enabled / is_visible / lead time are
-- changed only inside the block. DEV needs at least two auth.users rows.

DO $verify$
DECLARE
  v_provider uuid := NULL;   -- ← SET THIS to a DEV provider_profiles.id

  v_checks integer := 0;
  v_now_il timestamp := now() AT TIME ZONE 'Asia/Jerusalem';
  v_today  date := (now() AT TIME ZONE 'Asia/Jerusalem')::date;
  v_base   date;
  u1 uuid; u2 uuid;
  s30 uuid;
  w1 uuid; w2 uuid;
  ev1 bigint; ev2 bigint; ev3 bigint; ev4 bigint;
  v_got text;
  v_n integer;
  v_log uuid;
  v_reason text;
BEGIN
  -- ── Setup ──────────────────────────────────────────────────────────────────
  IF v_provider IS NULL THEN
    RAISE EXCEPTION 'SETUP: set v_provider to a DEV provider id first';
  END IF;
  IF (SELECT md5(replace(prosrc, E'\r', '')) FROM pg_proc
       WHERE oid = to_regprocedure('public.waitlist_claim_round(uuid, smallint, bigint, uuid, text, uuid, text, text, text, text)'))
     IS DISTINCT FROM '93c7e310e8272a47f7b60404e376a9f3' THEN
    RAISE EXCEPTION 'SETUP: the migration is not applied (run §A1)';
  END IF;
  IF public.waitlist_is_quiet_hours() OR v_now_il::time > time '21:30' THEN
    RAISE EXCEPTION 'INCONCLUSIVE: run between 08:00 and 21:30 Israel time (now %)', v_now_il;
  END IF;
  IF (SELECT count(*) FROM public.waitlist_events WHERE processed_at IS NULL) > 900 THEN
    RAISE EXCEPTION 'INCONCLUSIVE: DEV outbox has >900 unprocessed events; claim_events might not reach the test rows';
  END IF;

  SELECT id INTO u1 FROM auth.users ORDER BY created_at, id LIMIT 1;
  SELECT id INTO u2 FROM auth.users ORDER BY created_at, id OFFSET 1 LIMIT 1;
  IF u2 IS NULL THEN RAISE EXCEPTION 'SETUP: DEV needs at least 2 auth.users rows'; END IF;

  UPDATE public.provider_profiles
     SET waitlist_enabled = true, staff_enabled = false, is_visible = true, min_lead_time_minutes = 15
   WHERE id = v_provider;
  IF NOT FOUND THEN RAISE EXCEPTION 'SETUP: provider % not found', v_provider; END IF;

  -- A far-future day with no bookings for this provider and no entries for the
  -- two users there.
  v_base := v_today + 730;
  WHILE EXISTS (SELECT 1 FROM public.bookings b
                 WHERE b.provider_id = v_provider AND b.booking_date = v_base)
     OR EXISTS (SELECT 1 FROM public.waitlist_entries w
                 WHERE w.provider_id = v_provider AND w.entry_date = v_base AND w.user_id IN (u1, u2))
  LOOP
    v_base := v_base + 1;
    IF v_base > v_today + 3000 THEN RAISE EXCEPTION 'SETUP: no free day found'; END IF;
  END LOOP;

  INSERT INTO public.provider_services (provider_id, name, duration, service_type, max_capacity, is_parallel)
    VALUES (v_provider, 'WL VERIFY 3A', 30, 'private', 1, false) RETURNING id INTO s30;

  INSERT INTO public.waitlist_entries (user_id, provider_id, entry_date, service_id, staff_id,
                                       wants_morning, wants_afternoon, wants_evening, notify_lang)
    VALUES (u1, v_provider, v_base, s30, NULL, true, true, true, 'he') RETURNING id INTO w1;
  INSERT INTO public.waitlist_entries (user_id, provider_id, entry_date, service_id, staff_id,
                                       wants_morning, wants_afternoon, wants_evening, notify_lang)
    VALUES (u2, v_provider, v_base, s30, NULL, true, true, true, 'en') RETURNING id INTO w2;

  -- ── V. Visible: behaves exactly as Phase 2 ─────────────────────────────────
  INSERT INTO public.waitlist_events (provider_id, booking_date, booking_time, staff_id, service_ids, old_status, change_kind)
    VALUES (v_provider, v_base, '10:00', NULL, ARRAY[s30], 'confirmed', 'deactivated') RETURNING id INTO ev1;

  PERFORM * FROM public.waitlist_claim_events(1000);
  IF NOT EXISTS (SELECT 1 FROM public.waitlist_events
                  WHERE id = ev1 AND processed_at IS NULL AND claimed_at IS NOT NULL AND outcome IS NULL) THEN
    RAISE EXCEPTION 'FAIL V1 visible provider: event should be leased, not closed';
  END IF;
  v_checks := v_checks + 1;

  SELECT string_agg(s.label, ',' ORDER BY s.label) INTO v_got
    FROM (SELECT CASE c.entry_id WHEN w1 THEN 'w1' WHEN w2 THEN 'w2' END AS label
            FROM public.waitlist_candidates(ARRAY[ev1]) c
           WHERE c.entry_id IN (w1, w2)) s;
  IF v_got IS DISTINCT FROM 'w1,w2' THEN
    RAISE EXCEPTION 'FAIL V2 visible provider: candidates should be w1,w2, got %', v_got;
  END IF;
  v_checks := v_checks + 1;

  -- ── H. Hidden: nothing reaches anyone ──────────────────────────────────────
  UPDATE public.provider_profiles SET is_visible = false WHERE id = v_provider;

  INSERT INTO public.waitlist_events (provider_id, booking_date, booking_time, staff_id, service_ids, old_status, change_kind)
    VALUES (v_provider, v_base, '11:00', NULL, ARRAY[s30], 'confirmed', 'deactivated') RETURNING id INTO ev2;

  PERFORM * FROM public.waitlist_claim_events(1000);
  IF NOT EXISTS (SELECT 1 FROM public.waitlist_events
                  WHERE id = ev2 AND processed_at IS NOT NULL AND outcome = 'provider_off') THEN
    SELECT coalesce(outcome, 'NULL') || ' processed=' || (processed_at IS NOT NULL)::text INTO v_got
      FROM public.waitlist_events WHERE id = ev2;
    RAISE EXCEPTION 'FAIL H1 hidden provider: claim_events should close the event as provider_off, got %', v_got;
  END IF;
  v_checks := v_checks + 1;

  -- ev1 was leased while visible and is still unprocessed — the window between
  -- claim_events and candidates that the second gate exists for.
  SELECT count(*) INTO v_n FROM public.waitlist_candidates(ARRAY[ev1]) c WHERE c.entry_id IN (w1, w2);
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'FAIL H2 hidden provider: candidates should be empty, got % rows', v_n;
  END IF;
  v_checks := v_checks + 1;

  -- The last gate: hidden between candidates and the send.
  SELECT r.log_id, r.reason INTO v_log, v_reason
    FROM public.waitlist_claim_round(w1, 1::smallint, ev1, NULL, '10:00', NULL, NULL, NULL, NULL, 'VERIFY') r;
  IF v_log IS NOT NULL OR v_reason IS DISTINCT FROM 'PROVIDER_OFF' THEN
    RAISE EXCEPTION 'FAIL H3 hidden provider: claim_round should return PROVIDER_OFF, got log % reason %', v_log, v_reason;
  END IF;
  IF EXISTS (SELECT 1 FROM public.waitlist_send_log WHERE waitlist_entry_id IN (w1, w2))
     OR EXISTS (SELECT 1 FROM public.waitlist_entries WHERE id = w1 AND (notify_count <> 0 OR last_notified_at IS NOT NULL)) THEN
    RAISE EXCEPTION 'FAIL H3 hidden provider: a ledger row was written or the entry was advanced';
  END IF;
  v_checks := v_checks + 1;

  -- Ruling 5: entries at a hidden provider stay active, housekeeping included.
  PERFORM * FROM public.waitlist_housekeeping();
  SELECT count(*) INTO v_n FROM public.waitlist_entries WHERE id IN (w1, w2) AND status = 'active' AND ended_at IS NULL;
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'FAIL H4 hidden provider: both entries should still be active, % are', v_n;
  END IF;
  v_checks := v_checks + 1;

  -- ── S. Shown again: resumes for what is still pending ──────────────────────
  UPDATE public.provider_profiles SET is_visible = true WHERE id = v_provider;

  SELECT r.log_id, r.reason INTO v_log, v_reason
    FROM public.waitlist_claim_round(w1, 1::smallint, ev1, NULL, '10:00', NULL, NULL, NULL, NULL, 'VERIFY') r;
  IF v_log IS NULL OR v_reason IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL S1 shown again: claim_round should succeed, got log % reason %', v_log, v_reason;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.waitlist_send_log
                  WHERE id = v_log AND waitlist_entry_id = w1 AND message_kind = 'waitlist_slot:1'
                    AND status = 'skipped' AND error_code = 'VERIFY')
     OR NOT EXISTS (SELECT 1 FROM public.waitlist_entries WHERE id = w1 AND notify_count = 1) THEN
    RAISE EXCEPTION 'FAIL S1 shown again: ledger row or entry advance missing';
  END IF;
  v_checks := v_checks + 1;

  INSERT INTO public.waitlist_events (provider_id, booking_date, booking_time, staff_id, service_ids, old_status, change_kind)
    VALUES (v_provider, v_base, '12:00', NULL, ARRAY[s30], 'confirmed', 'deactivated') RETURNING id INTO ev3;
  PERFORM * FROM public.waitlist_claim_events(1000);
  IF NOT EXISTS (SELECT 1 FROM public.waitlist_events WHERE id = ev3 AND processed_at IS NULL AND claimed_at IS NOT NULL)
     OR NOT EXISTS (SELECT 1 FROM public.waitlist_events WHERE id = ev2 AND outcome = 'provider_off') THEN
    RAISE EXCEPTION 'FAIL S2 shown again: new event should be leased, the hidden-time event stays closed';
  END IF;
  v_checks := v_checks + 1;

  -- ── O. waitlist_enabled = false (visible) is still provider_off — unchanged ─
  UPDATE public.provider_profiles SET waitlist_enabled = false WHERE id = v_provider;

  INSERT INTO public.waitlist_events (provider_id, booking_date, booking_time, staff_id, service_ids, old_status, change_kind)
    VALUES (v_provider, v_base, '13:00', NULL, ARRAY[s30], 'confirmed', 'deactivated') RETURNING id INTO ev4;
  PERFORM * FROM public.waitlist_claim_events(1000);
  IF NOT EXISTS (SELECT 1 FROM public.waitlist_events WHERE id = ev4 AND outcome = 'provider_off') THEN
    RAISE EXCEPTION 'FAIL O1 opted out: claim_events should close the event as provider_off';
  END IF;
  SELECT count(*) INTO v_n FROM public.waitlist_candidates(ARRAY[ev3]) c WHERE c.entry_id IN (w1, w2);
  SELECT r.reason INTO v_reason
    FROM public.waitlist_claim_round(w2, 1::smallint, ev3, NULL, '12:00', NULL, NULL, NULL, NULL, 'VERIFY') r;
  IF v_n <> 0 OR v_reason IS DISTINCT FROM 'PROVIDER_OFF' THEN
    RAISE EXCEPTION 'FAIL O1 opted out: candidates % rows (want 0), claim_round % (want PROVIDER_OFF)', v_n, v_reason;
  END IF;
  v_checks := v_checks + 1;

  -- ── Done. Roll everything back. ────────────────────────────────────────────
  RAISE EXCEPTION 'PASS: all % checks passed (expected 9). This error is deliberate — it rolled back the test service, entries, events and ledger row, and the provider''s settings. Nothing was persisted.', v_checks;
END
$verify$;

-- B-after. Confirm nothing persisted. Expect 0, and the provider's
-- waitlist_enabled / staff_enabled / is_visible / min_lead_time_minutes as
-- they were.
SELECT count(*) AS leftover_test_services FROM public.provider_services WHERE name LIKE 'WL VERIFY%';


-- ═════════════════════════════════════════════════════════════════════════════
-- §C. OPTIONAL — PROD, Test1 only. Hidden provider, real cancellation.
-- ═════════════════════════════════════════════════════════════════════════════
-- Proves end to end that a hidden provider sends nothing: no WhatsApp, no
-- bell, no push, no ledger row. Between 08:00 and 22:00 Israel time.
-- Rollout safety is unchanged: WHATSAPP_WAITLIST_PHONES = only your number.
--
--   1. Test1 visible and opted in; you have an ACTIVE entry for a day D with
--      a walk-in you can cancel inside your time windows, and notify_count < 2
--      (otherwise the round cap, not this change, explains the silence).
--      Insert the entry by SQL as in Phase 2 §C2 if needed.
SELECT w.id, w.entry_date, w.status, w.notify_count, w.last_notified_at,
       p.business_name, p.waitlist_enabled, p.is_visible
FROM public.waitlist_entries w
JOIN public.provider_profiles p ON p.id = w.provider_id
WHERE p.business_name ILIKE 'Test1%' AND w.status = 'active'
ORDER BY w.entry_date;
--   2. Admin page → hide Test1.
--   3. As Test1, cancel the walk-in on D.
--   4. Wait two minutes. Expect the newest Test1 event: outcome
--      'provider_off', processed_at set. Expect NO new waitlist_send_log row
--      since the cancel, no WhatsApp, no bell row, no push.
SELECT e.id, e.created_at, e.booking_date, e.booking_time, e.processed_at, e.outcome
FROM public.waitlist_events e
JOIN public.provider_profiles p ON p.id = e.provider_id
WHERE p.business_name ILIKE 'Test1%'
ORDER BY e.id DESC
LIMIT 3;

SELECT l.created_at, l.message_kind, l.status, l.error_code
FROM public.waitlist_send_log l
JOIN public.provider_profiles p ON p.id = l.provider_id
WHERE p.business_name ILIKE 'Test1%'
ORDER BY l.created_at DESC
LIMIT 3;
--   5. Your entry from step 1 is still 'active' (ruling 5). Re-run step 1.
--   6. Admin page → show Test1 again.


-- ═════════════════════════════════════════════════════════════════════════════
-- §D. MONITORING (read-only)
-- ═════════════════════════════════════════════════════════════════════════════

-- D1. Active entries parked at hidden providers. They wait silently (ruling 5);
--     a large or long-lived number means a provider was hidden for good and
--     its customers are waiting for nothing — a product decision, not a bug.
SELECT p.id, p.business_name, count(*) AS active_entries, min(w.entry_date), max(w.entry_date)
FROM public.waitlist_entries w
JOIN public.provider_profiles p ON p.id = w.provider_id
WHERE w.status = 'active' AND NOT p.is_visible
GROUP BY 1, 2
ORDER BY 3 DESC;


-- ═════════════════════════════════════════════════════════════════════════════
-- §E. ROLLBACK — commented out.
-- ═════════════════════════════════════════════════════════════════════════════
-- Restores the three Phase 2 bodies exactly (they are copied from
-- 20261101000001_waitlist_dispatch.sql §4, §6, §7). Safe while the cron runs.
-- Afterwards §0.1 shows "matches" = true again, and §0.4 is unchanged.
--
-- BEGIN;
-- SET LOCAL lock_timeout = '3s';
--
-- CREATE OR REPLACE FUNCTION public.waitlist_claim_events(p_limit integer DEFAULT 50)
-- RETURNS SETOF public.waitlist_events
-- LANGUAGE plpgsql
-- VOLATILE
-- SET search_path = public, pg_temp
-- AS $fn$
-- DECLARE
--   v_now   timestamptz := now();
--   v_today date := (now() AT TIME ZONE 'Asia/Jerusalem')::date;
-- BEGIN
--   IF public.waitlist_is_quiet_hours(v_now) THEN
--     RETURN;
--   END IF;
--
--   -- Step 1: close. The 1000-row cap bounds one run's work; the remainder is
--   -- closed by the next run.
--   WITH candidate AS (
--     SELECT e.id
--       FROM public.waitlist_events e
--      WHERE e.processed_at IS NULL
--        AND (e.claimed_at IS NULL OR e.claimed_at < v_now - interval '5 minutes')
--      ORDER BY e.id
--      LIMIT 1000
--      FOR UPDATE SKIP LOCKED
--   ),
--   judged AS (
--     SELECT e.id,
--            CASE
--              WHEN e.provider_id IS NULL
--                OR e.booking_date IS NULL
--                OR e.booking_time IS NULL
--                OR e.booking_time !~ '^[0-9]{1,2}:[0-9]{2}'
--                OR e.service_ids IS NULL
--                OR cardinality(e.service_ids) = 0
--                THEN 'malformed'
--              WHEN public.waitlist_event_age_anchor(e.created_at, v_now) < v_now - interval '30 minutes'
--                THEN 'stale'
--              WHEN e.booking_date < v_today
--                THEN 'past'
--              WHEN NOT EXISTS (SELECT 1 FROM public.provider_profiles p
--                                WHERE p.id = e.provider_id AND p.waitlist_enabled)
--                THEN 'provider_off'
--              WHEN EXISTS (SELECT 1 FROM public.provider_services ps
--                            WHERE ps.id = e.service_ids[1] AND ps.provider_id = e.provider_id)
--               AND NOT public.waitlist_is_private_service(e.provider_id, e.service_ids[1], v_today)
--                THEN 'group'
--              WHEN e.attempts >= 3
--                THEN 'gave_up'
--            END AS outcome
--       FROM public.waitlist_events e
--       JOIN candidate c ON c.id = e.id
--   )
--   UPDATE public.waitlist_events e
--      SET processed_at = v_now,
--          outcome      = j.outcome
--     FROM judged j
--    WHERE e.id = j.id
--      AND j.outcome IS NOT NULL;
--
--   -- Step 2: lease. Rows closed in step 1 are processed now and drop out.
--   RETURN QUERY
--   WITH c AS (
--     SELECT e.id
--       FROM public.waitlist_events e
--      WHERE e.processed_at IS NULL
--        AND (e.claimed_at IS NULL OR e.claimed_at < v_now - interval '5 minutes')
--      ORDER BY e.id
--      LIMIT greatest(coalesce(p_limit, 0), 0)
--      FOR UPDATE SKIP LOCKED
--   )
--   UPDATE public.waitlist_events e
--      SET claimed_at = v_now,
--          attempts   = e.attempts + 1
--     FROM c
--    WHERE e.id = c.id
--   RETURNING e.*;
-- END;
-- $fn$;
--
-- CREATE OR REPLACE FUNCTION public.waitlist_candidates(p_event_ids bigint[])
-- RETURNS TABLE (
--   entry_id          uuid,
--   user_id           uuid,
--   event_id          bigint,
--   freed_booking_id  uuid,
--   provider_id       uuid,
--   slot_date         date,
--   slot_time         text,
--   staff_lane        uuid,
--   service_id        uuid,
--   service_duration  integer,
--   latest_start_time text,
--   next_round        smallint,
--   notify_lang       text
-- )
-- LANGUAGE sql
-- STABLE
-- SET search_path = public, pg_temp
-- AS $fn$
--   WITH ev AS (
--     SELECT e.id,
--            e.booking_id,
--            e.provider_id,
--            e.booking_date,
--            e.staff_id,
--            public.booking_time_to_minutes(e.booking_time) AS start_min,
--            COALESCE(
--              e.duration_override,
--              (SELECT NULLIF(SUM(ps.duration), 0)
--                 FROM public.provider_services ps
--                WHERE ps.provider_id = e.provider_id
--                  AND ps.id = ANY (e.service_ids)),
--              30
--            ) AS freed_duration
--       FROM public.waitlist_events e
--      WHERE e.id = ANY (p_event_ids)
--        AND e.processed_at IS NULL
--        AND e.booking_time ~ '^[0-9]{1,2}:[0-9]{2}'
--   ),
--   today AS (SELECT (now() AT TIME ZONE 'Asia/Jerusalem')::date AS d)
--   SELECT w.id,
--          w.user_id,
--          ev.id,
--          ev.booking_id,
--          ev.provider_id,
--          ev.booking_date,
--          -- Normalised HH:MM, whatever padding the stored text had.
--          lpad((ev.start_min / 60)::text, 2, '0') || ':' || lpad((ev.start_min % 60)::text, 2, '0'),
--          ev.staff_id,
--          w.service_id,
--          COALESCE(NULLIF(s.duration, 0), 30)::integer,
--          -- ::text because no migration in this repo creates the column (VERIFY
--          -- §0.6 records its live type); text and time both cast cleanly.
--          s.latest_start_time::text,
--          (w.notify_count + 1)::smallint,
--          w.notify_lang
--     FROM ev
--     CROSS JOIN today
--     JOIN public.provider_profiles p
--       ON p.id = ev.provider_id
--      AND p.waitlist_enabled
--     JOIN public.waitlist_entries w
--       ON w.provider_id = ev.provider_id
--      AND w.entry_date = ev.booking_date
--      AND w.status = 'active'
--     JOIN public.provider_services s
--       ON s.id = w.service_id
--      AND s.provider_id = w.provider_id
--    WHERE (   (w.wants_morning   AND ev.start_min < 720)
--           OR (w.wants_afternoon AND ev.start_min >= 720 AND ev.start_min < 1020)
--           OR (w.wants_evening   AND ev.start_min >= 1020))
--      AND public.waitlist_is_private_service(w.provider_id, w.service_id, today.d)
--      -- The booking page lists active services only (useAllProviders filters
--      -- s.is_active), so a deactivated service cannot be booked from the link.
--      AND COALESCE(s.is_active, true)
--      AND COALESCE(NULLIF(s.duration, 0), 30) <= ev.freed_duration
--      AND (
--            -- a named member: their own lane only
--            (    w.staff_id IS NOT NULL
--             AND ev.staff_id = w.staff_id
--             AND COALESCE(p.staff_enabled, false)
--             AND public.waitlist_staff_performs(w.provider_id, w.staff_id, w.service_id))
--            -- "anyone", freed booking had a member
--         OR (    w.staff_id IS NULL
--             AND ev.staff_id IS NOT NULL
--             AND COALESCE(p.staff_enabled, false)
--             AND public.waitlist_staff_performs(w.provider_id, ev.staff_id, w.service_id))
--            -- "anyone", freed booking had no member: the zero-staff path only
--         OR (    w.staff_id IS NULL
--             AND ev.staff_id IS NULL
--             AND (   NOT COALESCE(p.staff_enabled, false)
--                  OR NOT EXISTS (
--                       SELECT 1 FROM public.provider_staff st
--                        WHERE st.provider_id = w.provider_id
--                          AND public.waitlist_staff_performs(w.provider_id, st.id, w.service_id))))
--          )
--      AND ((ev.booking_date + make_interval(mins => ev.start_min)) AT TIME ZONE 'Asia/Jerusalem')
--          >= now() + make_interval(mins => COALESCE(p.min_lead_time_minutes, 15))
--      AND w.notify_count < 2
--      AND (w.last_notified_at IS NULL OR w.last_notified_at <= now() - interval '60 minutes')
--      AND NOT public.waitlist_customer_has_booking(w.user_id, w.provider_id, w.entry_date);
-- $fn$;
--
-- CREATE OR REPLACE FUNCTION public.waitlist_claim_round(
--   p_entry_id         uuid,
--   p_round            smallint,
--   p_event_id         bigint,
--   p_freed_booking_id uuid,
--   p_slot_time        text,
--   p_staff_lane       uuid,
--   p_phone_digits     text,
--   p_template_name    text,
--   p_language_code    text,
--   p_whatsapp_skip    text DEFAULT NULL
-- )
-- RETURNS TABLE (log_id uuid, reason text)
-- LANGUAGE plpgsql
-- VOLATILE
-- SET search_path = public, pg_temp
-- AS $fn$
-- DECLARE
--   w     public.waitlist_entries%ROWTYPE;
--   v_lead integer;
--   v_on   boolean;
--   v_log  uuid;
-- BEGIN
--   SELECT * INTO w FROM public.waitlist_entries WHERE id = p_entry_id FOR UPDATE;
--   IF NOT FOUND THEN
--     RETURN QUERY SELECT NULL::uuid, 'ENTRY_GONE'::text; RETURN;
--   END IF;
--   IF w.status <> 'active' THEN
--     RETURN QUERY SELECT NULL::uuid, 'ENTRY_INACTIVE'::text; RETURN;
--   END IF;
--   IF p_round IS NULL OR p_round NOT IN (1, 2) OR w.notify_count <> p_round - 1 THEN
--     RETURN QUERY SELECT NULL::uuid, 'ROUND_MISMATCH'::text; RETURN;
--   END IF;
--   IF w.last_notified_at IS NOT NULL AND w.last_notified_at > now() - interval '60 minutes' THEN
--     RETURN QUERY SELECT NULL::uuid, 'TOO_SOON'::text; RETURN;
--   END IF;
--   IF public.waitlist_is_quiet_hours() THEN
--     RETURN QUERY SELECT NULL::uuid, 'QUIET_HOURS'::text; RETURN;
--   END IF;
--
--   SELECT p.waitlist_enabled, COALESCE(p.min_lead_time_minutes, 15)
--     INTO v_on, v_lead
--     FROM public.provider_profiles p
--    WHERE p.id = w.provider_id;
--   IF NOT COALESCE(v_on, false) THEN
--     RETURN QUERY SELECT NULL::uuid, 'PROVIDER_OFF'::text; RETURN;
--   END IF;
--
--   IF ((w.entry_date + make_interval(mins => public.booking_time_to_minutes(p_slot_time)))
--         AT TIME ZONE 'Asia/Jerusalem') < now() + make_interval(mins => v_lead) THEN
--     RETURN QUERY SELECT NULL::uuid, 'TOO_LATE'::text; RETURN;
--   END IF;
--
--   IF public.waitlist_customer_has_booking(w.user_id, w.provider_id, w.entry_date) THEN
--     RETURN QUERY SELECT NULL::uuid, 'ALREADY_BOOKED'::text; RETURN;
--   END IF;
--
--   IF NOT public.waitlist_slot_is_open(w.provider_id, w.entry_date, p_slot_time, w.service_id, p_staff_lane) THEN
--     RETURN QUERY SELECT NULL::uuid, 'SLOT_TAKEN'::text; RETURN;
--   END IF;
--
--   BEGIN
--     INSERT INTO public.waitlist_send_log (
--       waitlist_entry_id, message_kind, provider_id, event_id, freed_booking_id,
--       slot_date, slot_time, phone_digits, template_name, language_code,
--       status, error_code
--     ) VALUES (
--       w.id, 'waitlist_slot:' || p_round, w.provider_id, p_event_id, p_freed_booking_id,
--       w.entry_date, p_slot_time, p_phone_digits, p_template_name, p_language_code,
--       CASE WHEN p_whatsapp_skip IS NULL THEN 'sending' ELSE 'skipped' END,
--       p_whatsapp_skip
--     )
--     RETURNING id INTO v_log;
--   EXCEPTION WHEN unique_violation THEN
--     RETURN QUERY SELECT NULL::uuid, 'ALREADY_CLAIMED'::text; RETURN;
--   END;
--
--   UPDATE public.waitlist_entries
--      SET notify_count     = p_round,
--          last_notified_at = now()
--    WHERE id = w.id;
--
--   RETURN QUERY SELECT v_log, NULL::text;
-- END;
-- $fn$;
--
-- COMMIT;
