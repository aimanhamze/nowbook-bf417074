-- VERIFY for 20261109000001_recurring_series.sql
--
--   §0  BEFORE the migration, read-only. DEV, then PROD before the prod apply.
--   §A  after the migration, read-only. DEV and PROD.
--   §B  after the migration, DEV ONLY. Behaviour tests, all rolled back.
--   §E  rollback (commented out).
--
-- ── DEV RE-APPLY (one time, 2026-11-10) ──────────────────────────────────────
-- DEV has the FIRST version of the migration (before the DEFINER session
-- helper). The file uses CREATE, not CREATE OR REPLACE, so it cannot simply be
-- re-run. Nothing real lives in the new objects (§B rolls back, no app code
-- uses them), so on DEV only:
--   1. §E below, uncommented — drops everything the first version created
--      (DROP … IF EXISTS, so the helper's absence is fine).
--   2. §0.1 → one row, all NULL / false.  §0.2 → must equal the DEV row you
--      saved before the first apply (proves the rollback left bookings as it
--      found it).
--   3. The migration file → §A (A5 = §0.2 again).
--   4. supabase/scripts/dev_only_parity_provider_sessions_policies.sql
--   5. §B.
-- PROD never had the first version: plain §0 → migration → §A.


-- ═════════════════════════════════════════════════════════════════════════════
-- §0. PRE-APPLY — REQUIRED, READ-ONLY
-- ═════════════════════════════════════════════════════════════════════════════

-- 0.1 Every new name is free. Expect one row, all eight columns NULL / false.
SELECT to_regclass('public.recurring_series')               AS series_tbl,
       to_regprocedure('public.recurring_series_service_eligible(uuid, uuid, date)') AS eligible_fn,
       to_regclass('public.recurring_series_cancellations') AS cancels_tbl,
       to_regprocedure('public.guard_booking_series_id()')  AS guard_fn,
       to_regprocedure('public.create_recurring_series(uuid, uuid, uuid, text, date[], integer, text, text, text, boolean)') AS create_fn,
       to_regprocedure('public.cancel_recurring_series(uuid, text)') AS cancel_fn,
       EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.bookings'::regclass
                AND attname = 'series_id' AND NOT attisdropped) AS series_col,
       EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.bookings'::regclass
                AND tgname = 'trg_guard_booking_series_id') AS guard_trg;

-- 0.2 FINGERPRINTS — SAVE THIS ROW. §A5 runs the same query and must match it
--     exactly: the migration may not change any existing bookings trigger,
--     trigger function body (prevent_booking_conflicts included) or policy.
SELECT
  (SELECT md5(string_agg(t.tgname || '|' || pg_get_triggerdef(t.oid) || '|' || md5(replace(p.prosrc, E'\r', '')),
                         '#' ORDER BY t.tgname))
     FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
    WHERE t.tgrelid = 'public.bookings'::regclass AND NOT t.tgisinternal
      AND t.tgname <> 'trg_guard_booking_series_id')                       AS triggers_md5,
  (SELECT count(*) FROM pg_trigger t
    WHERE t.tgrelid = 'public.bookings'::regclass AND NOT t.tgisinternal
      AND t.tgname <> 'trg_guard_booking_series_id')                       AS trigger_count,
  (SELECT md5(replace(p.prosrc, E'\r', '')) FROM pg_proc p
    WHERE p.oid = 'public.prevent_booking_conflicts()'::regprocedure)      AS conflicts_md5,
  (SELECT md5(string_agg(policyname || '|' || cmd || '|' || coalesce(qual, '') || '|' || coalesce(with_check, ''),
                         '#' ORDER BY policyname))
     FROM pg_policies WHERE schemaname = 'public' AND tablename = 'bookings') AS policies_md5;

-- 0.3 Every column the new code reads or writes. Expect 21 rows, these types:
--   bookings           booking_date date, booking_time text, customer_name text,
--                      customer_phone text, guest_notes text, provider_id uuid,
--                      service_ids uuid[], staff_id uuid, status text,
--                      total_price numeric (or integer — note which), user_id uuid,
--                      whatsapp_consent boolean
--   provider_profiles  category text, user_id uuid
--   provider_services  is_active boolean, price numeric (or integer), service_type text
--   provider_staff     is_active boolean, provider_id uuid
--   provider_sessions  service_id uuid, session_date date
SELECT c.relname AS tbl, a.attname AS col, format_type(a.atttypid, a.atttypmod) AS type
FROM pg_attribute a
JOIN pg_class c ON c.oid = a.attrelid AND c.relnamespace = 'public'::regnamespace
WHERE a.attnum > 0 AND NOT a.attisdropped
  AND (c.relname, a.attname) IN (
    ('bookings', 'booking_date'), ('bookings', 'booking_time'), ('bookings', 'customer_name'),
    ('bookings', 'customer_phone'), ('bookings', 'guest_notes'), ('bookings', 'provider_id'),
    ('bookings', 'service_ids'), ('bookings', 'staff_id'), ('bookings', 'status'),
    ('bookings', 'total_price'), ('bookings', 'user_id'), ('bookings', 'whatsapp_consent'),
    ('provider_profiles', 'category'), ('provider_profiles', 'user_id'),
    ('provider_services', 'is_active'), ('provider_services', 'price'), ('provider_services', 'service_type'),
    ('provider_staff', 'is_active'), ('provider_staff', 'provider_id'),
    ('provider_sessions', 'service_id'), ('provider_sessions', 'session_date'))
