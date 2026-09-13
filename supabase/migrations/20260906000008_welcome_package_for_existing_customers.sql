-- One-time goodwill grant: every existing customer of ONE provider (Herlift)
-- who does not already hold a package gets 2 free entries, valid 30 days.
--
-- SCOPED TO A SINGLE PROVIDER BY ID, not by category. Consequences:
--   * On any database where this id is absent the migration is a silent
--     no-op -- it creates nothing and raises nothing. That is true of DEV,
--     where the id does not exist, so applying it here proves only that the
--     SQL parses.
--   * If this provider is NOT category = 'fitness_studio' on the target
--     database, the grant still lands, but the provider cannot manage
--     templates afterwards ("Fitness studio manages own templates" RLS) and
--     package_request_purchase will refuse with PACKAGES_FOR_FITNESS_ONLY.
--     Confirm the category before running this on PROD.
--
-- Numbered 20260906000008 -- AFTER every table, trigger and RPC this depends
-- on. An earlier number (e.g. 202609040000xx) would sort before
-- 20260905000002 creates package_templates and fail on a clean replay.
--
-- Idempotency is by WHERE NOT EXISTS, not ON CONFLICT: package_templates has
-- no unique constraint on (provider_id, name) for ON CONFLICT to target, and
-- one cannot be added -- providers already have same-named templates in real
-- data, so the index would fail to build.

BEGIN;

-- 1. A hidden template per studio. is_active = false keeps it out of the
--    customer-facing list (useProviderPackages filters on it) -- this is a
--    grant, not something on sale.
INSERT INTO package_templates
  (provider_id, name, description, total_entries, validity_days, price, is_active)
SELECT pp.id,
       'חבילת ברוך הבא 🎁',
       'חבילת פתיחה חינמית ל-2 כניסות',
       2, 30, 0, false
FROM provider_profiles pp
WHERE pp.id = '23a6af1e-a476-40e0-ada8-afd2d0195477'   -- Herlift
  AND NOT EXISTS (
    SELECT 1 FROM package_templates t
     WHERE t.provider_id = pp.id
       AND t.name = 'חבילת ברוך הבא 🎁'
  );

-- 2. Grant + log in ONE statement. The log is driven by the CTE's RETURNING,
--    i.e. by what THIS run actually inserted -- matching on `notes` instead
--    would re-log every previously granted package on any replay.
WITH granted AS (
  INSERT INTO customer_packages
    (customer_id, provider_id, template_id, entries_remaining, total_entries,
     status, activated_at, expires_at, notes)
  SELECT DISTINCT ON (b.user_id, pp.id)
    b.user_id,
    pp.id,
    pt.id,
    2,
    2,
    'active',
    now(),
    -- Local midnight, consistent with handle_package_booking's expiry rule.
    -- Plain `now() + 30 days` would expire mid-day and drift across the UTC
    -- boundary.
    (((now() AT TIME ZONE 'Asia/Jerusalem')::date + 30)::timestamp
       AT TIME ZONE 'Asia/Jerusalem'),
    'חבילת ברוך הבא — ניתנה אוטומטית'
  FROM bookings b
  JOIN provider_profiles pp
    ON pp.id = b.provider_id          -- both uuid; a ::text cast breaks this
  JOIN package_templates pt
    ON pt.provider_id = pp.id
   AND pt.name = 'חבילת ברוך הבא 🎁'
  WHERE pp.id = '23a6af1e-a476-40e0-ada8-afd2d0195477'   -- Herlift
    AND b.status IN ('confirmed', 'pending')
    AND b.user_id IS NOT NULL
    -- Anyone who already owns a package here is skipped entirely, whatever
    -- its state. A welcome grant must never sit alongside a real purchase.
    AND NOT EXISTS (
      SELECT 1 FROM customer_packages cp
       WHERE cp.customer_id = b.user_id
         AND cp.provider_id = pp.id
    )
  ORDER BY b.user_id, pp.id, b.booking_date DESC
  RETURNING id, entries_remaining
)
INSERT INTO package_usage_log
  (customer_package_id, booking_id, action_type,
   entries_before, entries_after, performed_by, note)
SELECT id, NULL, 'package_activated',
       -- before = after. The package is CREATED holding its entries, so a
       -- 0 -> 2 delta would be a lie and would break the reconciliation
       -- invariant (remaining = total + sum(delta)).
       entries_remaining, entries_remaining,
       NULL,
       'חבילת ברוך הבא — ניתנה אוטומטית במיגרציה'
FROM granted;

COMMIT;
