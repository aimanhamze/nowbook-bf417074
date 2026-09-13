-- Deduct a package entry when a class booking is created, not when it is
-- approved.
--
-- WHY: enforce_booking_approval_status rewrites an inserted 'confirmed' to
-- 'pending' for providers with requires_booking_approval = true, so for those
-- providers nothing was ever deducted at booking time. A customer with 2
-- entries could queue 10 pending class bookings -- each one holding a real
-- slot, since prevent_booking_conflicts counts pending -- and the provider
-- would hit PACKAGE_EXHAUSTED on the third approval.
--
-- Deducting on 'pending' turns TWO other confirmed-only guards into bugs that
-- silently destroy customer entries, so all three functions move together:
--
--   handle_package_cancellation  had `IF OLD.status != 'confirmed' RETURN`,
--     so a REJECTED booking (useRejectBooking does pending -> cancelled)
--     would keep the entry it just took. Every rejection would cost the
--     customer an entry.
--
--   handle_package_reschedule    had `IF OLD.status != 'confirmed' OR
--     NEW.status != 'confirmed' RETURN`, so switching the package on a
--     PENDING booking would deduct from the new package without returning
--     the old one.

-- ── 1. Deduct while pending ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.handle_package_booking()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_remaining integer;
  v_activated_at timestamptz;
  v_expires_at timestamptz;
  v_validity_days integer;
  v_pkg customer_packages%ROWTYPE;
  v_notify boolean;
BEGIN
  IF NEW.customer_package_id IS NULL THEN RETURN NEW; END IF;

  -- A booking holds its slot from the moment it exists: prevent_booking_conflicts
  -- counts both 'pending' and 'confirmed'. The entry must be held on the same
  -- terms, or an approval-required provider deducts nothing at booking time.
  IF NEW.status NOT IN ('confirmed', 'pending') THEN RETURN NEW; END IF;

  -- Already holding an entry and the package did not change -> nothing to do.
  -- OLD.status IN ('pending','confirmed') is what makes pending -> confirmed
  -- (the approval step) a no-op instead of a second deduction.
  -- IS NOT DISTINCT FROM, not =, so a NULL package id compares safely.
  IF TG_OP = 'UPDATE'
     AND OLD.status IN ('pending', 'confirmed')
     AND OLD.customer_package_id IS NOT DISTINCT FROM NEW.customer_package_id THEN
    RETURN NEW;
  END IF;

  IF NEW.class_schedule_id IS NULL THEN
    RAISE EXCEPTION 'PACKAGES_FOR_CLASSES_ONLY';
  END IF;

  SELECT * INTO v_pkg FROM customer_packages
  WHERE id = NEW.customer_package_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PACKAGE_NOT_FOUND';
  END IF;

  IF v_pkg.customer_id IS DISTINCT FROM NEW.user_id THEN
    RAISE EXCEPTION 'PACKAGE_NOT_YOURS';
  END IF;

  IF v_pkg.provider_id IS DISTINCT FROM NEW.provider_id THEN
    RAISE EXCEPTION 'PACKAGE_WRONG_PROVIDER';
  END IF;

  IF v_pkg.status = 'exhausted' OR v_pkg.entries_remaining <= 0 THEN
    RAISE EXCEPTION 'PACKAGE_EXHAUSTED';
  END IF;

  IF v_pkg.status <> 'active' THEN
    RAISE EXCEPTION 'PACKAGE_NOT_ACTIVE';
  END IF;

  IF v_pkg.expires_at IS NOT NULL
     AND (v_pkg.expires_at AT TIME ZONE 'Asia/Jerusalem')::date
         < (now() AT TIME ZONE 'Asia/Jerusalem')::date THEN
    RAISE EXCEPTION 'PACKAGE_EXPIRED';
  END IF;

  SELECT pt.validity_days INTO v_validity_days
    FROM package_templates pt WHERE pt.id = v_pkg.template_id;

  v_activated_at := COALESCE(v_pkg.activated_at, now());
  v_expires_at := COALESCE(
    v_pkg.expires_at,
    (((v_activated_at AT TIME ZONE 'Asia/Jerusalem')::date + v_validity_days)::timestamp
       AT TIME ZONE 'Asia/Jerusalem')
  );

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

  INSERT INTO package_usage_log
    (customer_package_id, booking_id, action_type, entries_before, entries_after, performed_by)
  VALUES
    (NEW.customer_package_id, NEW.id, 'entry_deducted',
     v_remaining + 1, v_remaining, auth.uid());

  v_notify := v_remaining <= 2 AND (
    v_remaining <= 1
    OR v_pkg.last_low_entry_notified_at IS NULL
    OR v_pkg.last_low_entry_notified_at < now() - interval '24 hours'
  );

  IF v_notify THEN
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

-- ── 2. Refund a REJECTED booking, not just a cancelled-from-confirmed one ──
CREATE OR REPLACE FUNCTION public.handle_package_cancellation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_remaining integer;
  v_pkg_status text;
BEGIN
  -- Was the booking HOLDING an entry? Under deduct-on-pending that is true of
  -- both live states, so a provider rejection (pending -> cancelled) must
  -- refund exactly like a cancellation from confirmed.
  IF OLD.status NOT IN ('pending', 'confirmed') THEN RETURN NEW; END IF;
  IF NEW.status != 'cancelled' THEN RETURN NEW; END IF;
  IF OLD.customer_package_id IS NULL THEN RETURN NEW; END IF;
  IF OLD.check_in_at IS NOT NULL THEN RETURN NEW; END IF;

  SELECT status INTO v_pkg_status FROM customer_packages
   WHERE id = OLD.customer_package_id;
  -- Package was cancelled by the provider: entries are forfeit by design.
  IF v_pkg_status = 'cancelled' THEN RETURN NEW; END IF;

  UPDATE customer_packages SET
    entries_remaining = entries_remaining + 1,
    status = CASE WHEN status = 'exhausted' THEN 'active' ELSE status END,
    updated_at = now()
  WHERE id = OLD.customer_package_id
  RETURNING entries_remaining INTO v_remaining;

  IF NOT FOUND THEN RETURN NEW; END IF;

  INSERT INTO package_usage_log
    (customer_package_id, booking_id, action_type, entries_before, entries_after, performed_by)
  VALUES
    (OLD.customer_package_id, OLD.id, 'entry_returned_cancellation',
     v_remaining - 1, v_remaining, auth.uid());

  RETURN NEW;
END;
$$;

-- ── 3. Return the old entry when the package changes on a PENDING booking ──
CREATE OR REPLACE FUNCTION public.handle_package_reschedule()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_remaining integer;
BEGIN
  -- Both sides must be live. Without 'pending' here, switching the package on
  -- a pending booking deducts from the new package (handle_package_booking
  -- now fires for pending) without returning the old one.
  IF OLD.status NOT IN ('pending', 'confirmed')
     OR NEW.status NOT IN ('pending', 'confirmed') THEN RETURN NEW; END IF;
  IF OLD.customer_package_id IS NULL AND NEW.customer_package_id IS NULL THEN RETURN NEW; END IF;
  IF OLD.customer_package_id IS NOT DISTINCT FROM NEW.customer_package_id THEN RETURN NEW; END IF;

  IF OLD.customer_package_id IS NOT NULL THEN
    UPDATE customer_packages SET
      entries_remaining = entries_remaining + 1,
      status = CASE WHEN status = 'exhausted' THEN 'active' ELSE status END,
      updated_at = now()
    WHERE id = OLD.customer_package_id
    RETURNING entries_remaining INTO v_remaining;

    -- Package row is gone (being deleted, via the FK's ON DELETE SET NULL).
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
