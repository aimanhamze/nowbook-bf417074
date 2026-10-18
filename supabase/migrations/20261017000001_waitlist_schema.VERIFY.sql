-- VERIFY / test plan for 20261017000001_waitlist_schema.sql
--
-- ORDER:
--   DEV ONLY, before anything else: supabase/scripts/
--       dev_only_parity_provider_services_id_provider_id_key.sql (see §0.5).
--   §0  BEFORE the migration. REQUIRED. Read-only. Run on DEV, and again on PROD
--       before the prod apply. SAVE THE OUTPUT — §A compares against it.
--   §A  after the migration. Read-only object checks. DEV and PROD.
--   §B  after the migration. Trigger behaviour + failure tests, all rolled back.
--       DEV ONLY.
--   §C  after the migration. App-level checklist through the real code paths,
--       including the outbox-rename test. DEV ONLY.
--   §D  ongoing monitoring.
--   §E  rollback script (commented out).
--
-- §B and §C are DEV ONLY because they rename the outbox / add a constraint to
-- it. Both take an ACCESS EXCLUSIVE lock on waitlist_events, and on PROD every
-- cancellation in that window would queue behind the lock instead of
-- committing.


-- ═════════════════════════════════════════════════════════════════════════════
-- §0. PRE-APPLY — RUN BEFORE THE MIGRATION. REQUIRED. READ-ONLY.
-- ═════════════════════════════════════════════════════════════════════════════

-- 0.1 Types of the bookings columns the outbox copies. The migration's §2
--     guard enforces exactly this list and aborts on any difference.
--     Expect:
--       booking_date      date
--       booking_time      text
--       class_schedule_id uuid
--       duration_override integer
--       id                uuid
--       provider_id       uuid
--       service_ids       uuid[]
--       staff_id          uuid
--       status            text
SELECT a.attname AS column_name,
       format_type(a.atttypid, a.atttypmod) AS type,
       a.attnotnull AS not_null
FROM pg_attribute a
WHERE a.attrelid = 'public.bookings'::regclass
  AND a.attnum > 0
  AND NOT a.attisdropped
  AND a.attname IN ('id', 'provider_id', 'booking_date', 'booking_time', 'staff_id',
                    'service_ids', 'duration_override', 'status', 'class_schedule_id')
ORDER BY a.attname;

-- 0.2 Every existing trigger on bookings. SAVE THIS.
--     Expect: no name beginning trg_waitlist_. (Repo history suggests about
--     a dozen: trg_enforce_*, trg_handle_package_*, trg_link_walkin_to_account,
--     trg_prevent_booking_conflicts, trg_bookings_updated_at.)
SELECT t.tgname,
       t.tgenabled,
       p.oid::regprocedure AS function,
       pg_get_triggerdef(t.oid) AS definition
FROM pg_trigger t
JOIN pg_proc p ON p.oid = t.tgfoid
WHERE t.tgrelid = 'public.bookings'::regclass
  AND NOT t.tgisinternal
ORDER BY t.tgname;

-- 0.3 One fingerprint over every existing bookings trigger: its definition
--     plus the source of its function. SAVE THE VALUE. §A8 recomputes it,
--     excluding the two new triggers, and it must be identical. That is the
--     proof that prevent_booking_conflicts and every other existing trigger
--     were not touched.
SELECT md5(string_agg(
         t.tgname || '|' || pg_get_triggerdef(t.oid) || '|' || md5(p.prosrc),
         E'\n' ORDER BY t.tgname)) AS bookings_triggers_fingerprint,
       count(*) AS trigger_count
FROM pg_trigger t
JOIN pg_proc p ON p.oid = t.tgfoid
WHERE t.tgrelid = 'public.bookings'::regclass
  AND NOT t.tgisinternal
  AND t.tgname NOT LIKE 'trg_waitlist_%';

-- 0.3b prevent_booking_conflicts on its own. SAVE THE VALUE (for §A8b).
SELECT md5(prosrc) AS prevent_booking_conflicts_md5
FROM pg_proc
WHERE oid = 'public.prevent_booking_conflicts()'::regprocedure;

-- 0.4 Every name this migration creates is free.
--     Expect: all four NULL, and 0 rows from the column query.
SELECT to_regclass('public.waitlist_entries')  AS entries,
       to_regclass('public.waitlist_events')   AS events,
       to_regclass('public.waitlist_send_log') AS send_log,
       to_regprocedure('public.waitlist_capture_freed_slot()') AS capture_fn;

SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'provider_profiles'
  AND column_name ILIKE '%waitlist%';

-- 0.5 The composite-FK targets the entries table needs.
--     Expect 2 rows, on BOTH projects:
--       provider_services_id_provider_id_key  provider_services  UNIQUE (id, provider_id)
--       provider_staff_id_provider_id_key     provider_staff     UNIQUE (id, provider_id)
--     DEV drift: DEV was missing provider_services_id_provider_id_key (PROD has
--     it). Run supabase/scripts/dev_only_parity_provider_services_id_provider_id_key.sql
--     on DEV first; then this returns 2 rows there too. Only 1 row on PROD =
--     STOP — do not run the parity script there blindly; find out why PROD
--     changed.
SELECT conname, conrelid::regclass AS on_table, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conname IN ('provider_services_id_provider_id_key',
                  'provider_staff_id_provider_id_key')
