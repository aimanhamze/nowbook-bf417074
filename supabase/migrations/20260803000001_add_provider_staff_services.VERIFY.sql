-- VERIFY for 20260803000001_add_provider_staff_services.sql
-- Run AFTER applying the migration.
--
-- Checks 1–7 are READ-ONLY. Check 8 is the cross-provider NEGATIVE TEST: it
-- attempts INSERTs strictly inside DO-block subtransactions that are ALWAYS
-- rolled back (the subtransaction form of BEGIN…ROLLBACK — safe to paste into
-- an editor that autocommits, unlike a bare BEGIN). Nothing persists; check 9
-- re-asserts that. Skip check 8 if you want a purely read-only pass.

-- 1) provider_services gained UNIQUE (id, provider_id) and its PK is UNCHANGED.
--    Expect BOTH rows, and nothing else changed on the table:
--      provider_services_pkey              : PRIMARY KEY (id)
--      provider_services_id_provider_id_key: UNIQUE (id, provider_id)
SELECT conname, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'public.provider_services'::regclass
  AND contype IN ('p', 'u')
ORDER BY contype, conname;

--    Size of what that new index covers (the constraint is unfalsifiable —
--    id is already unique — so this is scale confirmation, not a risk check).
--    Expect a few hundred rows: ~29 providers × a handful of services each.
SELECT COUNT(*) AS provider_services_rows FROM public.provider_services;

-- 2) provider_staff_services exists with the expected columns.
--    Expect 4 rows:
--      provider_id | uuid                     | NO |
--      staff_id    | uuid                     | NO |
--      service_id  | uuid                     | NO |
--      created_at  | timestamp with time zone | NO | now()
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'provider_staff_services'
ORDER BY ordinal_position;

-- 3) Composite PK + both composite FKs, with delete_rule = CASCADE on BOTH.
--    Expect three rows:
--      provider_staff_services_pkey : PRIMARY KEY (staff_id, service_id)      | (null)
--      pss_service_fkey             : FOREIGN KEY (service_id, provider_id)
--                                     REFERENCES provider_services(id, provider_id) ON DELETE CASCADE | CASCADE
--      pss_staff_fkey               : FOREIGN KEY (staff_id, provider_id)
--                                     REFERENCES provider_staff(id, provider_id)    ON DELETE CASCADE | CASCADE
--    The two-column FK column lists are the proof that cross-provider
--    attachment is impossible; CASCADE is the deliberate divergence from
--    bookings' NO ACTION (configuration, not history).
SELECT conname,
       pg_get_constraintdef(oid) AS definition,
       CASE confdeltype WHEN 'a' THEN 'NO ACTION' WHEN 'n' THEN 'SET NULL'
                        WHEN 'c' THEN 'CASCADE'   WHEN 'r' THEN 'RESTRICT'
                        WHEN 'd' THEN 'SET DEFAULT' END AS delete_rule
FROM pg_constraint
WHERE conrelid = 'public.provider_staff_services'::regclass
  AND contype IN ('p', 'f')
ORDER BY contype, conname;

-- 4) Indexes. Expect exactly two:
--      provider_staff_services_pkey : btree (staff_id, service_id)   ← owner direction
--      idx_pss_provider_service     : btree (provider_id, service_id) ← customer direction
SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public' AND tablename = 'provider_staff_services'
ORDER BY indexname;

-- 5) RLS is ENABLED. Expect rls_enabled = true.
SELECT relrowsecurity AS rls_enabled
FROM pg_class WHERE oid = 'public.provider_staff_services'::regclass;

-- 6) Exactly two policies, mirroring provider_staff's live shape:
--      "Anyone can view staff services"           | SELECT | true    | (null)
--      "Providers can manage own staff services"  | ALL    | EXISTS… | EXISTS…  ← BOTH spelled out
--    with_check_expr MUST be non-null on the ALL policy (provider_staff spells
--    it out explicitly; provider_services leaves it NULL — we follow the former).
SELECT pol.polname,
       CASE pol.polcmd WHEN 'r' THEN 'SELECT' WHEN '*' THEN 'ALL'
                       WHEN 'a' THEN 'INSERT' WHEN 'w' THEN 'UPDATE'
                       WHEN 'd' THEN 'DELETE' END          AS command,
       pg_get_expr(pol.polqual,      pol.polrelid)          AS using_expr,
       pg_get_expr(pol.polwithcheck, pol.polrelid)          AS with_check_expr
