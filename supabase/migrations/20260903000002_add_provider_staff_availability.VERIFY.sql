-- VERIFY for 20260903000002_add_provider_staff_availability.sql
-- Run AFTER applying the migration.
-- Every check here is READ-ONLY; nothing below mutates data.
--
-- Checks 1–6 verify the object was created as intended. Check 7 is the SAFETY
-- check: the whole claim of this migration is "zero behaviour change", and that
-- claim rests on the table being empty and unread.

-- 1) Table exists with exactly the expected columns.
--    Expect 7 rows, in this order:
--      provider_id  | uuid                     | NO  |
--      staff_id     | uuid                     | NO  |
--      day_of_week  | integer                  | NO  |
--      start_time   | text                     | NO  | '09:00'::text
--      end_time     | text                     | NO  | '17:00'::text
--      is_available | boolean                  | NO  | true
--      created_at   | timestamp with time zone | NO  | now()
--    NOTE start_time/end_time must be TEXT, not `time` — that is what
--    provider_availability actually is in production, and Phase 3's intersection
--    compares the two directly. If these come back as `time without time zone`,
--    STOP: the migration was edited, and the two sides will serialise
--    differently ("09:00" vs "09:00:00").
--    NOTE also there is deliberately NO break_start / break_end — see the
--    migration header for why.
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'provider_staff_availability'
ORDER BY ordinal_position;

-- 2) Constraints: composite PK, composite FK with CASCADE, day_of_week CHECK.
--    Expect three rows:
--      provider_staff_availability_pkey : PRIMARY KEY (staff_id, day_of_week)
--      psa_staff_fkey                   : FOREIGN KEY (staff_id, provider_id)
--                                           REFERENCES provider_staff(id, provider_id)
--                                           ON DELETE CASCADE
--      psa_day_of_week_check            : CHECK ((day_of_week >= 0) AND (day_of_week <= 6))
SELECT conname,
       pg_get_constraintdef(oid) AS definition,
       CASE confdeltype WHEN 'a' THEN 'NO ACTION' WHEN 'n' THEN 'SET NULL'
                        WHEN 'c' THEN 'CASCADE'   WHEN 'r' THEN 'RESTRICT'
                        WHEN 'd' THEN 'SET DEFAULT' END AS delete_rule
FROM pg_constraint
WHERE conrelid = 'public.provider_staff_availability'::regclass
ORDER BY contype, conname;

-- 3) The FK really points at provider_staff's composite unique key, not at its
--    PK alone. This is what makes "provider X's row naming provider Y's staff"
--    unrepresentable. Expect one row naming provider_staff_id_provider_id_key.
-- (c.conindid is the OID of the INDEX on the referenced table that backs the FK;
--  the unique/PK constraint sharing that index is the one being referenced.)
SELECT c.conname,
       (SELECT ref.conname
          FROM pg_constraint ref
         WHERE ref.conrelid = c.confrelid
           AND ref.contype IN ('u', 'p')
           AND ref.conindid = c.conindid)  AS referenced_constraint,
       pg_get_constraintdef(c.oid)          AS definition
FROM pg_constraint c
WHERE c.conrelid = 'public.provider_staff_availability'::regclass
  AND c.contype = 'f';

-- 4) Index on (provider_id) exists — the single per-provider fetch Phase 3 makes.
--    Expect two rows: the PK's implicit index on (staff_id, day_of_week) and
--      idx_psa_provider ... btree (provider_id)
SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public' AND tablename = 'provider_staff_availability'
ORDER BY indexname;

-- 5) RLS is ENABLED. Expect rls_enabled = true. If this is false the public
--    SELECT policy is irrelevant and the table is wide open to any writer.
SELECT relrowsecurity AS rls_enabled
FROM pg_class WHERE oid = 'public.provider_staff_availability'::regclass;

-- 6) Exactly two policies, mirroring provider_availability's shape.
--    Expect:
--      "Anyone can view staff availability"      SELECT  using_expr = true
--                                                        with_check_expr = NULL
--      "Provider manages own staff availability" ALL     using_expr AND
--                                                        with_check_expr BOTH =
--          (provider_id IN ( SELECT provider_profiles.id FROM provider_profiles
--                            WHERE provider_profiles.user_id = auth.uid()))
--    with_check_expr being NULL on the ALL policy is a FAILURE, not a detail:
--    that is the exact omission 20260425000001 had to fix on
--    provider_availability, and it silently blocks every upsert through
--    PostgREST. Phase 2 would present as a broken editor.
SELECT pol.polname,
       CASE pol.polcmd WHEN 'r' THEN 'SELECT' WHEN '*' THEN 'ALL'
                       WHEN 'a' THEN 'INSERT' WHEN 'w' THEN 'UPDATE'
                       WHEN 'd' THEN 'DELETE' END          AS command,
       pg_get_expr(pol.polqual,      pol.polrelid)         AS using_expr,
       pg_get_expr(pol.polwithcheck, pol.polrelid)         AS with_check_expr
FROM pg_policy pol
WHERE pol.polrelid = 'public.provider_staff_availability'::regclass
ORDER BY pol.polname;

-- 7) THE SAFETY CHECK — the table ships EMPTY and stays empty until Phase 2.
--    Expect: 0.
--    Any row here in Phase 1 means something is writing to a table no client
--    code reads, and the "zero behaviour change" claim needs re-examining.
SELECT COUNT(*) AS staff_availability_rows FROM public.provider_staff_availability;

-- 8) Confirm nothing else moved. These are the tables this migration must NOT
--    have touched; run before/after if you want a diff, or just eyeball that
--    provider_availability still has its own columns intact (start_time/end_time
--    TEXT, break_start/break_end TIME) and no staff_id has appeared on it.
--    Expect for provider_availability, in order: id, provider_id, day_of_week,
--    start_time (text), end_time (text), is_available, break_start (time without
--    time zone), break_end (time without time zone) — and NO staff_id.
SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('provider_availability', 'provider_blocked_dates',
                     'provider_date_overrides', 'provider_staff')
ORDER BY table_name, ordinal_position;
