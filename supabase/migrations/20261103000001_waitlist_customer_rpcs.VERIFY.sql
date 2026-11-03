-- VERIFY for 20261103000001_waitlist_customer_rpcs.sql
--
--   §0  BEFORE the migration, read-only. DEV, then PROD before the prod apply.
--   §A  after the migration, read-only. DEV and PROD.
--   §B  after the migration, DEV ONLY. Behaviour tests, all rolled back.
--   §E  rollback (commented out).


-- ═════════════════════════════════════════════════════════════════════════════
-- §0. PRE-APPLY — REQUIRED, READ-ONLY
-- ═════════════════════════════════════════════════════════════════════════════

-- 0.1 The two names are free. Expect both NULL.
SELECT to_regprocedure('public.waitlist_join(uuid, date, uuid, uuid, boolean, boolean, boolean, text)') AS join_fn,
       to_regprocedure('public.waitlist_leave(uuid)') AS leave_fn;

-- 0.2 DRIFT GATE. The Phase 2 helpers the join calls are exactly the Phase 2
--     file's bodies (CR stripped, so a CRLF paste still matches).
--     Expect 3 rows, every matches = true. Any false or NULL: STOP and report.
SELECT x.fn, md5(replace(p.prosrc, E'\r', '')) = x.expected_md5 AS matches
FROM (VALUES
  ('public.waitlist_is_private_service(uuid, uuid, date)',   '64144adb65032444ceb76ab0cbeed5c8'),
  ('public.waitlist_staff_performs(uuid, uuid, uuid)',       'a93eb298e394cd09f14bf58da794b59e'),
  ('public.waitlist_customer_has_booking(uuid, uuid, date)', 'aeeb7490e16cb623e586a97582e864ed')
) AS x(fn, expected_md5)
LEFT JOIN pg_proc p ON p.oid = to_regprocedure(x.fn)
ORDER BY 1;

-- 0.3 Every column the join reads, and the one-per-day index.
--     Expect 7 rows with these types:
--       provider_profiles  booking_window_days integer, staff_enabled boolean,
--                          waitlist_enabled boolean
--       provider_services  is_active boolean
--       user_roles         role app_role, user_id uuid
--       waitlist_entries   notify_lang text
--     and 1 index row: waitlist_entries_one_active_per_day … WHERE (status = 'active'::text)
SELECT c.relname AS tbl, a.attname AS col, format_type(a.atttypid, a.atttypmod) AS type
FROM pg_attribute a
JOIN pg_class c ON c.oid = a.attrelid AND c.relnamespace = 'public'::regnamespace
WHERE a.attnum > 0 AND NOT a.attisdropped
  AND (c.relname, a.attname) IN (
    ('provider_profiles', 'booking_window_days'), ('provider_profiles', 'staff_enabled'),
    ('provider_profiles', 'waitlist_enabled'), ('provider_services', 'is_active'),
    ('user_roles', 'role'), ('user_roles', 'user_id'), ('waitlist_entries', 'notify_lang'))
ORDER BY 1, 2;

SELECT indexname, indexdef FROM pg_indexes
WHERE schemaname = 'public' AND indexname = 'waitlist_entries_one_active_per_day';


-- ═════════════════════════════════════════════════════════════════════════════
-- §A. AFTER THE MIGRATION — READ-ONLY
-- ═════════════════════════════════════════════════════════════════════════════

-- A1. Expect 2 rows: prosecdef true, proconfig {"search_path=public, pg_temp"},
--     anon false, authenticated true.
SELECT p.oid::regprocedure AS fn, p.prosecdef, p.proconfig,
       has_function_privilege('anon', p.oid, 'EXECUTE')          AS anon,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated
FROM pg_proc p
WHERE p.oid IN (to_regprocedure('public.waitlist_join(uuid, date, uuid, uuid, boolean, boolean, boolean, text)'),
                to_regprocedure('public.waitlist_leave(uuid)'))
ORDER BY 1;


