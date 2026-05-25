-- Per-provider opt-in for manual booking approval.
-- Default false: existing providers (and new ones) auto-confirm bookings.
-- Providers who want manual approval flip this to true from their dashboard.
ALTER TABLE public.provider_profiles
  ADD COLUMN IF NOT EXISTS requires_booking_approval boolean NOT NULL DEFAULT false;

-- Defense-in-depth: server-side enforcement of the approval setting.
-- If a stale client (or any direct API caller) tries to insert a booking with
-- status='confirmed' for a provider who requires approval, override to 'pending'.
-- bookings.provider_id references provider_profiles.id (see prevent_booking_conflicts).
CREATE OR REPLACE FUNCTION public.enforce_booking_approval_status()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_requires_approval boolean;
BEGIN
  -- Only relevant for newly-created bookings claiming a slot.
  IF NEW.status <> 'confirmed' THEN
    RETURN NEW;
  END IF;

  SELECT requires_booking_approval INTO v_requires_approval
  FROM public.provider_profiles
  WHERE id = NEW.provider_id;

  IF v_requires_approval IS TRUE THEN
    NEW.status := 'pending';
  END IF;

  RETURN NEW;
END;
$$;

-- Name sorts alphabetically before trg_enforce_booking_lead_time and
-- trg_prevent_booking_conflicts, so status normalization happens first.
-- (Order is not actually load-bearing: prevent_booking_conflicts treats
-- 'confirmed' and 'pending' identically for slot reservation.)
DROP TRIGGER IF EXISTS trg_enforce_booking_approval_status ON public.bookings;

CREATE TRIGGER trg_enforce_booking_approval_status
BEFORE INSERT ON public.bookings
FOR EACH ROW
EXECUTE FUNCTION public.enforce_booking_approval_status();
