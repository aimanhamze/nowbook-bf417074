-- Membership / package system — Phase 1, migration 8 of 8.
--
-- Three corrections were applied to the original draft of this migration before
-- it was ever run; each was a guaranteed RUNTIME failure that CREATE FUNCTION
-- could not catch, because PL/pgSQL resolves field and column references lazily:
--
--   FIX 1  OLD is unassigned on INSERT, and this trigger is AFTER INSERT OR
--          UPDATE. Reading OLD.status raised "record old is not assigned yet"
--          on every package booking. Now gated on TG_OP.
--   FIX 2  validity_days lives on package_templates, NOT customer_packages.
--          v_pkg.validity_days raised "record v_pkg has no field
--          validity_days". Now read from the template via template_id.
--   FIX 3  notifications has a `body` column, not `message`. The original
--          INSERT raised "column message of relation notifications does not
--          exist".
--
-- Plus an OWNERSHIP GUARD, a security fix rather than a bug fix — see the
-- comment at the check itself.
--
-- KNOWN LIMITATIONS, accepted deliberately for this phase:
--   * Deduction keys on status = 'confirmed'. enforce_booking_approval_status()
--     rewrites an inserted 'confirmed' to 'pending' for providers with
--     requires_booking_approval = true, so those bookings deduct at APPROVAL,
--     not at booking. Verified on DEV: the entry is not taken at insert.
--   * handle_package_cancellation guards on OLD.status = 'confirmed', so a
--     pending -> cancelled rejection does NOT return the entry.
--   * The 24h low-entry window can suppress the 1-entry warning when the
--     2-entry warning fired within the same day.
--   * handle_package_reschedule fires on customer_package_id changes, not on
--     booking_date changes, so a true reschedule moves no entries.

-- Trigger 1: deduct entry on booking confirmed
CREATE OR REPLACE FUNCTION public.handle_package_booking()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_remaining integer;
  v_activated_at timestamptz;
  v_expires_at timestamptz;
  v_validity_days integer;
  v_pkg customer_packages%ROWTYPE;
BEGIN
  -- Only when booking becomes confirmed with a package
  IF NEW.customer_package_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.status != 'confirmed' THEN RETURN NEW; END IF;

  -- FIX 1: this trigger is AFTER INSERT OR UPDATE, and OLD is unassigned on
  -- INSERT. Reading OLD.status unguarded raised "record old is not assigned
  -- yet" on every package booking. TG_OP gates it; IS NOT DISTINCT FROM also
  -- makes the package comparison NULL-safe.
  IF TG_OP = 'UPDATE'
     AND OLD.status = 'confirmed'
     AND OLD.customer_package_id IS NOT DISTINCT FROM NEW.customer_package_id THEN
    RETURN NEW;
  END IF;

  -- Lock the package row (prevents race condition)
  SELECT * INTO v_pkg FROM customer_packages
  WHERE id = NEW.customer_package_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PACKAGE_NOT_FOUND';
  END IF;

  -- OWNERSHIP GUARD: bookings' UPDATE policy has no WITH CHECK, so a customer
  -- can PATCH any column of their own booking. Without this, they could point
  -- customer_package_id at a stranger's package and drain it.
  IF v_pkg.customer_id IS DISTINCT FROM NEW.user_id THEN
    RAISE EXCEPTION 'PACKAGE_NOT_YOURS';
  END IF;

  IF v_pkg.provider_id IS DISTINCT FROM NEW.provider_id THEN
    RAISE EXCEPTION 'PACKAGE_WRONG_PROVIDER';
  END IF;

  -- Check package is usable
  IF v_pkg.status NOT IN ('pending_activation','active') THEN
    RAISE EXCEPTION 'PACKAGE_NOT_ACTIVE';
  END IF;

  IF v_pkg.expires_at IS NOT NULL AND v_pkg.expires_at < now() THEN
    RAISE EXCEPTION 'PACKAGE_EXPIRED';
  END IF;

  IF v_pkg.entries_remaining <= 0 THEN
    RAISE EXCEPTION 'PACKAGE_EXHAUSTED';
  END IF;

  -- FIX 2: validity_days lives on package_templates, NOT on customer_packages.
  -- v_pkg.validity_days raised "record v_pkg has no field validity_days".
  SELECT pt.validity_days INTO v_validity_days
    FROM package_templates pt WHERE pt.id = v_pkg.template_id;

  -- Activate if first use
  v_activated_at := COALESCE(v_pkg.activated_at, now());
  v_expires_at := COALESCE(v_pkg.expires_at,
    v_activated_at + (v_validity_days || ' days')::interval);

  -- Atomic deduction
  UPDATE customer_packages SET
    entries_remaining = entries_remaining - 1,
    activated_at = v_activated_at,
    expires_at = v_expires_at,
    status = CASE
      WHEN entries_remaining - 1 = 0 THEN 'exhausted'
      ELSE 'active'
    END,
    updated_at = now()
  WHERE id = NEW.customer_package_id
  RETURNING entries_remaining INTO v_remaining;

  -- Log the action
  INSERT INTO package_usage_log
    (customer_package_id, booking_id, action_type, entries_before, entries_after, performed_by)
  VALUES
    (NEW.customer_package_id, NEW.id, 'entry_deducted',
     v_remaining + 1, v_remaining, auth.uid());

  -- Notify if low entries (max once per 24h)
  IF v_remaining <= 2 AND (
    v_pkg.last_low_entry_notified_at IS NULL OR
    v_pkg.last_low_entry_notified_at < now() - interval '24 hours'
  ) THEN
    -- FIX 3: notifications has `body`, not `message`.
    INSERT INTO notifications (user_id, title, body, type)
    VALUES
      (v_pkg.customer_id, 'כניסות נגמרות',
       'נשארו ' || v_remaining || ' כניסות בחבילה שלך', 'package_low'),
      ((SELECT user_id FROM provider_profiles WHERE id = v_pkg.provider_id),
       'כניסות נגמרות ללקוח',
       'נשארו ' || v_remaining || ' כניסות ללקוח', 'package_low');

    UPDATE customer_packages
    SET last_low_entry_notified_at = now()
    WHERE id = NEW.customer_package_id;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_handle_package_booking
  AFTER INSERT OR UPDATE OF status, customer_package_id
  ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.handle_package_booking();

