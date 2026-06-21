-- ============================================================================
-- VERIFY: parallel-services
-- Companion to migrations:
--   20260621000001_add_is_parallel_parallel_overlap.sql   (is_parallel + Clause 1 exception)
--   20260621000002_widen_same_user_guard_any_overlap.sql  (same-user guard widened)
-- Run the harness AFTER BOTH migrations are applied. Case (g) is the behavioral
-- discriminator for 0002 (same-user cross-service overlap now BLOCKED).
--
-- Run sections 1–4 in the Supabase SQL editor (or psql) as a privileged role
-- (the SQL editor runs as the table owner, so RLS does NOT interfere). Nothing
-- here mutates real data: the test harness (section 3) runs inside an explicit
-- transaction that ENDS IN ROLLBACK.
-- ============================================================================


-- ── SECTION 1 — BEFORE (run before applying the migration) ──────────────────
-- Expect: 0 rows (column absent).
SELECT column_name, data_type, column_default, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'provider_services'
  AND column_name = 'is_parallel';

-- Expect: the function source still contains the OLD Clause 1 (the line
-- "b.service_ids[1] IS DISTINCT FROM NEW.service_ids[1]") but NOT the string
-- "PARALLEL EXCEPTION". (substring match returns true/false.)
SELECT
  pg_get_functiondef(p.oid) LIKE '%PARALLEL EXCEPTION%' AS has_parallel_exception  -- expect: false
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'prevent_booking_conflicts';


-- ── SECTION 2 — AFTER (run after applying the migration) ────────────────────
-- Expect: one row — is_parallel | boolean | false | NO
SELECT column_name, data_type, column_default, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'provider_services'
  AND column_name = 'is_parallel';

-- Expect: every existing row backfilled to false (count of true = 0).
SELECT COUNT(*) FILTER (WHERE is_parallel) AS parallel_rows,
       COUNT(*)                            AS total_rows
FROM public.provider_services;

-- Expect: has_parallel_exception = true (function replaced).
SELECT
  pg_get_functiondef(p.oid) LIKE '%PARALLEL EXCEPTION%' AS has_parallel_exception
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'prevent_booking_conflicts';

-- Confirm the trigger is still bound BEFORE INSERT OR UPDATE on bookings.
SELECT tgname, tgenabled,
       pg_get_triggerdef(t.oid) AS trigger_def
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
WHERE c.relname = 'bookings'
  AND NOT t.tgisinternal
  AND tgname ILIKE '%conflict%';


-- ── SECTION 3 — CONFLICT TEST HARNESS (run AFTER applying) ──────────────────
-- Self-contained: builds throwaway services under an existing provider, drives
-- the trigger with overlapping bookings, records each outcome, prints a table,
-- then ROLLS BACK. Safe to run repeatedly. Overlap window is 60-min services at
-- 10:00 / 10:15 / 10:30 on far-future dates (2099) so it can never collide with
-- real bookings, availability, or lead-time checks.

BEGIN;

DO $$
DECLARE
  v_provider uuid;
  v_user     uuid;   -- a real account, for the same-user case (g)
  sa uuid;  -- A: private, PARALLEL,     cap 1
  sb uuid;  -- B: private, PARALLEL,     cap 1
  se uuid;  -- E: private, PARALLEL,     cap 1
  sc uuid;  -- C: private, NON-parallel, cap 1
  sd uuid;  -- D: private, NON-parallel, cap 1
  sg uuid;  -- G: group,   cap 2
