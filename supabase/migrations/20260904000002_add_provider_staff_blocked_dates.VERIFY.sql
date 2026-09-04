-- VERIFY for 20260904000002_add_provider_staff_blocked_dates.sql
-- Run AFTER applying the migration.
-- Every check here is READ-ONLY; nothing below mutates data.
--
-- Checks 1–6 verify the object was created as intended. Check 7 is the SAFETY
-- check: the whole claim of this migration is "zero behaviour change", and that
-- claim rests on the table being empty and unread.

-- 1) Table exists with exactly the expected columns.
--    Expect 4 rows, in this order:
--      provider_id  | uuid                     | NO  |
--      staff_id     | uuid                     | NO  |
--      blocked_date | date                     | NO  |
--      created_at   | timestamp with time zone | NO  | now()
--
--    NOTE there is deliberately NO `reason`, unlike provider_blocked_dates —
--    this table needs public SELECT and Postgres RLS cannot restrict columns, so
--    a free-text reason about a named employee would be world-readable. See the
--    migration header. If a `reason` column appears here, that decision was
--    reversed and the privacy note needs revisiting.
--    NOTE `created_at` IS present, unlike provider_blocked_dates — this table
--    follows its two staff-table siblings instead.
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'provider_staff_blocked_dates'
ORDER BY ordinal_position;

-- 2) Constraints: composite PK and composite FK with CASCADE.
--    Expect two rows:
--      provider_staff_blocked_dates_pkey : PRIMARY KEY (staff_id, blocked_date)
--      psbd_staff_fkey                   : FOREIGN KEY (staff_id, provider_id)
--                                            REFERENCES provider_staff(id, provider_id)
--                                            ON DELETE CASCADE
--
--    The PK's COLUMN ORDER matters: staff_id must lead, so the index also serves
--    the owner editor's range-scoped delete
--    (provider_id, staff_id, blocked_date >= today).
SELECT conname,
       pg_get_constraintdef(oid) AS definition,
       CASE confdeltype WHEN 'a' THEN 'NO ACTION' WHEN 'n' THEN 'SET NULL'
                        WHEN 'c' THEN 'CASCADE'   WHEN 'r' THEN 'RESTRICT'
                        WHEN 'd' THEN 'SET DEFAULT' END AS delete_rule
FROM pg_constraint
WHERE conrelid = 'public.provider_staff_blocked_dates'::regclass
ORDER BY contype, conname;

-- 3) The FK points at provider_staff's COMPOSITE unique key, not at its PK
--    alone. This is what makes "provider X's row naming provider Y's staff"
--    unrepresentable. Expect one row naming provider_staff_id_provider_id_key.
--    (c.conindid is the OID of the INDEX on the referenced table backing the FK;
--     the unique/PK constraint sharing that index is the one being referenced.)
SELECT c.conname,
       (SELECT ref.conname
          FROM pg_constraint ref
         WHERE ref.conrelid = c.confrelid
           AND ref.contype IN ('u', 'p')
           AND ref.conindid = c.conindid)  AS referenced_constraint,
       pg_get_constraintdef(c.oid)          AS definition
FROM pg_constraint c
WHERE c.conrelid = 'public.provider_staff_blocked_dates'::regclass
  AND c.contype = 'f';

-- 4) Index on (provider_id, blocked_date) exists — the single windowed
--    per-provider fetch the customer flow makes.
--    Expect two rows: the PK's implicit index on (staff_id, blocked_date) and
--      idx_psbd_provider_date ... btree (provider_id, blocked_date)
SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public' AND tablename = 'provider_staff_blocked_dates'
ORDER BY indexname;

-- 5) RLS is ENABLED. Expect rls_enabled = true. If this is false the public
--    SELECT policy is irrelevant and the table is wide open to any writer.
SELECT relrowsecurity AS rls_enabled
FROM pg_class WHERE oid = 'public.provider_staff_blocked_dates'::regclass;

-- 6) Exactly two policies, mirroring provider_blocked_dates' shape.
--    Expect:
--      "Anyone can view staff blocked dates"      SELECT  using_expr = true
--                                                         with_check_expr = NULL
--      "Provider manages own staff blocked dates" ALL     using_expr AND
--                                                         with_check_expr BOTH =
--          (provider_id IN ( SELECT provider_profiles.id FROM provider_profiles
--                            WHERE provider_profiles.user_id = auth.uid()))
--
--    with_check_expr being NULL on the ALL policy is a FAILURE, not a detail:
--    that is the exact omission 20260425000001 had to fix on
--    provider_blocked_dates, and it silently blocks every insert through
--    PostgREST. Step 5b would present as a broken editor.
SELECT pol.polname,
       CASE pol.polcmd WHEN 'r' THEN 'SELECT' WHEN '*' THEN 'ALL'
                       WHEN 'a' THEN 'INSERT' WHEN 'w' THEN 'UPDATE'
                       WHEN 'd' THEN 'DELETE' END          AS command,
       pg_get_expr(pol.polqual,      pol.polrelid)         AS using_expr,
       pg_get_expr(pol.polwithcheck, pol.polrelid)         AS with_check_expr
FROM pg_policy pol
WHERE pol.polrelid = 'public.provider_staff_blocked_dates'::regclass
ORDER BY pol.polname;

-- 7) THE SAFETY CHECK — the table ships EMPTY and stays empty until 5b.
--    Expect: 0.
--    Any row here at this step means something is writing to a table no client
--    code reads, and the "zero behaviour change" claim needs re-examining.
SELECT COUNT(*) AS staff_blocked_date_rows FROM public.provider_staff_blocked_dates;

-- 8) Confirm nothing else moved. These are the tables this migration must NOT
--    have touched. Expect provider_blocked_dates to still be exactly
--    id / provider_id / blocked_date / reason — with NO staff_id added to it,
--    and NO created_at (its long-standing shape; this migration does not
--    normalise it), and provider_staff_availability unchanged from
--    20260903000002.
SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('provider_blocked_dates', 'provider_staff_availability',
                     'provider_staff', 'provider_staff_services')
ORDER BY table_name, ordinal_position;

-- 9) OPTIONAL — the PRECEDENCE the header claims, asserted against real data
--    rather than read from a comment. Read-only; returns rows only if something
--    is wrong.
--
--    9a) No staff blocked date may exist for a staff/provider pair that does not
--        exist. The composite FK already guarantees this; the query is here so a
--        future migration that weakens the FK is caught. Expect ZERO rows.
SELECT b.provider_id, b.staff_id, b.blocked_date
FROM public.provider_staff_blocked_dates b
LEFT JOIN public.provider_staff s
  ON s.id = b.staff_id AND s.provider_id = b.provider_id
WHERE s.id IS NULL;

--    9b) Informational, not a failure: staff days off that fall on a date the
--        SHOP is already closed. These are harmless and fully expected (layer 1
--        wins and closes the day for everyone regardless), but a large count
--        suggests an owner is marking staff off for shop holidays, which they
--        do not need to do. Expect zero rows until 5b ships.
SELECT b.provider_id, b.staff_id, b.blocked_date
FROM public.provider_staff_blocked_dates b
JOIN public.provider_blocked_dates p
  ON p.provider_id = b.provider_id AND p.blocked_date = b.blocked_date;