ORDER BY 1, 2;

-- 0.4 The walk-in INSERT policy the INVOKER create path relies on.
--     Expect 1 row: cmd INSERT, roles {authenticated}, with_check naming
--     provider_profiles and auth.uid().
SELECT policyname, cmd, roles, with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'bookings'
  AND policyname = 'Providers can create bookings for their business';


-- ═════════════════════════════════════════════════════════════════════════════
-- §A. AFTER THE MIGRATION — READ-ONLY
-- ═════════════════════════════════════════════════════════════════════════════

-- A1. Tables + RLS + policies. Expect 3 rows:
--   recurring_series               | t | Owners create own recurring series   | INSERT
--   recurring_series               | t | Owners read own recurring series     | SELECT
--   recurring_series_cancellations | t | Owners read own series cancellations | SELECT
SELECT c.relname, c.relrowsecurity, p.policyname, p.cmd
FROM pg_class c
LEFT JOIN pg_policies p ON p.schemaname = 'public' AND p.tablename = c.relname
WHERE c.oid IN ('public.recurring_series'::regclass, 'public.recurring_series_cancellations'::regclass)
ORDER BY 1, 3;

-- A2. Table grants. Expect:
--   recurring_series               anon: none   authenticated: SELECT, INSERT only
--   recurring_series_cancellations anon: none   authenticated: SELECT only
SELECT t.tbl, r.role,
       has_table_privilege(r.role, t.tbl, 'SELECT') AS sel,
       has_table_privilege(r.role, t.tbl, 'INSERT') AS ins,
       has_table_privilege(r.role, t.tbl, 'UPDATE') AS upd,
       has_table_privilege(r.role, t.tbl, 'DELETE') AS del
FROM (VALUES ('public.recurring_series'), ('public.recurring_series_cancellations')) AS t(tbl)
CROSS JOIN (VALUES ('anon'), ('authenticated')) AS r(role)
ORDER BY 1, 2;

-- A3. Functions. Expect 4 rows:
--   cancel_recurring_series            prosecdef t  anon f  authenticated t
--   create_recurring_series            prosecdef f  anon f  authenticated t
--   guard_booking_series_id            prosecdef t  anon f  authenticated f
--   recurring_series_service_eligible  prosecdef t  anon f  authenticated t
--   all with proconfig {"search_path=public, pg_temp"}
SELECT p.proname, p.prosecdef, p.proconfig,
       has_function_privilege('anon', p.oid, 'EXECUTE')          AS anon,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated
FROM pg_proc p
WHERE p.oid IN (to_regprocedure('public.guard_booking_series_id()'),
                to_regprocedure('public.recurring_series_service_eligible(uuid, uuid, date)'),
                to_regprocedure('public.create_recurring_series(uuid, uuid, uuid, text, date[], integer, text, text, text, boolean)'),
                to_regprocedure('public.cancel_recurring_series(uuid, text)'))
ORDER BY 1;

-- A4. The new column + trigger. Expect:
--   series_id | uuid | nullable, no default, FK → recurring_series ON DELETE SET NULL
--   trg_guard_booking_series_id | O | BEFORE INSERT OR UPDATE OF series_id … FOR EACH ROW
SELECT a.attname, format_type(a.atttypid, a.atttypmod) AS type, a.attnotnull, a.atthasdef,
       (SELECT pg_get_constraintdef(co.oid) FROM pg_constraint co
         WHERE co.conrelid = 'public.bookings'::regclass AND co.contype = 'f'
           AND co.conkey = ARRAY[a.attnum]) AS fk
FROM pg_attribute a
WHERE a.attrelid = 'public.bookings'::regclass AND a.attname = 'series_id';

SELECT tgname, tgenabled, pg_get_triggerdef(oid)
FROM pg_trigger
WHERE tgrelid = 'public.bookings'::regclass AND tgname = 'trg_guard_booking_series_id';

-- A5. Re-run §0.2 above. All four values must equal the row you saved.


-- ═════════════════════════════════════════════════════════════════════════════
-- §B. BEHAVIOUR TESTS — DEV ONLY, PERSISTS NOTHING
-- ═════════════════════════════════════════════════════════════════════════════
-- Calls the RPCs as the provider's owner and as a customer, with the real
-- `authenticated` role (SET LOCAL ROLE) so RLS applies exactly as from the
-- app. Covers: every refusal code; a pre-taken date skipped and reported; a
-- series reaching past 60 days; ALL_TAKEN writing nothing; a single survivor;
-- the series_id guard; no client insert into the cancellations table; both
-- cancel scopes leaving past bookings alone; one waiting-list event per
-- cancelled booking.
--
-- ⚠  THE BLOCK ALWAYS ENDS IN AN ERROR — that is how it rolls back.
--      SUCCESS = an error starting "PASS:".   Anything else = report it.
--
-- SETUP: set v_provider to a DEV provider_profiles.id whose user_id is a real
-- auth user. DEV needs 1 other auth user with no provider/admin role.

