-- VERIFY / test plan for 20260714000002_link_walkin_to_account_trigger.sql
-- Run AFTER applying the migration. The functional test (§B) runs inside a
-- transaction that ROLLS BACK, so it leaves NO residue even though it INSERTs.
-- (Run in a SQL client that honors an explicit BEGIN/ROLLBACK block.)

-- ─────────────────────────────────────────────────────────────────────────────
-- §A. Object checks (read-only)
-- ─────────────────────────────────────────────────────────────────────────────

-- A1. Function exists, is SECURITY DEFINER, search_path pinned to public.
--     Expect: prosecdef = true, proconfig contains 'search_path=public'.
SELECT proname, prosecdef, proconfig
FROM pg_proc
WHERE proname = 'link_walkin_to_account'
  AND pronamespace = 'public'::regnamespace;

-- A2. Trigger is BEFORE INSERT, row-level, on public.bookings.
--     Expect: timing = BEFORE, event = INSERT, orientation = ROW.
SELECT tgname,
       CASE WHEN (tgtype & 2)  <> 0 THEN 'BEFORE' ELSE 'AFTER' END AS timing,
       CASE WHEN (tgtype & 4)  <> 0 THEN 'INSERT' END              AS on_insert,
       CASE WHEN (tgtype & 1)  <> 0 THEN 'ROW' ELSE 'STATEMENT' END AS orientation
FROM pg_trigger
WHERE tgrelid = 'public.bookings'::regclass
  AND tgname = 'trg_link_walkin_to_account';

-- ─────────────────────────────────────────────────────────────────────────────
-- §Discovery. Pick real IDs/phones to drive the test. Note the outputs, then
-- paste them into the placeholders in §B.
-- ─────────────────────────────────────────────────────────────────────────────

-- D1. A provider to attach the test rows to (need pp.id).
SELECT id AS provider_id, business_name FROM public.provider_profiles LIMIT 5;

-- D2. A phone that matches EXACTLY ONE account (single-match) + that user_id.
SELECT regexp_replace(p.phone,'\D','','g') AS dphone,
       MIN(p.user_id)                      AS the_only_user_id,
       COUNT(DISTINCT p.user_id)           AS matches
FROM public.profiles p
WHERE p.phone IS NOT NULL AND regexp_replace(p.phone,'\D','','g') <> ''
GROUP BY 1
HAVING COUNT(DISTINCT p.user_id) = 1
LIMIT 5;

-- D3. A phone that matches 2+ accounts (ambiguous — must NOT link).
SELECT regexp_replace(p.phone,'\D','','g') AS dphone,
       COUNT(DISTINCT p.user_id)           AS matches
FROM public.profiles p
WHERE p.phone IS NOT NULL AND regexp_replace(p.phone,'\D','','g') <> ''
GROUP BY 1
HAVING COUNT(DISTINCT p.user_id) >= 2;

-- ─────────────────────────────────────────────────────────────────────────────
-- §B. Functional test — INSERT walk-ins and observe linked_user_id, then ROLLBACK.
-- Replace the placeholders with values from §Discovery:
--   :provider_id   → a provider_profiles.id (uuid)   [D1]
--   :service_id    → any service id for that provider (or any text; duration
--                    defaults to 30 if unknown). SELECT id FROM provider_services
--                    WHERE provider_id = :provider_id LIMIT 1;
--   :single_phone  → the single-match dphone          [D2]
--   :single_user   → its the_only_user_id (uuid)      [D2]
--   :ambig_phone   → an ambiguous dphone              [D3]  (omit case 3 if none)
--   :some_user     → any real auth account id, for the registered-booking case
-- Distinct booking_time per row + a far-future date avoids the conflict trigger.
-- ─────────────────────────────────────────────────────────────────────────────
BEGIN;

-- Case 1 — walk-in, phone matches exactly ONE account → linked_user_id = that user.
INSERT INTO public.bookings
  (user_id, provider_id, service_ids, booking_date, booking_time, total_price,
   status, customer_name, customer_phone)
VALUES
  (NULL, ':provider_id', ARRAY[':service_id'], DATE '2099-01-01', '09:00', 0,
   'confirmed', 'ZZ_TEST_LINK match-one', ':single_phone')
RETURNING id, customer_name, user_id, linked_user_id;
--   Expect: linked_user_id = :single_user   (NON-NULL)

-- Case 2 — walk-in, phone matches NO account → linked_user_id stays NULL.
INSERT INTO public.bookings
  (user_id, provider_id, service_ids, booking_date, booking_time, total_price,
   status, customer_name, customer_phone)
VALUES
  (NULL, ':provider_id', ARRAY[':service_id'], DATE '2099-01-01', '09:15', 0,
   'confirmed', 'ZZ_TEST_LINK no-match', '0500000000')  -- 10 digits, unused number
RETURNING id, customer_name, linked_user_id;
--   Expect: linked_user_id IS NULL

-- Case 3 — walk-in, phone matches 2+ accounts → NULL (ambiguous, skipped).
-- (Run only if D3 returned a phone; else skip this INSERT.)
INSERT INTO public.bookings
  (user_id, provider_id, service_ids, booking_date, booking_time, total_price,
   status, customer_name, customer_phone)
VALUES
  (NULL, ':provider_id', ARRAY[':service_id'], DATE '2099-01-01', '09:30', 0,
   'confirmed', 'ZZ_TEST_LINK ambiguous', ':ambig_phone')
RETURNING id, customer_name, linked_user_id;
--   Expect: linked_user_id IS NULL

-- Case 4 — REGISTERED booking (user_id set) → trigger does nothing.
INSERT INTO public.bookings
  (user_id, provider_id, service_ids, booking_date, booking_time, total_price,
   status, customer_name, customer_phone)
VALUES
  (':some_user', ':provider_id', ARRAY[':service_id'], DATE '2099-01-01', '09:45', 0,
   'confirmed', 'ZZ_TEST_LINK registered', ':single_phone')
RETURNING id, user_id, linked_user_id;
--   Expect: linked_user_id IS NULL (never links a registered row, even though the
--           phone would match one account)

-- Case 5 — too-short / garbage phone → NULL (length guard).
INSERT INTO public.bookings
  (user_id, provider_id, service_ids, booking_date, booking_time, total_price,
   status, customer_name, customer_phone)
VALUES
  (NULL, ':provider_id', ARRAY[':service_id'], DATE '2099-01-01', '10:00', 0,
   'confirmed', 'ZZ_TEST_LINK garbage', 'abc-12')
RETURNING id, customer_name, linked_user_id;
--   Expect: linked_user_id IS NULL

-- Undo everything above — nothing persists.
ROLLBACK;

-- ─────────────────────────────────────────────────────────────────────────────
-- §C. Existing rows untouched (read-only). The trigger is INSERT-only, so any
-- previously-existing walk-in still has linked_user_id NULL. Expect: 0.
-- ─────────────────────────────────────────────────────────────────────────────
SELECT COUNT(*) AS preexisting_walkins_now_linked
FROM public.bookings
WHERE user_id IS NULL AND linked_user_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- §D. Fallback cleanup — only needed if you did NOT use the §B transaction and
-- instead committed the test inserts. Removes exactly the tagged test rows.
-- ─────────────────────────────────────────────────────────────────────────────
-- DELETE FROM public.bookings WHERE customer_name LIKE 'ZZ_TEST_LINK%';
