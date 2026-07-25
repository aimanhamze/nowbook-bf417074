-- VERIFY for 20260724000002_staff_aware_conflicts.sql
-- Run AFTER applying the migration.
-- Sections 1-4 are read-only structural checks. Section 5 is the behavioral
-- matrix: every INSERT/UPDATE happens inside a DO-block SUBTRANSACTION that is
-- ALWAYS rolled back (either the trigger raises, or we force MATRIX_ROLLBACK)
-- — nothing persists. Fixture UUIDs are pinned to this database (test
-- barbershop, its 2 staff, a parallel-services provider, a group service, a
-- class schedule); if the fixtures are missing the matrix emits one SKIP row.

-- ── 1. The staff predicate is in clauses 5+7 ONLY ────────────────────────────
-- Expect: predicate_occurrences = 2, and same_user_guard_has_predicate = false
-- (the substring between the same-user EXISTS and its DUPLICATE_USER_BOOKING
-- raise must NOT contain the predicate — clause 6 deliberately checks across
-- staff so one customer cannot book two staff members at once).
WITH def AS (
  SELECT pg_get_functiondef('public.prevent_booking_conflicts'::regproc) AS d
)
SELECT
  (length(d) - length(replace(d, 'b.staff_id IS NOT DISTINCT FROM NEW.staff_id', '')))
    / length('b.staff_id IS NOT DISTINCT FROM NEW.staff_id')  AS predicate_occurrences,
  substring(d FROM position('NEW.user_id IS NOT NULL' IN d)
              FOR position('DUPLICATE_USER_BOOKING' IN d)
                  - position('NEW.user_id IS NOT NULL' IN d))
    LIKE '%staff_id%'                                          AS same_user_guard_has_predicate
FROM def;

-- ── 2. Trigger UPDATE OF lists ───────────────────────────────────────────────
-- Expect: trg_prevent_booking_conflicts definition contains
--   "UPDATE OF provider_id, booking_date, booking_time, service_ids, status, staff_id"
-- and trg_enforce_booking_lead_time does NOT contain staff_id (a staff swap
-- changes who serves the booking, not when — lead time only depends on
-- date/time, already in its list).
SELECT tgname,
       pg_get_triggerdef(oid) AS definition,
       pg_get_triggerdef(oid) LIKE '%staff_id%' AS mentions_staff_id
FROM pg_trigger
WHERE tgrelid = 'public.bookings'::regclass AND NOT tgisinternal
ORDER BY tgname;

-- ── 3. get_provider_busy_slots — 4 columns, same properties ──────────────────
-- Expect: result = TABLE(booking_date date, booking_time text,
--                        service_ids text[], staff_id uuid),
--         is_security_definer = true, volatility = 's' (STABLE),
--         config pins search_path.
SELECT pg_get_function_result('public.get_provider_busy_slots'::regproc) AS result,
       p.prosecdef  AS is_security_definer,
       p.provolatile AS volatility,
       p.proconfig  AS config
FROM pg_proc p
WHERE p.oid = 'public.get_provider_busy_slots'::regproc;

-- ── 4. Grants match the original migration ───────────────────────────────────
-- Expect: anon = true, authenticated = true (original 20260531000003 revoked
-- PUBLIC then granted exactly these two).
SELECT
  has_function_privilege('anon',
    'public.get_provider_busy_slots(uuid, date, date)', 'EXECUTE')          AS anon_can_execute,
  has_function_privilege('authenticated',
    'public.get_provider_busy_slots(uuid, date, date)', 'EXECUTE')          AS authenticated_can_execute;

