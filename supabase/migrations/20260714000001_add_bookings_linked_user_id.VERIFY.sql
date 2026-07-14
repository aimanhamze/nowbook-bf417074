-- VERIFY for 20260714000001_add_bookings_linked_user_id.sql
-- Read-only. Run AFTER applying the migration. Nothing here mutates data.

-- 1) Column exists, is nullable uuid.
--    Expect: linked_user_id | uuid | YES
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'bookings'
  AND column_name = 'linked_user_id';

-- 2) FK → auth.users(id) with ON DELETE SET NULL.
--    Expect one row: references auth.users(id), delete_rule = 'SET NULL'.
SELECT
  con.conname                                   AS constraint_name,
  confrelid::regclass                           AS references_table,
  af.attname                                    AS references_column,
  CASE con.confdeltype
    WHEN 'n' THEN 'SET NULL'
    WHEN 'c' THEN 'CASCADE'
    WHEN 'a' THEN 'NO ACTION'
    WHEN 'r' THEN 'RESTRICT'
    WHEN 'd' THEN 'SET DEFAULT'
  END                                           AS delete_rule
FROM pg_constraint con
JOIN pg_attribute a  ON a.attrelid = con.conrelid  AND a.attnum  = con.conkey[1]
JOIN pg_attribute af ON af.attrelid = con.confrelid AND af.attnum = con.confkey[1]
WHERE con.conrelid = 'public.bookings'::regclass
  AND con.contype = 'f'
  AND a.attname = 'linked_user_id';

-- 3) SELECT policy now includes linked_user_id (and still the user_id + provider arms).
--    Expect: using_expr mentions linked_user_id, user_id, and provider_profiles.
SELECT policyname, cmd,
       pg_get_expr(qual, 'public.bookings'::regclass) AS using_expr
FROM pg_policy
WHERE polrelid = 'public.bookings'::regclass AND cmd = 'r'   -- r = SELECT
ORDER BY policyname;

-- 4) UPDATE / DELETE / INSERT policies UNCHANGED — must NOT mention linked_user_id
--    (customer arm stays auth.uid() = user_id; provider arms via provider_profiles).
--    Expect: zero rows referencing linked_user_id.
SELECT policyname,
       CASE cmd WHEN 'a' THEN 'INSERT' WHEN 'w' THEN 'UPDATE' WHEN 'd' THEN 'DELETE' END AS command,
       pg_get_expr(qual,       'public.bookings'::regclass) AS using_expr,
       pg_get_expr(with_check, 'public.bookings'::regclass) AS with_check_expr
FROM pg_policy
WHERE polrelid = 'public.bookings'::regclass
  AND cmd IN ('a','w','d')
ORDER BY cmd, policyname;
-- Manual check: none of the above using_expr / with_check_expr contain
-- "linked_user_id". If any do, the migration overreached — investigate.

-- 5) All existing rows have linked_user_id NULL (additive → nothing linked yet).
--    Expect: total > 0, non_null_linked = 0.
SELECT COUNT(*) AS total_bookings,
       COUNT(linked_user_id) AS non_null_linked
FROM public.bookings;