FROM pg_policy pol
WHERE pol.polrelid = 'public.provider_staff_services'::regclass
ORDER BY pol.polname;

--    Side-by-side against the table it mirrors — the two EXISTS bodies should be
--    identical modulo the table name in the qualified column reference.
SELECT c.relname AS table_name, pol.polname,
       pg_get_expr(pol.polqual,      pol.polrelid) AS using_expr,
       pg_get_expr(pol.polwithcheck, pol.polrelid) AS with_check_expr
FROM pg_policy pol
JOIN pg_class c ON c.oid = pol.polrelid
WHERE c.relname IN ('provider_staff', 'provider_staff_services')
ORDER BY c.relname, pol.polname;

-- 7) ADDITIVE-SAFETY PROOF: the table is EMPTY.
--    Expect assignment_rows = 0. Under the inheritance rule (zero rows for a
--    staff member = offers ALL services), an empty table means EVERY existing
--    staff member is unrestricted → the barbershop's 2 staff behave identically
--    → zero behaviour change. staff_rows / restricted_staff are shown for
--    contrast: restricted_staff must also be 0.
SELECT
  (SELECT COUNT(*) FROM public.provider_staff_services)                    AS assignment_rows,
  (SELECT COUNT(*) FROM public.provider_staff)                             AS staff_rows,
  (SELECT COUNT(DISTINCT staff_id) FROM public.provider_staff_services)    AS restricted_staff,
  (SELECT COUNT(*) FROM public.provider_profiles WHERE staff_enabled)      AS staff_enabled_providers;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8) CROSS-PROVIDER NEGATIVE TEST (+ positive control).
--    All INSERTs happen inside subtransactions that are unconditionally rolled
--    back — nothing persists either way.
--    Expect three rows verdict = PASS at the end — or SKIP where the live data
--    has no suitable fixture (needs two DIFFERENT providers, one with a staff
--    row and one with a service row).
--
--    Results go to a TEMP TABLE rather than RAISE NOTICE: the Supabase SQL
--    editor swallows notices and would report only "Success, no rows returned".
--    Every INSERT into verify_results happens in an EXCEPTION handler — i.e.
--    AFTER the inner subtransaction has already rolled back — so the verdicts
--    persist while the test rows never do.
DROP TABLE IF EXISTS verify_results;
CREATE TEMP TABLE verify_results (
  case_id  text,
  expected text,
  actual   text,
  verdict  text
);

DO $$
DECLARE
  v_staff_id     uuid;
  v_provider_a   uuid;  -- owns v_staff_id
  v_service_b    uuid;
  v_provider_b   uuid;  -- owns v_service_b, and v_provider_b <> v_provider_a
  v_service_a    uuid;  -- a service of provider A, for the positive control
