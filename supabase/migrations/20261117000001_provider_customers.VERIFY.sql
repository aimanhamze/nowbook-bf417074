-- VERIFY for 20261117000001_provider_customers.sql
--
--   §0  BEFORE the migration, read-only. DEV, then PROD before the prod apply.
--   §A  after the migration, read-only. DEV and PROD.
--   §B  after the migration, read-only. Parity against the bookings table, as
--       the provider. DEV and PROD (it only reads; the block rolls back).
--   §E  rollback (commented out).
--
-- §B needs two ids. Find them once:
--   SELECT id AS provider_id, user_id AS owner_id, business_name
--   FROM public.provider_profiles
--   WHERE business_name ILIKE '%herlift%' OR business_name ILIKE '%siwar%';


-- ═════════════════════════════════════════════════════════════════════════════
-- §0. PRE-APPLY — REQUIRED, READ-ONLY
-- ═════════════════════════════════════════════════════════════════════════════

-- 0.1 The name is free. Expect NULL.
SELECT to_regprocedure('public.provider_customers(uuid)') AS customers_fn;

-- 0.2 Every column read, with its type. Expect 10 rows:
--       bookings   booking_date date, customer_name text, customer_phone text,
--                  id uuid, linked_user_id uuid, provider_id uuid, user_id uuid
--       profiles   display_name text, phone text, user_id uuid
SELECT c.relname AS tbl, a.attname AS col, format_type(a.atttypid, a.atttypmod) AS type
FROM pg_attribute a
JOIN pg_class c ON c.oid = a.attrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND a.attnum > 0 AND NOT a.attisdropped
  AND (c.relname, a.attname) IN (
    ('bookings', 'booking_date'), ('bookings', 'customer_name'), ('bookings', 'customer_phone'),
    ('bookings', 'id'), ('bookings', 'linked_user_id'), ('bookings', 'provider_id'), ('bookings', 'user_id'),
    ('profiles', 'display_name'), ('profiles', 'phone'), ('profiles', 'user_id'))
ORDER BY 1, 2;

-- 0.3 One profile per account. Expect 0 rows. (The function takes one profile
--     per user_id; the old client code took one too. A duplicate would make
--     which one is used arbitrary — in both.)
SELECT user_id, count(*) FROM public.profiles GROUP BY user_id HAVING count(*) > 1;


-- ═════════════════════════════════════════════════════════════════════════════
-- §A. POST-APPLY — READ-ONLY
-- ═════════════════════════════════════════════════════════════════════════════

-- A.1 Exists, SECURITY INVOKER (prosecdef = false), STABLE (provolatile = 's'),
--     returns jsonb.
SELECT p.proname, p.prosecdef, p.provolatile, pg_get_function_result(p.oid) AS returns
FROM pg_proc p
WHERE p.oid = to_regprocedure('public.provider_customers(uuid)');

-- A.2 Who may execute it. Expect authenticated = true, anon = false, and no
--     '=X/' (PUBLIC) entry in the ACL.
SELECT has_function_privilege('authenticated', 'public.provider_customers(uuid)', 'EXECUTE') AS authenticated,
       has_function_privilege('anon',          'public.provider_customers(uuid)', 'EXECUTE') AS anon,
       (SELECT proacl FROM pg_proc WHERE oid = to_regprocedure('public.provider_customers(uuid)')) AS acl;


-- ═════════════════════════════════════════════════════════════════════════════
-- §B. PARITY — READ-ONLY, run as the provider (replace the two ids)
-- ═════════════════════════════════════════════════════════════════════════════

BEGIN;
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims',
  json_build_object('sub', '<OWNER_ID>', 'role', 'authenticated')::text, true);

-- B.1 Totals. Expect every pair equal:
--       customers        = distinct_keys
--       bookings_counted = bookings_total     (no booking lost or counted twice)
--       registered       = distinct_accounts
WITH fn AS (
  SELECT jsonb_array_elements(public.provider_customers('<PROVIDER_ID>')) AS c
), raw AS (
  SELECT id, user_id, linked_user_id, customer_phone
  FROM public.bookings WHERE provider_id = '<PROVIDER_ID>'
)
SELECT
  (SELECT count(*) FROM fn)                                             AS customers,
  (SELECT count(DISTINCT
     CASE
       WHEN COALESCE(user_id, linked_user_id) IS NOT NULL THEN 'u:' || COALESCE(user_id, linked_user_id)::text
       WHEN length(regexp_replace(COALESCE(customer_phone, ''), '[^0-9]', '', 'g')) >= 9
         THEN 'p:' || right(regexp_replace(customer_phone, '[^0-9]', '', 'g'), 9)
       ELSE 'w:' || id::text
     END) FROM raw)                                                     AS distinct_keys,
  (SELECT sum((c->>'booking_count')::int) FROM fn)                      AS bookings_counted,
  (SELECT count(*) FROM raw)                                            AS bookings_total,
  (SELECT count(*) FROM fn WHERE c->>'key' LIKE 'u:%')                  AS registered,
  (SELECT count(DISTINCT COALESCE(user_id, linked_user_id)) FROM raw)   AS distinct_accounts;

-- B.2 The top of the list, to compare by eye with the customers page as it is
--     today (same provider, before the new app is deployed): names, phones,
--     counts and last visit must match row for row.
SELECT c->>'name' AS name, c->>'phone' AS phone,
       (c->>'booking_count')::int AS bookings, c->>'last_visit' AS last_visit, c->>'key' AS key
FROM jsonb_array_elements(public.provider_customers('<PROVIDER_ID>')) AS c
ORDER BY (c->>'booking_count')::int DESC, c->>'name'
LIMIT 25;

-- B.3 Cost. Expect a few milliseconds.
EXPLAIN (ANALYZE, BUFFERS) SELECT public.provider_customers('<PROVIDER_ID>');

-- B.4 A branch the caller does not own returns no one else's customers.
--     Replace with ANOTHER owner's provider id. Expect 0 — or only the
--     caller's own bookings there, if they ever booked at that business.
SELECT jsonb_array_length(public.provider_customers('<OTHER_PROVIDER_ID>')) AS visible_customers;

ROLLBACK;


-- ═════════════════════════════════════════════════════════════════════════════
-- §E. ROLLBACK — only after the app that calls it has been rolled back
-- ═════════════════════════════════════════════════════════════════════════════

-- DROP FUNCTION IF EXISTS public.provider_customers(uuid);
