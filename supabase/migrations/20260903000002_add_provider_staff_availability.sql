-- Phase 1 of PER-STAFF AVAILABILITY — SCHEMA ONLY.
--
-- Goal (later phases): each staff member may work a SUBSET of the shop's hours,
-- so a customer who picks a staff member sees only the times that member works.
-- This migration creates the storage for that and nothing else.
--
-- THE SUBSET RULE (the whole basis of the design):
--   staff availability NARROWS the shop's window, it can never EXTEND it. If the
--   shop is closed, nobody is bookable, whatever this table says. Phase 3
--   enforces that structurally in lib/availabilityResolver.ts: resolveDayHours()
--   is NOT modified and gains no parameter; a new pure function composes over
--   its OUTPUT, taking max() of the two start times and min() of the two end
--   times. A function whose only boundary operators are max-of-starts and
--   min-of-ends cannot return a wider window than either input.
--
-- INHERITANCE RULE (the reason this migration is a no-op today):
--   a staff member with ZERO rows in provider_staff_availability works ALL of
--   the shop's hours. Configuration only ever RESTRICTS. The table ships EMPTY,
--   so every existing staff member is unrestricted and behaves exactly as today.
--   No backfill exists, and none is needed — now or ever.
--
--   This mirrors provider_staff_services (see lib/staffServices.ts:5-21), with
--   ONE deliberate difference in granularity that matters for Phase 2/3:
--     * "configured" is a property of the MEMBER, not of the weekday. A member
--       with ANY rows is configured.
--     * within a CONFIGURED member, a MISSING weekday row means NOT WORKING —
--       not "inherit the shop's hours for that day". An owner who fills in
--       Mon–Fri means the member is off at the weekend; the opposite reading
--       would make partial configuration silently useless.
--   Phase 3 therefore distinguishes three states, not two: no rows at all
--   (identity — return the shop's own window object untouched), rows but none
--   for this weekday (closed), and a row for this weekday (intersect).
--
-- This migration is PURELY ADDITIVE:
--   * provider_staff_availability — new table, empty.
--   → zero behaviour change anywhere. No client code reads it, so no provider,
--     staff-enabled or not, can be affected by its existence.
--
-- EXPLICITLY OUT OF SCOPE (later phases):
--   * NO client code reads this table (Phase 2 = owner UI, Phase 3 = the
--     resolver composition + useRealAvailability, Phase 4 = booking-flow copy).
--   * NO trigger work, now or later. Opening hours have NEVER been enforced
--     server-side — prevent_booking_conflicts is booking-vs-booking only and
--     get_provider_busy_slots reads bookings alone, never provider_availability.
--     Per-staff hours inherit exactly that posture: they are a client-side
--     offering rule, and the DB's guarantee remains "no double-booking". This is
--     a deliberate, accepted decision, not an oversight.
--   * STAFF TIME OFF (a per-staff equivalent of provider_blocked_dates) is a
--     LATER phase and a SEPARATE table. It is not modelled here.
--   * NO break_start / break_end COLUMNS — a deliberate omission, and the one
--     place this table does NOT mirror provider_availability. The reason is that
--     a per-staff break is UNREPRESENTABLE in the resolver's return type:
--     DayWindow (availabilityResolver.ts:38-43) carries ONE window and at most
--     ONE break. Intersecting a shop break of 13:00–14:00 with a staff break of
--     11:00–12:00 yields a window with TWO holes, which DayWindow cannot express.
--     Honouring a staff break would therefore require changing that return shape
--     — the exact thing the approved design does not touch. Carrying the columns
--     anyway would be worse than omitting them: Phase 2's editor would offer
--     fields that Phase 3 silently ignores, which is the failure mode this
--     codebase keeps writing comments to avoid. Staff inherit the SHOP's break,
--     which the intersection already preserves. If per-staff breaks are wanted
--     later they arrive as two nullable columns plus a `breaks[]` change to
--     DayWindow — purely additive, and no harder for having waited.
--   * PER-STAFF PER-DATE overrides (a staff equivalent of
--     provider_date_overrides) are NOT in scope. Staff hours are weekly-only and
--     narrow whatever resolveDayHours returned — weekly window or monthly
--     window alike — because the composition consumes the resolver's OUTPUT
--     type and neither knows nor cares which branch produced it. Monthly-mode
--     shops are therefore supported without a second staff data model.
--   * provider_availability, provider_date_overrides, provider_blocked_dates,
--     provider_staff and bookings are UNTOUCHED. This migration adds one table
--     and changes no existing object.
--
-- After applying, regenerate src/integrations/supabase/types.ts
-- (`supabase gen types`) so the new table appears in the generated types.

BEGIN;

-- ── provider_staff_availability ──────────────────────────────────────────────
-- One row = "this staff member works this weekday, from start_time to end_time".
-- Absence of ALL rows for a member = unrestricted (see INHERITANCE RULE above)
-- — NOT "works nothing". That asymmetry is what makes the table safe to ship
-- empty.
--
-- provider_id is DENORMALISED onto this table on purpose, exactly as on
-- provider_staff_services: it is what lets the composite FK below prove the
-- staff row belongs to the claimed provider, it is what the RLS owner-check
-- reads directly instead of joining through provider_staff, and it is the
-- column Phase 3's SINGLE per-provider fetch filters on.
CREATE TABLE public.provider_staff_availability (
  provider_id  uuid        NOT NULL,
  staff_id     uuid        NOT NULL,
  day_of_week  integer     NOT NULL,

  -- COLUMN TYPES MIRROR provider_availability AS IT ACTUALLY IS IN PRODUCTION,
  -- which is NOT what every migration in this directory says. Two historical
  -- migrations disagree: 001_initial_schema.sql declares start_time/end_time as
  -- `text`, while 20260322225907 declares them `TIME`. Production was sampled
  -- directly through PostgREST on 2026-09-03 to settle it: start_time comes back
  -- as "09:00" and accepts the text `like` operator, so the live columns are
  -- TEXT. (A `time` column would serialise as "09:00:00".) Mirroring text here
  -- keeps the two sides of Phase 3's intersection in the same representation.
  start_time   text        NOT NULL DEFAULT '09:00',
  end_time     text        NOT NULL DEFAULT '17:00',

  -- is_available mirrors provider_availability and is how "Sami does not work
  -- Tuesdays" is stored EXPLICITLY. A configured member is equally closed on a
  -- weekday with no row at all, but Phase 2's editor should write the explicit
  -- false row (as AvailabilityTab already does for the shop) so the owner can
  -- see the day in the grid rather than inferring it from an absence.
  is_available boolean     NOT NULL DEFAULT true,

  created_at   timestamptz NOT NULL DEFAULT now(),

  -- day_of_week domain, same as provider_availability's original CHECK.
  -- 0 = Sunday … 6 = Saturday, matching JS date.getDay(), which is what
  -- resolveDayHours looks rows up by (availabilityResolver.ts:109-110).
  CONSTRAINT psa_day_of_week_check CHECK (day_of_week >= 0 AND day_of_week <= 6),

  -- COMPOSITE PK (staff_id, day_of_week): the row IS the fact, and nothing will
  -- ever reference a staff-availability row by id, so a surrogate key would only
  -- add a column plus a second index — the same reasoning provider_staff_services
  -- records for its own composite PK. It doubles as the natural invariant (one
  -- window per member per weekday, mirroring provider_availability's
  -- UNIQUE (provider_id, day_of_week)) and, unlike that table, it gives Phase 2's
  -- writer a real ON CONFLICT target: the shop-side writer has to do
  -- UPDATE-then-INSERT-if-no-rows (useProviderAvailability.ts:38-53) precisely
  -- because it cannot name one. Phase 2 should upsert on (staff_id, day_of_week).
  CONSTRAINT provider_staff_availability_pkey PRIMARY KEY (staff_id, day_of_week),

  -- COMPOSITE FK carrying provider_id: with a plain FK on staff_id alone,
  -- provider X's row could name provider Y's staff member, and the RLS
  -- owner-check (which can only be written against one provider_id) would
  -- happily authorise it. Pairing provider_id into the FK makes the mismatch
  -- unrepresentable — the same hole pss_staff_fkey and
  -- bookings_staff_id_provider_id_fkey close.
  --
  -- ON DELETE CASCADE, deliberately UNLIKE bookings' NO ACTION: a working-hours
  -- row is CONFIGURATION with no historical value, whereas a booking is HISTORY
  -- that must survive a staff member leaving. In practice cascade rarely fires
  -- at all — staff are soft-deleted via is_active, never hard-deleted. When it
  -- does fire it is correct: deleting a provider cascades provider_profiles →
  -- provider_staff → these rows, leaving nothing orphaned.
  CONSTRAINT psa_staff_fkey FOREIGN KEY (staff_id, provider_id)
    REFERENCES public.provider_staff (id, provider_id) ON DELETE CASCADE
);

-- Serves the ONE query Phase 3 will run: every staff member's rows for this
-- provider, fetched once and indexed by staff_id in a useMemo. Phase 3 must
-- NOT key this query per staff member and must NOT query it per calendar day —
-- dayHasAvailability() is invoked once per rendered calendar cell
-- (BookAppointment.tsx:367-382, NewBookingSheet.tsx:206-213), so a per-day
-- query here would fan out across the whole month grid.
--
-- The PK leads with staff_id, so it already covers the owner-side direction
-- ("this member's week") and the FK's cascade-delete lookup. This index covers
-- the customer-side direction the PK cannot.
CREATE INDEX idx_psa_provider
  ON public.provider_staff_availability (provider_id);

-- ── RLS — mirrors provider_availability's CURRENT policies ───────────────────
-- Live provider_availability policies, per 20260425000001_fix_provider_availability_rls.sql
-- (the migration that fixed them, and the latest to touch them):
--   "Anyone can view availability"     FOR SELECT USING (true)
--   "Provider manages own availability" FOR ALL, USING and WITH CHECK both =
--       provider_id IN (SELECT id FROM provider_profiles WHERE user_id = auth.uid())
-- Replicated below with the same shape. Note that shape differs from
-- provider_staff / provider_staff_services, which use an EXISTS subquery instead
-- of IN; both are equivalent, and we follow the table this one mirrors.
--
-- The explicit WITH CHECK is NOT optional here. 20260425000001 exists precisely
-- because the original FOR ALL policies omitted it, which made PostgREST
-- silently block every upsert against provider_availability. A new table
-- repeating that omission would fail the same way, and Phase 2 would look like a
-- UI bug.
ALTER TABLE public.provider_staff_availability ENABLE ROW LEVEL SECURITY;

-- Public SELECT is REQUIRED: the customer booking flow resolves slots pre-auth
-- and already reads provider_availability, provider_blocked_dates,
-- provider_staff and provider_staff_services anonymously. These rows expose only
-- "staff member N works weekday D from H to H" — strictly less than the shop
-- hours the provider profile already publishes.
CREATE POLICY "Anyone can view staff availability"
  ON public.provider_staff_availability FOR SELECT
  USING (true);

-- Owner-only writes, checked against THIS table's provider_id. Because the
-- composite FK above guarantees provider_id agrees with the staff row's own
-- provider, checking it here is both cheaper than joining through provider_staff
-- and exactly as strong: an owner cannot smuggle in another provider's staff_id.
CREATE POLICY "Provider manages own staff availability"
  ON public.provider_staff_availability FOR ALL
  USING (
    provider_id IN (
      SELECT id FROM public.provider_profiles WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    provider_id IN (
      SELECT id FROM public.provider_profiles WHERE user_id = auth.uid()
    )
  );

COMMIT;