-- ═════════════════════════════════════════════════════════════════════════════
-- §B. BEHAVIOUR TESTS — DEV ONLY, PERSISTS NOTHING
-- ═════════════════════════════════════════════════════════════════════════════
-- Calls the RPCs as three customers (by setting the JWT claims auth.uid()
-- reads), covering every refusal code, the one-per-day rule, the max-5 limit
-- and leave. Creates its own services, staff, sessions and two bookings.
--
-- ⚠  THE BLOCK ALWAYS ENDS IN AN ERROR — that is how it rolls back.
--      SUCCESS = an error starting "PASS:".   Anything else = report it.
--
-- SETUP: set v_provider to a DEV provider_profiles.id. DEV needs 3 auth.users
-- with no provider/admin role and no active waiting-list entries.

DO $verify$
DECLARE
  v_provider uuid := NULL;   -- ← SET THIS to a DEV provider_profiles.id

  v_today date := (now() AT TIME ZONE 'Asia/Jerusalem')::date;
  d  date[];
  u1 uuid; u2 uuid; u3 uuid;
  s uuid; s2 uuid; sgroup uuid; sinact uuid; ssess uuid;
  sx uuid; sy uuid; sz uuid;
  v_e1 uuid; v_e1b uuid; v_ended timestamptz;
  v_n integer;
