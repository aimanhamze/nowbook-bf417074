-- Phase 4 of walk-in → account linking: signup-time RETROACTIVE linking.
--
-- Phase 2 links a walk-in AT CREATION when an account already exists for the
-- typed phone. This handles the reverse: a walk-in was created for a phone with
-- NO account; that person signs up later → link their prior walk-ins to the new
-- account so they appear in the customer's own bookings (Phase 3 reads
-- linked_user_id).
--
-- WHY AN RPC: a freshly-signed-up customer cannot read those walk-ins
-- client-side — they are user_id IS NULL rows the SELECT RLS does not grant. A
-- SECURITY DEFINER function runs as owner and can match server-side.
--
-- CORE SAFETY — own-phone-only, self-only:
--   * Takes NO parameters. The target is ALWAYS auth.uid(); a caller can never
--     pass another user's id.
--   * The match phone is ALWAYS the caller's OWN verified OTP number
--     (auth.users.phone for auth.uid()) — the canonical, verified source (the
--     profiles.phone mirror is derived and may lag first signup).
--   * Therefore a caller can only ever claim walk-ins matching THEIR OWN
--     verified phone, and only to THEMSELVES.
--
-- IDEMPOTENT: only touches rows still unlinked (user_id IS NULL AND
-- linked_user_id IS NULL). Re-running links nothing new → safe to call on every
-- login. Additive: sets linked_user_id only; never alters user_id /
-- customer_name / customer_phone.
--
-- NO CONFLICT RE-CHECK: trg_prevent_booking_conflicts / trg_enforce_booking_lead_time
-- fire on UPDATE OF (provider_id, booking_date, booking_time, service_ids, status)
-- only — NOT linked_user_id — so this UPDATE cannot spuriously raise a conflict.

BEGIN;

CREATE OR REPLACE FUNCTION public.link_my_walkins()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller       uuid := auth.uid();
  caller_phone text;
  d            text;
  linked_count integer := 0;
BEGIN
  -- Must be an authenticated caller.
  IF caller IS NULL THEN
    RETURN 0;
  END IF;

  -- Canonical, verified source: the OTP phone on auth.users for THIS caller.
  SELECT u.phone INTO caller_phone
  FROM auth.users u
  WHERE u.id = caller;

  IF caller_phone IS NULL THEN
    RETURN 0;   -- e.g. email-only account: nothing to match on.
  END IF;

  -- Digit-normalize + garbage guard (same floor as the Phase 2 trigger).
  d := regexp_replace(caller_phone, '\D', '', 'g');
  IF length(d) < 9 THEN
    RETURN 0;
  END IF;

  -- Claim the caller's OWN still-unlinked walk-ins. Only ever sets
  -- linked_user_id = the caller; never touches user_id or the text fields.
  UPDATE public.bookings
  SET linked_user_id = caller
  WHERE user_id IS NULL
    AND linked_user_id IS NULL
    AND customer_phone IS NOT NULL
    AND regexp_replace(customer_phone, '\D', '', 'g') = d;

  GET DIAGNOSTICS linked_count = ROW_COUNT;
  RETURN linked_count;
END;
$$;

-- Only authenticated users may call it; it always acts as/for auth.uid().
REVOKE ALL ON FUNCTION public.link_my_walkins() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.link_my_walkins() TO authenticated;

COMMIT;
