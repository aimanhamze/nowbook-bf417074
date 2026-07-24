-- VERIFY for 20260724000001_add_multi_staff_schema.sql
-- Run AFTER applying the migration.
-- Checks 1–8 are read-only. Check 9 is an OPTIONAL behavioral smoke test that
-- performs UPDATEs strictly inside DO-block subtransactions that are always
-- rolled back — nothing persists — but skip it if you want a purely read-only pass.

-- 1) provider_staff table exists with the expected columns.
--    Expect 6 rows:
--      id            | uuid                     | NO  | gen_random_uuid()
--      provider_id   | uuid                     | NO  |
--      name          | text                     | NO  |
--      is_active     | boolean                  | NO  | true
--      display_order | integer                  | NO  | 0
--      created_at    | timestamp with time zone | NO  | now()
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'provider_staff'
ORDER BY ordinal_position;

-- 2) provider_staff constraints: PK(id), UNIQUE(id, provider_id),
--    FK provider_id → provider_profiles(id) ON DELETE CASCADE.
--    Expect three rows:
--      provider_staff_pkey                : PRIMARY KEY (id)
--      provider_staff_id_provider_id_key : UNIQUE (id, provider_id)
--      provider_staff_provider_id_fkey   : FOREIGN KEY ... ON DELETE CASCADE
SELECT conname, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'public.provider_staff'::regclass
ORDER BY contype, conname;

-- 3) Index on (provider_id, is_active) exists.
--    Expect: idx_provider_staff_provider_active ... btree (provider_id, is_active)
SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public' AND tablename = 'provider_staff';

-- 4) RLS is ENABLED on provider_staff, with exactly the two mirrored policies:
--      "Anyone can view staff"           SELECT USING (true)
--      "Providers can manage own staff"  ALL    USING + WITH CHECK (EXISTS ... pp.user_id = auth.uid())
--    Expect rls_enabled = true and two policy rows shaped like provider_services'.
SELECT relrowsecurity AS rls_enabled
FROM pg_class WHERE oid = 'public.provider_staff'::regclass;

SELECT pol.polname,
       CASE pol.polcmd WHEN 'r' THEN 'SELECT' WHEN '*' THEN 'ALL'
                       WHEN 'a' THEN 'INSERT' WHEN 'w' THEN 'UPDATE'
                       WHEN 'd' THEN 'DELETE' END          AS command,
       pg_get_expr(pol.polqual,      pol.polrelid)          AS using_expr,
       pg_get_expr(pol.polwithcheck, pol.polrelid)          AS with_check_expr
FROM pg_policy pol
WHERE pol.polrelid = 'public.provider_staff'::regclass
ORDER BY pol.polname;

-- 5) bookings.staff_id exists (nullable uuid) and the COMPOSITE FK
--    (staff_id, provider_id) → provider_staff(id, provider_id) is in place
--    with delete rule NO ACTION (NOT SET NULL, NOT CASCADE).
--    Expect: staff_id | uuid | YES, and one FK row:
--      bookings_staff_id_provider_id_fkey :
--        FOREIGN KEY (staff_id, provider_id) REFERENCES provider_staff(id, provider_id)
--        (no ON DELETE clause in the definition = NO ACTION)
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'bookings' AND column_name = 'staff_id';

SELECT conname,
       pg_get_constraintdef(oid) AS definition,
       CASE confdeltype WHEN 'a' THEN 'NO ACTION' WHEN 'n' THEN 'SET NULL'
                        WHEN 'c' THEN 'CASCADE'   WHEN 'r' THEN 'RESTRICT'
                        WHEN 'd' THEN 'SET DEFAULT' END AS delete_rule
FROM pg_constraint
WHERE conrelid = 'public.bookings'::regclass
  AND contype = 'f'
  AND conname = 'bookings_staff_id_provider_id_fkey';

-- 6) Index on bookings (provider_id, staff_id, booking_date) exists.
--    Expect: idx_bookings_provider_staff_date ... btree (provider_id, staff_id, booking_date)
SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public' AND tablename = 'bookings'
  AND indexname = 'idx_bookings_provider_staff_date';

-- 7) Additive-safety proof over live data.
--    Expect (as of Phase 0 recon): providers_total = 29, staff_enabled_true = 0,
--    bookings_total = 1412+, bookings_with_staff = 0, staff_rows = 0.
SELECT
  (SELECT COUNT(*) FROM public.provider_profiles)                            AS providers_total,
  (SELECT COUNT(*) FROM public.provider_profiles WHERE staff_enabled = true) AS staff_enabled_true,
  (SELECT COUNT(*) FROM public.bookings)                                     AS bookings_total,
  (SELECT COUNT(staff_id) FROM public.bookings)                              AS bookings_with_staff,
  (SELECT COUNT(*) FROM public.provider_staff)                               AS staff_rows;

-- Also: staff_enabled column shape. Expect boolean | NO | false.
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'provider_profiles'
  AND column_name = 'staff_enabled';

