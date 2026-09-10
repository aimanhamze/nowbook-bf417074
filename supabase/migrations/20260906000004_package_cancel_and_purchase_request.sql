-- Provider "cancel package", and customer-initiated purchase requests.
--
-- Applied to DEV as migration `package_cancel_and_purchase_request`.

-- ── Constraints ────────────────────────────────────────────────────────────
ALTER TABLE customer_packages DROP CONSTRAINT customer_packages_status_check;
ALTER TABLE customer_packages
  ADD CONSTRAINT customer_packages_status_check
  CHECK (status IN ('pending_activation','active','exhausted','expired','cancelled'));

ALTER TABLE package_usage_log DROP CONSTRAINT package_usage_log_action_type_check;
ALTER TABLE package_usage_log
  ADD CONSTRAINT package_usage_log_action_type_check
  CHECK (action_type IN (
    'entry_deducted','entry_returned_cancellation','entry_returned_manual',
    'entry_added_manual','package_activated','package_exhausted',
    'package_expired','package_extended','package_cancelled','package_requested'));

-- ── Refund guard ───────────────────────────────────────────────────────────
-- A provider-cancelled package must NOT return entries. package_cancel() marks
-- the package 'cancelled' and then cancels its future bookings; without this
-- check each of those cancellations would fire the ordinary refund path and
-- hand the entries straight back, defeating the whole point.
CREATE OR REPLACE FUNCTION public.handle_package_cancellation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_remaining integer;
  v_pkg_status text;
BEGIN
  IF OLD.status != 'confirmed' THEN RETURN NEW; END IF;
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

-- ── DECISION 1: provider cancels a package ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.package_cancel(
  p_package_id uuid, p_note text DEFAULT NULL
) RETURNS public.customer_packages
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_pkg customer_packages%ROWTYPE;
  v_before integer;
  v_bookings integer;
BEGIN
  SELECT * INTO v_pkg FROM customer_packages WHERE id = p_package_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PACKAGE_NOT_FOUND'; END IF;

  IF NOT EXISTS (SELECT 1 FROM provider_profiles pp
                  WHERE pp.id::text = v_pkg.provider_id::text
                    AND pp.user_id::text = auth.uid()::text) THEN
    RAISE EXCEPTION 'PACKAGE_FORBIDDEN';
  END IF;

  IF v_pkg.status = 'cancelled' THEN
    RAISE EXCEPTION 'PACKAGE_ALREADY_CANCELLED';
  END IF;

  v_before := v_pkg.entries_remaining;

  -- Order matters: mark cancelled FIRST, so the booking cancellations below
  -- hit the guard in handle_package_cancellation and do not refund.
  UPDATE customer_packages
     SET entries_remaining = 0, status = 'cancelled', updated_at = now()
   WHERE id = p_package_id RETURNING * INTO v_pkg;

  INSERT INTO package_usage_log
    (customer_package_id, booking_id, action_type,
     entries_before, entries_after, performed_by, note)
  VALUES (p_package_id, NULL, 'package_cancelled', v_before, 0, auth.uid(), p_note);

  -- Future confirmed bookings only. Past visits already happened and stay.
  UPDATE bookings SET status = 'cancelled'
   WHERE customer_package_id = p_package_id
     AND status = 'confirmed'
     AND booking_date >= CURRENT_DATE;
  GET DIAGNOSTICS v_bookings = ROW_COUNT;

  -- Best-effort: a failed notification must never roll back the cancellation.
  BEGIN
    INSERT INTO notifications (user_id, title, body, type, url)
    VALUES (v_pkg.customer_id, 'החבילה בוטלה',
            'החבילה שלך בוטלה על ידי הספק' ||
              CASE WHEN v_bookings > 0
                   THEN ' · ' || v_bookings || ' תורים עתידיים בוטלו' ELSE '' END,
            'package_cancelled', '/bookings');
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN v_pkg;
END;
$$;

-- ── DECISION 3: customer requests to buy a package ─────────────────────────
-- An RPC, not an INSERT policy: a direct client insert would let the customer
-- choose their own entries_remaining, total_entries and status. Here every
-- value is taken from the template server-side and status is forced to
-- 'pending_activation' — the provider still has to activate after payment.
CREATE OR REPLACE FUNCTION public.package_request_purchase(p_template_id uuid)
RETURNS public.customer_packages
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_tpl package_templates%ROWTYPE;
  v_pkg customer_packages%ROWTYPE;
  v_provider_user uuid;
  v_customer_name text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;

  SELECT * INTO v_tpl FROM package_templates WHERE id = p_template_id;
  IF NOT FOUND OR NOT v_tpl.is_active THEN
    RAISE EXCEPTION 'TEMPLATE_NOT_AVAILABLE';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM provider_profiles pp
                  WHERE pp.id = v_tpl.provider_id AND pp.category = 'fitness_studio') THEN
    RAISE EXCEPTION 'PACKAGES_FOR_FITNESS_ONLY';
  END IF;

  -- One outstanding request or live package per customer per provider, so the
  -- button cannot be spammed into a pile of pending rows.
  IF EXISTS (SELECT 1 FROM customer_packages
              WHERE customer_id = auth.uid()
                AND provider_id = v_tpl.provider_id
                AND status IN ('pending_activation','active')) THEN
    RAISE EXCEPTION 'PACKAGE_ALREADY_PENDING';
  END IF;

  INSERT INTO customer_packages
    (customer_id, provider_id, template_id, entries_remaining, total_entries, status)
  VALUES (auth.uid(), v_tpl.provider_id, p_template_id,
          v_tpl.total_entries, v_tpl.total_entries, 'pending_activation')
  RETURNING * INTO v_pkg;

  INSERT INTO package_usage_log
    (customer_package_id, booking_id, action_type,
     entries_before, entries_after, performed_by)
  VALUES (v_pkg.id, NULL, 'package_requested',
          v_tpl.total_entries, v_tpl.total_entries, auth.uid());

  SELECT pp.user_id INTO v_provider_user
    FROM provider_profiles pp WHERE pp.id = v_tpl.provider_id;
  SELECT display_name INTO v_customer_name
    FROM profiles WHERE user_id = auth.uid();

  BEGIN
    INSERT INTO notifications (user_id, title, body, type, url)
    VALUES (v_provider_user, 'בקשה לרכישת חבילה',
            COALESCE(v_customer_name, 'לקוח') || ' מעוניין לרכוש: ' || v_tpl.name,
            'package_purchase_request', '/dashboard');
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN v_pkg;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.package_cancel(uuid,text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.package_request_purchase(uuid) FROM anon;