BEGIN
  IF v_provider IS NULL THEN RAISE EXCEPTION 'SETUP: set v_provider first'; END IF;
  IF to_regprocedure('public.waitlist_leave(uuid)') IS NULL THEN
    RAISE EXCEPTION 'SETUP: the migration is not applied';
  END IF;

  -- Helpers, dropped with the rollback.
  CREATE FUNCTION pg_temp.wl_as(p_uid uuid) RETURNS void LANGUAGE sql AS $h$
    SELECT set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true),
           set_config('request.jwt.claims',
                      CASE WHEN p_uid IS NULL THEN '' ELSE json_build_object('sub', p_uid, 'role', 'authenticated')::text END,
                      true);
  $h$;
  CREATE FUNCTION pg_temp.wl_join(p_uid uuid, p_prov uuid, p_day date, p_svc uuid, p_staff uuid,
                                  p_m boolean, p_a boolean, p_e boolean, p_lang text)
  RETURNS text LANGUAGE plpgsql AS $h$
  DECLARE v text;
  BEGIN
    PERFORM pg_temp.wl_as(p_uid);
    SELECT j.code INTO v FROM public.waitlist_join(p_prov, p_day, p_svc, p_staff, p_m, p_a, p_e, p_lang) j;
    RETURN v;
  END $h$;
  CREATE FUNCTION pg_temp.wl_leave(p_uid uuid, p_entry uuid) RETURNS text LANGUAGE plpgsql AS $h$
  BEGIN
    PERFORM pg_temp.wl_as(p_uid);
    RETURN public.waitlist_leave(p_entry);
  END $h$;
  CREATE FUNCTION pg_temp.expect(p_label text, p_got text, p_want text) RETURNS void LANGUAGE plpgsql AS $h$
  BEGIN
    IF p_got IS DISTINCT FROM p_want THEN
      RAISE EXCEPTION 'FAIL %: got %, want %', p_label, coalesce(p_got, 'NULL'), p_want;
    END IF;
  END $h$;

  -- Three customers with nothing on any waiting list.
  SELECT u.id INTO u1 FROM auth.users u
   WHERE NOT EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = u.id AND r.role::text IN ('provider', 'admin'))
     AND NOT EXISTS (SELECT 1 FROM public.waitlist_entries w WHERE w.user_id = u.id AND w.status = 'active')
   ORDER BY u.created_at, u.id LIMIT 1;
  SELECT u.id INTO u2 FROM auth.users u
   WHERE NOT EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = u.id AND r.role::text IN ('provider', 'admin'))
     AND NOT EXISTS (SELECT 1 FROM public.waitlist_entries w WHERE w.user_id = u.id AND w.status = 'active')
   ORDER BY u.created_at, u.id OFFSET 1 LIMIT 1;
  SELECT u.id INTO u3 FROM auth.users u
   WHERE NOT EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = u.id AND r.role::text IN ('provider', 'admin'))
     AND NOT EXISTS (SELECT 1 FROM public.waitlist_entries w WHERE w.user_id = u.id AND w.status = 'active')
   ORDER BY u.created_at, u.id OFFSET 2 LIMIT 1;
  IF u3 IS NULL THEN RAISE EXCEPTION 'SETUP: need 3 customer accounts with no active entries'; END IF;

  UPDATE public.provider_profiles
     SET waitlist_enabled = true, staff_enabled = true, booking_window_days = 60
   WHERE id = v_provider;
  IF NOT FOUND THEN RAISE EXCEPTION 'SETUP: provider % not found', v_provider; END IF;

  -- 8 days in the window where the provider has no active booking and the
  -- three customers have none with this provider.
  SELECT array_agg(g.day ORDER BY g.day) INTO d
    FROM (SELECT gs::date AS day
            FROM generate_series(v_today + 1, v_today + 59, interval '1 day') gs
           WHERE NOT EXISTS (SELECT 1 FROM public.bookings b
                              WHERE b.provider_id = v_provider AND b.booking_date = gs::date
                                AND b.status IN ('confirmed', 'pending'))
             AND NOT public.waitlist_customer_has_booking(u1, v_provider, gs::date)
             AND NOT public.waitlist_customer_has_booking(u2, v_provider, gs::date)
             AND NOT public.waitlist_customer_has_booking(u3, v_provider, gs::date)
           ORDER BY 1 LIMIT 8) g;
  IF coalesce(cardinality(d), 0) < 8 THEN RAISE EXCEPTION 'SETUP: need 8 free days in the next 59'; END IF;

  INSERT INTO public.provider_services (provider_id, name, duration, service_type, max_capacity)
    VALUES (v_provider, 'WL VERIFY 3B', 30, 'private', 1) RETURNING id INTO s;
  INSERT INTO public.provider_services (provider_id, name, duration, service_type, max_capacity)
    VALUES (v_provider, 'WL VERIFY 3B OTHER', 30, 'private', 1) RETURNING id INTO s2;
  INSERT INTO public.provider_services (provider_id, name, duration, service_type, max_capacity)
    VALUES (v_provider, 'WL VERIFY 3B GROUP', 30, 'group', 10) RETURNING id INTO sgroup;
  INSERT INTO public.provider_services (provider_id, name, duration, service_type, max_capacity, is_active)
    VALUES (v_provider, 'WL VERIFY 3B INACTIVE', 30, 'private', 1, false) RETURNING id INTO sinact;
  INSERT INTO public.provider_services (provider_id, name, duration, service_type, max_capacity)
    VALUES (v_provider, 'WL VERIFY 3B SESS', 30, 'private', 1) RETURNING id INTO ssess;
  INSERT INTO public.provider_sessions (provider_id, service_id, session_date, session_time)
    VALUES (v_provider, ssess, d[8], '10:00');
  -- X performs everything (no rows), Y only the OTHER service, Z inactive.
  INSERT INTO public.provider_staff (provider_id, name) VALUES (v_provider, 'WL VERIFY X') RETURNING id INTO sx;
  INSERT INTO public.provider_staff (provider_id, name) VALUES (v_provider, 'WL VERIFY Y') RETURNING id INTO sy;
  INSERT INTO public.provider_staff (provider_id, name, is_active) VALUES (v_provider, 'WL VERIFY Z', false) RETURNING id INTO sz;
  INSERT INTO public.provider_staff_services (provider_id, staff_id, service_id) VALUES (v_provider, sy, s2);

  -- ── Refusal codes (each call is otherwise valid) ───────────────────────────
  PERFORM pg_temp.expect('NOT_CUSTOMER signed out', pg_temp.wl_join(NULL, v_provider, d[1], s, NULL, true, true, true, 'he'), 'NOT_CUSTOMER');
  INSERT INTO public.user_roles (user_id, role) VALUES (u3, 'provider');
  PERFORM pg_temp.expect('NOT_CUSTOMER provider', pg_temp.wl_join(u3, v_provider, d[1], s, NULL, true, true, true, 'he'), 'NOT_CUSTOMER');
  UPDATE public.user_roles SET role = 'admin' WHERE user_id = u3 AND role::text = 'provider';
  PERFORM pg_temp.expect('NOT_CUSTOMER admin', pg_temp.wl_join(u3, v_provider, d[1], s, NULL, true, true, true, 'he'), 'NOT_CUSTOMER');
  DELETE FROM public.user_roles WHERE user_id = u3 AND role::text = 'admin';

  PERFORM pg_temp.expect('WAITLIST_OFF no provider', pg_temp.wl_join(u1, gen_random_uuid(), d[1], s, NULL, true, true, true, 'he'), 'WAITLIST_OFF');
  UPDATE public.provider_profiles SET waitlist_enabled = false WHERE id = v_provider;
  PERFORM pg_temp.expect('WAITLIST_OFF disabled', pg_temp.wl_join(u1, v_provider, d[1], s, NULL, true, true, true, 'he'), 'WAITLIST_OFF');
  UPDATE public.provider_profiles SET waitlist_enabled = true WHERE id = v_provider;

  PERFORM pg_temp.expect('BAD_LANG fr',   pg_temp.wl_join(u1, v_provider, d[1], s, NULL, true, true, true, 'fr'), 'BAD_LANG');
  PERFORM pg_temp.expect('BAD_LANG null', pg_temp.wl_join(u1, v_provider, d[1], s, NULL, true, true, true, NULL), 'BAD_LANG');

  PERFORM pg_temp.expect('NO_WINDOW false', pg_temp.wl_join(u1, v_provider, d[1], s, NULL, false, false, false, 'he'), 'NO_WINDOW');
  PERFORM pg_temp.expect('NO_WINDOW null',  pg_temp.wl_join(u1, v_provider, d[1], s, NULL, NULL, NULL, NULL, 'he'), 'NO_WINDOW');

  PERFORM pg_temp.expect('DATE yesterday',   pg_temp.wl_join(u1, v_provider, v_today - 1, s, NULL, true, true, true, 'he'), 'DATE_OUT_OF_RANGE');
  PERFORM pg_temp.expect('DATE past window', pg_temp.wl_join(u1, v_provider, v_today + 60, s, NULL, true, true, true, 'he'), 'DATE_OUT_OF_RANGE');
  PERFORM pg_temp.expect('DATE null',        pg_temp.wl_join(u1, v_provider, NULL, s, NULL, true, true, true, 'he'), 'DATE_OUT_OF_RANGE');
  -- Last day of the window passes the date check (any later code is fine).
  IF pg_temp.wl_join(u3, v_provider, v_today + 59, gen_random_uuid(), NULL, true, true, true, 'he') <> 'SERVICE_INVALID' THEN
    RAISE EXCEPTION 'FAIL DATE last window day should pass the date check';
  END IF;

  PERFORM pg_temp.expect('SERVICE group',    pg_temp.wl_join(u1, v_provider, d[1], sgroup, NULL, true, true, true, 'he'), 'SERVICE_INVALID');
  PERFORM pg_temp.expect('SERVICE inactive', pg_temp.wl_join(u1, v_provider, d[1], sinact, NULL, true, true, true, 'he'), 'SERVICE_INVALID');
  PERFORM pg_temp.expect('SERVICE sessions', pg_temp.wl_join(u1, v_provider, d[1], ssess, NULL, true, true, true, 'he'), 'SERVICE_INVALID');
  PERFORM pg_temp.expect('SERVICE unknown',  pg_temp.wl_join(u1, v_provider, d[1], gen_random_uuid(), NULL, true, true, true, 'he'), 'SERVICE_INVALID');
  PERFORM pg_temp.expect('SERVICE null',     pg_temp.wl_join(u1, v_provider, d[1], NULL, NULL, true, true, true, 'he'), 'SERVICE_INVALID');

  PERFORM pg_temp.expect('STAFF inactive',      pg_temp.wl_join(u1, v_provider, d[1], s, sz, true, true, true, 'he'), 'STAFF_INVALID');
  PERFORM pg_temp.expect('STAFF not performing', pg_temp.wl_join(u1, v_provider, d[1], s, sy, true, true, true, 'he'), 'STAFF_INVALID');
  PERFORM pg_temp.expect('STAFF unknown',       pg_temp.wl_join(u1, v_provider, d[1], s, gen_random_uuid(), true, true, true, 'he'), 'STAFF_INVALID');
  UPDATE public.provider_profiles SET staff_enabled = false WHERE id = v_provider;
  PERFORM pg_temp.expect('STAFF staff off',     pg_temp.wl_join(u1, v_provider, d[1], s, sx, true, true, true, 'he'), 'STAFF_INVALID');
  UPDATE public.provider_profiles SET staff_enabled = true WHERE id = v_provider;

  INSERT INTO public.bookings (provider_id, user_id, service_ids, booking_date, booking_time, total_price, status, customer_name, staff_id)
    VALUES (v_provider, u2, ARRAY[s], d[2], '10:00', 0, 'confirmed', 'WAITLIST VERIFY', sx);
  INSERT INTO public.bookings (provider_id, linked_user_id, service_ids, booking_date, booking_time, total_price, status, customer_name, staff_id)
    VALUES (v_provider, u3, ARRAY[s], d[3], '10:00', 0, 'pending', 'WAITLIST VERIFY', sx);
  PERFORM pg_temp.expect('ALREADY_BOOKED booker', pg_temp.wl_join(u2, v_provider, d[2], s, NULL, true, true, true, 'he'), 'ALREADY_BOOKED');
  PERFORM pg_temp.expect('ALREADY_BOOKED linked', pg_temp.wl_join(u3, v_provider, d[3], s, NULL, true, true, true, 'he'), 'ALREADY_BOOKED');

  SELECT count(*) INTO v_n FROM public.waitlist_entries WHERE user_id IN (u1, u2, u3);
  PERFORM pg_temp.expect('refusals wrote nothing', v_n::text, '0');

  -- ── Joins, one-per-day ─────────────────────────────────────────────────────
  PERFORM pg_temp.expect('OK named member', pg_temp.wl_join(u1, v_provider, d[1], s, sx, true, false, true, 'ar'), 'OK');
  SELECT w.id INTO v_e1 FROM public.waitlist_entries w WHERE w.user_id = u1 AND w.entry_date = d[1] AND w.status = 'active';
  IF NOT EXISTS (SELECT 1 FROM public.waitlist_entries w
                  WHERE w.id = v_e1 AND w.provider_id = v_provider AND w.service_id = s AND w.staff_id = sx
                    AND w.wants_morning AND NOT w.wants_afternoon AND w.wants_evening
                    AND w.notify_lang = 'ar' AND w.notify_count = 0 AND w.ended_at IS NULL) THEN
    RAISE EXCEPTION 'FAIL OK named member: stored row is wrong';
  END IF;
  PERFORM pg_temp.expect('OK anyone, same day other customer', pg_temp.wl_join(u2, v_provider, d[1], s, NULL, true, true, true, 'en'), 'OK');
  PERFORM pg_temp.expect('ALREADY_ON_LIST', pg_temp.wl_join(u1, v_provider, d[1], s, NULL, true, true, true, 'he'), 'ALREADY_ON_LIST');

  -- ── Max 5 active, today onward ─────────────────────────────────────────────
  -- A past-dated entry housekeeping has not expired yet must not count.
  INSERT INTO public.waitlist_entries (user_id, provider_id, entry_date, service_id, wants_morning)
    VALUES (u1, v_provider, v_today - 1, s, true);
  PERFORM pg_temp.expect('LIMIT join 2', pg_temp.wl_join(u1, v_provider, d[4], s, NULL, true, true, true, 'he'), 'OK');
  PERFORM pg_temp.expect('LIMIT join 3', pg_temp.wl_join(u1, v_provider, d[5], s, NULL, true, true, true, 'he'), 'OK');
  PERFORM pg_temp.expect('LIMIT join 4', pg_temp.wl_join(u1, v_provider, d[6], s, NULL, true, true, true, 'he'), 'OK');
  PERFORM pg_temp.expect('LIMIT join 5', pg_temp.wl_join(u1, v_provider, d[7], s, NULL, true, true, true, 'he'), 'OK');
  PERFORM pg_temp.expect('LIMIT_REACHED 6th', pg_temp.wl_join(u1, v_provider, d[8], s, NULL, true, true, true, 'he'), 'LIMIT_REACHED');

  -- ── Leave ──────────────────────────────────────────────────────────────────
  PERFORM pg_temp.expect('leave someone else''s', pg_temp.wl_leave(u2, v_e1), 'NOT_FOUND');
  PERFORM pg_temp.expect('leave signed out',      pg_temp.wl_leave(NULL, v_e1), 'NOT_FOUND');
  PERFORM pg_temp.expect('leave unknown',         pg_temp.wl_leave(u1, gen_random_uuid()), 'NOT_FOUND');
  IF NOT EXISTS (SELECT 1 FROM public.waitlist_entries WHERE id = v_e1 AND status = 'active') THEN
    RAISE EXCEPTION 'FAIL leave: a refused leave changed the entry';
  END IF;
  PERFORM pg_temp.expect('leave own', pg_temp.wl_leave(u1, v_e1), 'OK');
  SELECT ended_at INTO v_ended FROM public.waitlist_entries WHERE id = v_e1 AND status = 'left';
  IF v_ended IS NULL THEN RAISE EXCEPTION 'FAIL leave own: not status left with ended_at'; END IF;
  PERFORM pg_temp.expect('leave twice', pg_temp.wl_leave(u1, v_e1), 'OK');
  IF NOT EXISTS (SELECT 1 FROM public.waitlist_entries WHERE id = v_e1 AND status = 'left' AND ended_at = v_ended) THEN
    RAISE EXCEPTION 'FAIL leave twice: the ended entry changed';
  END IF;
  -- An entry that ended some other way keeps its status and ended_at.
  UPDATE public.waitlist_entries SET status = 'expired', ended_at = now() - interval '1 day'
   WHERE user_id = u1 AND entry_date = v_today - 1 AND status = 'active'
   RETURNING id INTO v_e1b;
  PERFORM pg_temp.expect('leave expired', pg_temp.wl_leave(u1, v_e1b), 'OK');
  IF NOT EXISTS (SELECT 1 FROM public.waitlist_entries
                  WHERE id = v_e1b AND status = 'expired' AND ended_at < now() - interval '23 hours') THEN
    RAISE EXCEPTION 'FAIL leave expired: an ended entry was changed';
  END IF;

  -- Rejoin the same day after leaving: a NEW entry; the limit is full again after.
  PERFORM pg_temp.expect('rejoin after leave', pg_temp.wl_join(u1, v_provider, d[1], s, NULL, true, true, true, 'he'), 'OK');
  SELECT w.id INTO v_e1b FROM public.waitlist_entries w WHERE w.user_id = u1 AND w.entry_date = d[1] AND w.status = 'active';
  IF v_e1b IS NULL OR v_e1b = v_e1 THEN RAISE EXCEPTION 'FAIL rejoin: expected a new entry'; END IF;
  PERFORM pg_temp.expect('LIMIT_REACHED after rejoin', pg_temp.wl_join(u1, v_provider, d[8], s, NULL, true, true, true, 'he'), 'LIMIT_REACHED');

  RAISE EXCEPTION 'PASS: every check passed. This error is deliberate — it rolled back the test services, staff, sessions, bookings, roles, entries and the provider''s settings. Nothing was persisted.';
END
$verify$;

-- B-after. Expect 0 and 0.
SELECT count(*) AS leftover_services FROM public.provider_services WHERE name LIKE 'WL VERIFY 3B%';
SELECT count(*) AS leftover_bookings FROM public.bookings WHERE customer_name = 'WAITLIST VERIFY';


-- ═════════════════════════════════════════════════════════════════════════════
-- §E. ROLLBACK — commented out
-- ═════════════════════════════════════════════════════════════════════════════
-- Entries already created stay (they are ordinary rows the dispatcher reads).
--
-- BEGIN;
-- DROP FUNCTION IF EXISTS public.waitlist_join(uuid, date, uuid, uuid, boolean, boolean, boolean, text);
-- DROP FUNCTION IF EXISTS public.waitlist_leave(uuid);
-- COMMIT;