-- 8) Guard trigger exists and is scoped to EXACTLY the false→true transition:
--    Expect one row whose definition reads:
--      BEFORE UPDATE OF staff_enabled ON provider_profiles FOR EACH ROW
--      WHEN (old.staff_enabled IS DISTINCT FROM new.staff_enabled AND new.staff_enabled)
--      EXECUTE FUNCTION enforce_staff_enable_no_future_bookings()
--    The UPDATE OF column list + WHEN clause are the proof that every other
--    provider_profiles update never invokes the function at all.
SELECT tgname, pg_get_triggerdef(oid) AS definition
FROM pg_trigger
WHERE tgrelid = 'public.provider_profiles'::regclass
  AND tgname = 'trg_enforce_staff_enable_no_future_bookings';

--    And the function is SECURITY DEFINER with a pinned search_path
--    (required so an admin-initiated flag flip cannot bypass the check via RLS).
--    Expect: is_security_definer = true, config contains search_path=public.
SELECT prosecdef AS is_security_definer, proconfig AS config
FROM pg_proc
WHERE oid = 'public.enforce_staff_enable_no_future_bookings'::regproc;

-- ─────────────────────────────────────────────────────────────────────────────
-- 9) OPTIONAL behavioral smoke test (mutations occur ONLY inside subtransactions
--    that are always rolled back; final state is untouched). Run as service_role
--    or any role that can UPDATE provider_profiles.
--    Expect NOTICEs: PASS (a), PASS (b), PASS (c) — or SKIP where no fixture exists.
DO $$
DECLARE
  v_with_future    uuid;
  v_without_future uuid;
BEGIN
  -- (a) false→true with FUTURE bookings must be BLOCKED by the guard.
  SELECT b.provider_id INTO v_with_future
  FROM public.bookings b
  JOIN public.provider_profiles pp ON pp.id = b.provider_id AND pp.staff_enabled = false
  WHERE b.status IN ('confirmed', 'pending')
    AND b.booking_date >= (NOW() AT TIME ZONE 'Asia/Jerusalem')::date
  LIMIT 1;

  IF v_with_future IS NULL THEN
    RAISE NOTICE 'SKIP (a): no provider with future active bookings found';
  ELSE
    BEGIN
      UPDATE public.provider_profiles SET staff_enabled = true WHERE id = v_with_future;
      -- Guard did not fire — force a rollback of the subtransaction so the
      -- accidental enable does not persist, then report the failure.
      RAISE EXCEPTION 'VERIFY_INTERNAL_ROLLBACK';
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM = 'STAFF_ENABLE_BLOCKED_BY_FUTURE_BOOKINGS' THEN
        RAISE NOTICE 'PASS (a): guard blocked false→true with future bookings';
      ELSIF SQLERRM = 'VERIFY_INTERNAL_ROLLBACK' THEN
        RAISE NOTICE 'FAIL (a): guard DID NOT fire; test update was rolled back';
      ELSE
        RAISE;
      END IF;
    END;
  END IF;

  -- (b) false→true WITHOUT future bookings must SUCCEED (then roll back).
  SELECT pp.id INTO v_without_future
  FROM public.provider_profiles pp
  WHERE pp.staff_enabled = false
    AND NOT EXISTS (
      SELECT 1 FROM public.bookings b
      WHERE b.provider_id = pp.id
        AND b.status IN ('confirmed', 'pending')
        AND b.booking_date >= (NOW() AT TIME ZONE 'Asia/Jerusalem')::date
    )
  LIMIT 1;

  IF v_without_future IS NULL THEN
    RAISE NOTICE 'SKIP (b): every provider has future active bookings';
  ELSE
    BEGIN
      UPDATE public.provider_profiles SET staff_enabled = true WHERE id = v_without_future;
      RAISE EXCEPTION 'VERIFY_INTERNAL_ROLLBACK';  -- success path: undo the enable
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM = 'VERIFY_INTERNAL_ROLLBACK' THEN
        RAISE NOTICE 'PASS (b): enable succeeded without future bookings (rolled back)';
      ELSE
        RAISE NOTICE 'FAIL (b): unexpected error on clean enable: %', SQLERRM;
      END IF;
    END;
  END IF;

  -- (c) A NORMAL provider_profiles update (not touching staff_enabled) must be
  --     completely unaffected. SET show_prices = show_prices is semantically a
  --     no-op but exercises a full UPDATE through all triggers; it is rolled
  --     back anyway in case an updated_at-style trigger stamps the row.
  BEGIN
    UPDATE public.provider_profiles
    SET show_prices = show_prices
    WHERE id = COALESCE(v_with_future, v_without_future, (SELECT id FROM public.provider_profiles LIMIT 1));
    RAISE EXCEPTION 'VERIFY_INTERNAL_ROLLBACK';  -- success path: undo any side effects
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'VERIFY_INTERNAL_ROLLBACK' THEN
      RAISE NOTICE 'PASS (c): unrelated provider_profiles update unaffected by guard (rolled back)';
    ELSE
      RAISE NOTICE 'FAIL (c): unrelated update errored: %', SQLERRM;
    END IF;
  END;
END $$;

-- Post-test invariant: nothing persisted. Expect staff_enabled_true = 0.
SELECT COUNT(*) AS staff_enabled_true
FROM public.provider_profiles WHERE staff_enabled = true;