BEGIN
  SELECT id INTO v_provider FROM public.provider_profiles ORDER BY created_at LIMIT 1;
  IF v_provider IS NULL THEN RAISE EXCEPTION 'No provider_profiles row to test against'; END IF;

  SELECT user_id INTO v_user FROM public.profiles WHERE user_id IS NOT NULL LIMIT 1;
  IF v_user IS NULL THEN RAISE EXCEPTION 'No profiles.user_id to test the same-user case'; END IF;

  INSERT INTO public.provider_services (provider_id,name,duration,price,service_type,max_capacity,is_active,is_parallel)
    VALUES (v_provider,'PT_A',60,0,'private',1,true,true)  RETURNING id INTO sa;
  INSERT INTO public.provider_services (provider_id,name,duration,price,service_type,max_capacity,is_active,is_parallel)
    VALUES (v_provider,'PT_B',60,0,'private',1,true,true)  RETURNING id INTO sb;
  INSERT INTO public.provider_services (provider_id,name,duration,price,service_type,max_capacity,is_active,is_parallel)
    VALUES (v_provider,'PT_E',60,0,'private',1,true,true)  RETURNING id INTO se;
  INSERT INTO public.provider_services (provider_id,name,duration,price,service_type,max_capacity,is_active,is_parallel)
    VALUES (v_provider,'PT_C',60,0,'private',1,true,false) RETURNING id INTO sc;
  INSERT INTO public.provider_services (provider_id,name,duration,price,service_type,max_capacity,is_active,is_parallel)
    VALUES (v_provider,'PT_D',60,0,'private',1,true,false) RETURNING id INTO sd;
  INSERT INTO public.provider_services (provider_id,name,duration,price,service_type,max_capacity,is_active,is_parallel)
    VALUES (v_provider,'PT_G',60,0,'group',2,true,false)   RETURNING id INTO sg;

  CREATE TEMP TABLE _pt_results(label text, expected text, outcome text) ON COMMIT DROP;

  -- ---- helper via inline sub-blocks -------------------------------------
  -- Each booking insert is wrapped so a raised conflict is captured as BLOCKED
  -- rather than aborting the whole harness. user_id NULL = walk-in (distinct
  -- person; the same-user guard never fires for NULL).

  -- (a) two DIFFERENT parallel services, overlapping  → both ALLOWED
  BEGIN INSERT INTO public.bookings(provider_id,user_id,service_ids,booking_date,booking_time,total_price,status)
        VALUES (v_provider,NULL,ARRAY[sa],'2099-01-01','10:00',0,'confirmed');
        INSERT INTO _pt_results VALUES('a.1 A∥@10:00','ALLOWED','ALLOWED');
  EXCEPTION WHEN others THEN INSERT INTO _pt_results VALUES('a.1 A∥@10:00','ALLOWED','BLOCKED: '||SQLERRM); END;
  BEGIN INSERT INTO public.bookings(provider_id,user_id,service_ids,booking_date,booking_time,total_price,status)
        VALUES (v_provider,NULL,ARRAY[sb],'2099-01-01','10:30',0,'confirmed');
        INSERT INTO _pt_results VALUES('a.2 B∥@10:30 (vs A∥)','ALLOWED','ALLOWED');
  EXCEPTION WHEN others THEN INSERT INTO _pt_results VALUES('a.2 B∥@10:30 (vs A∥)','ALLOWED','BLOCKED: '||SQLERRM); END;

  -- (b) parallel vs NON-parallel, overlapping  → second BLOCKED
  BEGIN INSERT INTO public.bookings(provider_id,user_id,service_ids,booking_date,booking_time,total_price,status)
        VALUES (v_provider,NULL,ARRAY[sa],'2099-01-02','10:00',0,'confirmed');
        INSERT INTO _pt_results VALUES('b.1 A∥@10:00','ALLOWED','ALLOWED');
  EXCEPTION WHEN others THEN INSERT INTO _pt_results VALUES('b.1 A∥@10:00','ALLOWED','BLOCKED: '||SQLERRM); END;
  BEGIN INSERT INTO public.bookings(provider_id,user_id,service_ids,booking_date,booking_time,total_price,status)
        VALUES (v_provider,NULL,ARRAY[sc],'2099-01-02','10:30',0,'confirmed');
        INSERT INTO _pt_results VALUES('b.2 C(not∥)@10:30 (vs A∥)','BLOCKED','ALLOWED');
  EXCEPTION WHEN others THEN INSERT INTO _pt_results VALUES('b.2 C(not∥)@10:30 (vs A∥)','BLOCKED','BLOCKED: '||SQLERRM); END;

  -- (c) two NON-parallel services, overlapping  → second BLOCKED (unchanged)
  BEGIN INSERT INTO public.bookings(provider_id,user_id,service_ids,booking_date,booking_time,total_price,status)
        VALUES (v_provider,NULL,ARRAY[sc],'2099-01-03','10:00',0,'confirmed');
        INSERT INTO _pt_results VALUES('c.1 C(not∥)@10:00','ALLOWED','ALLOWED');
  EXCEPTION WHEN others THEN INSERT INTO _pt_results VALUES('c.1 C(not∥)@10:00','ALLOWED','BLOCKED: '||SQLERRM); END;
  BEGIN INSERT INTO public.bookings(provider_id,user_id,service_ids,booking_date,booking_time,total_price,status)
        VALUES (v_provider,NULL,ARRAY[sd],'2099-01-03','10:30',0,'confirmed');
        INSERT INTO _pt_results VALUES('c.2 D(not∥)@10:30 (vs C)','BLOCKED','ALLOWED');
  EXCEPTION WHEN others THEN INSERT INTO _pt_results VALUES('c.2 D(not∥)@10:30 (vs C)','BLOCKED','BLOCKED: '||SQLERRM); END;

  -- (d) SAME parallel service, two customers overlapping → capacity governs.
  --     cap 1 → second BLOCKED. Proves parallel does NOT bypass same-service capacity.
  BEGIN INSERT INTO public.bookings(provider_id,user_id,service_ids,booking_date,booking_time,total_price,status)
        VALUES (v_provider,NULL,ARRAY[sa],'2099-01-04','10:00',0,'confirmed');
        INSERT INTO _pt_results VALUES('d.1 A∥@10:00','ALLOWED','ALLOWED');
  EXCEPTION WHEN others THEN INSERT INTO _pt_results VALUES('d.1 A∥@10:00','ALLOWED','BLOCKED: '||SQLERRM); END;
  BEGIN INSERT INTO public.bookings(provider_id,user_id,service_ids,booking_date,booking_time,total_price,status)
        VALUES (v_provider,NULL,ARRAY[sa],'2099-01-04','10:30',0,'confirmed');
        INSERT INTO _pt_results VALUES('d.2 A∥@10:30 SAME svc cap1','BLOCKED','ALLOWED');
  EXCEPTION WHEN others THEN INSERT INTO _pt_results VALUES('d.2 A∥@10:30 SAME svc cap1','BLOCKED','BLOCKED: '||SQLERRM); END;

  -- (e) THREE different parallel services, all overlapping → ALL ALLOWED
  BEGIN INSERT INTO public.bookings(provider_id,user_id,service_ids,booking_date,booking_time,total_price,status)
        VALUES (v_provider,NULL,ARRAY[sa],'2099-01-05','10:00',0,'confirmed');
        INSERT INTO _pt_results VALUES('e.1 A∥@10:00','ALLOWED','ALLOWED');
  EXCEPTION WHEN others THEN INSERT INTO _pt_results VALUES('e.1 A∥@10:00','ALLOWED','BLOCKED: '||SQLERRM); END;
  BEGIN INSERT INTO public.bookings(provider_id,user_id,service_ids,booking_date,booking_time,total_price,status)
        VALUES (v_provider,NULL,ARRAY[sb],'2099-01-05','10:15',0,'confirmed');
        INSERT INTO _pt_results VALUES('e.2 B∥@10:15','ALLOWED','ALLOWED');
  EXCEPTION WHEN others THEN INSERT INTO _pt_results VALUES('e.2 B∥@10:15','ALLOWED','BLOCKED: '||SQLERRM); END;
  BEGIN INSERT INTO public.bookings(provider_id,user_id,service_ids,booking_date,booking_time,total_price,status)
        VALUES (v_provider,NULL,ARRAY[se],'2099-01-05','10:30',0,'confirmed');
        INSERT INTO _pt_results VALUES('e.3 E∥@10:30','ALLOWED','ALLOWED');
  EXCEPTION WHEN others THEN INSERT INTO _pt_results VALUES('e.3 E∥@10:30','ALLOWED','BLOCKED: '||SQLERRM); END;

  -- (f) GROUP service, exact-start capacity (cap 2) → 1,2 ALLOWED, 3 BLOCKED. Unchanged.
  BEGIN INSERT INTO public.bookings(provider_id,user_id,service_ids,booking_date,booking_time,total_price,status)
        VALUES (v_provider,NULL,ARRAY[sg],'2099-01-06','10:00',0,'confirmed');
        INSERT INTO _pt_results VALUES('f.1 G group@10:00','ALLOWED','ALLOWED');
  EXCEPTION WHEN others THEN INSERT INTO _pt_results VALUES('f.1 G group@10:00','ALLOWED','BLOCKED: '||SQLERRM); END;
  BEGIN INSERT INTO public.bookings(provider_id,user_id,service_ids,booking_date,booking_time,total_price,status)
        VALUES (v_provider,NULL,ARRAY[sg],'2099-01-06','10:00',0,'confirmed');
        INSERT INTO _pt_results VALUES('f.2 G group@10:00 (cap2)','ALLOWED','ALLOWED');
  EXCEPTION WHEN others THEN INSERT INTO _pt_results VALUES('f.2 G group@10:00 (cap2)','ALLOWED','BLOCKED: '||SQLERRM); END;
  BEGIN INSERT INTO public.bookings(provider_id,user_id,service_ids,booking_date,booking_time,total_price,status)
        VALUES (v_provider,NULL,ARRAY[sg],'2099-01-06','10:00',0,'confirmed');
        INSERT INTO _pt_results VALUES('f.3 G group@10:00 (over cap)','BLOCKED','ALLOWED');
  EXCEPTION WHEN others THEN INSERT INTO _pt_results VALUES('f.3 G group@10:00 (over cap)','BLOCKED','BLOCKED: '||SQLERRM); END;

  -- (g) SAME user, two DIFFERENT parallel services, overlapping → second BLOCKED.
  --     Migration 0002 WIDENED the same-user guard: it now fires for ANY
  --     overlapping booking by the same user_id (not just the same service), so
  --     even though Clause 1's parallel exception lets the cross-service overlap
  --     pass, the same-user guard catches it → DUPLICATE_USER_BOOKING. This is
  --     the behavioral discriminator that proves 0002 is applied.
  BEGIN INSERT INTO public.bookings(provider_id,user_id,service_ids,booking_date,booking_time,total_price,status)
        VALUES (v_provider,v_user,ARRAY[sa],'2099-01-07','10:00',0,'confirmed');
        INSERT INTO _pt_results VALUES('g.1 A∥@10:00 userU','ALLOWED','ALLOWED');
  EXCEPTION WHEN others THEN INSERT INTO _pt_results VALUES('g.1 A∥@10:00 userU','ALLOWED','BLOCKED: '||SQLERRM); END;
  BEGIN INSERT INTO public.bookings(provider_id,user_id,service_ids,booking_date,booking_time,total_price,status)
        VALUES (v_provider,v_user,ARRAY[sb],'2099-01-07','10:30',0,'confirmed');
        INSERT INTO _pt_results VALUES('g.2 B∥@10:30 userU (diff svc)','BLOCKED','ALLOWED');
  EXCEPTION WHEN others THEN INSERT INTO _pt_results VALUES('g.2 B∥@10:30 userU (diff svc)','BLOCKED','BLOCKED: '||SQLERRM); END;

  -- (h) SAME user, two DIFFERENT NON-parallel services, overlapping → second
  --     BLOCKED. Already blocked by Clause 1 (cross-service, neither parallel);
  --     this confirms the widened same-user guard doesn't break that path.
  BEGIN INSERT INTO public.bookings(provider_id,user_id,service_ids,booking_date,booking_time,total_price,status)
        VALUES (v_provider,v_user,ARRAY[sc],'2099-01-08','10:00',0,'confirmed');
        INSERT INTO _pt_results VALUES('h.1 C(not∥)@10:00 userU','ALLOWED','ALLOWED');
  EXCEPTION WHEN others THEN INSERT INTO _pt_results VALUES('h.1 C(not∥)@10:00 userU','ALLOWED','BLOCKED: '||SQLERRM); END;
  BEGIN INSERT INTO public.bookings(provider_id,user_id,service_ids,booking_date,booking_time,total_price,status)
        VALUES (v_provider,v_user,ARRAY[sd],'2099-01-08','10:30',0,'confirmed');
        INSERT INTO _pt_results VALUES('h.2 D(not∥)@10:30 userU (diff svc)','BLOCKED','ALLOWED');
  EXCEPTION WHEN others THEN INSERT INTO _pt_results VALUES('h.2 D(not∥)@10:30 userU (diff svc)','BLOCKED','BLOCKED: '||SQLERRM); END;

