-- Phase 3 of the multi-staff feature — make conflict enforcement and the
-- busy-slots RPC staff-aware. THE CLIENT MIRROR (useAllProviders.ts
-- getAvailableSlots) CHANGES IN THE SAME PR — trigger and client must not
-- drift, or customers get offered slots the trigger rejects (or vice versa).
--
-- WHAT CHANGES (and nothing else):
--   1. prevent_booking_conflicts(): exactly TWO added lines —
--        `AND b.staff_id IS NOT DISTINCT FROM NEW.staff_id`
--      in clause 5 (cross-service overlap EXISTS) and clause 7 (same-service
--      capacity count). Diff against the live definition confirms these are
--      the only changes. Everything else is byte-for-byte identical:
--        * clause 0/1 (status gate, conflict-statuses selection) — unchanged
--        * clause 2 (CLASS branch)  — unchanged; class bookings stay staff-less
--        * clause 3 (advisory lock) — unchanged, DELIBERATELY per-provider:
--          the same-user guard (clause 6) checks ACROSS staff, so concurrent
--          inserts for different staff by the same user must still serialize
--          on the provider-level lock. Do not add staff to the lock key.
--        * clause 4 (GROUP branch)  — unchanged; group capacity is pooled
--          shop-wide, v1 excludes group services from staff selection
--        * clause 6 (same-user guard, DUPLICATE_USER_BOOKING) — unchanged,
--          DELIBERATELY no staff predicate: one customer must not be able to
--          book two staff members at the same time. Confirmed product decision.
--   2. trg_prevent_booking_conflicts: staff_id added to the UPDATE OF column
--      list. Without it, reassigning a booking between staff
--      (UPDATE ... SET staff_id = X) would skip conflict re-checking entirely
--      and silently double-book the target staff member.
--      (trg_enforce_booking_lead_time's OF list does NOT get staff_id: a staff
--      swap changes who serves the booking, not WHEN it happens — lead time
--      depends only on booking_date/booking_time, which are already listed.)
--   3. get_provider_busy_slots(): returns staff_id as a 4th column. Return-type
--      change → DROP + CREATE (CREATE OR REPLACE cannot change a result type).
--      Same body/volatility/security; grants re-issued exactly as the original
--      migration (20260531000003): REVOKE PUBLIC, GRANT anon + authenticated.
--      No PII: staff_id identifies a member of the provider's published staff
--      list (provider_staff has public SELECT), not a customer.
--
-- BACKWARD COMPATIBILITY (why nothing changes for existing providers):
--   All 1,412 existing bookings have staff_id IS NULL, and every new booking
--   at a non-staff provider inserts staff_id NULL. In SQL,
--   NULL IS NOT DISTINCT FROM NULL = true — the new predicate matches every
--   NULL-vs-NULL pair, so clauses 5 and 7 evaluate IDENTICALLY to today for
--   the entire existing dataset. Only when BOTH rows carry different staff ids
--   does the predicate start excluding rows (= different chairs don't clash).
--   The regression matrix in the VERIFY file proves this on live data.
--
-- After applying, regenerate src/integrations/supabase/types.ts
-- (`supabase gen types`) so the RPC's new staff_id column appears.

BEGIN;

-- ── 1. prevent_booking_conflicts — the two-line staff predicate ──────────────
-- Full definition reproduced from the LIVE database (pg_get_functiondef,
-- dumped 2026-07-24) with exactly the two staff_id lines added.
CREATE OR REPLACE FUNCTION public.prevent_booking_conflicts()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  new_start integer;
  new_duration integer;
  primary_service_type text;
  primary_max_capacity integer;
  new_is_parallel boolean;
  current_count integer;
  conflict_statuses text[];
BEGIN
  IF NEW.status NOT IN ('confirmed', 'pending') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.status = 'confirmed' AND OLD.status = 'pending' THEN
    conflict_statuses := ARRAY['confirmed'];
  ELSE
    conflict_statuses := ARRAY['confirmed', 'pending'];
  END IF;

  -- Class bookings (fitness_studio) use class_schedule_id and service_ids = '{}'.
  -- Enforce capacity against provider_class_schedule.max_capacity.
  IF NEW.service_ids IS NULL OR array_length(NEW.service_ids, 1) IS NULL THEN
    IF NEW.class_schedule_id IS NOT NULL THEN
      PERFORM pg_advisory_xact_lock(
        hashtext(NEW.class_schedule_id::text || '|' || NEW.booking_date::text)
      );

      SELECT cs.max_capacity INTO primary_max_capacity
      FROM public.provider_class_schedule cs
      WHERE cs.id = NEW.class_schedule_id;

      SELECT COUNT(*) INTO current_count
      FROM public.bookings b
      WHERE b.class_schedule_id = NEW.class_schedule_id
        AND b.booking_date = NEW.booking_date
        AND b.status = ANY(conflict_statuses)
        AND (TG_OP = 'INSERT' OR b.id <> NEW.id);

      IF current_count >= COALESCE(primary_max_capacity, 1) THEN
        RAISE EXCEPTION 'GROUP_CAPACITY_EXCEEDED'
          USING ERRCODE = 'P0001';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(NEW.provider_id || '|' || NEW.booking_date::text));

  SELECT ps.service_type, ps.max_capacity, ps.is_parallel
  INTO primary_service_type, primary_max_capacity, new_is_parallel
  FROM public.provider_services ps
  WHERE ps.provider_id = NEW.provider_id
    AND ps.id = NEW.service_ids[1];

  IF primary_service_type = 'group' THEN
    SELECT COUNT(*)
    INTO current_count
    FROM public.bookings b
    WHERE b.provider_id = NEW.provider_id
      AND b.booking_date = NEW.booking_date
      AND b.booking_time = NEW.booking_time
      AND b.status = ANY(conflict_statuses)
      AND (TG_OP = 'INSERT' OR b.id <> NEW.id);

    IF current_count >= COALESCE(primary_max_capacity, 1) THEN
      RAISE EXCEPTION 'GROUP_CAPACITY_EXCEEDED'
        USING ERRCODE = 'P0001';
    END IF;

    RETURN NEW;
  END IF;

  new_start := public.booking_time_to_minutes(NEW.booking_time);

  SELECT COALESCE(NULLIF(SUM(ps.duration), 0), 30)
  INTO new_duration
  FROM public.provider_services ps
  WHERE ps.provider_id = NEW.provider_id
    AND ps.id = ANY(NEW.service_ids);

  IF EXISTS (
    SELECT 1
    FROM public.bookings b
    LEFT JOIN LATERAL (
      SELECT COALESCE(NULLIF(SUM(ps2.duration), 0), 30) AS duration_minutes
      FROM public.provider_services ps2
      WHERE ps2.provider_id = b.provider_id
        AND ps2.id = ANY(b.service_ids)
    ) svc ON TRUE
    WHERE b.provider_id = NEW.provider_id
      AND b.booking_date = NEW.booking_date
      AND b.status = ANY(conflict_statuses)
      AND (TG_OP = 'INSERT' OR b.id <> NEW.id)
      AND new_start < (public.booking_time_to_minutes(b.booking_time) + svc.duration_minutes)
      AND public.booking_time_to_minutes(b.booking_time) < (new_start + new_duration)
      AND b.staff_id IS NOT DISTINCT FROM NEW.staff_id
      AND b.service_ids[1] IS DISTINCT FROM NEW.service_ids[1]
      AND NOT (
        COALESCE(new_is_parallel, false)
        AND COALESCE((
          SELECT ps3.is_parallel
          FROM public.provider_services ps3
          WHERE ps3.provider_id = b.provider_id
            AND ps3.id = b.service_ids[1]
        ), false)
      )
  ) THEN
    RAISE EXCEPTION 'The selected time is no longer available'
      USING ERRCODE = '23505';
  END IF;

  IF NEW.user_id IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.bookings b
    LEFT JOIN LATERAL (
      SELECT COALESCE(NULLIF(SUM(ps2.duration), 0), 30) AS duration_minutes
      FROM public.provider_services ps2
      WHERE ps2.provider_id = b.provider_id
        AND ps2.id = ANY(b.service_ids)
    ) svc ON TRUE
    WHERE b.provider_id = NEW.provider_id
      AND b.booking_date = NEW.booking_date
      AND b.status = ANY(conflict_statuses)
      AND (TG_OP = 'INSERT' OR b.id <> NEW.id)
      AND b.user_id = NEW.user_id
      AND new_start < (public.booking_time_to_minutes(b.booking_time) + svc.duration_minutes)
      AND public.booking_time_to_minutes(b.booking_time) < (new_start + new_duration)
  ) THEN
    RAISE EXCEPTION 'DUPLICATE_USER_BOOKING'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT COUNT(*)
  INTO current_count
  FROM public.bookings b
  LEFT JOIN LATERAL (
    SELECT COALESCE(NULLIF(SUM(ps2.duration), 0), 30) AS duration_minutes
    FROM public.provider_services ps2
    WHERE ps2.provider_id = b.provider_id
      AND ps2.id = ANY(b.service_ids)
  ) svc ON TRUE
  WHERE b.provider_id = NEW.provider_id
    AND b.booking_date = NEW.booking_date
    AND b.status = ANY(conflict_statuses)
    AND (TG_OP = 'INSERT' OR b.id <> NEW.id)
    AND new_start < (public.booking_time_to_minutes(b.booking_time) + svc.duration_minutes)
    AND public.booking_time_to_minutes(b.booking_time) < (new_start + new_duration)
    AND b.staff_id IS NOT DISTINCT FROM NEW.staff_id
    AND b.service_ids[1] IS NOT DISTINCT FROM NEW.service_ids[1];

  IF current_count >= COALESCE(primary_max_capacity, 1) THEN
    RAISE EXCEPTION 'The selected time is no longer available'
      USING ERRCODE = '23505';
  END IF;

  RETURN NEW;
