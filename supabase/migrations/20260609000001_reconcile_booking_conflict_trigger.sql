-- RECONCILIATION: make production use our capacity-aware conflict trigger.
--
-- DISCOVERED STATE (confirmed via pg_trigger on public.bookings):
--   Active triggers: trg_bookings_updated_at, trg_enforce_booking_approval_status,
--   trg_enforce_booking_lead_time, AND trg_prevent_double_booking.
--   There is NO trg_prevent_booking_conflicts.
--
-- The active trg_prevent_double_booking (-> prevent_double_booking()) was created
-- out-of-band (Lovable / SQL editor) and was NEVER in our migrations. It:
--   * has no skip-on-cancel guard, so it blocks cancellations, and
--   * contradicts the capacity feature (it enforces blanket double-booking).
-- Meanwhile our prevent_booking_conflicts() function EXISTS in the DB (from our
-- migrations) but is wired to NO trigger, so all of our capacity / cancel-guard /
-- two-clause work has never actually run in production.
--
-- THIS MIGRATION:
--   1. Drops the phantom trigger and its function.
--   2. Re-asserts prevent_booking_conflicts() at its latest version (identical to
--      20260608000002) so the repo is authoritative on its own — no dependency on
--      whatever happens to be in the DB.
--   3. Creates trg_prevent_booking_conflicts with the events our migrations always
--      intended (matching 20260328194531).

-- ATOMICITY: the whole reconciliation runs in ONE transaction. Between dropping
-- the phantom trigger and creating the real one there must never be a committed
-- moment where bookings has no conflict protection. BEGIN/COMMIT guarantees the
-- swap is all-or-nothing; any error rolls the entire migration back, leaving the
-- phantom in place rather than an unprotected table. (Supabase does not auto-wrap
-- hand-run migration files, so we wrap explicitly.)
BEGIN;

-- ── 1. Remove the out-of-band phantom ────────────────────────────────────────
-- Drops the rogue trigger so it stops firing on bookings. IF EXISTS makes this a
-- no-op on any environment where it was never created.
DROP TRIGGER IF EXISTS trg_prevent_double_booking ON public.bookings;

-- Drops the now-orphaned function the phantom trigger called. Safe because the
-- trigger above (its only caller) is gone; IF EXISTS keeps it idempotent.
DROP FUNCTION IF EXISTS public.prevent_double_booking();

-- ── 2. Re-assert the authoritative function (latest version, == 20260608000002) ──
-- CREATE OR REPLACE rewrites the function body in place (OID preserved), so any
-- existing trigger binding survives. We restate the full latest definition here so
-- the repo does not depend on the DB already holding the right version.
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
  WHERE ps.provider_id::text = NEW.provider_id
    AND ps.id::text = NEW.service_ids[1];

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
  WHERE ps.provider_id::text = NEW.provider_id
    AND ps.id::text = ANY(NEW.service_ids);

  -- CLAUSE 1 (cross-service = exclusive): reject if ANY overlapping active
  -- booking is for a DIFFERENT primary service than the incoming one.
  IF EXISTS (
    SELECT 1
    FROM public.bookings b
    LEFT JOIN LATERAL (
      SELECT COALESCE(NULLIF(SUM(ps2.duration), 0), 30) AS duration_minutes
      FROM public.provider_services ps2
      WHERE ps2.provider_id::text = b.provider_id
        AND ps2.id::text = ANY(b.service_ids)
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
    WHERE ps2.provider_id::text = b.provider_id
      AND ps2.id::text = ANY(b.service_ids)
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

-- ── 3. Wire the trigger (events match 20260328194531) ────────────────────────
-- Drop-then-create so this migration is idempotent and re-runnable: if a prior
-- run (or environment) already has the trigger, we replace it cleanly.
DROP TRIGGER IF EXISTS trg_prevent_booking_conflicts ON public.bookings;

-- Fires BEFORE the row is written, on INSERT and on UPDATE of any of the columns
-- that affect a conflict decision (provider_id, booking_date, booking_time,
-- service_ids, status). Scoping UPDATE to those columns avoids re-running the
-- check on unrelated edits (e.g. notes). FOR EACH ROW so NEW/OLD are available.
CREATE TRIGGER trg_prevent_booking_conflicts
BEFORE INSERT OR UPDATE OF provider_id, booking_date, booking_time, service_ids, status
ON public.bookings
FOR EACH ROW
EXECUTE FUNCTION public.prevent_booking_conflicts();

-- Commit the swap atomically. If anything above raised, none of it took effect.
COMMIT;
