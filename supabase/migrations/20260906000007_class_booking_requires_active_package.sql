-- Packages are now MANDATORY for fitness_studio class bookings.
--
-- Design notes, each deliberate:
--
--  * INSERT ONLY. 14 class bookings already exist with no package. A check that
--    also fired on UPDATE would make cancelling, rescheduling or checking in
--    any of them throw. Existing rows are grandfathered; only new bookings are
--    gated.
--
--  * IT ATTACHES, IT DOES NOT MERELY CHECK. Verifying "this customer owns an
--    active package" without linking the booking to it would let one package
--    buy unlimited classes -- the booking would carry customer_package_id NULL,
--    handle_package_booking would return early, and nothing would ever be
--    deducted. Resolving and assigning the package here guarantees the AFTER
--    trigger deducts, whatever the client sent.
--
--  * PROVIDER AND SERVICE-ROLE PATHS ARE EXEMPT. A provider adding someone to a
--    class is a business decision, and cron/Edge Functions carry no JWT. Only a
--    customer booking for themselves is gated.
--
--  * SOONEST-EXPIRING PACKAGE WINS, so the perishable one is spent first.
--
-- Applied to DEV as migration `class_booking_requires_active_package`.

CREATE OR REPLACE FUNCTION public.enforce_class_requires_package()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_pkg_id uuid;
  v_today date := (now() AT TIME ZONE 'Asia/Jerusalem')::date;
BEGIN
  -- Not a class booking: the standard appointment flow is untouched.
  IF NEW.class_schedule_id IS NULL THEN RETURN NEW; END IF;

  -- Server-side callers (service role, cron, Edge Functions) carry no JWT.
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;

  -- Provider acting for their own business -- not a customer self-booking.
  IF EXISTS (SELECT 1 FROM provider_profiles pp
              WHERE pp.id::text = NEW.provider_id::text
                AND pp.user_id::text = auth.uid()::text) THEN
    RETURN NEW;
  END IF;

  -- A walk-in has no account and so cannot hold a package. Only reachable via
  -- a provider path, which the check above already returned for.
  IF NEW.user_id IS NULL THEN RETURN NEW; END IF;

  -- Already carries a package: leave it, handle_package_booking validates it.
  IF NEW.customer_package_id IS NOT NULL THEN RETURN NEW; END IF;

  SELECT id INTO v_pkg_id
    FROM customer_packages
   WHERE customer_id = NEW.user_id
     AND provider_id = NEW.provider_id
     AND status = 'active'
     AND entries_remaining > 0
     AND (expires_at IS NULL
          OR (expires_at AT TIME ZONE 'Asia/Jerusalem')::date >= v_today)
   ORDER BY expires_at NULLS LAST, purchased_at
   LIMIT 1;

  IF v_pkg_id IS NOT NULL THEN
    NEW.customer_package_id := v_pkg_id;
    RETURN NEW;
  END IF;

  -- Nothing usable. Say WHY, so the UI can show the right message rather than
  -- a generic refusal.
  IF EXISTS (SELECT 1 FROM customer_packages
              WHERE customer_id = NEW.user_id AND provider_id = NEW.provider_id
                AND (status = 'exhausted' OR (status = 'active' AND entries_remaining <= 0))) THEN
    RAISE EXCEPTION 'PACKAGE_EXHAUSTED';
  END IF;

  IF EXISTS (SELECT 1 FROM customer_packages
              WHERE customer_id = NEW.user_id AND provider_id = NEW.provider_id
                AND (status = 'expired'
                     OR (expires_at IS NOT NULL
                         AND (expires_at AT TIME ZONE 'Asia/Jerusalem')::date < v_today))) THEN
    RAISE EXCEPTION 'PACKAGE_EXPIRED';
  END IF;

  RAISE EXCEPTION 'NO_ACTIVE_PACKAGE';
END;
$$;

-- BEFORE INSERT only. Named so it sorts before trg_enforce_package_column_permission,
-- which only guards customer_package_id on UPDATE and so does not object to this
-- trigger assigning it on INSERT.
DROP TRIGGER IF EXISTS trg_enforce_class_requires_package ON public.bookings;
CREATE TRIGGER trg_enforce_class_requires_package
BEFORE INSERT ON public.bookings
FOR EACH ROW EXECUTE FUNCTION public.enforce_class_requires_package();