ORDER BY conname;

-- 0.6 The shared updated_at helper exists (both new tables use it; so does
--     trg_bookings_updated_at). update_updated_at_column() does NOT exist on
--     either project — set_updated_at() is the one.
--     Expect 1 row, set_updated_at(); the body sets NEW.updated_at = now() and
--     returns NEW.
SELECT p.oid::regprocedure, p.prosrc
FROM pg_proc p
WHERE p.proname = 'set_updated_at'
  AND p.pronamespace = 'public'::regnamespace;

-- 0.7 whatsapp_send_log fingerprint: columns, constraints, indexes, policies,
--     triggers. SAVE THE VALUE. §A10 must match: this feature does not touch
--     that table.
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

-- 0.8 Status values in use, and the status CHECKs (two duplicates are known:
--     bookings_status_check + chk_valid_status).
--     Expect: the only "active" values are confirmed and pending — the set the
--     triggers treat as holding a slot. Anything else here that also holds a
--     slot means the WHEN clauses need widening: STOP and report.
SELECT status, count(*) FROM public.bookings GROUP BY status ORDER BY 2 DESC;

SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'public.bookings'::regclass
  AND contype = 'c'
ORDER BY conname;

-- 0.9 Expected outbox volume (informational): bookings that became cancelled
--     in the last 30 days, per day. Reschedules and deletes add a little.
SELECT round(count(*) / 30.0, 1) AS cancellations_per_day_last_30d
FROM public.bookings
WHERE status = 'cancelled'
  AND updated_at > now() - interval '30 days';

-- 0.10 Server version (NOT NULL DEFAULT false is metadata-only on PG 11+).
SELECT current_setting('server_version') AS pg_version;


-- ═════════════════════════════════════════════════════════════════════════════
-- §A. OBJECT CHECKS — after the migration (read-only). DEV and PROD.
-- ═════════════════════════════════════════════════════════════════════════════

-- A1. The opt-in column, and nobody is opted in.
--     Expect: waitlist_enabled | boolean | NO | false ;  enabled = 0.
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'provider_profiles'
  AND column_name = 'waitlist_enabled';

SELECT count(*) AS providers,
       count(*) FILTER (WHERE waitlist_enabled) AS enabled
FROM public.provider_profiles;

-- A2. The three tables exist, RLS is ON and NOT forced.
--     Expect 3 rows, rls = true, force_rls = false for all.
--     (Forced RLS would make every capture insert fail — and be swallowed.)
SELECT c.relname, c.relrowsecurity AS rls, c.relforcerowsecurity AS force_rls,
       pg_get_userbyid(c.relowner) AS owner
FROM pg_class c
WHERE c.oid IN ('public.waitlist_entries'::regclass,
                'public.waitlist_events'::regclass,
                'public.waitlist_send_log'::regclass)
ORDER BY c.relname;

-- A3. Policies. Expect exactly ONE row:
--     waitlist_entries | Customers read own waitlist entries | SELECT | {authenticated}
SELECT tablename, policyname, cmd, roles, qual
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('waitlist_entries', 'waitlist_events', 'waitlist_send_log')
ORDER BY tablename, policyname;

-- A4. Table privileges for the client roles.
--     Expect: every cell false EXCEPT authenticated / waitlist_entries / select.
SELECT r.role, t.tbl,
       has_table_privilege(r.role, t.tbl, 'SELECT') AS sel,
       has_table_privilege(r.role, t.tbl, 'INSERT') AS ins,
       has_table_privilege(r.role, t.tbl, 'UPDATE') AS upd,
       has_table_privilege(r.role, t.tbl, 'DELETE') AS del
FROM (VALUES ('anon'), ('authenticated')) AS r(role)
CROSS JOIN (VALUES ('public.waitlist_entries'),
                   ('public.waitlist_events'),
                   ('public.waitlist_send_log')) AS t(tbl)
ORDER BY t.tbl, r.role;

-- A5. Constraints.
--     waitlist_entries — expect 9 (+ any NOT NULLs, which are not listed here):
--       pkey; user_id FK (CASCADE); provider_id FK (CASCADE);
--       waitlist_entries_service_fk (service_id, provider_id) CASCADE;
--       waitlist_entries_staff_fk   (staff_id, provider_id)   CASCADE;
--       window_check; status_check; ended_check; notify_count_check;
--       notified_check.
--     waitlist_events  — expect ONLY the primary key. No FK, no CHECK.
--     waitlist_send_log — pkey; waitlist_entry_id FK CASCADE; provider_id FK
--       CASCADE; kind_check ('waitlist_slot:1','waitlist_slot:2');
--       status_check.
SELECT conrelid::regclass AS tbl, conname, contype, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid IN ('public.waitlist_entries'::regclass,
                   'public.waitlist_events'::regclass,
                   'public.waitlist_send_log'::regclass)
ORDER BY 1, 2;

