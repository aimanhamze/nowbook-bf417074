-- Phase 2 of walk-in → account linking.
--
-- When a provider creates a NEW walk-in (user_id IS NULL, customer_phone free
-- text), set linked_user_id to a matching customer account so that customer can
-- SEE the booking in their own list (Phase 1 already opened the SELECT policy
-- for linked_user_id = auth.uid()).
--
-- WHY SERVER-SIDE (SECURITY DEFINER): the inserting provider cannot, under RLS,
-- read an arbitrary customer's profile by phone (they can only see profiles of
-- their EXISTING customers). A client-side match would therefore see nothing.
-- This trigger runs as the function owner, bypassing RLS to read public.profiles
-- for the match only — it never exposes profile data to the provider.
--
-- SCOPE (deliberately narrow):
--   * Fires only BEFORE INSERT, and only acts on WALK-INS (NEW.user_id IS NULL).
--   * Links only on EXACTLY ONE profile match (0 → skip; 2+ → ambiguous, skip).
--   * Never touches NEW.user_id / customer_name / customer_phone — additive; the
--     walk-in text is preserved verbatim.
--   * No UPDATE path (new walk-ins only), no change to any other trigger/policy.
--     prevent_booking_conflicts keys on user_id, so linking cannot cause false
--     conflicts.

BEGIN;

CREATE OR REPLACE FUNCTION public.link_walkin_to_account()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  d              text;   -- digit-normalized incoming walk-in phone
  match_count    integer;
  matched_user   uuid;
BEGIN
  -- Only NEW provider-created walk-ins that are not already linked.
  IF NEW.user_id IS NOT NULL OR NEW.linked_user_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Nothing to match on.
  IF NEW.customer_phone IS NULL THEN
    RETURN NEW;
  END IF;

  -- Digit-normalize; guard against empty / too-short garbage so we never match
  -- on a stray fragment. Israeli mobiles normalize to 10 digits (0XXXXXXXXX);
  -- 9 is a permissive floor that still rejects junk.
  d := regexp_replace(NEW.customer_phone, '\D', '', 'g');
  IF length(d) < 9 THEN
    RETURN NEW;
  END IF;

  -- Count DISTINCT accounts whose digit-normalized phone equals d.
  SELECT COUNT(DISTINCT p.user_id)
  INTO match_count
  FROM public.profiles p
  WHERE p.phone IS NOT NULL
    AND regexp_replace(p.phone, '\D', '', 'g') = d;

  -- Link ONLY on an unambiguous single match. 0 or 2+ → leave NULL.
  IF match_count = 1 THEN
    SELECT p.user_id
    INTO matched_user
    FROM public.profiles p
    WHERE p.phone IS NOT NULL
      AND regexp_replace(p.phone, '\D', '', 'g') = d
    LIMIT 1;

    NEW.linked_user_id := matched_user;
  END IF;

  RETURN NEW;
END;
$$;

-- BEFORE INSERT so NEW.linked_user_id is populated before the row is persisted.
DROP TRIGGER IF EXISTS trg_link_walkin_to_account ON public.bookings;
CREATE TRIGGER trg_link_walkin_to_account
  BEFORE INSERT ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.link_walkin_to_account();

COMMIT;
