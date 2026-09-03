-- Phase 1 of PER-STAFF SERVICES — SCHEMA ONLY.
--
-- Goal (later phases): each staff member may offer a SUBSET of the provider's
-- services, so a customer who picks a service sees only the staff who perform
-- it. This migration creates the storage for that and nothing else.
--
-- INHERITANCE RULE (the reason this migration is a no-op today):
--   a staff member with ZERO rows in provider_staff_services offers ALL of the
--   provider's services. Assignment only ever RESTRICTS. The table ships EMPTY,
--   so every existing staff member is unrestricted and behaves exactly as today.
--   No backfill exists, and none is needed — now or ever.
--
-- This migration is PURELY ADDITIVE:
--   * provider_services gains UNIQUE (id, provider_id) — a composite-FK target
--     only; id is already the PK, so the pair is already unique and the
--     constraint cannot fail or change any existing behaviour.
--   * provider_staff_services — new table, empty.
--   → zero behaviour change anywhere. Non-staff providers have no staff rows,
--     therefore no assignment rows, therefore never enter a filtering path.
--
-- EXPLICITLY OUT OF SCOPE (later phases):
--   * NO client code reads this table (Phase 2 = owner management UI,
--     Phase 3 = customer/walk-in picker filtering).
--   * prevent_booking_conflicts is NOT touched. It stays service-blind with
--     respect to staff: nothing at the DB level asserts that bookings.staff_id
--     performs the services in bookings.service_ids. Filtering is client-side
--     in Phase 3; the residual gap is a mis-assigned appointment at one's own
--     shop, not a security boundary. Revisit only if that proves insufficient
--     (awkward: service_ids is an array, staff_id is scalar).
--   * provider_staff and provider_services are otherwise UNTOUCHED — the one
--     unique constraint below is the entire change to existing tables.
--
-- After applying, regenerate src/integrations/supabase/types.ts
-- (`supabase gen types`) so the new table appears in the generated types.

BEGIN;

-- ── 1. provider_services: composite-FK target ────────────────────────────────
-- provider_staff already carries UNIQUE (id, provider_id) for exactly this
-- purpose (it is what bookings_staff_id_provider_id_fkey points at).
-- provider_services has only its PK today, so the mirror must be added here
-- before pss_service_fkey below can reference the pair.
--
-- SAFETY: id is already unique on its own, so (id, provider_id) is trivially
-- unique for every existing and future row — the constraint is unfalsifiable by
-- data and cannot reject a write that the PK would have accepted. It adds one
-- btree index over a few hundred rows; the brief ACCESS EXCLUSIVE lock taken to
-- build it is negligible at this size.
ALTER TABLE public.provider_services
  ADD CONSTRAINT provider_services_id_provider_id_key UNIQUE (id, provider_id);

-- ── 2. provider_staff_services ───────────────────────────────────────────────
-- One row = "this staff member performs this service". Absence of rows for a
-- staff member = unrestricted (see INHERITANCE RULE above) — NOT "performs
-- nothing". That asymmetry is the whole design: it is what makes the table
-- safe to ship empty.
--
-- provider_id is DENORMALISED onto this table on purpose. It is not redundant
-- bookkeeping: it is the column that makes the two composite FKs below able to
-- prove both parents belong to the SAME provider, and it is what the RLS
-- owner-check reads directly instead of joining through provider_staff.
CREATE TABLE public.provider_staff_services (
  provider_id uuid        NOT NULL,
  staff_id    uuid        NOT NULL,
  service_id  uuid        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),

  -- COMPOSITE PK (staff_id, service_id): the row IS the fact, and nothing will
  -- ever reference an assignment by id. A surrogate key would only add a column
  -- plus a second index. (provider_services uses a surrogate id because bookings
  -- reference it — that reason does not apply to a pure join table.)
  -- It also enforces the natural invariant: a pair can only be assigned once.
  CONSTRAINT provider_staff_services_pkey PRIMARY KEY (staff_id, service_id),

  -- COMPOSITE FKs carrying provider_id: with two plain single-column FKs,
  -- provider X's staff could be joined to provider Y's service, and the RLS
  -- owner-check (which can only be written against one provider_id) would
  -- happily authorise it. Pairing provider_id into BOTH FKs makes the mismatch
  -- unrepresentable — the same hole bookings_staff_id_provider_id_fkey closes.
  --
  -- ON DELETE CASCADE, deliberately UNLIKE bookings' NO ACTION: an assignment is
  -- CONFIGURATION with no historical value, whereas a booking is HISTORY that
  -- must survive a staff member leaving. In practice cascade rarely fires at
  -- all — staff are soft-deleted via is_active and services via is_active, so
  -- neither parent is normally hard-deleted. When it does fire it is correct:
  -- deleting a provider cascades provider_profiles → provider_staff /
  -- provider_services → these rows, leaving nothing orphaned.
  CONSTRAINT pss_staff_fkey FOREIGN KEY (staff_id, provider_id)
    REFERENCES public.provider_staff (id, provider_id) ON DELETE CASCADE,
  CONSTRAINT pss_service_fkey FOREIGN KEY (service_id, provider_id)
    REFERENCES public.provider_services (id, provider_id) ON DELETE CASCADE
);

-- The PK already serves the owner-side lookup ("which services does this staff
-- member perform", leading column staff_id). This index serves the HOT
-- customer-side direction the booking flow will run: "which staff perform this
-- service, for this provider".
CREATE INDEX idx_pss_provider_service
  ON public.provider_staff_services (provider_id, service_id);

-- ── 3. RLS — mirrors provider_staff ──────────────────────────────────────────
-- Live provider_staff policies (dumped from production 2026-08-03):
--   "Anyone can view staff"           FOR SELECT USING (true)
--   "Providers can manage own staff"  FOR ALL, BOTH qual and with_check =
--       EXISTS (SELECT 1 FROM provider_profiles pp
--               WHERE pp.id = provider_staff.provider_id AND pp.user_id = auth.uid())
-- Replicated below with the same shape. provider_staff spells WITH CHECK out
-- explicitly (provider_services leaves it NULL and lets Postgres reuse the
-- USING expression); we follow provider_staff's explicit form.
ALTER TABLE public.provider_staff_services ENABLE ROW LEVEL SECURITY;

-- Public SELECT is REQUIRED: the customer's staff picker renders pre-auth, so
-- it must read this table exactly as it already reads provider_staff and
-- provider_services. The rows expose only "staff N performs service M" — no PII
-- beyond what the provider already publishes in those two tables.
CREATE POLICY "Anyone can view staff services"
  ON public.provider_staff_services
  FOR SELECT
  USING (true);

-- Owner-only writes, checked against THIS table's provider_id. Because the
-- composite FKs above guarantee provider_id agrees with both parents, checking
-- it here is both cheaper than joining through provider_staff and exactly as
-- strong: an owner cannot smuggle in another provider's staff_id or service_id.
CREATE POLICY "Providers can manage own staff services"
  ON public.provider_staff_services
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.provider_profiles pp
    WHERE pp.id = provider_staff_services.provider_id AND pp.user_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.provider_profiles pp
    WHERE pp.id = provider_staff_services.provider_id AND pp.user_id = auth.uid()
  ));

COMMIT;
