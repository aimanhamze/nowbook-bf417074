-- Phase 1 of the multi-staff feature — SCHEMA ONLY.
--
-- Some providers (e.g. a barbershop) have multiple staff members; the customer
-- will pick a specific one when booking, and different staff can be booked at
-- the same time. Opt-in per provider via provider_profiles.staff_enabled.
--
-- This migration is PURELY ADDITIVE. Nothing reads these objects yet:
--   * provider_staff            — new table (empty).
--   * bookings.staff_id         — NULL for every existing and new row.
--   * provider_profiles.staff_enabled — false for all 29 providers.
--   → zero behavior change anywhere.
--
-- EXPLICITLY OUT OF SCOPE (later phases):
--   * prevent_booking_conflicts is NOT touched. Phase 3 will add
--     `AND b.staff_id IS NOT DISTINCT FROM NEW.staff_id` to its cross-service
--     overlap and same-service capacity clauses (NOT the same-user guard), and
--     add staff_id to the trigger's UPDATE OF column list.
--   * get_provider_busy_slots is NOT touched (return-type change needs
--     DROP + CREATE; Phase 3).
--   * No client code reads staff_* yet (Phases 2+).
--
-- After applying, regenerate src/integrations/supabase/types.ts
-- (`supabase gen types`) so the new table/columns appear in the generated types.

BEGIN;

-- ── 1. provider_staff ────────────────────────────────────────────────────────
-- One row per staff member, owned by a provider. Staff are SOFT-DELETED via
-- is_active = false, never hard-deleted: bookings will reference staff_id and
-- booking history must survive a staff member leaving. (The composite FK on
-- bookings below is deliberately NO ACTION, so an accidental hard DELETE of a
-- referenced staff row fails loudly instead of corrupting history.)
--
-- UNIQUE (id, provider_id): not for uniqueness itself (id is already the PK) —
-- it exists solely as the target of the composite FK from bookings, which is
-- what guarantees a booking can never point at another provider's staff.
CREATE TABLE public.provider_staff (
  id            uuid        NOT NULL DEFAULT gen_random_uuid(),
  provider_id   uuid        NOT NULL REFERENCES public.provider_profiles(id) ON DELETE CASCADE,
  name          text        NOT NULL,
  is_active     boolean     NOT NULL DEFAULT true,
  display_order integer     NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT provider_staff_pkey PRIMARY KEY (id),
  CONSTRAINT provider_staff_id_provider_id_key UNIQUE (id, provider_id)
);

-- Serves the two hot lookups: "active staff list for this provider" (customer
-- picker) and "all staff for this provider" (owner management UI).
CREATE INDEX idx_provider_staff_provider_active
  ON public.provider_staff (provider_id, is_active);

-- ── 1a. RLS — mirrors provider_services ─────────────────────────────────────
-- Live provider_services policies (dumped from production 2026-07-24):
--   "Anyone can view active services"   FOR SELECT USING (true)
--   "Providers can manage own services" FOR ALL USING (EXISTS (SELECT 1
--       FROM provider_profiles pp
--       WHERE pp.id = provider_services.provider_id AND pp.user_id = auth.uid()))
--     [no explicit WITH CHECK → Postgres implicitly reuses the USING expression]
-- Replicated below with the same shape. We state WITH CHECK explicitly on the
-- ALL policy; that is functionally identical to provider_services' implicit
-- behavior, just spelled out.
ALTER TABLE public.provider_staff ENABLE ROW LEVEL SECURITY;

-- Customers must see the staff list pre-auth (the picker renders before login),
-- exactly like the public services list. Rows carry only name/order/active — no
-- PII beyond what the provider chooses to publish.
CREATE POLICY "Anyone can view staff"
  ON public.provider_staff
  FOR SELECT
  USING (true);

CREATE POLICY "Providers can manage own staff"
  ON public.provider_staff
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.provider_profiles pp
    WHERE pp.id = provider_staff.provider_id AND pp.user_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.provider_profiles pp
    WHERE pp.id = provider_staff.provider_id AND pp.user_id = auth.uid()
  ));

-- ── 2. bookings.staff_id ─────────────────────────────────────────────────────
-- Nullable: NULL means "no specific staff member" — every existing row, every
-- booking at a non-staff provider, and (per plan) group/class bookings forever.
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS staff_id uuid NULL;