END $$;

-- Read results, then discard everything.
SELECT label,
       expected,
       outcome,
       CASE WHEN split_part(outcome,':',1) = expected THEN 'PASS' ELSE '*** FAIL ***' END AS verdict
FROM _pt_results
ORDER BY label;

ROLLBACK;   -- <-- nothing above persists. Re-run freely.


-- ── SECTION 4 — EXPECTED RESULTS (the matrix, for eyeballing) ───────────────
-- a.1 ALLOWED | a.2 ALLOWED      two different parallel services overlap → allowed (NEW behavior)
-- b.1 ALLOWED | b.2 BLOCKED      parallel vs non-parallel → blocked (unchanged)
-- c.1 ALLOWED | c.2 BLOCKED      two non-parallel → blocked (unchanged)
-- d.1 ALLOWED | d.2 BLOCKED      same parallel service, cap 1 → capacity still blocks
-- e.1/e.2/e.3 ALLOWED           three different parallel services overlap → all allowed
-- f.1/f.2 ALLOWED | f.3 BLOCKED group capacity unchanged
-- g.1 ALLOWED | g.2 BLOCKED     same user, two different parallel services → blocked (0002: widened guard)
-- h.1 ALLOWED | h.2 BLOCKED     same user, two different non-parallel services → blocked (Clause 1 + guard)
-- Every row's verdict column should read PASS.