END;
$function$;

-- ── 2. Re-scope the trigger: staff_id joins the UPDATE OF list ───────────────
-- Reassigning a booking to another staff member is `UPDATE ... SET staff_id`,
-- which the old column list did not cover — the conflict check would silently
-- not run and the target staff member could be double-booked. INSERT behavior
-- and the other UPDATE OF columns are unchanged.
DROP TRIGGER trg_prevent_booking_conflicts ON public.bookings;
CREATE TRIGGER trg_prevent_booking_conflicts
  BEFORE INSERT OR UPDATE OF provider_id, booking_date, booking_time, service_ids, status, staff_id
  ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_booking_conflicts();

-- ── 3. get_provider_busy_slots — expose staff_id (4th column) ────────────────
-- Return-type change requires DROP + CREATE. Body identical to the original
-- (20260531000003) plus b.staff_id in the projection. Still no PII: the
-- projection carries timing columns + staff_id, which points at the provider's
-- PUBLICLY readable staff list (provider_staff SELECT USING (true)) — it
-- identifies who works the chair, never who booked it. NULL for every booking
-- at a non-staff provider, so pre-regen clients see an ignorable extra column.
DROP FUNCTION public.get_provider_busy_slots(uuid, date, date);

CREATE FUNCTION public.get_provider_busy_slots(
  p_provider_id uuid,
  p_from_date   date,
  p_to_date     date
)
RETURNS TABLE (
  booking_date date,
  booking_time text,
  service_ids  text[],
  staff_id     uuid
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT b.booking_date, b.booking_time, b.service_ids::text[], b.staff_id
  FROM public.bookings b
  WHERE b.provider_id = p_provider_id
    AND b.status IN ('confirmed', 'pending')
    AND b.booking_date BETWEEN p_from_date AND p_to_date;
$$;

-- Grants exactly as the original migration: lock down PUBLIC, re-grant anon
-- (logged-out availability is PII-free) + authenticated (booking page,
-- provider dashboard).
REVOKE ALL ON FUNCTION public.get_provider_busy_slots(uuid, date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_provider_busy_slots(uuid, date, date) TO anon, authenticated;

COMMIT;