DO $verify$
DECLARE
  v_provider uuid := NULL;   -- ← SET THIS to a DEV provider_profiles.id

  v_today date := (now() AT TIME ZONE 'Asia/Jerusalem')::date;
  v_owner uuid; v_cust uuid; v_cat text;
  d date[]; v_past date; v_off integer;
  s uuid; sg uuid; si uuid; ss uuid; st uuid; st_off uuid;
  r jsonb; v_series uuid; v_series2 uuid;
  v_n integer; v_series_before integer;
  v_b1 uuid; v_b6 uuid; v_past_b uuid; v_ids uuid[];
BEGIN
  IF v_provider IS NULL THEN RAISE EXCEPTION 'SETUP: set v_provider first'; END IF;
  IF to_regprocedure('public.cancel_recurring_series(uuid, text)') IS NULL THEN
    RAISE EXCEPTION 'SETUP: the migration is not applied';
  END IF;

  -- ── Helpers, dropped with the rollback ─────────────────────────────────────
  -- JWT claims only (auth.uid()); NULL = no user, i.e. SQL editor.
  CREATE FUNCTION pg_temp.rs_as(p_uid uuid) RETURNS void LANGUAGE sql AS $h$
    SELECT set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true),
           set_config('request.jwt.claims',
                      CASE WHEN p_uid IS NULL THEN '' ELSE json_build_object('sub', p_uid, 'role', 'authenticated')::text END,
                      true);
  $h$;
  -- create_recurring_series as p_uid under the authenticated role → jsonb rows.
  CREATE FUNCTION pg_temp.rs_create(p_uid uuid, p_prov uuid, p_svc uuid, p_staff uuid, p_time text,
                                    p_dates date[], p_req integer, p_name text, p_phone text,
                                    p_notes text, p_consent boolean)
  RETURNS jsonb LANGUAGE plpgsql AS $h$
  DECLARE v jsonb;
  BEGIN
    PERFORM pg_temp.rs_as(p_uid);
    SET LOCAL ROLE authenticated;
    SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.r_date), '[]'::jsonb) INTO v
      FROM public.create_recurring_series(p_prov, p_svc, p_staff, p_time, p_dates, p_req,
                                          p_name, p_phone, p_notes, p_consent) x;
    RESET ROLE;
    PERFORM pg_temp.rs_as(NULL);
    RETURN v;
  END $h$;
  CREATE FUNCTION pg_temp.rs_cancel(p_uid uuid, p_booking uuid, p_scope text)
  RETURNS jsonb LANGUAGE plpgsql AS $h$
  DECLARE v jsonb;
  BEGIN
    PERFORM pg_temp.rs_as(p_uid);
    SET LOCAL ROLE authenticated;
    SELECT to_jsonb(x) INTO v FROM public.cancel_recurring_series(p_booking, p_scope) x;
    RESET ROLE;
    PERFORM pg_temp.rs_as(NULL);
    RETURN v;
  END $h$;
  -- Runs p_sql as p_uid under the authenticated role. 'OK' or the error text.
  CREATE FUNCTION pg_temp.rs_try(p_uid uuid, p_sql text) RETURNS text LANGUAGE plpgsql AS $h$
  BEGIN
    PERFORM pg_temp.rs_as(p_uid);
    SET LOCAL ROLE authenticated;
    EXECUTE p_sql;
    RESET ROLE;
    PERFORM pg_temp.rs_as(NULL);
    RETURN 'OK';
  EXCEPTION WHEN OTHERS THEN
    RETURN SQLERRM;   -- the failed block's SET LOCAL ROLE / claims roll back with it
  END $h$;
  CREATE FUNCTION pg_temp.expect(p_label text, p_got text, p_want text) RETURNS void LANGUAGE plpgsql AS $h$
  BEGIN
    IF p_got IS DISTINCT FROM p_want THEN
      RAISE EXCEPTION 'FAIL %: got %, want %', p_label, coalesce(p_got, 'NULL'), p_want;
    END IF;
  END $h$;
  -- First row's code of a create result.
  CREATE FUNCTION pg_temp.code(p jsonb) RETURNS text LANGUAGE sql AS $h$ SELECT p->0->>'r_code' $h$;

  PERFORM pg_temp.rs_as(NULL);

  -- ── Setup (as the SQL editor: no user) ─────────────────────────────────────
  SELECT pp.user_id, pp.category INTO v_owner, v_cat FROM public.provider_profiles pp WHERE pp.id = v_provider;
  IF v_owner IS NULL THEN RAISE EXCEPTION 'SETUP: provider % not found or has no user_id', v_provider; END IF;
  IF v_cat IS NOT DISTINCT FROM 'fitness_studio' THEN
    RAISE EXCEPTION 'SETUP: pick a provider that is not a fitness_studio';
  END IF;

  SELECT u.id INTO v_cust FROM auth.users u
   WHERE u.id <> v_owner
     AND NOT EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = u.id AND ur.role::text IN ('provider', 'admin'))
   ORDER BY u.created_at, u.id LIMIT 1;
  IF v_cust IS NULL THEN RAISE EXCEPTION 'SETUP: need 1 customer account'; END IF;

  -- 12 weekly dates from tomorrow-or-later with no active booking that day, so
  -- the series spans 77 days — past the client's 60-day window on purpose.
  FOR v_off IN 1..60 LOOP
    SELECT array_agg(v_today + v_off + 7 * k ORDER BY k) INTO d
      FROM generate_series(0, 11) AS k
     WHERE NOT EXISTS (SELECT 1 FROM public.bookings b
                        WHERE b.provider_id = v_provider AND b.booking_date = v_today + v_off + 7 * k
                          AND b.status IN ('confirmed', 'pending'));
    EXIT WHEN cardinality(d) = 12;
  END LOOP;
  IF coalesce(cardinality(d), 0) < 12 THEN RAISE EXCEPTION 'SETUP: no weekday with 12 free weeks'; END IF;

  SELECT g::date INTO v_past FROM generate_series(v_today - 1, v_today - 30, interval '-1 day') g
   WHERE NOT EXISTS (SELECT 1 FROM public.bookings b
                      WHERE b.provider_id = v_provider AND b.booking_date = g::date
                        AND b.status IN ('confirmed', 'pending'))
   LIMIT 1;
  IF v_past IS NULL THEN RAISE EXCEPTION 'SETUP: no free past day in the last 30'; END IF;

  INSERT INTO public.provider_services (provider_id, name, duration, price, service_type, max_capacity)
    VALUES (v_provider, 'RS VERIFY', 30, 120, 'private', 1) RETURNING id INTO s;
  INSERT INTO public.provider_services (provider_id, name, duration, price, service_type, max_capacity)
    VALUES (v_provider, 'RS VERIFY GROUP', 30, 50, 'group', 10) RETURNING id INTO sg;
  INSERT INTO public.provider_services (provider_id, name, duration, price, service_type, max_capacity, is_active)
    VALUES (v_provider, 'RS VERIFY INACTIVE', 30, 50, 'private', 1, false) RETURNING id INTO si;
  INSERT INTO public.provider_services (provider_id, name, duration, price, service_type, max_capacity)
    VALUES (v_provider, 'RS VERIFY SESS', 30, 50, 'private', 1) RETURNING id INTO ss;
  INSERT INTO public.provider_sessions (provider_id, service_id, session_date, session_time)
    VALUES (v_provider, ss, d[12], '10:00');
  INSERT INTO public.provider_staff (provider_id, name) VALUES (v_provider, 'RS VERIFY A') RETURNING id INTO st;
  INSERT INTO public.provider_staff (provider_id, name, is_active) VALUES (v_provider, 'RS VERIFY OFF', false) RETURNING id INTO st_off;

  -- d[3] at 10:00 is already taken (a plain walk-in) — for the SAME member:
  -- the conflict trigger keeps staff lanes, so a NULL-staff booking would not
  -- block member A.
  INSERT INTO public.bookings (provider_id, user_id, service_ids, booking_date, booking_time, total_price, status, customer_name, customer_phone, staff_id)
    VALUES (v_provider, NULL, ARRAY[s], d[3], '10:00', 120, 'confirmed', 'RS VERIFY BLOCKER', '0500000000', st);

  SELECT count(*) INTO v_series_before FROM public.recurring_series WHERE provider_id = v_provider;

  -- ── Refusals: one row, nothing written ─────────────────────────────────────
  PERFORM pg_temp.expect('NOT_OWNER customer', pg_temp.code(pg_temp.rs_create(v_cust, v_provider, s, NULL, '14:00', d[1:2], 2, 'N', '050', NULL, false)), 'NOT_OWNER');
  PERFORM pg_temp.expect('NOT_OWNER signed out', pg_temp.code(pg_temp.rs_create(NULL, v_provider, s, NULL, '14:00', d[1:2], 2, 'N', '050', NULL, false)), 'NOT_OWNER');
  PERFORM pg_temp.expect('NOT_OWNER unknown provider', pg_temp.code(pg_temp.rs_create(v_owner, gen_random_uuid(), s, NULL, '14:00', d[1:2], 2, 'N', '050', NULL, false)), 'NOT_OWNER');

  -- FIRST service check, on purpose: a session service is refused even when
  -- the caller can see NO session rows at all (DEV's drifted state: RLS on,
  -- zero policies). A restrictive policy hides every row for this check only
  -- and rolls back with the block. It must run before any other call reaches
  -- the eligibility helper: a SQL function's plan is cached for the rest of
  -- the transaction, so a call made before the policy existed would hide the
  -- policy from this one and the check would prove nothing.
  CREATE POLICY rs_verify_hide_all ON public.provider_sessions AS RESTRICTIVE FOR SELECT TO authenticated USING (false);
  IF pg_temp.rs_try(v_owner, format('DO $x$ BEGIN IF EXISTS (SELECT 1 FROM public.provider_sessions WHERE service_id = %L) THEN RAISE EXCEPTION ''VISIBLE''; END IF; END $x$', ss)) <> 'OK' THEN
    RAISE EXCEPTION 'SETUP: the hiding policy did not hide the session row';
  END IF;
  PERFORM pg_temp.expect('SERVICE sessions, rows hidden by RLS', pg_temp.code(pg_temp.rs_create(v_owner, v_provider, ss, NULL, '14:00', d[1:2], 2, 'N', '050', NULL, false)), 'SERVICE_INVALID');
  DROP POLICY rs_verify_hide_all ON public.provider_sessions;

  PERFORM pg_temp.expect('SERVICE group',    pg_temp.code(pg_temp.rs_create(v_owner, v_provider, sg, NULL, '14:00', d[1:2], 2, 'N', '050', NULL, false)), 'SERVICE_INVALID');
  PERFORM pg_temp.expect('SERVICE inactive', pg_temp.code(pg_temp.rs_create(v_owner, v_provider, si, NULL, '14:00', d[1:2], 2, 'N', '050', NULL, false)), 'SERVICE_INVALID');
  PERFORM pg_temp.expect('SERVICE sessions', pg_temp.code(pg_temp.rs_create(v_owner, v_provider, ss, NULL, '14:00', d[1:2], 2, 'N', '050', NULL, false)), 'SERVICE_INVALID');
  PERFORM pg_temp.expect('SERVICE unknown',  pg_temp.code(pg_temp.rs_create(v_owner, v_provider, gen_random_uuid(), NULL, '14:00', d[1:2], 2, 'N', '050', NULL, false)), 'SERVICE_INVALID');
  UPDATE public.provider_profiles SET category = 'fitness_studio' WHERE id = v_provider;
  PERFORM pg_temp.expect('SERVICE fitness_studio', pg_temp.code(pg_temp.rs_create(v_owner, v_provider, s, NULL, '14:00', d[1:2], 2, 'N', '050', NULL, false)), 'SERVICE_INVALID');
  UPDATE public.provider_profiles SET category = v_cat WHERE id = v_provider;

  PERFORM pg_temp.expect('STAFF inactive', pg_temp.code(pg_temp.rs_create(v_owner, v_provider, s, st_off, '14:00', d[1:2], 2, 'N', '050', NULL, false)), 'STAFF_INVALID');
  PERFORM pg_temp.expect('STAFF unknown',  pg_temp.code(pg_temp.rs_create(v_owner, v_provider, s, gen_random_uuid(), '14:00', d[1:2], 2, 'N', '050', NULL, false)), 'STAFF_INVALID');

  PERFORM pg_temp.expect('BAD count 1',      pg_temp.code(pg_temp.rs_create(v_owner, v_provider, s, NULL, '14:00', d[1:1], 1, 'N', '050', NULL, false)), 'BAD_REQUEST');
  PERFORM pg_temp.expect('BAD count 13',     pg_temp.code(pg_temp.rs_create(v_owner, v_provider, s, NULL, '14:00', d[1:2], 13, 'N', '050', NULL, false)), 'BAD_REQUEST');
  PERFORM pg_temp.expect('BAD time 24:00',   pg_temp.code(pg_temp.rs_create(v_owner, v_provider, s, NULL, '24:00', d[1:2], 2, 'N', '050', NULL, false)), 'BAD_REQUEST');
  PERFORM pg_temp.expect('BAD time 9:00',    pg_temp.code(pg_temp.rs_create(v_owner, v_provider, s, NULL, '9:00', d[1:2], 2, 'N', '050', NULL, false)), 'BAD_REQUEST');
  PERFORM pg_temp.expect('BAD empty name',   pg_temp.code(pg_temp.rs_create(v_owner, v_provider, s, NULL, '14:00', d[1:2], 2, '  ', '050', NULL, false)), 'BAD_REQUEST');
  PERFORM pg_temp.expect('BAD null phone',   pg_temp.code(pg_temp.rs_create(v_owner, v_provider, s, NULL, '14:00', d[1:2], 2, 'N', NULL, NULL, false)), 'BAD_REQUEST');
  PERFORM pg_temp.expect('BAD no dates',     pg_temp.code(pg_temp.rs_create(v_owner, v_provider, s, NULL, '14:00', '{}'::date[], 2, 'N', '050', NULL, false)), 'BAD_REQUEST');
  PERFORM pg_temp.expect('BAD null dates',   pg_temp.code(pg_temp.rs_create(v_owner, v_provider, s, NULL, '14:00', NULL, 2, 'N', '050', NULL, false)), 'BAD_REQUEST');
  PERFORM pg_temp.expect('BAD null in dates', pg_temp.code(pg_temp.rs_create(v_owner, v_provider, s, NULL, '14:00', ARRAY[d[1], NULL], 2, 'N', '050', NULL, false)), 'BAD_REQUEST');
  PERFORM pg_temp.expect('BAD duplicate',    pg_temp.code(pg_temp.rs_create(v_owner, v_provider, s, NULL, '14:00', ARRAY[d[1], d[1]], 2, 'N', '050', NULL, false)), 'BAD_REQUEST');
  PERFORM pg_temp.expect('BAD past',         pg_temp.code(pg_temp.rs_create(v_owner, v_provider, s, NULL, '14:00', ARRAY[v_today - 7, v_today], 2, 'N', '050', NULL, false)), 'BAD_REQUEST');
  PERFORM pg_temp.expect('BAD not weekly',   pg_temp.code(pg_temp.rs_create(v_owner, v_provider, s, NULL, '14:00', ARRAY[d[1], d[1] + 3], 2, 'N', '050', NULL, false)), 'BAD_REQUEST');
  PERFORM pg_temp.expect('BAD span > count', pg_temp.code(pg_temp.rs_create(v_owner, v_provider, s, NULL, '14:00', ARRAY[d[1], d[3]], 2, 'N', '050', NULL, false)), 'BAD_REQUEST');
  PERFORM pg_temp.expect('BAD more dates than count', pg_temp.code(pg_temp.rs_create(v_owner, v_provider, s, NULL, '14:00', d[1:3], 2, 'N', '050', NULL, false)), 'BAD_REQUEST');

  SELECT count(*) INTO v_n FROM public.recurring_series WHERE provider_id = v_provider;
  PERFORM pg_temp.expect('refusals wrote no series', v_n::text, v_series_before::text);
  SELECT count(*) INTO v_n FROM public.bookings WHERE provider_id = v_provider AND booking_time = '14:00' AND booking_date = ANY (d);
  PERFORM pg_temp.expect('refusals wrote no bookings', v_n::text, '0');

  -- ── 12 dates, d[3] pre-taken → 11 created, d[3] skipped ────────────────────
  r := pg_temp.rs_create(v_owner, v_provider, s, st, '10:00', d, 12, '  RS Customer ', ' 0501234567 ', '   ', true);
  PERFORM pg_temp.expect('main rows', jsonb_array_length(r)::text, '12');
  SELECT count(*) INTO v_n FROM jsonb_array_elements(r) e WHERE e->>'r_code' = 'OK';
  PERFORM pg_temp.expect('main all OK', v_n::text, '12');
  SELECT count(*) INTO v_n FROM jsonb_array_elements(r) e WHERE e->>'r_outcome' = 'created' AND e->>'r_booking_id' IS NOT NULL;
  PERFORM pg_temp.expect('main created', v_n::text, '11');
  SELECT count(*) INTO v_n FROM jsonb_array_elements(r) e
   WHERE e->>'r_outcome' = 'taken' AND (e->>'r_date')::date = d[3] AND e->>'r_booking_id' IS NULL;
  PERFORM pg_temp.expect('main d3 taken', v_n::text, '1');
  SELECT count(DISTINCT e->>'r_series_id') INTO v_n FROM jsonb_array_elements(r) e;
  PERFORM pg_temp.expect('main one series id', v_n::text, '1');
  v_series := (r->0->>'r_series_id')::uuid;

  IF NOT EXISTS (SELECT 1 FROM public.recurring_series x
                  WHERE x.id = v_series AND x.provider_id = v_provider AND x.service_id = s AND x.staff_id = st
                    AND x.weekday = extract(dow FROM d[1]) AND x.booking_time = '10:00'
                    AND x.requested_count = 12 AND x.created_by = v_owner) THEN
    RAISE EXCEPTION 'FAIL main: series row is wrong';
  END IF;
  SELECT count(*) INTO v_n FROM public.bookings b
   WHERE b.series_id = v_series AND b.user_id IS NULL AND b.provider_id = v_provider
     AND b.service_ids = ARRAY[s] AND b.booking_time = '10:00' AND b.status = 'confirmed'
     AND b.total_price = 120 AND b.customer_name = 'RS Customer' AND b.customer_phone = '0501234567'
     AND b.guest_notes IS NULL AND b.whatsapp_consent AND b.staff_id = st;
  PERFORM pg_temp.expect('main booking rows', v_n::text, '11');
  IF (SELECT max(booking_date) FROM public.bookings WHERE series_id = v_series) <> d[12]
     OR d[12] <= v_today + 60 THEN
    RAISE EXCEPTION 'FAIL main: last date should be d[12], past day 60';
  END IF;

  -- ── Same dates again → every one taken → ALL_TAKEN, nothing written ─────────
  SELECT count(*) INTO v_series_before FROM public.recurring_series WHERE provider_id = v_provider;
  r := pg_temp.rs_create(v_owner, v_provider, s, st, '10:00', d, 12, 'RS Customer', '0501234567', NULL, true);
  SELECT count(*) INTO v_n FROM jsonb_array_elements(r) e
   WHERE e->>'r_code' = 'ALL_TAKEN' AND e->>'r_outcome' = 'taken' AND e->>'r_series_id' IS NULL;
  PERFORM pg_temp.expect('ALL_TAKEN rows', v_n::text, '12');
  SELECT count(*) INTO v_n FROM public.recurring_series WHERE provider_id = v_provider;
  PERFORM pg_temp.expect('ALL_TAKEN no series row', v_n::text, v_series_before::text);

  -- ── Single survivor stays a 1-appointment series ───────────────────────────
  INSERT INTO public.bookings (provider_id, user_id, service_ids, booking_date, booking_time, total_price, status, customer_name, customer_phone)
    VALUES (v_provider, NULL, ARRAY[s], d[2], '12:00', 120, 'confirmed', 'RS VERIFY BLOCKER', '0500000000');
  r := pg_temp.rs_create(v_owner, v_provider, s, NULL, '12:00', d[1:2], 2, 'RS Solo', '0501234567', 'note', false);
  PERFORM pg_temp.expect('solo code', pg_temp.code(r), 'OK');
  v_series2 := (r->0->>'r_series_id')::uuid;
  SELECT count(*) INTO v_n FROM public.bookings WHERE series_id = v_series2 AND booking_date = d[1] AND staff_id IS NULL AND guest_notes = 'note';
  PERFORM pg_temp.expect('solo one booking', v_n::text, '1');

  -- ── The series_id guard ────────────────────────────────────────────────────
  -- Control first: the customer's own insert works without a series id…
  PERFORM pg_temp.expect('guard control: customer plain insert', pg_temp.rs_try(v_cust, format(
    'INSERT INTO public.bookings (provider_id, user_id, service_ids, booking_date, booking_time, total_price, status) VALUES (%L, %L, ARRAY[%L]::uuid[], %L, ''16:00'', 0, ''confirmed'')',
    v_provider, v_cust, s, d[4])), 'OK');
  -- …and is refused with one.
  PERFORM pg_temp.expect('guard: customer tags a booking', pg_temp.rs_try(v_cust, format(
    'INSERT INTO public.bookings (provider_id, user_id, service_ids, booking_date, booking_time, total_price, status, series_id) VALUES (%L, %L, ARRAY[%L]::uuid[], %L, ''17:00'', 0, ''confirmed'', %L)',
    v_provider, v_cust, s, d[5], v_series)), 'SERIES_ID_INVALID');
  SELECT b.id INTO v_b1 FROM public.bookings b WHERE b.series_id = v_series AND b.booking_date = d[1];
  PERFORM pg_temp.expect('guard: owner clears series_id', pg_temp.rs_try(v_owner, format(
    'UPDATE public.bookings SET series_id = NULL WHERE id = %L', v_b1)), 'SERIES_ID_IMMUTABLE');
  PERFORM pg_temp.expect('guard: owner moves to another series', pg_temp.rs_try(v_owner, format(
    'UPDATE public.bookings SET series_id = %L WHERE id = %L', v_series2, v_b1)), 'SERIES_ID_IMMUTABLE');
  -- Normal updates of a series booking are untouched by the guard.
  PERFORM pg_temp.expect('guard: owner edits notes', pg_temp.rs_try(v_owner, format(
    'UPDATE public.bookings SET guest_notes = ''x'' WHERE id = %L', v_b1)), 'OK');
  -- Nobody but the cancel RPC writes cancellation rows.
  IF pg_temp.rs_try(v_owner, format(
       'INSERT INTO public.recurring_series_cancellations (series_id, provider_id, first_booking_id, first_date, cancelled_count, scope, created_by) VALUES (%L, %L, %L, %L, 1, ''all_upcoming'', %L)',
       v_series, v_provider, v_b1, d[1], v_owner)) NOT LIKE 'permission denied%' THEN
    RAISE EXCEPTION 'FAIL guard: owner could insert a cancellation row';
  END IF;

  -- ── Cancel ─────────────────────────────────────────────────────────────────
  -- A PAST booking in the series (inserted from the SQL editor, which the guard
  -- allows); neither scope may touch it.
  INSERT INTO public.bookings (provider_id, user_id, service_ids, booking_date, booking_time, total_price, status, customer_name, customer_phone, series_id)
    VALUES (v_provider, NULL, ARRAY[s], v_past, '10:00', 120, 'confirmed', 'RS Customer', '0501234567', v_series)
    RETURNING id INTO v_past_b;

  PERFORM pg_temp.expect('cancel BAD_SCOPE', pg_temp.rs_cancel(v_owner, v_b1, 'everything')->>'r_code', 'BAD_SCOPE');
  PERFORM pg_temp.expect('cancel customer',  pg_temp.rs_cancel(v_cust, v_b1, 'all_upcoming')->>'r_code', 'NOT_FOUND');
  PERFORM pg_temp.expect('cancel signed out', pg_temp.rs_cancel(NULL, v_b1, 'all_upcoming')->>'r_code', 'NOT_FOUND');
  PERFORM pg_temp.expect('cancel unknown',   pg_temp.rs_cancel(v_owner, gen_random_uuid(), 'all_upcoming')->>'r_code', 'NOT_FOUND');
  PERFORM pg_temp.expect('cancel non-series booking', pg_temp.rs_cancel(v_owner,
    (SELECT id FROM public.bookings WHERE provider_id = v_provider AND booking_date = d[3] AND booking_time = '10:00'),
    'all_upcoming')->>'r_code', 'NOT_FOUND');

  -- from_here at d[6]: d[6]..d[12] = 7 bookings (d[3] was never in the series).
  SELECT b.id INTO v_b6 FROM public.bookings b WHERE b.series_id = v_series AND b.booking_date = d[6];
  SELECT array_agg(b.id) INTO v_ids FROM public.bookings b WHERE b.series_id = v_series AND b.booking_date >= d[6];
  r := pg_temp.rs_cancel(v_owner, v_b6, 'from_here');
  PERFORM pg_temp.expect('from_here code',  r->>'r_code', 'OK');
  PERFORM pg_temp.expect('from_here count', r->>'r_cancelled_count', '7');
  PERFORM pg_temp.expect('from_here first booking', r->>'r_first_booking_id', v_b6::text);
  PERFORM pg_temp.expect('from_here first date', r->>'r_first_date', d[6]::text);
  SELECT count(*) INTO v_n FROM public.bookings WHERE id = ANY (v_ids) AND status = 'cancelled';
  PERFORM pg_temp.expect('from_here cancelled rows', v_n::text, '7');
  SELECT count(*) INTO v_n FROM public.bookings WHERE series_id = v_series AND status = 'confirmed';
  PERFORM pg_temp.expect('from_here left d1 d2 d4 d5 + past', v_n::text, '5');
  IF NOT EXISTS (SELECT 1 FROM public.recurring_series_cancellations c
                  WHERE c.id = (r->>'r_cancellation_id')::uuid AND c.series_id = v_series
                    AND c.provider_id = v_provider AND c.first_booking_id = v_b6 AND c.first_date = d[6]
                    AND c.cancelled_count = 7 AND c.scope = 'from_here' AND c.created_by = v_owner) THEN
    RAISE EXCEPTION 'FAIL from_here: cancellation row is wrong';
  END IF;
  -- The waiting list saw every freed slot, one event each.
  IF to_regclass('public.waitlist_events') IS NOT NULL THEN
    SELECT count(*) INTO v_n FROM public.waitlist_events WHERE booking_id = ANY (v_ids);
    PERFORM pg_temp.expect('from_here waitlist events', v_n::text, '7');
  END IF;

  -- all_upcoming from d[1]: d[1], d[2], d[4], d[5] = 4. The past one stays.
  r := pg_temp.rs_cancel(v_owner, v_b1, 'all_upcoming');
  PERFORM pg_temp.expect('all_upcoming code',  r->>'r_code', 'OK');
  PERFORM pg_temp.expect('all_upcoming count', r->>'r_cancelled_count', '4');
  PERFORM pg_temp.expect('all_upcoming first date', r->>'r_first_date', d[1]::text);
  PERFORM pg_temp.expect('past booking untouched',
    (SELECT status FROM public.bookings WHERE id = v_past_b), 'confirmed');
  -- Calling it from the past booking reaches nothing that is left.
  PERFORM pg_temp.expect('nothing left', pg_temp.rs_cancel(v_owner, v_past_b, 'all_upcoming')->>'r_code', 'NOTHING_TO_CANCEL');
  SELECT count(*) INTO v_n FROM public.recurring_series_cancellations WHERE series_id = v_series;
  PERFORM pg_temp.expect('two cancellation rows', v_n::text, '2');

  -- No WhatsApp ledger row came from any of this (nothing here sends).
  SELECT count(*) INTO v_n FROM public.whatsapp_send_log l
    JOIN public.bookings b ON b.id = l.booking_id WHERE b.series_id IN (v_series, v_series2);
  PERFORM pg_temp.expect('no whatsapp ledger rows', v_n::text, '0');

  RAISE EXCEPTION 'PASS: recurring series — all checks passed (rolled back)';
END
$verify$;


-- ═════════════════════════════════════════════════════════════════════════════
-- §E. ROLLBACK — commented out. Only before any client phase ships.
-- ═════════════════════════════════════════════════════════════════════════════
-- BEGIN;
-- DROP FUNCTION IF EXISTS public.cancel_recurring_series(uuid, text);
-- DROP FUNCTION IF EXISTS public.create_recurring_series(uuid, uuid, uuid, text, date[], integer, text, text, text, boolean);
-- DROP FUNCTION IF EXISTS public.recurring_series_service_eligible(uuid, uuid, date);
-- DROP TRIGGER  IF EXISTS trg_guard_booking_series_id ON public.bookings;
-- DROP FUNCTION IF EXISTS public.guard_booking_series_id();
-- DROP TABLE    IF EXISTS public.recurring_series_cancellations;
-- ALTER TABLE public.bookings DROP COLUMN IF EXISTS series_id;
-- DROP TABLE    IF EXISTS public.recurring_series;
-- COMMIT;
-- Then re-run §0.1 (all NULL / false) and §0.2 (must equal the saved row).