-- COMPOSITE FK (staff_id, provider_id) → provider_staff (id, provider_id):
-- a plain FK on staff_id alone would allow attaching provider X's booking to
-- provider Y's staff; pairing provider_id into the FK makes that impossible.
-- MATCH SIMPLE (the default) means the constraint is simply not enforced while
-- staff_id IS NULL — so all existing rows and all non-staff bookings pass
-- without any check, and provider_id alone never trips it.
--
-- ON DELETE is deliberately the default NO ACTION:
--   * SET NULL is WRONG here — on a composite FK it would null BOTH columns,
--     and provider_id is NOT NULL, so any staff hard-delete with history would
--     fail with a not-null violation (confusing) instead of a clean FK error.
--     (PG 15+ supports column-specific `ON DELETE SET NULL (staff_id)` and the
--     live DB is PG 17.6, so it IS available — but soft delete via is_active
--     is the chosen model, so we keep NO ACTION and let a hard DELETE of
--     referenced staff fail loudly.)
--   * Provider deletion is unaffected: bookings.provider_id already cascades
--     from provider_profiles, and provider_staff.provider_id cascades too, so
--     deleting a provider removes bookings and staff together.
ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_staff_id_provider_id_fkey
  FOREIGN KEY (staff_id, provider_id)
  REFERENCES public.provider_staff (id, provider_id);

-- Serves the Phase 3 per-staff conflict/busy-slot lookups
-- (provider + staff + date) and per-staff calendar filtering.
CREATE INDEX idx_bookings_provider_staff_date
  ON public.bookings (provider_id, staff_id, booking_date);

-- ── 3. provider_profiles.staff_enabled ───────────────────────────────────────
-- Same pattern as requires_booking_approval / treatment_notes_enabled /
-- show_prices / deposit_request_enabled: boolean NOT NULL DEFAULT false.
-- Every existing provider gets false → completely unaffected.
ALTER TABLE public.provider_profiles
  ADD COLUMN IF NOT EXISTS staff_enabled boolean NOT NULL DEFAULT false;

-- ── 4. Guard: cannot enable staff mode with future bookings on the books ─────
-- Once staff_enabled is on, NULL-staff bookings are ambiguous (they block no
-- specific staff member's calendar). Rather than guess, we refuse the false→true
-- transition while FUTURE active bookings exist; Phase 2's UI catches the error
-- and tells the owner to wait out (or resolve) their future bookings first.
--
-- "Future" uses the app's operating timezone (Asia/Jerusalem), matching
-- enforce_booking_lead_time — NOT UTC CURRENT_DATE — so "today" here is the
-- same "today" the rest of the booking system uses.
--
-- SECURITY DEFINER is required for the guard to be truly un-bypassable: RLS on
-- bookings has NO admin SELECT arm, so when an ADMIN flips the flag (admins may
-- UPDATE any provider_profile), an invoker-rights EXISTS would see zero rows
-- and silently wave the transition through. Definer rights make the check see
-- all bookings regardless of who performs the update. search_path is pinned,
-- per SECURITY DEFINER hygiene (matches link_walkin_to_account).
CREATE OR REPLACE FUNCTION public.enforce_staff_enable_no_future_bookings()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.bookings b
    WHERE b.provider_id = NEW.id
      AND b.status IN ('confirmed', 'pending')
      AND b.booking_date >= (NOW() AT TIME ZONE 'Asia/Jerusalem')::date
  ) THEN
    -- Distinct, machine-matchable token + P0001, same convention the client
    -- already handles for LEAD_TIME_VIOLATION / GROUP_CAPACITY_EXCEEDED /
    -- DUPLICATE_USER_BOOKING.
    RAISE EXCEPTION 'STAFF_ENABLE_BLOCKED_BY_FUTURE_BOOKINGS'
      USING ERRCODE = 'P0001',
            HINT = 'Staff mode cannot be enabled while future confirmed or pending bookings exist for this provider.';
  END IF;

  RETURN NEW;
END;
$$;

-- Scoping — the trigger fires ONLY on the exact guarded transition:
--   * UPDATE OF staff_enabled: statements that do not SET staff_enabled never
--     even consider this trigger — every other provider_profiles update
--     (show_prices, cancellation_notice_hours, ...) is completely unaffected.
--   * WHEN (... IS DISTINCT FROM ... AND NEW.staff_enabled): among statements
--     that DO set the column, only a real false→true change invokes the
--     function. true→true and false→false no-ops skip it, and turning the flag
--     OFF (→ false) is always allowed — that is the conservative direction.
CREATE TRIGGER trg_enforce_staff_enable_no_future_bookings
  BEFORE UPDATE OF staff_enabled ON public.provider_profiles
  FOR EACH ROW
  WHEN (OLD.staff_enabled IS DISTINCT FROM NEW.staff_enabled AND NEW.staff_enabled)
  EXECUTE FUNCTION public.enforce_staff_enable_no_future_bookings();

COMMIT;
