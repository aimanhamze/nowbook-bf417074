-- BUG FIX: both refund triggers did `UPDATE customer_packages ... RETURNING
-- entries_remaining INTO v_remaining` with no check that a row was actually
-- updated, then wrote `v_remaining - 1` into package_usage_log.entries_before
-- (NOT NULL).
--
-- When the package row is gone the UPDATE matches nothing, v_remaining stays
-- NULL, and the INSERT fails with 23502. That happens on a real path: deleting
-- a customer_package fires the ON DELETE SET NULL on bookings.customer_package_id,
-- which fires handle_package_reschedule against the row being deleted. Net
-- effect was that a package could never be deleted once any booking had
-- referenced it.
--
-- Fix: if the package row is not there, there is no balance to move and
-- nothing to log -- return quietly.
--
-- Applied to DEV as migration `package_triggers_guard_missing_package_row`.

CREATE OR REPLACE FUNCTION public.handle_package_reschedule()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_remaining integer;
BEGIN
  IF OLD.status != 'confirmed' OR NEW.status != 'confirmed' THEN RETURN NEW; END IF;
  IF OLD.customer_package_id IS NULL AND NEW.customer_package_id IS NULL THEN RETURN NEW; END IF;
  IF OLD.customer_package_id IS NOT DISTINCT FROM NEW.customer_package_id THEN RETURN NEW; END IF;

  IF OLD.customer_package_id IS NOT NULL THEN
    UPDATE customer_packages SET
      entries_remaining = entries_remaining + 1,
      status = CASE WHEN status = 'exhausted' THEN 'active' ELSE status END,
      updated_at = now()
    WHERE id = OLD.customer_package_id
    RETURNING entries_remaining INTO v_remaining;

    -- The package row is gone (it is being deleted, and this trigger fired via
    -- the FK's ON DELETE SET NULL). No balance to return, nothing to log.
    IF NOT FOUND THEN
      RETURN NEW;
    END IF;

    INSERT INTO package_usage_log
      (customer_package_id, booking_id, action_type, entries_before, entries_after, performed_by)
    VALUES
      (OLD.customer_package_id, OLD.id, 'entry_returned_manual',
       v_remaining - 1, v_remaining, auth.uid());
  END IF;

  RETURN NEW;
END;
$$;

-- Same latent hole in the cancellation refund. Less reachable (a deleted
-- package leaves customer_package_id NULL, which the early return catches)
-- but identical in kind, so guard it too.
--
-- NOTE: this function is replaced again in the next migration, which adds the
-- provider-cancelled check. Kept here so the history reflects what was applied.
CREATE OR REPLACE FUNCTION public.handle_package_cancellation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_remaining integer;
BEGIN
  IF OLD.status != 'confirmed' THEN RETURN NEW; END IF;
  IF NEW.status != 'cancelled' THEN RETURN NEW; END IF;
  IF OLD.customer_package_id IS NULL THEN RETURN NEW; END IF;
  IF OLD.check_in_at IS NOT NULL THEN RETURN NEW; END IF;

  UPDATE customer_packages SET
    entries_remaining = entries_remaining + 1,
    status = CASE WHEN status = 'exhausted' THEN 'active' ELSE status END,
    updated_at = now()
  WHERE id = OLD.customer_package_id
  RETURNING entries_remaining INTO v_remaining;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  INSERT INTO package_usage_log
    (customer_package_id, booking_id, action_type, entries_before, entries_after, performed_by)
  VALUES
    (OLD.customer_package_id, OLD.id, 'entry_returned_cancellation',
     v_remaining - 1, v_remaining, auth.uid());

  RETURN NEW;
END;
$$;