-- A6. Indexes.
--     Expect:
--       waitlist_entries   pkey; waitlist_entries_one_active_per_day (UNIQUE,
--                          partial status='active');
--                          waitlist_entries_provider_day_active_idx (partial)
--       waitlist_events    pkey; waitlist_events_pending_idx (partial
--                          processed_at IS NULL)
--       waitlist_send_log  pkey; waitlist_send_log_entry_kind_key (UNIQUE,
--                          FULL — not partial); waitlist_send_log_provider_created_idx
SELECT tablename, indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN ('waitlist_entries', 'waitlist_events', 'waitlist_send_log')
ORDER BY tablename, indexname;

-- A7. The two new triggers on bookings: AFTER, ROW, enabled ('O'), with the
--     WHEN clauses from §5, and the UPDATE one with NO column list.
--     Expect 2 rows:
--       trg_waitlist_capture_delete  AFTER DELETE … WHEN ((old.status = ANY …
--       trg_waitlist_capture_update  AFTER UPDATE … WHEN ((old.status = ANY …
SELECT t.tgname, t.tgenabled, pg_get_triggerdef(t.oid) AS definition
FROM pg_trigger t
WHERE t.tgrelid = 'public.bookings'::regclass
  AND t.tgname LIKE 'trg_waitlist_%'
ORDER BY t.tgname;

-- A8. Every pre-existing bookings trigger is untouched.
--     Expect: bookings_triggers_fingerprint and trigger_count IDENTICAL to §0.3.
SELECT md5(string_agg(
         t.tgname || '|' || pg_get_triggerdef(t.oid) || '|' || md5(p.prosrc),
         E'\n' ORDER BY t.tgname)) AS bookings_triggers_fingerprint,
       count(*) AS trigger_count
FROM pg_trigger t
JOIN pg_proc p ON p.oid = t.tgfoid
WHERE t.tgrelid = 'public.bookings'::regclass
  AND NOT t.tgisinternal
  AND t.tgname NOT LIKE 'trg_waitlist_%';

-- A8b. prevent_booking_conflicts specifically. Expect: identical to §0.3b.
SELECT md5(prosrc) AS prevent_booking_conflicts_md5
FROM pg_proc
WHERE oid = 'public.prevent_booking_conflicts()'::regprocedure;

-- A9. The capture function: SECURITY DEFINER, pinned search_path, and owned by
--     the SAME role that owns waitlist_events (that ownership is what lets its
--     insert pass RLS). EXECUTE not granted to PUBLIC/anon/authenticated.
--     Expect: prosecdef = true; proconfig = {"search_path=public, pg_temp"};
--             owner_matches_table = true; anon_exec = false; auth_exec = false.
SELECT p.prosecdef,
       p.proconfig,
       pg_get_userbyid(p.proowner) AS fn_owner,
       pg_get_userbyid(p.proowner) = (SELECT pg_get_userbyid(relowner) FROM pg_class
                                       WHERE oid = 'public.waitlist_events'::regclass) AS owner_matches_table,
       has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_exec,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_exec
FROM pg_proc p
WHERE p.oid = 'public.waitlist_capture_freed_slot()'::regprocedure;

-- A10. whatsapp_send_log untouched. Expect: IDENTICAL to §0.7.
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

-- A11. The outbox right after apply. Expect: empty, or only events from real
--      cancellations made since the apply.
SELECT count(*) AS events, min(created_at), max(created_at)
FROM public.waitlist_events;


-- ═════════════════════════════════════════════════════════════════════════════
-- §B. TRIGGER BEHAVIOUR + FAILURE TESTS — DEV ONLY. PERSISTS NOTHING.
-- ═════════════════════════════════════════════════════════════════════════════
-- One DO block. It inserts test walk-in bookings (user_id NULL, no phone, so
-- no notification or account-link side effects) on far-future days that have
-- no bookings, drives them through every slot-freeing write shape, and asserts
-- the outbox after each step.
--
-- ⚠  THE BLOCK ALWAYS ENDS IN AN ERROR. That is how it rolls itself back.
--      SUCCESS  = an error whose message starts with  "PASS:".
--      FAILURE  = an error starting "FAIL", "SETUP" or "INCONCLUSIVE", or any
--                 other error (e.g. a booking trigger rejecting a test row —
--                 report the message).
--
-- SQL can only reproduce the write SHAPES. Two app paths that issue the same
-- write (customer cancel and provider cancel are both `status = 'cancelled'`)
-- are one scenario here; §C proves each code path separately.
--
-- SETUP: set v_provider below to a DEV provider_profiles.id that has at least
-- one non-group service.

DO $verify$
DECLARE
  v_provider uuid := NULL;   -- ← SET THIS to a DEV provider_profiles.id

  v_service  uuid;
  v_base     date;
  v_past     date;
  v_id       uuid;
  v_id2      uuid;
  v_status   text;
  v_n        integer;
  v_n2       integer;
  v_kind     text;
  v_old      text;
  v_new      text;
  v_date     date;
  v_time     text;
  v_checks   integer := 0;
BEGIN
  -- ── Setup ──────────────────────────────────────────────────────────────────
  IF v_provider IS NULL THEN
    RAISE EXCEPTION 'SETUP: set v_provider to a DEV provider id first';
  END IF;
  IF to_regclass('public.waitlist_events') IS NULL THEN
    RAISE EXCEPTION 'SETUP: the migration is not applied';
  END IF;

  SELECT ps.id INTO v_service
    FROM public.provider_services ps
   WHERE ps.provider_id = v_provider
     AND ps.service_type IS DISTINCT FROM 'group'
   ORDER BY ps.id
   LIMIT 1;
  IF v_service IS NULL THEN
    RAISE EXCEPTION 'SETUP: provider % has no non-group service', v_provider;
  END IF;

  -- A 31-day run of far-future days with no bookings for this provider, so the
  -- conflict trigger never sees a neighbour.
  v_base := CURRENT_DATE + 730;
  WHILE EXISTS (SELECT 1 FROM public.bookings b
                 WHERE b.provider_id = v_provider
                   AND b.booking_date BETWEEN v_base AND v_base + 30) LOOP
    v_base := v_base + 31;
  END LOOP;

  -- A past day (older than the WHEN clauses' one-day slack) with no bookings.
  v_past := CURRENT_DATE - 30;
  WHILE EXISTS (SELECT 1 FROM public.bookings b
                 WHERE b.provider_id = v_provider AND b.booking_date = v_past) LOOP
    v_past := v_past - 1;
  END LOOP;

  -- ── S1. Cancel a confirmed booking (customer cancel / provider cancel) ─────
  INSERT INTO public.bookings (provider_id, service_ids, booking_date, booking_time, total_price, status, customer_name)
  VALUES (v_provider, ARRAY[v_service], v_base + 0, '10:00', 0, 'confirmed', 'WAITLIST VERIFY')
  RETURNING id INTO v_id;

  -- N1. An INSERT alone records nothing.
  SELECT count(*) INTO v_n FROM public.waitlist_events WHERE booking_id = v_id;
  IF v_n <> 0 THEN RAISE EXCEPTION 'FAIL N1 insert: expected 0 events, got %', v_n; END IF;
  v_checks := v_checks + 1;

  UPDATE public.bookings SET status = 'cancelled' WHERE id = v_id;
  SELECT count(*), max(change_kind), max(old_status), max(new_status), max(booking_date), max(booking_time)
    INTO v_n, v_kind, v_old, v_new, v_date, v_time
    FROM public.waitlist_events WHERE booking_id = v_id;
  IF NOT (v_n = 1 AND v_kind = 'deactivated' AND v_old = 'confirmed' AND v_new = 'cancelled'
          AND v_date = v_base + 0 AND v_time = '10:00') THEN
    RAISE EXCEPTION 'FAIL S1 cancel confirmed: n=% kind=% old=% new=% date=% time=%', v_n, v_kind, v_old, v_new, v_date, v_time;
  END IF;
  v_checks := v_checks + 1;

  -- ── S2. Decline a pending request ──────────────────────────────────────────
  INSERT INTO public.bookings (provider_id, service_ids, booking_date, booking_time, total_price, status, customer_name)
  VALUES (v_provider, ARRAY[v_service], v_base + 1, '10:00', 0, 'pending', 'WAITLIST VERIFY')
  RETURNING id INTO v_id;
  UPDATE public.bookings SET status = 'cancelled' WHERE id = v_id;
  SELECT count(*), max(change_kind), max(old_status), max(new_status)
    INTO v_n, v_kind, v_old, v_new
    FROM public.waitlist_events WHERE booking_id = v_id;
  IF NOT (v_n = 1 AND v_kind = 'deactivated' AND v_old = 'pending' AND v_new = 'cancelled') THEN
    RAISE EXCEPTION 'FAIL S2 decline pending: n=% kind=% old=% new=%', v_n, v_kind, v_old, v_new;
  END IF;
  v_checks := v_checks + 1;

  -- ── S3. Reschedule to another time, same day ───────────────────────────────
  INSERT INTO public.bookings (provider_id, service_ids, booking_date, booking_time, total_price, status, customer_name)
  VALUES (v_provider, ARRAY[v_service], v_base + 2, '10:00', 0, 'confirmed', 'WAITLIST VERIFY')
  RETURNING id INTO v_id;
  UPDATE public.bookings SET booking_time = '14:00' WHERE id = v_id;
  SELECT count(*), max(change_kind), max(new_status), max(booking_date), max(booking_time)
    INTO v_n, v_kind, v_new, v_date, v_time
    FROM public.waitlist_events WHERE booking_id = v_id;
  -- The event must carry the FREED (old) slot, not the new one.
  IF NOT (v_n = 1 AND v_kind = 'moved' AND v_new = 'confirmed'
          AND v_date = v_base + 2 AND v_time = '10:00') THEN
    RAISE EXCEPTION 'FAIL S3 reschedule time: n=% kind=% new=% date=% time=%', v_n, v_kind, v_new, v_date, v_time;
  END IF;
  v_checks := v_checks + 1;

  -- ── S4. Reschedule to another day ──────────────────────────────────────────
  INSERT INTO public.bookings (provider_id, service_ids, booking_date, booking_time, total_price, status, customer_name)
  VALUES (v_provider, ARRAY[v_service], v_base + 3, '10:00', 0, 'confirmed', 'WAITLIST VERIFY')
  RETURNING id INTO v_id;
  UPDATE public.bookings SET booking_date = v_base + 4 WHERE id = v_id;
  SELECT count(*), max(change_kind), max(booking_date), max(booking_time)
    INTO v_n, v_kind, v_date, v_time
    FROM public.waitlist_events WHERE booking_id = v_id;
  IF NOT (v_n = 1 AND v_kind = 'moved' AND v_date = v_base + 3 AND v_time = '10:00') THEN
    RAISE EXCEPTION 'FAIL S4 reschedule day: n=% kind=% date=% time=%', v_n, v_kind, v_date, v_time;
  END IF;
  v_checks := v_checks + 1;

  -- ── S5. Customer reschedule that flips to pending (approval required) ──────
  INSERT INTO public.bookings (provider_id, service_ids, booking_date, booking_time, total_price, status, customer_name)
  VALUES (v_provider, ARRAY[v_service], v_base + 5, '10:00', 0, 'confirmed', 'WAITLIST VERIFY')
  RETURNING id INTO v_id;
  UPDATE public.bookings SET booking_time = '14:00', status = 'pending' WHERE id = v_id;
  SELECT count(*), max(change_kind), max(old_status), max(new_status)
    INTO v_n, v_kind, v_old, v_new
    FROM public.waitlist_events WHERE booking_id = v_id;
  IF NOT (v_n = 1 AND v_kind = 'moved' AND v_old = 'confirmed' AND v_new = 'pending') THEN
    RAISE EXCEPTION 'FAIL S5 reschedule to pending: n=% kind=% old=% new=%', v_n, v_kind, v_old, v_new;
  END IF;
  v_checks := v_checks + 1;

  -- ── S6. Delete a confirmed booking ─────────────────────────────────────────
  INSERT INTO public.bookings (provider_id, service_ids, booking_date, booking_time, total_price, status, customer_name)
  VALUES (v_provider, ARRAY[v_service], v_base + 6, '10:00', 0, 'confirmed', 'WAITLIST VERIFY')
  RETURNING id INTO v_id;
  DELETE FROM public.bookings WHERE id = v_id;
  -- v_n2 = count(new_status): a deletion has no new status, so it must be 0.
  SELECT count(*), max(change_kind), max(old_status), count(new_status), max(booking_date), max(booking_time)
    INTO v_n, v_kind, v_old, v_n2, v_date, v_time
    FROM public.waitlist_events WHERE booking_id = v_id;
  IF NOT (v_n = 1 AND v_kind = 'deleted' AND v_old = 'confirmed' AND v_n2 = 0
          AND v_date = v_base + 6 AND v_time = '10:00') THEN
    RAISE EXCEPTION 'FAIL S6 delete confirmed: n=% kind=% old=% new_count=% date=% time=%', v_n, v_kind, v_old, v_n2, v_date, v_time;
  END IF;
  v_checks := v_checks + 1;

  -- ── S7. Delete a pending booking ───────────────────────────────────────────
  INSERT INTO public.bookings (provider_id, service_ids, booking_date, booking_time, total_price, status, customer_name)
  VALUES (v_provider, ARRAY[v_service], v_base + 7, '10:00', 0, 'pending', 'WAITLIST VERIFY')
  RETURNING id INTO v_id;
  DELETE FROM public.bookings WHERE id = v_id;
  SELECT count(*), max(change_kind), max(old_status)
    INTO v_n, v_kind, v_old
    FROM public.waitlist_events WHERE booking_id = v_id;
  IF NOT (v_n = 1 AND v_kind = 'deleted' AND v_old = 'pending') THEN
    RAISE EXCEPTION 'FAIL S7 delete pending: n=% kind=% old=%', v_n, v_kind, v_old;
  END IF;
  v_checks := v_checks + 1;

  -- ── S8. Cancel, then delete the cancelled row: still exactly ONE event ─────
  INSERT INTO public.bookings (provider_id, service_ids, booking_date, booking_time, total_price, status, customer_name)
  VALUES (v_provider, ARRAY[v_service], v_base + 8, '10:00', 0, 'confirmed', 'WAITLIST VERIFY')
  RETURNING id INTO v_id;
  UPDATE public.bookings SET status = 'cancelled' WHERE id = v_id;
  DELETE FROM public.bookings WHERE id = v_id;
  SELECT count(*) INTO v_n FROM public.waitlist_events WHERE booking_id = v_id;
  IF v_n <> 1 THEN RAISE EXCEPTION 'FAIL S8 cancel then delete: expected 1 event, got %', v_n; END IF;
  v_checks := v_checks + 1;

  -- ── S9. Two reschedules: one event per write ───────────────────────────────
  INSERT INTO public.bookings (provider_id, service_ids, booking_date, booking_time, total_price, status, customer_name)
  VALUES (v_provider, ARRAY[v_service], v_base + 9, '10:00', 0, 'confirmed', 'WAITLIST VERIFY')
  RETURNING id INTO v_id;
  UPDATE public.bookings SET booking_time = '14:00' WHERE id = v_id;
  UPDATE public.bookings SET booking_time = '18:00' WHERE id = v_id;
  SELECT count(*), string_agg(booking_time, ',' ORDER BY id)
    INTO v_n, v_time
    FROM public.waitlist_events WHERE booking_id = v_id;
  IF NOT (v_n = 2 AND v_time = '10:00,14:00') THEN
    RAISE EXCEPTION 'FAIL S9 two reschedules: n=% freed=%', v_n, v_time;
  END IF;
  v_checks := v_checks + 1;

  -- ── N2–N6. Writes that free nothing record nothing ─────────────────────────
  INSERT INTO public.bookings (provider_id, service_ids, booking_date, booking_time, total_price, status, customer_name)
  VALUES (v_provider, ARRAY[v_service], v_base + 10, '10:00', 0, 'pending', 'WAITLIST VERIFY')
  RETURNING id INTO v_id;

  UPDATE public.bookings SET status = 'confirmed' WHERE id = v_id;                -- N2 approve
  SELECT count(*) INTO v_n FROM public.waitlist_events WHERE booking_id = v_id;
  IF v_n <> 0 THEN RAISE EXCEPTION 'FAIL N2 approve: expected 0 events, got %', v_n; END IF;
  v_checks := v_checks + 1;

  UPDATE public.bookings SET treatment_notes = 'waitlist verify' WHERE id = v_id; -- N3 notes
  SELECT count(*) INTO v_n FROM public.waitlist_events WHERE booking_id = v_id;
  IF v_n <> 0 THEN RAISE EXCEPTION 'FAIL N3 notes edit: expected 0 events, got %', v_n; END IF;
  v_checks := v_checks + 1;

  UPDATE public.bookings SET check_in_at = now() WHERE id = v_id;                 -- N4 check-in
  SELECT count(*) INTO v_n FROM public.waitlist_events WHERE booking_id = v_id;
  IF v_n <> 0 THEN RAISE EXCEPTION 'FAIL N4 check-in: expected 0 events, got %', v_n; END IF;
  v_checks := v_checks + 1;

  UPDATE public.bookings SET duration_override = 30 WHERE id = v_id;              -- N5 duration (out of v1)
  SELECT count(*) INTO v_n FROM public.waitlist_events WHERE booking_id = v_id;
  IF v_n <> 0 THEN RAISE EXCEPTION 'FAIL N5 duration_override: expected 0 events, got %', v_n; END IF;
  v_checks := v_checks + 1;

  UPDATE public.bookings SET status = 'confirmed' WHERE id = v_id;                -- N6 no-op status write
  SELECT count(*) INTO v_n FROM public.waitlist_events WHERE booking_id = v_id;
  IF v_n <> 0 THEN RAISE EXCEPTION 'FAIL N6 no-op status: expected 0 events, got %', v_n; END IF;
  v_checks := v_checks + 1;

  -- ── N7. A past booking: cancel and delete record nothing ───────────────────
  INSERT INTO public.bookings (provider_id, service_ids, booking_date, booking_time, total_price, status, customer_name)
  VALUES (v_provider, ARRAY[v_service], v_past, '10:00', 0, 'confirmed', 'WAITLIST VERIFY')
  RETURNING id INTO v_id;
  UPDATE public.bookings SET status = 'cancelled' WHERE id = v_id;
  DELETE FROM public.bookings WHERE id = v_id;
  SELECT count(*) INTO v_n FROM public.waitlist_events WHERE booking_id = v_id;
  IF v_n <> 0 THEN RAISE EXCEPTION 'FAIL N7 past booking: expected 0 events, got %', v_n; END IF;
  v_checks := v_checks + 1;

  -- ── N8. Moving an already-cancelled row records nothing ────────────────────
  INSERT INTO public.bookings (provider_id, service_ids, booking_date, booking_time, total_price, status, customer_name)
  VALUES (v_provider, ARRAY[v_service], v_base + 11, '10:00', 0, 'cancelled', 'WAITLIST VERIFY')
  RETURNING id INTO v_id;
  UPDATE public.bookings SET booking_date = v_base + 12 WHERE id = v_id;
  SELECT count(*) INTO v_n FROM public.waitlist_events WHERE booking_id = v_id;
  IF v_n <> 0 THEN RAISE EXCEPTION 'FAIL N8 inactive row moved: expected 0 events, got %', v_n; END IF;
  v_checks := v_checks + 1;

  -- ── F1. Outbox RENAMED: a cancellation still succeeds ──────────────────────
  INSERT INTO public.bookings (provider_id, service_ids, booking_date, booking_time, total_price, status, customer_name)
  VALUES (v_provider, ARRAY[v_service], v_base + 13, '10:00', 0, 'confirmed', 'WAITLIST VERIFY')
  RETURNING id INTO v_id;

  ALTER TABLE public.waitlist_events RENAME TO waitlist_events__verify_off;

  UPDATE public.bookings SET status = 'cancelled' WHERE id = v_id;   -- must NOT raise
  SELECT b.status INTO v_status FROM public.bookings b WHERE b.id = v_id;
  IF v_status IS DISTINCT FROM 'cancelled' THEN
    RAISE EXCEPTION 'FAIL F1 rename: cancellation did not commit (status=%)', v_status;
  END IF;
  -- The capture insert must really have failed. If the event landed in the
  -- renamed table anyway (a cached plan following the table's OID), this test
  -- proved nothing — F2 below is the deterministic version.
  SELECT count(*) INTO v_n FROM public.waitlist_events__verify_off WHERE booking_id = v_id;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'INCONCLUSIVE F1: the event still reached the renamed table (cached plan); F2 did not run';
  END IF;

  ALTER TABLE public.waitlist_events__verify_off RENAME TO waitlist_events;
  v_checks := v_checks + 1;

  -- ── F2. Outbox REJECTS every insert: cancel and delete still succeed ───────
  INSERT INTO public.bookings (provider_id, service_ids, booking_date, booking_time, total_price, status, customer_name)
  VALUES (v_provider, ARRAY[v_service], v_base + 14, '10:00', 0, 'confirmed', 'WAITLIST VERIFY')
  RETURNING id INTO v_id;
  INSERT INTO public.bookings (provider_id, service_ids, booking_date, booking_time, total_price, status, customer_name)
  VALUES (v_provider, ARRAY[v_service], v_base + 15, '10:00', 0, 'confirmed', 'WAITLIST VERIFY')
  RETURNING id INTO v_id2;

  ALTER TABLE public.waitlist_events
    ADD CONSTRAINT waitlist_events__verify_reject CHECK (false) NOT VALID;

  UPDATE public.bookings SET status = 'cancelled' WHERE id = v_id;   -- must NOT raise
  DELETE FROM public.bookings WHERE id = v_id2;                      -- must NOT raise

  SELECT b.status INTO v_status FROM public.bookings b WHERE b.id = v_id;
  IF v_status IS DISTINCT FROM 'cancelled' THEN
    RAISE EXCEPTION 'FAIL F2 reject: cancellation did not commit (status=%)', v_status;
  END IF;
  IF EXISTS (SELECT 1 FROM public.bookings WHERE id = v_id2) THEN
    RAISE EXCEPTION 'FAIL F2 reject: deletion did not commit';
  END IF;
  SELECT count(*) INTO v_n FROM public.waitlist_events WHERE booking_id IN (v_id, v_id2);
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'FAIL F2 reject: % event(s) recorded despite CHECK (false)', v_n;
  END IF;

  ALTER TABLE public.waitlist_events DROP CONSTRAINT waitlist_events__verify_reject;
  v_checks := v_checks + 1;

  -- ── F3. Capture resumes once the outbox is healthy again ───────────────────
  INSERT INTO public.bookings (provider_id, service_ids, booking_date, booking_time, total_price, status, customer_name)
  VALUES (v_provider, ARRAY[v_service], v_base + 16, '10:00', 0, 'confirmed', 'WAITLIST VERIFY')
  RETURNING id INTO v_id;
  UPDATE public.bookings SET status = 'cancelled' WHERE id = v_id;
  SELECT count(*) INTO v_n FROM public.waitlist_events WHERE booking_id = v_id;
  IF v_n <> 1 THEN RAISE EXCEPTION 'FAIL F3 resume: expected 1 event, got %', v_n; END IF;
  v_checks := v_checks + 1;

  -- ── Done. Roll everything back. ────────────────────────────────────────────
  RAISE EXCEPTION 'PASS: all % checks passed (expected 20). This error is deliberate — it rolled back every test booking, event, rename and constraint. Nothing was persisted.', v_checks;
END
$verify$;

-- B-after. Confirm nothing persisted. Expect: 0 and 0, and the outbox is
-- named waitlist_events with no extra constraint (re-run §A5 if in doubt).
SELECT count(*) AS leftover_test_bookings
FROM public.bookings WHERE customer_name = 'WAITLIST VERIFY';

SELECT count(*) AS leftover_reject_constraint
FROM pg_constraint WHERE conname = 'waitlist_events__verify_reject';


-- ═════════════════════════════════════════════════════════════════════════════
-- §C. APP-LEVEL CHECKLIST — DEV ONLY (the app pointed at DEV)
-- ═════════════════════════════════════════════════════════════════════════════
-- §B proved the write shapes. This proves each real code path issues one.
-- Use a DEV provider with a future booking per step, and a DEV customer.
--
-- C0. Record the starting point. Note the value as <BASE>.
SELECT coalesce(max(id), 0) AS base_event_id FROM public.waitlist_events;

-- After EACH step below, run C-check and compare with the expected delta.
-- C-check:
--   SELECT id, change_kind, old_status, new_status, booking_date, booking_time,
--          booking_id, created_at
--   FROM public.waitlist_events
--   WHERE id > <BASE>
--   ORDER BY id;
--
--  #   Action (code path)                                             Expect
--  ──  ─────────────────────────────────────────────────────────────  ─────────────────────────────
--  1   Customer cancels on /bookings                                  +1 deactivated confirmed→cancelled
--      (hooks/useCancelBooking.ts)
--  2   Customer cancels from the provider-page appointment card       +1 deactivated confirmed→cancelled
--      (same hook, second entry point)
--  3   Provider cancels a confirmed booking                           +1 deactivated confirmed→cancelled
--      (useProviderBookings.useCancelBooking)
--  4   Provider (requires_booking_approval ON): customer books →      +0 for the booking itself
--      provider DECLINES it (useRejectBooking)                        +1 deactivated pending→cancelled
--  5   Customer books again → provider APPROVES (useApproveBooking)   +0
--  6   Provider reschedules (RescheduleSheet / useRescheduleBooking)  +1 moved; date/time = the OLD slot
--  7   Customer reschedules (allow_customer_reschedule ON;            +1 moved; new_status = pending
--      CustomerRescheduleSheet) — with approval ON                     when approval is ON
--  8   Provider deletes a booking (useDeleteBooking)                  +1 deleted, new_status NULL
--  9   Provider edits treatment notes                                 +0
--  10  Provider checks a customer in                                  +0
--  11  Provider changes a booking's duration                          +0
--  12  Provider creates a walk-in (NewBookingSheet)                   +0
--  13  Provider cancels a GROUP service slot (useCancelGroupClass)     +1 per participant (captured;
--                                                                        the Phase 2 dispatcher drops
--                                                                        group events)
--  14  Optional — fitness class booking cancelled                     +0 (class_schedule_id set)
--
-- Every "+1" must be exactly one row, with booking_id = the booking you acted on.
-- Two rows for one action, or one row for a "+0" action, is a FAIL: stop and
-- report the C-check output.

-- C-rename. The outbox is missing: a REAL cancellation through the app still
-- succeeds. Keep the paused window short — events in it are lost, by design.
--
--   1. Run:
--        ALTER TABLE public.waitlist_events RENAME TO waitlist_events_paused;
--   2. In the app, cancel a confirmed booking (customer or provider side).
--      Expect: the normal success toast; the booking shows as cancelled.
--   3. Confirm in SQL (expect 'cancelled'):
--        SELECT status FROM public.bookings WHERE id = '<that booking id>';
--   4. Dashboard → Logs → Postgres, search "waitlist_capture_freed_slot".
--      Expect: one WARNING "event not recorded for booking <id> (42P01 …)".
--   5. Restore:
--        ALTER TABLE public.waitlist_events_paused RENAME TO waitlist_events;
--   6. Cancel another booking in the app. Expect C-check to show +1 again.
--   7. Confirm the name is back (expect a non-NULL value):
--        SELECT to_regclass('public.waitlist_events');


-- ═════════════════════════════════════════════════════════════════════════════
-- §D. MONITORING (read-only) — until Phase 2 consumes the outbox
-- ═════════════════════════════════════════════════════════════════════════════

-- D1. Outbox growth per day, by kind. Expect roughly §0.9's daily rate.
SELECT created_at::date AS day, change_kind, count(*)
FROM public.waitlist_events
GROUP BY 1, 2
ORDER BY 1 DESC, 2;

-- D2. Capture failures. Dashboard → Logs → Postgres, search
--     "waitlist_capture_freed_slot". Expect: none outside the §C-rename test.
--     Any other hit means events are being lost while bookings still commit:
--     report the SQLSTATE in the message.

-- D3. Both capture triggers still enabled. Expect 2 rows, tgenabled = 'O'.
SELECT tgname, tgenabled
FROM pg_trigger
WHERE tgrelid = 'public.bookings'::regclass AND tgname LIKE 'trg_waitlist_%';


-- ═════════════════════════════════════════════════════════════════════════════
-- §E. ROLLBACK — commented out. Safe while no later phase is deployed.
-- ═════════════════════════════════════════════════════════════════════════════
-- Kill switch only (keeps all data, stops capture instantly):
--   ALTER TABLE public.bookings DISABLE TRIGGER trg_waitlist_capture_update;
--   ALTER TABLE public.bookings DISABLE TRIGGER trg_waitlist_capture_delete;
--
-- Full removal. Once Phase 3/4 client code ships, that code reads
-- provider_profiles.waitlist_enabled and the RPCs: roll those back FIRST.
--
-- BEGIN;
-- SET LOCAL lock_timeout = '3s';
-- DROP TRIGGER IF EXISTS trg_waitlist_capture_update ON public.bookings;
-- DROP TRIGGER IF EXISTS trg_waitlist_capture_delete ON public.bookings;
-- DROP FUNCTION IF EXISTS public.waitlist_capture_freed_slot();
-- DROP TABLE IF EXISTS public.waitlist_send_log;
-- DROP TABLE IF EXISTS public.waitlist_events;
-- DROP TABLE IF EXISTS public.waitlist_entries;
-- ALTER TABLE public.provider_profiles DROP COLUMN IF EXISTS waitlist_enabled;
-- COMMIT;
--
-- After rollback, re-run §0.2 and §0.3: the trigger list and the fingerprint
-- must match the saved pre-apply output.
