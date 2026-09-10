-- SCOPE CHANGE: packages are for fitness_studio providers, group classes only.
--
-- Three guards, deliberately layered:
--   1. RLS on package_templates    -- only a fitness_studio may create offers
--   2. RLS on customer_packages    -- only a fitness_studio may sell them
--   3. trigger on bookings         -- an entry may only pay for a CLASS
--
-- The trigger is the real enforcement: RLS covers the client path, but a
-- service-role caller (Edge Function, cron) bypasses RLS entirely.
--
-- Applied to DEV as migration `packages_fitness_studio_classes_only`.

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

  IF v_pkg.status NOT IN ('pending_activation','active') THEN
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

-- ── RLS: templates ──────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Provider manages own templates" ON package_templates;

CREATE POLICY "Fitness studio manages own templates" ON package_templates
FOR ALL USING (
  provider_id IN (
    SELECT id FROM provider_profiles
    WHERE user_id = auth.uid()
      AND category = 'fitness_studio'
  )
);

-- ── RLS: sold packages ──────────────────────────────────────────────────────
-- The SELECT policies are deliberately left alone so packages sold before this
-- scope change stay readable (and auditable) by their provider and customer.
-- Only the ability to CREATE or MODIFY is narrowed to fitness studios.
DROP POLICY IF EXISTS "Provider manages own customer packages" ON customer_packages;

CREATE POLICY "Fitness studio manages own customer packages" ON customer_packages
FOR ALL USING (
  provider_id IN (
    SELECT id FROM provider_profiles
    WHERE user_id = auth.uid()
      AND category = 'fitness_studio'
  )
);
