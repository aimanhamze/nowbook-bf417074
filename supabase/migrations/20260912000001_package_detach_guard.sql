-- SECURITY FIX: two ways a customer could get a free class.
--
-- "Users can update own bookings" has no WITH CHECK, so a customer can PATCH
-- any column of their own row. Two consequences, both verified on DEV before
-- this migration:
--
--   1. DETACH THE PACKAGE
--        booked            -> entries 3->2
--        detach package    -> entries back to 3, booking still confirmed
--      handle_package_reschedule refunds the entry while the class stays
--      booked. Unlimited free classes from one package.
--
--   2. WIPE THE CHECK-IN
--        booked                   -> entries 3->2
--        provider checks them in  -> attended
--        customer clears check-in -> check_in_at NULL
--        customer cancels         -> entries back to 3
--      handle_package_cancellation only skips the refund while check_in_at is
--      set, so clearing it turns an attended class back into a refund.
--
-- Both are blocked for the customer here. Deliberately still allowed:
--
--   * CUSTOMER SELF CHECK-IN (setting check_in_at). It is a specified
--     feature; only CLEARING it is an escape hatch.
--   * SWITCHING between two of the customer's own packages. Already safe --
--     handle_package_reschedule returns the entry to the old package and
--     handle_package_booking deducts from the new one behind its own
--     ownership check, netting to zero.
--   * EVERYTHING THE PROVIDER DOES. Reassigning a booking or undoing a
--     mistaken check-in are legitimate business actions.
--   * SERVICE-ROLE CALLERS (migrations, cron, Edge Functions), which carry
--     no JWT.

CREATE OR REPLACE FUNCTION public.enforce_package_detach_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_is_provider boolean;
BEGIN
  IF v_uid IS NULL THEN RETURN NEW; END IF;

  -- ::text on BOTH sides -- PROD and DEV disagree on these column types, and
  -- a one-sided cast raises "operator does not exist: text = uuid".
  SELECT EXISTS (
    SELECT 1 FROM provider_profiles pp
     WHERE pp.user_id::text = v_uid::text
       AND pp.id::text = OLD.provider_id::text
  ) INTO v_is_provider;

  IF v_is_provider THEN RETURN NEW; END IF;

  IF OLD.customer_package_id IS NOT NULL
     AND NEW.customer_package_id IS NULL THEN
    RAISE EXCEPTION 'PACKAGE_DETACH_FORBIDDEN'
      USING HINT = 'package cannot be removed from a booking';
  END IF;

  IF OLD.check_in_at IS NOT NULL
     AND NEW.check_in_at IS NULL THEN
    RAISE EXCEPTION 'CHECK_IN_CLEAR_FORBIDDEN'
      USING HINT = 'only the provider can undo a check-in';
  END IF;

  RETURN NEW;
END;
$$;

-- Fires for BOTH columns. Listing only customer_package_id would leave the
-- check_in_at rule above unreachable.
DROP TRIGGER IF EXISTS trg_enforce_package_detach_guard ON public.bookings;
CREATE TRIGGER trg_enforce_package_detach_guard
  BEFORE UPDATE OF customer_package_id, check_in_at
  ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.enforce_package_detach_guard();
