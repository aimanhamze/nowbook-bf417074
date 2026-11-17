-- provider_customers(provider) — the "My Customers" list, grouped in the database.
--
-- ORDER: VERIFY §0 → this file → §A → §B, on DEV and then on PROD.
-- APPLY BEFORE THE APP THAT CALLS IT IS DEPLOYED: useProviderCustomers has no
-- client-side fallback, so without this function the customers page, the
-- walk-in customer picker and the sell-package sheet show no customers.
-- Applying it early is safe — nothing calls it until that app ships.
-- Rollback: VERIFY §E.
--
-- WHY. The client used to download EVERY booking of the provider (three
-- 500-row pages in sequence for a busy provider) plus the profile of every
-- registered customer (one request per 100), then group them in the browser.
-- This returns the grouped list in one request.
--
-- SAME NUMBERS. This is a line-for-line port of the grouping that
-- src/hooks/useProviderCustomers.ts did with src/lib/customerKey.ts:
--   key           account (user_id, else linked_user_id)  → 'u:<uuid>'
--                 else the phone's last 9 digits, when it
--                 has at least 9                           → 'p:<digits>'
--                 else the booking itself                  → 'w:<booking id>'
--   booking_count every booking of that customer, EVERY status (cancelled
--                 included) — exactly what the page counted before
--   last_visit    the latest booking_date, future dates included
--   name / phone  per booking: the account's profile value, else what is
--                 typed on the booking; per customer: the first non-empty one
--                 in booking-id order, else the first booking's value
-- '[^0-9]' rather than '\D': JavaScript's \D is ASCII-only, PostgreSQL's
-- follows the locale and would keep e.g. Arabic-Indic digits.
-- The list is returned UNSORTED; the client keeps its own sort (most bookings
-- first, then name) so the order cannot differ by collation.
--
-- WHO SEES WHAT. SECURITY INVOKER: the function reads bookings and profiles
-- under the CALLER's row-level security, exactly as the client's own queries
-- did. It can therefore return nothing the caller could not already select:
-- the owner of the branch gets the branch's customers; anyone else gets only
-- rows built from bookings they can already read (their own), or nothing.
-- No new access is granted and no policy is touched.
--
-- One jsonb value rather than a row set: PostgREST silently truncates row sets
-- at 1000 rows, and a provider can have more customers than that.
--
-- DELIBERATELY NOT TOUCHED: every table, column, index, policy, trigger and
-- existing function (prevent_booking_conflicts included). No data is written.

BEGIN;

CREATE OR REPLACE FUNCTION public.provider_customers(p_provider_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $fn$
  WITH b AS (
    SELECT id, user_id, linked_user_id, customer_name, customer_phone, booking_date
    FROM public.bookings
    WHERE provider_id = p_provider_id
  ),
  -- Registered customers' profiles, looked up by id (an index lookup per
  -- customer) rather than joined, so row-level security on profiles is only
  -- evaluated for this provider's customers.
  prof AS (
    SELECT DISTINCT ON (pr.user_id) pr.user_id, pr.display_name, pr.phone
    FROM public.profiles pr
    WHERE pr.user_id = ANY (ARRAY(SELECT DISTINCT user_id FROM b WHERE user_id IS NOT NULL))
  ),
  keyed AS (
    SELECT
      b.id,
      CASE
        WHEN COALESCE(b.user_id, b.linked_user_id) IS NOT NULL
          THEN 'u:' || COALESCE(b.user_id, b.linked_user_id)::text
        WHEN length(regexp_replace(COALESCE(b.customer_phone, ''), '[^0-9]', '', 'g')) >= 9
          THEN 'p:' || right(regexp_replace(b.customer_phone, '[^0-9]', '', 'g'), 9)
        ELSE 'w:' || b.id::text
      END                                          AS key,
      COALESCE(prof.display_name, b.customer_name) AS name,
      COALESCE(prof.phone, b.customer_phone)       AS phone,
      b.booking_date
    FROM b
    LEFT JOIN prof ON prof.user_id = b.user_id
  ),
  grouped AS (
    SELECT
      key,
      COALESCE(
        (array_agg(name ORDER BY id) FILTER (WHERE name <> ''))[1],
        (array_agg(name ORDER BY id))[1]
      )                 AS name,
      COALESCE(
        (array_agg(phone ORDER BY id) FILTER (WHERE phone <> ''))[1],
        (array_agg(phone ORDER BY id))[1]
      )                 AS phone,
      count(*)::int     AS booking_count,
      max(booking_date) AS last_visit
    FROM keyed
    GROUP BY key
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(grouped)), '[]'::jsonb) FROM grouped;
$fn$;

COMMENT ON FUNCTION public.provider_customers(uuid) IS
  'The provider''s customers grouped from their bookings: key, name, phone, booking_count (every status), last_visit. SECURITY INVOKER — reads bookings/profiles under the caller''s RLS. Port of useProviderCustomers + lib/customerKey; keep the two in step.';

REVOKE ALL ON FUNCTION public.provider_customers(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.provider_customers(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.provider_customers(uuid) TO authenticated;

COMMIT;