-- ── 5. Behavioral matrix (all mutations rolled back) ─────────────────────────
-- Cases A1-A7: NON-STAFF providers (staff_id NULL everywhere) — behavior must
--   be IDENTICAL to before the migration (NULL IS NOT DISTINCT FROM NULL is
--   true, so the new predicate is a no-op for NULL-vs-NULL rows).
-- Cases B8-B12: the STAFF barbershop — the new behavior.
--
-- Results land in a session TEMP table and are SELECTed after the DO block, so
-- the Supabase SQL editor shows the full matrix as a result grid (RAISE NOTICE
-- output is not displayed there). Each result row is INSERTed inside the
-- case's EXCEPTION handler — i.e. AFTER the probe subtransaction has already
-- rolled back — so verdicts persist while probe bookings/services never do.
-- No ON COMMIT DROP: if the editor autocommits per statement, the temp table
-- would vanish before the DO block ran; session-scoped + DROP IF EXISTS keeps
-- it re-runnable either way. The ordinal column exists only for ORDER BY:
-- plain ORDER BY case_id would sort B10-B12 before B8/B9 alphabetically.
DROP TABLE IF EXISTS matrix_results;
CREATE TEMP TABLE matrix_results (
  ordinal  int,
  case_id  text,
  expected text,
  actual   text,
  verdict  text
);

