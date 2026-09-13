-- Providers can now REMOVE entries, not only add them.
--
-- package_add_entries rejected any negative p_entries with INVALID_AMOUNT, so a
-- provider who granted too many, or who needs to dock an entry (a no-show, a
-- class taken outside the app), had no way back short of cancelling the whole
-- package.
--
-- SYMMETRIC WITH ADDING. 20260906000006 made a grant raise BOTH
-- entries_remaining and total_entries, so a +3 grant reads 13/13 rather than
-- 13/10. Removal lowers both for the same reason: add and remove are then true
-- inverses (5/5 -> +2 -> 7/7 -> -2 -> 5/5), and entries_remaining can never
-- exceed total_entries. Lowering only the balance would leave 5/7 after an
-- add/remove round trip, which reads as "2 entries were used" when none were.
--
-- Two hard limits, both from existing CHECK constraints:
--   * entries_remaining >= 0   -- cannot remove more than remain
--   * total_entries    >  0    -- cannot empty a package this way; that is
--                                 what package_cancel is for, and it also
--                                 cancels the future bookings and notifies
--                                 the customer, which this must not do
--                                 silently.
--
-- Applied to DEV as migration `package_allow_removing_entries`.

ALTER TABLE package_usage_log DROP CONSTRAINT package_usage_log_action_type_check;
ALTER TABLE package_usage_log
  ADD CONSTRAINT package_usage_log_action_type_check
  CHECK (action_type IN (
    'entry_deducted','entry_returned_cancellation','entry_returned_manual',
    'entry_added_manual','entry_removed_manual','package_activated',
    'package_exhausted','package_expired','package_extended',
    'package_cancelled','package_requested'));

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
  v_delta integer := COALESCE(p_entries, 0);
  v_days integer := COALESCE(p_extend_days, 0);
BEGIN
  -- Extending by a negative number of days is not a supported action: shortening
  -- a customer's validity silently is a different decision from docking an
  -- entry, and nothing in the UI offers it.
  IF v_days < 0 THEN
    RAISE EXCEPTION 'INVALID_AMOUNT';
  END IF;
  IF v_delta = 0 AND v_days = 0 THEN
    RAISE EXCEPTION 'NOTHING_TO_APPLY';
  END IF;

  SELECT * INTO v_pkg FROM customer_packages WHERE id = p_package_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PACKAGE_NOT_FOUND'; END IF;
  IF NOT EXISTS (SELECT 1 FROM provider_profiles pp
                  WHERE pp.id::text = v_pkg.provider_id::text
                    AND pp.user_id::text = auth.uid()::text) THEN
    RAISE EXCEPTION 'PACKAGE_FORBIDDEN';
  END IF;

  -- ── Removal guards ──────────────────────────────────────────────────────
  IF v_delta < 0 THEN
    IF v_pkg.entries_remaining + v_delta < 0 THEN
      RAISE EXCEPTION 'NOT_ENOUGH_ENTRIES';
    END IF;
    -- total_entries > 0 is a CHECK; hitting it would abort with a raw
    -- constraint error, so refuse with something the UI can translate.
    IF v_pkg.total_entries + v_delta <= 0 THEN
      RAISE EXCEPTION 'CANNOT_EMPTY_PACKAGE';
    END IF;
  END IF;

  v_before := v_pkg.entries_remaining;

  v_new_expiry := CASE
    WHEN v_days = 0 THEN v_pkg.expires_at
    ELSE ((GREATEST(
             COALESCE((v_pkg.expires_at AT TIME ZONE 'Asia/Jerusalem')::date, v_today),
             v_today
           ) + v_days)::timestamp AT TIME ZONE 'Asia/Jerusalem')
  END;

  UPDATE customer_packages SET
    entries_remaining = entries_remaining + v_delta,
    -- Both columns move together, in both directions.
    total_entries = total_entries + v_delta,
    expires_at = v_new_expiry,
    status = CASE
      -- Removing the last entry exhausts the package, exactly as a booking would.
      WHEN entries_remaining + v_delta = 0 AND status = 'active' THEN 'exhausted'
      WHEN status = 'exhausted' AND v_delta > 0 THEN 'active'
      WHEN status = 'expired'
           AND v_new_expiry IS NOT NULL
           AND (v_new_expiry AT TIME ZONE 'Asia/Jerusalem')::date >= v_today
           AND entries_remaining + v_delta > 0 THEN 'active'
      ELSE status END,
    updated_at = now()
  WHERE id = p_package_id RETURNING * INTO v_pkg;

  IF v_delta <> 0 THEN
    INSERT INTO package_usage_log
      (customer_package_id, booking_id, action_type,
       entries_before, entries_after, performed_by, note)
    VALUES (p_package_id, NULL,
            CASE WHEN v_delta > 0 THEN 'entry_added_manual'
                 ELSE 'entry_removed_manual' END,
            v_before, v_before + v_delta, auth.uid(), p_note);
  END IF;

  IF v_days > 0 THEN
    INSERT INTO package_usage_log
      (customer_package_id, booking_id, action_type,
       entries_before, entries_after, performed_by, note)
    VALUES (p_package_id, NULL, 'package_extended',
            v_pkg.entries_remaining, v_pkg.entries_remaining, auth.uid(),
            COALESCE(p_note,'') || ' [+' || v_days || 'd -> '
              || (v_new_expiry AT TIME ZONE 'Asia/Jerusalem')::date::text || ']');
  END IF;

  RETURN v_pkg;
END;
$$;
