-- Let a provider allow customers to reschedule their own bookings.
--
-- Adds provider_profiles.allow_customer_reschedule (default OFF) and a trigger
-- that makes the toggle REAL rather than cosmetic.
--
-- WHY A TRIGGER. Before this, the "Users can update own bookings" RLS policy
-- already let a customer UPDATE any column of their own booking, and on a
-- date/time change the database only checked overlap/capacity
-- (prevent_booking_conflicts) and same-day lead time
-- (enforce_booking_lead_time). Hours, blocked dates, the booking window and
-- the cancellation cutoff were UI-only. So a customer could already move a
-- booking anywhere free through the API, and a button gated on a toggle would
-- not have changed that. This trigger closes it.
--
-- WHO IT APPLIES TO. Only a CUSTOMER changing booking_date / booking_time.
-- Untouched:
--   * the booking's own provider (provider reschedule, incl. its out-of-hours
--     override) and admins;
--   * auth.uid() IS NULL -- service role, cron, SQL editor;
--   * every UPDATE that leaves date and time alone (self-cancel, reviews, etc.).
--
-- RULES for a customer reschedule, mirroring the Bookings page button gate:
--   1. the provider has allow_customer_reschedule = true
--   2. the booking is 'confirmed' and the same UPDATE does not change status
--   3. not a class booking and not a fitness_studio provider (fixed times)
--   4. only date/time move: provider, staff, services and duration stay put
--   5. the CURRENT booking is outside cancellation_notice_hours (0 = no
--      cutoff) and still in the future -- same cutoff as self-cancel
--   6. the NEW slot is in the future, inside booking_window_days, and not on
--      a provider blocked date
-- Overlap/capacity and same-day lead time stay with the existing triggers.
-- Opening hours and breaks are NOT re-checked here (they live in
-- availabilityResolver on the client); the slot picker only offers valid
-- slots, and rule 1 means only an opted-in provider is exposed at all.
--
-- APPROVAL. If the provider requires_booking_approval, a customer reschedule
-- sends the booking back to 'pending' for the provider to approve again.
--
-- ORDER. Named trg_enforce_customer_reschedule so it fires (BEFORE triggers
-- run alphabetically) ahead of trg_prevent_booking_conflicts, which then
-- validates the new slot against the possibly-updated status.

-- 1. The toggle.
ALTER TABLE public.provider_profiles
  ADD COLUMN IF NOT EXISTS allow_customer_reschedule boolean NOT NULL DEFAULT false;

-- 2. The guard.
CREATE OR REPLACE FUNCTION public.enforce_customer_reschedule()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  prov         record;
  notice_hours integer;
  old_start    timestamptz;
  new_start    timestamptz;
  today_israel date;
BEGIN
  IF NEW.booking_date IS NOT DISTINCT FROM OLD.booking_date
     AND NEW.booking_time IS NOT DISTINCT FROM OLD.booking_time THEN
    RETURN NEW;
  END IF;

  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
       SELECT 1 FROM public.provider_profiles pp
       WHERE pp.id = OLD.provider_id AND pp.user_id = auth.uid()
     )
     OR public.has_role(auth.uid(), 'admin') THEN
    RETURN NEW;
  END IF;

  -- From here on the caller is a customer (RLS already limited them to their
  -- own booking).
  SELECT category,
         allow_customer_reschedule,
         cancellation_notice_hours,
         booking_window_days,
         requires_booking_approval
    INTO prov
    FROM public.provider_profiles
   WHERE id = OLD.provider_id;

  IF NOT COALESCE(prov.allow_customer_reschedule, false) THEN
    RAISE EXCEPTION 'RESCHEDULE_NOT_ALLOWED' USING ERRCODE = 'P0001';
  END IF;

  IF OLD.status <> 'confirmed' OR NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'RESCHEDULE_NOT_ALLOWED' USING ERRCODE = 'P0001';
  END IF;

  IF OLD.class_schedule_id IS NOT NULL OR prov.category = 'fitness_studio' THEN
    RAISE EXCEPTION 'RESCHEDULE_NOT_ALLOWED' USING ERRCODE = 'P0001';
  END IF;

  IF NEW.provider_id IS DISTINCT FROM OLD.provider_id
     OR NEW.staff_id IS DISTINCT FROM OLD.staff_id
     OR NEW.service_ids IS DISTINCT FROM OLD.service_ids
     OR NEW.duration_override IS DISTINCT FROM OLD.duration_override
     OR NEW.class_schedule_id IS DISTINCT FROM OLD.class_schedule_id THEN
    RAISE EXCEPTION 'RESCHEDULE_NOT_ALLOWED' USING ERRCODE = 'P0001';
  END IF;

  -- Same cutoff as self-cancel (Bookings.tsx canCancel).
  notice_hours := COALESCE(prov.cancellation_notice_hours, 5);
  old_start := (OLD.booking_date
                + make_interval(mins => public.booking_time_to_minutes(OLD.booking_time)))
               AT TIME ZONE 'Asia/Jerusalem';
  IF old_start <= now()
     OR (notice_hours > 0 AND old_start <= now() + make_interval(hours => notice_hours)) THEN
    RAISE EXCEPTION 'RESCHEDULE_TOO_LATE' USING ERRCODE = 'P0001';
  END IF;

  today_israel := (now() AT TIME ZONE 'Asia/Jerusalem')::date;
  new_start := (NEW.booking_date
                + make_interval(mins => public.booking_time_to_minutes(NEW.booking_time)))
               AT TIME ZONE 'Asia/Jerusalem';
  IF new_start <= now()
     OR NEW.booking_date > today_israel + (COALESCE(prov.booking_window_days, 14) - 1) THEN
    RAISE EXCEPTION 'RESCHEDULE_SLOT_INVALID' USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
       SELECT 1 FROM public.provider_blocked_dates bd
       WHERE bd.provider_id = OLD.provider_id
         AND bd.blocked_date = NEW.booking_date
     ) THEN
    RAISE EXCEPTION 'RESCHEDULE_SLOT_INVALID' USING ERRCODE = 'P0001';
  END IF;

  IF COALESCE(prov.requires_booking_approval, false) THEN
    NEW.status := 'pending';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_enforce_customer_reschedule ON public.bookings;
CREATE TRIGGER trg_enforce_customer_reschedule
  BEFORE UPDATE OF booking_date, booking_time ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.enforce_customer_reschedule();