DO $$
DECLARE
  -- Test barbershop (staff_enabled = true, requires_booking_approval = false)
  BARBER   constant uuid := '7e552c65-eac5-4254-ad4a-c9631fbb3c78';
  STAFF_A  constant uuid := '45f02e8d-ccd2-4b44-bee5-93ad175d006a';  -- נסים
  STAFF_B  constant uuid := '5329932e-96c5-4de5-a397-1122af496e2f';  -- איימן
  SVC_T1   constant uuid := '0955b9bf-2aa9-448f-93e7-0cad97a4e901';  -- 60min private cap1
  -- Non-staff provider with two parallel 5-min services
  PAR_PROV constant uuid := '15f649d2-de46-4e0c-84aa-4cdcbf676976';
  PAR_S1   constant uuid := '3bc512c0-2de2-46a0-9297-096a1ef2d0c3';
  PAR_S2   constant uuid := 'b147e896-134d-48e0-91bf-0ec56980ca96';
  -- Non-staff group service, max_capacity = 2 (50 min)
  GRP_PROV constant uuid := '0851e879-4f87-4ffb-9769-31b6eab40392';
  GRP_SVC  constant uuid := '1a7cbb92-dc03-403e-81a0-f606e077424c';
  -- Fitness class schedule, max_capacity = 5
  CLS_PROV constant uuid := 'e68c1c6c-18fc-4f03-a4f5-d8b8b9e2d44a';
  CLS_ID   constant uuid := 'b5d1a8d3-ec98-49f6-ad48-329b29f8ad85';
  -- Registered account (admin@test.dev) for the same-user-guard cases
  TESTUSER constant uuid := 'f7875cba-542f-48bd-a65b-4084b76a29c9';
  -- Far-future date: beyond every provider's booking window, so no real
  -- bookings collide; not same-day, so the lead-time trigger is skipped.
  D  constant date := DATE '2026-12-30';
  tmp_s1 uuid;  tmp_s2 uuid;  tmp_cap2 uuid;  b2 uuid;

  -- One case = one subtransaction. `steps` runs; if it completes, the case is
  -- "allowed" and MATRIX_ROLLBACK undoes everything; if the trigger raises,
  -- the subtransaction is rolled back by the exception itself.
  actual text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.provider_staff WHERE id = STAFF_A) THEN
    INSERT INTO matrix_results VALUES (0, 'FIXTURES', 'fixtures present', 'MISSING — update the constants at the top of section 5', 'SKIP');
    RETURN;
  END IF;

  -- A1: same service, same time, capacity 1 → BLOCKED (23505)
  BEGIN
    INSERT INTO public.provider_services (id, provider_id, name, duration, price, service_type, max_capacity, is_parallel)
      VALUES (gen_random_uuid(), PAR_PROV, 'matrix-a-priv1', 30, 0, 'private', 1, false) RETURNING id INTO tmp_s1;
    INSERT INTO public.bookings (user_id, provider_id, service_ids, booking_date, booking_time, status, total_price)
      VALUES (NULL, PAR_PROV, ARRAY[tmp_s1], D, '07:00', 'confirmed', 0);
    INSERT INTO public.bookings (user_id, provider_id, service_ids, booking_date, booking_time, status, total_price)
      VALUES (NULL, PAR_PROV, ARRAY[tmp_s1], D, '07:00', 'confirmed', 0);
    RAISE EXCEPTION 'MATRIX_ROLLBACK';
  EXCEPTION WHEN OTHERS THEN
    actual := CASE WHEN SQLERRM = 'MATRIX_ROLLBACK' THEN 'ALLOWED' ELSE SQLSTATE || ' ' || SQLERRM END;
    INSERT INTO matrix_results VALUES (1, 'A1', 'BLOCKED 23505', actual,
      CASE WHEN SQLSTATE = '23505' THEN 'PASS' WHEN actual = 'ALLOWED' THEN 'FAIL' ELSE 'CHECK' END);
  END;

  -- A2: different services, overlapping, neither parallel → BLOCKED (23505)
  BEGIN
    INSERT INTO public.provider_services (id, provider_id, name, duration, price, service_type, max_capacity, is_parallel)
      VALUES (gen_random_uuid(), PAR_PROV, 'matrix-a-priv1', 30, 0, 'private', 1, false) RETURNING id INTO tmp_s1;
    INSERT INTO public.provider_services (id, provider_id, name, duration, price, service_type, max_capacity, is_parallel)
      VALUES (gen_random_uuid(), PAR_PROV, 'matrix-a-priv2', 30, 0, 'private', 1, false) RETURNING id INTO tmp_s2;
    INSERT INTO public.bookings (user_id, provider_id, service_ids, booking_date, booking_time, status, total_price)
      VALUES (NULL, PAR_PROV, ARRAY[tmp_s1], D, '07:00', 'confirmed', 0);
    INSERT INTO public.bookings (user_id, provider_id, service_ids, booking_date, booking_time, status, total_price)
      VALUES (NULL, PAR_PROV, ARRAY[tmp_s2], D, '07:15', 'confirmed', 0);
    RAISE EXCEPTION 'MATRIX_ROLLBACK';
  EXCEPTION WHEN OTHERS THEN
    actual := CASE WHEN SQLERRM = 'MATRIX_ROLLBACK' THEN 'ALLOWED' ELSE SQLSTATE || ' ' || SQLERRM END;
    INSERT INTO matrix_results VALUES (2, 'A2', 'BLOCKED 23505', actual,
      CASE WHEN SQLSTATE = '23505' THEN 'PASS' WHEN actual = 'ALLOWED' THEN 'FAIL' ELSE 'CHECK' END);
  END;

  -- A3: different services, overlapping, BOTH parallel → ALLOWED
  BEGIN
    INSERT INTO public.bookings (user_id, provider_id, service_ids, booking_date, booking_time, status, total_price)
      VALUES (NULL, PAR_PROV, ARRAY[PAR_S1], D, '07:00', 'confirmed', 0);
    INSERT INTO public.bookings (user_id, provider_id, service_ids, booking_date, booking_time, status, total_price)
      VALUES (NULL, PAR_PROV, ARRAY[PAR_S2], D, '07:00', 'confirmed', 0);
    RAISE EXCEPTION 'MATRIX_ROLLBACK';
  EXCEPTION WHEN OTHERS THEN
    actual := CASE WHEN SQLERRM = 'MATRIX_ROLLBACK' THEN 'ALLOWED' ELSE SQLSTATE || ' ' || SQLERRM END;
    INSERT INTO matrix_results VALUES (3, 'A3', 'ALLOWED', actual,
      CASE WHEN actual = 'ALLOWED' THEN 'PASS' ELSE 'FAIL' END);
  END;

  -- A4: same-service capacity 2 — 2nd booking ALLOWED, 3rd BLOCKED (23505)
  BEGIN
    INSERT INTO public.provider_services (id, provider_id, name, duration, price, service_type, max_capacity, is_parallel)
      VALUES (gen_random_uuid(), PAR_PROV, 'matrix-a-cap2', 30, 0, 'private', 2, false) RETURNING id INTO tmp_cap2;
    INSERT INTO public.bookings (user_id, provider_id, service_ids, booking_date, booking_time, status, total_price)
      VALUES (NULL, PAR_PROV, ARRAY[tmp_cap2], D, '07:00', 'confirmed', 0);
    INSERT INTO public.bookings (user_id, provider_id, service_ids, booking_date, booking_time, status, total_price)
      VALUES (NULL, PAR_PROV, ARRAY[tmp_cap2], D, '07:00', 'confirmed', 0);  -- 2nd: within capacity
    INSERT INTO public.bookings (user_id, provider_id, service_ids, booking_date, booking_time, status, total_price)
      VALUES (NULL, PAR_PROV, ARRAY[tmp_cap2], D, '07:00', 'confirmed', 0);  -- 3rd: over capacity
    RAISE EXCEPTION 'MATRIX_ROLLBACK';
  EXCEPTION WHEN OTHERS THEN
    actual := CASE WHEN SQLERRM = 'MATRIX_ROLLBACK' THEN 'ALLOWED(all 3!)' ELSE SQLSTATE || ' ' || SQLERRM END;
    INSERT INTO matrix_results VALUES (4, 'A4', '2 ok then BLOCKED 23505', actual,
      CASE WHEN SQLSTATE = '23505' THEN 'PASS' ELSE 'FAIL' END);
  END;

  -- A5: same user, overlapping at same provider → DUPLICATE_USER_BOOKING.
  --     Uses the PARALLEL pair on purpose: both-parallel bypasses the
  --     cross-service clause, so ONLY the same-user guard can block — proving
  --     clause 6 itself still fires.
  BEGIN
    INSERT INTO public.bookings (user_id, provider_id, service_ids, booking_date, booking_time, status, total_price)
      VALUES (TESTUSER, PAR_PROV, ARRAY[PAR_S1], D, '07:00', 'confirmed', 0);
    INSERT INTO public.bookings (user_id, provider_id, service_ids, booking_date, booking_time, status, total_price)
      VALUES (TESTUSER, PAR_PROV, ARRAY[PAR_S2], D, '07:00', 'confirmed', 0);
    RAISE EXCEPTION 'MATRIX_ROLLBACK';
  EXCEPTION WHEN OTHERS THEN
    actual := CASE WHEN SQLERRM = 'MATRIX_ROLLBACK' THEN 'ALLOWED' ELSE SQLSTATE || ' ' || SQLERRM END;
    INSERT INTO matrix_results VALUES (5, 'A5', 'BLOCKED DUPLICATE_USER_BOOKING', actual,
      CASE WHEN SQLERRM = 'DUPLICATE_USER_BOOKING' THEN 'PASS' ELSE 'FAIL' END);
  END;

  -- A6: group service (cap 2): 2 allowed, 3rd → GROUP_CAPACITY_EXCEEDED
  BEGIN
    INSERT INTO public.bookings (user_id, provider_id, service_ids, booking_date, booking_time, status, total_price)
      VALUES (NULL, GRP_PROV, ARRAY[GRP_SVC], D, '07:00', 'confirmed', 0);
    INSERT INTO public.bookings (user_id, provider_id, service_ids, booking_date, booking_time, status, total_price)
      VALUES (NULL, GRP_PROV, ARRAY[GRP_SVC], D, '07:00', 'confirmed', 0);
    INSERT INTO public.bookings (user_id, provider_id, service_ids, booking_date, booking_time, status, total_price)
      VALUES (NULL, GRP_PROV, ARRAY[GRP_SVC], D, '07:00', 'confirmed', 0);
    RAISE EXCEPTION 'MATRIX_ROLLBACK';
  EXCEPTION WHEN OTHERS THEN
    actual := CASE WHEN SQLERRM = 'MATRIX_ROLLBACK' THEN 'ALLOWED(all 3!)' ELSE SQLSTATE || ' ' || SQLERRM END;
    INSERT INTO matrix_results VALUES (6, 'A6', '2 ok then GROUP_CAPACITY_EXCEEDED', actual,
      CASE WHEN SQLERRM = 'GROUP_CAPACITY_EXCEEDED' THEN 'PASS' ELSE 'FAIL' END);
  END;

  -- A7: class bookings (class_schedule_id, empty service_ids), cap 5:
  --     5 allowed, 6th → GROUP_CAPACITY_EXCEEDED
  BEGIN
    FOR i IN 1..6 LOOP
      INSERT INTO public.bookings (user_id, provider_id, service_ids, booking_date, booking_time, status, total_price, class_schedule_id)
        VALUES (NULL, CLS_PROV, '{}', D, '07:00', 'confirmed', 0, CLS_ID);
    END LOOP;
    RAISE EXCEPTION 'MATRIX_ROLLBACK';
  EXCEPTION WHEN OTHERS THEN
    actual := CASE WHEN SQLERRM = 'MATRIX_ROLLBACK' THEN 'ALLOWED(all 6!)' ELSE SQLSTATE || ' ' || SQLERRM END;
    INSERT INTO matrix_results VALUES (7, 'A7', '5 ok then GROUP_CAPACITY_EXCEEDED', actual,
      CASE WHEN SQLERRM = 'GROUP_CAPACITY_EXCEEDED' THEN 'PASS' ELSE 'FAIL' END);
  END;

  -- B8: staff A and staff B, same time, SAME service → ALLOWED (the point)
  BEGIN
    INSERT INTO public.bookings (user_id, provider_id, service_ids, booking_date, booking_time, status, total_price, staff_id)
      VALUES (NULL, BARBER, ARRAY[SVC_T1], D, '07:00', 'confirmed', 0, STAFF_A);
    INSERT INTO public.bookings (user_id, provider_id, service_ids, booking_date, booking_time, status, total_price, staff_id)
      VALUES (NULL, BARBER, ARRAY[SVC_T1], D, '07:00', 'confirmed', 0, STAFF_B);
    RAISE EXCEPTION 'MATRIX_ROLLBACK';
  EXCEPTION WHEN OTHERS THEN
    actual := CASE WHEN SQLERRM = 'MATRIX_ROLLBACK' THEN 'ALLOWED' ELSE SQLSTATE || ' ' || SQLERRM END;
    INSERT INTO matrix_results VALUES (8, 'B8', 'ALLOWED (different staff)', actual,
      CASE WHEN actual = 'ALLOWED' THEN 'PASS' ELSE 'FAIL' END);
  END;

  -- B9: staff A booked twice at the same time → BLOCKED (23505)
  BEGIN
    INSERT INTO public.bookings (user_id, provider_id, service_ids, booking_date, booking_time, status, total_price, staff_id)
      VALUES (NULL, BARBER, ARRAY[SVC_T1], D, '07:00', 'confirmed', 0, STAFF_A);
    INSERT INTO public.bookings (user_id, provider_id, service_ids, booking_date, booking_time, status, total_price, staff_id)
      VALUES (NULL, BARBER, ARRAY[SVC_T1], D, '07:00', 'confirmed', 0, STAFF_A);
    RAISE EXCEPTION 'MATRIX_ROLLBACK';
  EXCEPTION WHEN OTHERS THEN
    actual := CASE WHEN SQLERRM = 'MATRIX_ROLLBACK' THEN 'ALLOWED' ELSE SQLSTATE || ' ' || SQLERRM END;
    INSERT INTO matrix_results VALUES (9, 'B9', 'BLOCKED 23505 (same staff)', actual,
      CASE WHEN SQLSTATE = '23505' THEN 'PASS' ELSE 'FAIL' END);
  END;

  -- B10: same CUSTOMER books staff A and staff B at the same time
  --      → DUPLICATE_USER_BOOKING (clause 6 has no staff predicate, on purpose)
  BEGIN
    INSERT INTO public.bookings (user_id, provider_id, service_ids, booking_date, booking_time, status, total_price, staff_id)
      VALUES (TESTUSER, BARBER, ARRAY[SVC_T1], D, '07:00', 'confirmed', 0, STAFF_A);
    INSERT INTO public.bookings (user_id, provider_id, service_ids, booking_date, booking_time, status, total_price, staff_id)
      VALUES (TESTUSER, BARBER, ARRAY[SVC_T1], D, '07:00', 'confirmed', 0, STAFF_B);
    RAISE EXCEPTION 'MATRIX_ROLLBACK';
  EXCEPTION WHEN OTHERS THEN
    actual := CASE WHEN SQLERRM = 'MATRIX_ROLLBACK' THEN 'ALLOWED' ELSE SQLSTATE || ' ' || SQLERRM END;
    INSERT INTO matrix_results VALUES (10, 'B10', 'BLOCKED DUPLICATE_USER_BOOKING', actual,
      CASE WHEN SQLERRM = 'DUPLICATE_USER_BOOKING' THEN 'PASS' ELSE 'FAIL' END);
  END;

  -- B11: reassign a booking onto an already-booked staff member → BLOCKED.
  --      Proves staff_id in the UPDATE OF list: before this migration the
  --      trigger did not even fire on SET staff_id and this silently succeeded.
  BEGIN
    INSERT INTO public.bookings (user_id, provider_id, service_ids, booking_date, booking_time, status, total_price, staff_id)
      VALUES (NULL, BARBER, ARRAY[SVC_T1], D, '07:00', 'confirmed', 0, STAFF_A);
    INSERT INTO public.bookings (user_id, provider_id, service_ids, booking_date, booking_time, status, total_price, staff_id)
      VALUES (NULL, BARBER, ARRAY[SVC_T1], D, '07:00', 'confirmed', 0, STAFF_B)
      RETURNING id INTO b2;
    UPDATE public.bookings SET staff_id = STAFF_A WHERE id = b2;
    RAISE EXCEPTION 'MATRIX_ROLLBACK';
  EXCEPTION WHEN OTHERS THEN
    actual := CASE WHEN SQLERRM = 'MATRIX_ROLLBACK' THEN 'ALLOWED (reassign not re-checked!)' ELSE SQLSTATE || ' ' || SQLERRM END;
    INSERT INTO matrix_results VALUES (11, 'B11', 'BLOCKED 23505 on UPDATE', actual,
      CASE WHEN SQLSTATE = '23505' THEN 'PASS' ELSE 'FAIL' END);
  END;

  -- B12: NULL-staff booking vs staff-A booking, same time, same service →
  --      trigger ALLOWS it (NULL IS NOT DISTINCT FROM STAFF_A is false: the
  --      rows live in different staff "lanes"). DOCUMENTED behavior, not a
  --      failure: the DB toggle guard prevents NULL-staff rows coexisting with
  --      staff mode via the UI, and the CLIENT treats NULL-staff bookings at a
  --      staff-enabled provider as blocking ALL staff (conservative display).
  BEGIN
    INSERT INTO public.bookings (user_id, provider_id, service_ids, booking_date, booking_time, status, total_price, staff_id)
      VALUES (NULL, BARBER, ARRAY[SVC_T1], D, '07:00', 'confirmed', 0, NULL);
    INSERT INTO public.bookings (user_id, provider_id, service_ids, booking_date, booking_time, status, total_price, staff_id)
      VALUES (NULL, BARBER, ARRAY[SVC_T1], D, '07:00', 'confirmed', 0, STAFF_A);
    RAISE EXCEPTION 'MATRIX_ROLLBACK';
  EXCEPTION WHEN OTHERS THEN
    actual := CASE WHEN SQLERRM = 'MATRIX_ROLLBACK' THEN 'ALLOWED' ELSE SQLSTATE || ' ' || SQLERRM END;
    INSERT INTO matrix_results VALUES (12, 'B12', 'ALLOWED by trigger (client blocks display-side)', actual,
      CASE WHEN actual = 'ALLOWED' THEN 'AS-DOCUMENTED' ELSE 'CHECK' END);
  END;
END $$;

-- Post-matrix invariant: nothing persisted on the probe date. Kept as its own
-- statement (visible in psql / multi-result clients), and ALSO mirrored into
-- the grid as row 99 below, because the Supabase SQL editor displays only the
-- LAST statement's result when running a multi-statement block.
-- Expect: 0.
SELECT COUNT(*) AS matrix_leftovers
FROM public.bookings
WHERE booking_date = DATE '2026-12-30';

INSERT INTO matrix_results
SELECT 99, 'LEFTOVERS', '0 probe rows persisted', COUNT(*)::text,
       CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END
FROM public.bookings
WHERE booking_date = DATE '2026-12-30';

-- The matrix, in test order — LAST on purpose so the editor's single result
-- grid shows it. Expect (post-apply): A1-A7 PASS (regression), B8-B11 PASS
-- (feature), B12 AS-DOCUMENTED, LEFTOVERS PASS.
SELECT case_id, expected, actual, verdict
FROM matrix_results
ORDER BY ordinal;