-- Trigger 2: return entry on cancellation before check-in
CREATE OR REPLACE FUNCTION public.handle_package_cancellation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_remaining integer;
BEGIN
  -- Only when booking cancelled and had a package and no check-in yet
  IF OLD.status != 'confirmed' THEN RETURN NEW; END IF;
  IF NEW.status != 'cancelled' THEN RETURN NEW; END IF;
  IF OLD.customer_package_id IS NULL THEN RETURN NEW; END IF;
  IF OLD.check_in_at IS NOT NULL THEN RETURN NEW; END IF;

  -- Return entry atomically
  UPDATE customer_packages SET
    entries_remaining = entries_remaining + 1,
    status = CASE WHEN status = 'exhausted' THEN 'active' ELSE status END,
    updated_at = now()
  WHERE id = OLD.customer_package_id
  RETURNING entries_remaining INTO v_remaining;

  -- Log
  INSERT INTO package_usage_log
    (customer_package_id, booking_id, action_type, entries_before, entries_after, performed_by)
  VALUES
    (OLD.customer_package_id, OLD.id, 'entry_returned_cancellation',
     v_remaining - 1, v_remaining, auth.uid());

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_handle_package_cancellation
  AFTER UPDATE OF status
  ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.handle_package_cancellation();

-- Trigger 3: handle reschedule (return + deduct)
CREATE OR REPLACE FUNCTION public.handle_package_reschedule()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_remaining integer;
BEGIN
  -- Package changed on confirmed booking = reschedule
  IF OLD.status != 'confirmed' OR NEW.status != 'confirmed' THEN RETURN NEW; END IF;
  IF OLD.customer_package_id IS NULL AND NEW.customer_package_id IS NULL THEN RETURN NEW; END IF;
  IF OLD.customer_package_id IS NOT DISTINCT FROM NEW.customer_package_id THEN RETURN NEW; END IF;

  -- Return to old package
  IF OLD.customer_package_id IS NOT NULL THEN
    UPDATE customer_packages SET
      entries_remaining = entries_remaining + 1,
      status = CASE WHEN status = 'exhausted' THEN 'active' ELSE status END,
      updated_at = now()
    WHERE id = OLD.customer_package_id
    RETURNING entries_remaining INTO v_remaining;

    INSERT INTO package_usage_log
      (customer_package_id, booking_id, action_type, entries_before, entries_after, performed_by)
    VALUES
      (OLD.customer_package_id, OLD.id, 'entry_returned_manual',
       v_remaining - 1, v_remaining, auth.uid());
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_handle_package_reschedule
  BEFORE UPDATE OF customer_package_id
  ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.handle_package_reschedule();