BEGIN
  -- Fixture: any staff member, plus a service belonging to a DIFFERENT provider.
  SELECT ps.id, ps.provider_id INTO v_staff_id, v_provider_a
  FROM public.provider_staff ps
  LIMIT 1;

  IF v_staff_id IS NULL THEN
    INSERT INTO verify_results VALUES
      ('a', 'INSERT rejected by pss_service_fkey', 'no provider_staff rows exist to test with', 'SKIP'),
      ('b', 'INSERT rejected by pss_staff_fkey',   'no provider_staff rows exist to test with', 'SKIP'),
      ('c', 'INSERT accepted (same provider)',     'no provider_staff rows exist to test with', 'SKIP');
    RETURN;
  END IF;

  SELECT sv.id, sv.provider_id INTO v_service_b, v_provider_b
  FROM public.provider_services sv
  WHERE sv.provider_id <> v_provider_a
  LIMIT 1;

  SELECT sv.id INTO v_service_a
  FROM public.provider_services sv
  WHERE sv.provider_id = v_provider_a
  LIMIT 1;

  -- (a) provider_id = A (the staff's own provider), service_id from provider B.
  --     Must FAIL on pss_service_fkey: (service_id, provider_id) = (B's service, A)
  --     is not a pair that exists in provider_services.
  IF v_service_b IS NULL THEN
    INSERT INTO verify_results VALUES
      ('a', 'INSERT rejected by pss_service_fkey', 'no service belonging to a different provider', 'SKIP');
  ELSE
    BEGIN
      INSERT INTO public.provider_staff_services (provider_id, staff_id, service_id)
      VALUES (v_provider_a, v_staff_id, v_service_b);
      RAISE EXCEPTION 'VERIFY_INTERNAL_ROLLBACK';  -- FK did not fire → undo it
    EXCEPTION
      WHEN foreign_key_violation THEN
        INSERT INTO verify_results VALUES
          ('a', 'INSERT rejected by pss_service_fkey', SQLERRM, 'PASS');
      WHEN OTHERS THEN
        IF SQLERRM = 'VERIFY_INTERNAL_ROLLBACK' THEN
          INSERT INTO verify_results VALUES
            ('a', 'INSERT rejected by pss_service_fkey',
                  'cross-provider row was ACCEPTED; test insert rolled back', 'FAIL');
        ELSE
          RAISE;
        END IF;
    END;
  END IF;

  -- (b) The mirror image: provider_id = B, staff_id from provider A.
  --     Must FAIL on pss_staff_fkey. Testing both directions proves neither FK
  --     is carrying the check alone.
  IF v_service_b IS NULL THEN
    INSERT INTO verify_results VALUES
      ('b', 'INSERT rejected by pss_staff_fkey', 'no service belonging to a different provider', 'SKIP');
  ELSE
    BEGIN
      INSERT INTO public.provider_staff_services (provider_id, staff_id, service_id)
      VALUES (v_provider_b, v_staff_id, v_service_b);
      RAISE EXCEPTION 'VERIFY_INTERNAL_ROLLBACK';
    EXCEPTION
      WHEN foreign_key_violation THEN
        INSERT INTO verify_results VALUES
          ('b', 'INSERT rejected by pss_staff_fkey', SQLERRM, 'PASS');
      WHEN OTHERS THEN
        IF SQLERRM = 'VERIFY_INTERNAL_ROLLBACK' THEN
          INSERT INTO verify_results VALUES
            ('b', 'INSERT rejected by pss_staff_fkey',
                  'mismatched row was ACCEPTED; test insert rolled back', 'FAIL');
        ELSE
          RAISE;
        END IF;
    END;
  END IF;

  -- (c) POSITIVE CONTROL — a legitimate same-provider pair must be ACCEPTED
  --     (then rolled back). Without this, (a) and (b) would also "pass" if the
  --     FKs rejected everything.
  IF v_service_a IS NULL THEN
    INSERT INTO verify_results VALUES
      ('c', 'INSERT accepted (same provider)',
            format('staff provider %s has no services', v_provider_a), 'SKIP');
  ELSE
    BEGIN
      INSERT INTO public.provider_staff_services (provider_id, staff_id, service_id)
      VALUES (v_provider_a, v_staff_id, v_service_a);
      RAISE EXCEPTION 'VERIFY_INTERNAL_ROLLBACK';  -- success path: undo the insert
    EXCEPTION
      WHEN OTHERS THEN
        IF SQLERRM = 'VERIFY_INTERNAL_ROLLBACK' THEN
          INSERT INTO verify_results VALUES
            ('c', 'INSERT accepted (same provider)',
                  'same-provider assignment accepted (rolled back)', 'PASS');
        ELSE
          INSERT INTO verify_results VALUES
            ('c', 'INSERT accepted (same provider)', SQLERRM, 'FAIL');
        END IF;
    END;
  END IF;
END $$;

--    Results of check 8 — expect three rows, all verdict = PASS.
SELECT * FROM verify_results ORDER BY case_id;

-- 9) Post-test invariant: nothing persisted. Expect 0.
SELECT COUNT(*) AS assignment_rows FROM public.provider_staff_services;
