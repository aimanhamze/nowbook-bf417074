-- PARALLEL SERVICES — Phase 1 (DB only, no UI).
--
-- Goal: let a provider mark services as "parallel". Two OVERLAPPING bookings for
-- two DIFFERENT services may now share a time window ONLY when BOTH services are
-- flagged is_parallel = true. Any non-parallel service blocks exactly as before.
--
-- Scope of behavior change is intentionally tiny: ONLY the PRIVATE branch's
-- CLAUSE 1 (cross-service exclusive) in prevent_booking_conflicts() gains a
-- single exception. Everything else — the GROUP branch, the same-user guard,
-- CLAUSE 2 (same-service capacity pool), the advisory lock, status handling and
-- duration math — is reproduced verbatim from 20260609000003 and is unchanged.
--
-- Default false means zero behavior change for every existing provider/service
-- until someone opts a service in.
--
-- ATOMICITY: single transaction so the live function is never half-rewritten.
BEGIN;

-- 1) New flag. IF NOT EXISTS keeps this re-runnable; NOT NULL DEFAULT false
--    backfills every existing row to non-parallel (current behavior).
ALTER TABLE public.provider_services
  ADD COLUMN IF NOT EXISTS is_parallel boolean NOT NULL DEFAULT false;

-- 2) Replace the conflict trigger. Only CLAUSE 1 changes (see -- PARALLEL
--    EXCEPTION below). A new local `new_is_parallel` is read alongside the
--    existing service_type/max_capacity lookup.
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
  new_is_parallel boolean;          -- PARALLEL: is the incoming primary service parallel?
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

  -- Read the incoming primary service's type, capacity, AND parallel flag.
  SELECT ps.service_type, ps.max_capacity, ps.is_parallel
  INTO primary_service_type, primary_max_capacity, new_is_parallel
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
  --
  -- PARALLEL EXCEPTION ───────────────────────────────────────────────────────
  -- The cross-service block is SKIPPED for a given overlap when BOTH the
  -- incoming primary service (new_is_parallel) AND the existing booking's
  -- primary service (b.service_ids[1]'s is_parallel) are parallel. If only one
  -- side is parallel, the overlap still blocks — a parallel service does NOT get
  -- to overlap a non-parallel one. More than two parallel services therefore all
  -- coexist (each pairwise overlap is skipped). COALESCE(..., false) makes a
  -- missing/unknown service non-parallel, i.e. it still blocks (fail-safe).
  -- Note: this exception is independent of CLAUSE 2 below — same-service overlaps
  -- never reach here (they are NOT DISTINCT) and remain governed by capacity.
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
      -- PARALLEL EXCEPTION: drop this overlap from the conflict set iff BOTH
      -- primary services are parallel.
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

  -- SAME-USER guard (UNCHANGED): one account may hold only ONE spot in an
  -- overlapping same-service slot. Runs only for real accounts; walk-ins
  -- (user_id IS NULL) are excluded both by the IS NOT NULL guard and by
  -- b.user_id = NEW.user_id (NULL = NULL is not TRUE). Separate from the capacity
  -- pool below, which still allows up to N DIFFERENT users for the same service.
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
      AND b.service_ids[1] IS NOT DISTINCT FROM NEW.service_ids[1]
  ) THEN
    RAISE EXCEPTION 'DUPLICATE_USER_BOOKING'
      USING ERRCODE = 'P0001';
  END IF;

  -- CLAUSE 2 (same-service pool, UNCHANGED): count overlapping active bookings
  -- for the SAME primary service; reject once the pool is at capacity.
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
