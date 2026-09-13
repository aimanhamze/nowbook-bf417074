-- SECURITY FIX: a package must be ACTIVATED before any entry can be spent.
--
-- handle_package_booking accepted status IN ('pending_activation','active').
-- That was tolerable while only a provider could create a package -- a pending
-- row meant the provider had already agreed to the sale. Once customers could
-- self-serve a purchase REQUEST (package_request_purchase), it became a way to
-- take free classes: request a package, book against it immediately, never pay.
-- Proven on DEV: request -> pending_activation with a full balance -> booking
-- allowed -> package auto-flipped to 'active'.
--
-- Payment happens outside the app, so activation is the provider's ONLY
-- leverage. Now only 'active' can be spent; everything else raises
-- PACKAGE_NOT_ACTIVE, which the UI already translates.
--
-- Consequence, intended: the provider must activate before ANY booking,
-- including a package sold face-to-face in the studio.
--
-- Applied to DEV as migration `package_require_activation_before_use`.

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
  -- MUST stay first: this trigger fires on every booking, and the vast
  -- majority carry no package at all.
  IF NEW.customer_package_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.status != 'confirmed' THEN RETURN NEW; END IF;

  IF TG_OP = 'UPDATE'
     AND OLD.status = 'confirmed'
     AND OLD.customer_package_id IS NOT DISTINCT FROM NEW.customer_package_id THEN
    RETURN NEW;
  END IF;

  -- SCOPE GUARD: an entry may only pay for a group class.
  -- Placed HERE, not at the top of the function, for two reasons:
  --   * above the customer_package_id check it would reject every ordinary
  --     appointment in the app;
  --   * above the status check it would make CANCELLING a pre-existing
  --     package booking on a regular appointment throw, stranding legacy rows.
  -- Here it blocks only a new DEDUCTION against a non-class booking.
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

  -- THE FIX: 'pending_activation' is no longer spendable.
  IF v_pkg.status <> 'active' THEN
    RAISE EXCEPTION 'PACKAGE_NOT_ACTIVE';
  END IF;

  IF v_pkg.expires_at IS NOT NULL AND v_pkg.expires_at < now() THEN
    RAISE EXCEPTION 'PACKAGE_EXPIRED';
  END IF;

  IF v_pkg.entries_remaining <= 0 THEN
    RAISE EXCEPTION 'PACKAGE_EXHAUSTED';
  END IF;

  SELECT pt.validity_days INTO v_validity_days
    FROM package_templates pt WHERE pt.id = v_pkg.template_id;

  v_activated_at := COALESCE(v_pkg.activated_at, now());
  v_expires_at := COALESCE(v_pkg.expires_at,
    v_activated_at + (v_validity_days || ' days')::interval);

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

  IF v_remaining <= 2 AND (
    v_pkg.last_low_entry_notified_at IS NULL OR
    v_pkg.last_low_entry_notified_at < now() - interval '24 hours'
  ) THEN
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
