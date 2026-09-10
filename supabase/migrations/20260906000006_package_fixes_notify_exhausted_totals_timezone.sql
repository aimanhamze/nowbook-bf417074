-- Four fixes.
--
-- 1. LOW-BALANCE NOTIFICATION. The blanket 24h window swallowed the "1 entry
--    left" warning whenever the "2 left" one had fired the same day -- the
--    most urgent alert was the one being dropped. The window now applies only
--    at 2; 1 and 0 always notify.
--
-- 2. PACKAGE_EXHAUSTED WAS UNREACHABLE. status flips to 'exhausted' the moment
--    the balance hits zero, and the generic status check ran first, so a
--    drained package reported "not active". The empty-balance case is now
--    tested BEFORE the status check and raises the right error.
--
-- 3. entries_remaining COULD EXCEED total_entries (the 13/10 display). Cause
--    was package_add_entries raising only the balance. It now raises
--    total_entries too, so a +3 grant reads 13/13. Deliberately NOT solved by
--    clamping the refund paths: that would silently destroy an entry when a
--    granted package had a booking cancelled, and would log a no-op delta
--    while the balance really moved. With both columns raised together the
--    invariant holds by construction -- a return can only ever undo a
--    deduction, so the balance cannot pass the total.
--
-- 4. expires_at NOW LANDS ON LOCAL MIDNIGHT. Previously it was
--    `first_use_instant + N days`, so a package died partway through its
--    expiry day, at whatever time of day it happened to be first used. Expiry
--    is now anchored to local midnight in Asia/Jerusalem and compared by local
--    date, so the whole of the expiry day is usable.
--    (Note: the earlier "expires a day early" report was a measurement
--    artifact -- reading expires_at::date in a UTC session. The stored value
--    was already correct when read in the local zone.)
--
-- Applied to DEV as migration `package_fixes_notify_exhausted_totals_timezone`.

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
  IF NEW.status != 'confirmed' THEN RETURN NEW; END IF;

  IF TG_OP = 'UPDATE'
     AND OLD.status = 'confirmed'
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

  -- FIX 2: an empty package must report PACKAGE_EXHAUSTED, not
  -- PACKAGE_NOT_ACTIVE. Must be tested BEFORE the status check, because
  -- status is already 'exhausted' by the time the balance reaches zero.
  IF v_pkg.status = 'exhausted' OR v_pkg.entries_remaining <= 0 THEN
    RAISE EXCEPTION 'PACKAGE_EXHAUSTED';
  END IF;

  IF v_pkg.status <> 'active' THEN
    RAISE EXCEPTION 'PACKAGE_NOT_ACTIVE';
  END IF;

  -- FIX 4: compare by LOCAL calendar date, so a package "valid until 10 Oct"
  -- still works throughout 10 Oct rather than dying at UTC midnight.
  IF v_pkg.expires_at IS NOT NULL
     AND (v_pkg.expires_at AT TIME ZONE 'Asia/Jerusalem')::date
         < (now() AT TIME ZONE 'Asia/Jerusalem')::date THEN
    RAISE EXCEPTION 'PACKAGE_EXPIRED';
  END IF;

  SELECT pt.validity_days INTO v_validity_days
    FROM package_templates pt WHERE pt.id = v_pkg.template_id;

  -- FIX 4: anchor the clock to LOCAL midnight of the first-use day, so the
  -- expiry date does not depend on which side of UTC midnight the booking fell.
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

  -- FIX 1: 1 and 0 are urgent and always notify. The 24h window still applies
  -- at 2, which is the level that can be crossed repeatedly by book/cancel.
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

-- FIX 3 + FIX 4 in the grant/extend path.
CREATE OR REPLACE FUNCTION public.package_add_entries(
  p_package_id uuid, p_entries integer DEFAULT 0,
  p_extend_days integer DEFAULT 0, p_note text DEFAULT NULL
) RETURNS public.customer_packages
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_pkg customer_packages%ROWTYPE;
  v_before integer;
  v_new_expiry timestamptz;
  v_today date := (now() AT TIME ZONE 'Asia/Jerusalem')::date;
BEGIN
  IF COALESCE(p_entries,0) < 0 OR COALESCE(p_extend_days,0) < 0 THEN
    RAISE EXCEPTION 'INVALID_AMOUNT';
  END IF;
  IF COALESCE(p_entries,0) = 0 AND COALESCE(p_extend_days,0) = 0 THEN
    RAISE EXCEPTION 'NOTHING_TO_APPLY';
  END IF;

  SELECT * INTO v_pkg FROM customer_packages WHERE id = p_package_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PACKAGE_NOT_FOUND'; END IF;
  IF NOT EXISTS (SELECT 1 FROM provider_profiles pp
                  WHERE pp.id::text = v_pkg.provider_id::text
                    AND pp.user_id::text = auth.uid()::text) THEN
    RAISE EXCEPTION 'PACKAGE_FORBIDDEN';
  END IF;

  v_before := v_pkg.entries_remaining;

  -- FIX 4: extend from LOCAL dates and land on local midnight. GREATEST still
  -- means an extension ADDS to remaining time rather than resetting the clock.
  v_new_expiry := CASE
    WHEN COALESCE(p_extend_days,0) = 0 THEN v_pkg.expires_at
    ELSE ((GREATEST(
             COALESCE((v_pkg.expires_at AT TIME ZONE 'Asia/Jerusalem')::date, v_today),
             v_today
           ) + p_extend_days)::timestamp AT TIME ZONE 'Asia/Jerusalem')
  END;

  UPDATE customer_packages SET
    entries_remaining = entries_remaining + COALESCE(p_entries,0),
    -- FIX 3: raise the total alongside the balance so entries_remaining can
    -- never exceed total_entries (the 13/10 display). A grant makes the
    -- package bigger; it does not overfill a package of the original size.
    total_entries = total_entries + COALESCE(p_entries,0),
    expires_at = v_new_expiry,
    status = CASE
      WHEN status = 'exhausted' AND COALESCE(p_entries,0) > 0 THEN 'active'
      WHEN status = 'expired'
           AND v_new_expiry IS NOT NULL
           AND (v_new_expiry AT TIME ZONE 'Asia/Jerusalem')::date >= v_today
           AND entries_remaining + COALESCE(p_entries,0) > 0 THEN 'active'
      ELSE status END,
    updated_at = now()
  WHERE id = p_package_id RETURNING * INTO v_pkg;

  IF COALESCE(p_entries,0) > 0 THEN
    INSERT INTO package_usage_log
      (customer_package_id, booking_id, action_type,
       entries_before, entries_after, performed_by, note)
    VALUES (p_package_id, NULL, 'entry_added_manual',
            v_before, v_before + p_entries, auth.uid(), p_note);
  END IF;

  IF COALESCE(p_extend_days,0) > 0 THEN
    INSERT INTO package_usage_log
      (customer_package_id, booking_id, action_type,
       entries_before, entries_after, performed_by, note)
    VALUES (p_package_id, NULL, 'package_extended',
            v_pkg.entries_remaining, v_pkg.entries_remaining, auth.uid(),
            COALESCE(p_note,'') || ' [+' || p_extend_days || 'd -> '
              || (v_new_expiry AT TIME ZONE 'Asia/Jerusalem')::date::text || ']');
  END IF;

  RETURN v_pkg;
END;
$$;
