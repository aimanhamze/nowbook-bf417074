-- Membership / package system — provider-side package actions.
--
-- package_usage_log deliberately has SELECT policies only, so the client cannot
-- write audit rows. These three SECURITY DEFINER functions are the only write
-- path for provider actions: they verify provider ownership, move the balance
-- and append the ledger row in ONE transaction, so entries_remaining can never
-- drift from the log.
--
-- Applied to DEV as migration `package_provider_rpcs`.

-- Activate a purchased package (pending_activation -> active).
CREATE OR REPLACE FUNCTION public.package_activate(p_package_id uuid)
RETURNS public.customer_packages
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE v_pkg customer_packages%ROWTYPE;
BEGIN
  SELECT * INTO v_pkg FROM customer_packages WHERE id = p_package_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PACKAGE_NOT_FOUND'; END IF;

  -- ::text on BOTH sides -- PROD and DEV disagree on these column types.
  IF NOT EXISTS (SELECT 1 FROM provider_profiles pp
                  WHERE pp.id::text = v_pkg.provider_id::text
                    AND pp.user_id::text = auth.uid()::text) THEN
    RAISE EXCEPTION 'PACKAGE_FORBIDDEN';
  END IF;

  IF v_pkg.status <> 'pending_activation' THEN
    RAISE EXCEPTION 'PACKAGE_NOT_PENDING';
  END IF;

  UPDATE customer_packages SET status = 'active', updated_at = now()
   WHERE id = p_package_id RETURNING * INTO v_pkg;

  INSERT INTO package_usage_log
    (customer_package_id, booking_id, action_type,
     entries_before, entries_after, performed_by)
  VALUES (p_package_id, NULL, 'package_activated',
          v_pkg.entries_remaining, v_pkg.entries_remaining, auth.uid());

  RETURN v_pkg;
END;
$$;

-- Grant entries and/or extend the expiry. Either amount may be zero.
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

  -- GREATEST so extending a package that still has time left ADDS to it rather
  -- than resetting the clock to today and silently shortening it.
  v_new_expiry := CASE
    WHEN COALESCE(p_extend_days,0) = 0 THEN v_pkg.expires_at
    ELSE GREATEST(COALESCE(v_pkg.expires_at, now()), now())
         + (p_extend_days || ' days')::interval
  END;

  UPDATE customer_packages SET
    entries_remaining = entries_remaining + COALESCE(p_entries,0),
    expires_at = v_new_expiry,
    status = CASE
      -- Revive an exhausted package only when entries were actually added, and
      -- an expired one only when the expiry actually moved past now().
      WHEN status = 'exhausted' AND COALESCE(p_entries,0) > 0 THEN 'active'
      WHEN status = 'expired' AND v_new_expiry > now()
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
              || v_new_expiry::date::text || ']');
  END IF;

  RETURN v_pkg;
END;
$$;

-- Return one entry for a booking that was already checked in. The automatic
-- refund in handle_package_cancellation deliberately skips checked-in
-- bookings, so this is the provider's judgement call.
CREATE OR REPLACE FUNCTION public.package_return_entry(
  p_booking_id uuid, p_note text DEFAULT NULL
) RETURNS public.customer_packages
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_bk bookings%ROWTYPE;
  v_pkg customer_packages%ROWTYPE;
  v_before integer;
BEGIN
  SELECT * INTO v_bk FROM bookings WHERE id = p_booking_id;
  IF NOT FOUND OR v_bk.customer_package_id IS NULL THEN
    RAISE EXCEPTION 'BOOKING_HAS_NO_PACKAGE';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM provider_profiles pp
                  WHERE pp.id::text = v_bk.provider_id::text
                    AND pp.user_id::text = auth.uid()::text) THEN
    RAISE EXCEPTION 'PACKAGE_FORBIDDEN';
  END IF;

  SELECT * INTO v_pkg FROM customer_packages
   WHERE id = v_bk.customer_package_id FOR UPDATE;
  v_before := v_pkg.entries_remaining;

  UPDATE customer_packages SET
    entries_remaining = entries_remaining + 1,
    status = CASE WHEN status = 'exhausted' THEN 'active' ELSE status END,
    updated_at = now()
  WHERE id = v_pkg.id RETURNING * INTO v_pkg;

  INSERT INTO package_usage_log
    (customer_package_id, booking_id, action_type,
     entries_before, entries_after, performed_by, note)
  VALUES (v_pkg.id, p_booking_id, 'entry_returned_manual',
          v_before, v_before + 1, auth.uid(), p_note);

  RETURN v_pkg;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.package_activate(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.package_add_entries(uuid,integer,integer,text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.package_return_entry(uuid,text) FROM anon;
