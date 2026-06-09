-- FIX: prevent_booking_conflicts() compared ::text-cast provider_services columns
-- against bookings.provider_id / bookings.service_ids, which are UUID / UUID[] in
-- production. That produced "operator does not exist: text = uuid" on every insert.
--
-- WHY IT WAS LATENT: these ::text casts date from 20260328194531, when bookings
-- was text-typed. bookings was later migrated to the uuid schema (001_initial_schema:
-- provider_id uuid, service_ids uuid[]; confirmed by get_provider_busy_slots, whose
-- `WHERE b.provider_id = <uuid param>` only type-checks if provider_id is uuid). The
-- stale casts never bit because the function was wired to NO trigger until the
-- 20260609000001 reconciliation — the out-of-band trg_prevent_double_booking ran
-- instead. Wiring our function exposed the long-standing type mismatch.
--
-- ACTUAL TYPES (information_schema):
--   bookings.provider_id        uuid
--   bookings.service_ids        uuid[]   (udt _uuid)
--   provider_services.id        uuid
--   provider_services.provider_id uuid
--
-- FIX: drop the six ::text casts so every cross-table comparison is uuid = uuid.
-- Same-table comparisons (b.provider_id = NEW.provider_id, service_ids[1] IS DISTINCT
-- FROM ...) were already correct. The advisory-lock concat is unchanged: uuid || text
-- resolves via Postgres's anynonarray || text operator. Logic is otherwise byte-for-
-- byte identical to 20260608000002 (group branch + two-clause private + cancel guard).
--
-- ATOMICITY: single transaction so the live function is never left half-rewritten.
BEGIN;

CREATE OR REPLACE FUNCTION public.prevent_booking_conflicts()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  new_start integer;
  new_duration integer;
  primary_service_type text;
  primary_max_capacity integer;
  current_count integer;
  -- When approving (UPDATE pending -> confirmed), only confirmed bookings
  -- create hard conflicts; other pending ones are still undecided.
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

  PERFORM pg_advisory_xact_lock(hashtext(NEW.provider_id || '|' || NEW.booking_date::text));

  SELECT ps.service_type, ps.max_capacity
  INTO primary_service_type, primary_max_capacity
  FROM public.provider_services ps
  WHERE ps.provider_id = NEW.provider_id
    AND ps.id = NEW.service_ids[1];

  -- ── GROUP branch (UNCHANGED): exact-start-time capacity ──────────────────
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

  -- ── PRIVATE branch: same-service pool, cross-service exclusive ────────────
  new_start := public.booking_time_to_minutes(NEW.booking_time);

  SELECT COALESCE(NULLIF(SUM(ps.duration), 0), 30)
  INTO new_duration
  FROM public.provider_services ps
  WHERE ps.provider_id = NEW.provider_id
    AND ps.id = ANY(NEW.service_ids);

  -- CLAUSE 1 (cross-service = exclusive): reject if ANY overlapping active
  -- booking is for a DIFFERENT primary service than the incoming one.
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
      AND b.service_ids[1] IS DISTINCT FROM NEW.service_ids[1]
  ) THEN
    RAISE EXCEPTION 'The selected time is no longer available'
      USING ERRCODE = '23505';
  END IF;

  -- CLAUSE 2 (same-service pool): count overlapping active bookings for the
  -- SAME primary service; reject once the pool is at capacity.
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
    AND b.service_ids[1] IS NOT DISTINCT FROM NEW.service_ids[1];

  IF current_count >= COALESCE(primary_max_capacity, 1) THEN
    RAISE EXCEPTION 'The selected time is no longer available'
      USING ERRCODE = '23505';
  END IF;

  RETURN NEW;
END;
$$;

COMMIT;
