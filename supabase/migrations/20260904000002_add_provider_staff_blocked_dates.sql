-- Phase 5a of PER-STAFF AVAILABILITY — STAFF TIME OFF, SCHEMA ONLY.
--
-- Goal (later steps): each staff member can have their own days off, on top of
-- the weekly hours added in 20260903000002. This migration creates the storage
-- for that and nothing else.
--
-- INDIVIDUAL DATES, one row per date — deliberately NOT ranges, matching
-- provider_blocked_dates exactly. A week off is seven rows. That is the existing
-- shop-level pattern and there is no reason for the staff-level one to differ.
--
-- ── PRECEDENCE (the reason this table is safe to add) ────────────────────────
-- Three layers, resolved in this order, and only the second is new:
--
--   1. SHOP blocked date (provider_blocked_dates) → CLOSED FOR EVERYONE.
--      Already guaranteed twice over and needs no change here: it is the FIRST
--      statement in resolveDayHours (availabilityResolver.ts:85), and
--      narrowToStaff returns null on a closed shop window BEFORE it inspects the
--      staff side at all. No staff row can reopen a day the shop has closed.
--
--   2. STAFF blocked date (THIS TABLE) → that member is off; the shop and every
--      OTHER member are unaffected. Enters as the FIRST statement of
--      staffDayWindow, above its "no rows → undefined" return. That ordering is
--      load-bearing: below it, a member with time off but NO weekly hours
--      configured — the most likely user of this feature — would have their day
--      off silently ignored.
--
--   3. STAFF weekly row (provider_staff_availability) → the window, intersected
--      with the shop's by max-of-starts / min-of-ends.
--
-- resolveDayHours is NOT modified, in this step or the ones after it. Nor is
-- narrowToStaff: staff time off simply becomes one more way staffDayWindow
-- returns null, which narrowToStaff already handles.
--
-- OPT-IN BY ABSENCE, same as the hours table: no rows means no time off. There
-- is no "configured vs unconfigured" subtlety here — unlike weekly hours, an
-- empty set and no rows mean the same thing. The table ships EMPTY, so every
-- existing provider and staff member is completely unaffected. No backfill
-- exists, and none is needed.
--
-- ── WHAT THIS MIGRATION DOES NOT DO ─────────────────────────────────────────
--   * NO client code reads or writes this table yet (5b = owner UI in the staff
--     edit sheet, 5c = the resolver parameter + the customer/walk-in wiring).
--   * NO trigger work, now or later. Opening hours have never been enforced
--     server-side and staff time off inherits that posture: it is a client-side
--     offering rule, and the DB's guarantee remains "no double-booking".
--   * provider_blocked_dates, provider_staff_availability, provider_staff and
--     bookings are UNTOUCHED. This migration adds one table and alters nothing.
--
-- ── TWO DELIBERATE DIVERGENCES FROM provider_blocked_dates ──────────────────
-- The shape is mirrored; these two differences are chosen, not accidental.
--
--   * NO `reason` COLUMN. provider_blocked_dates has one, and the shop's own UI
--     collects it. It is omitted here because this table needs PUBLIC SELECT
--     (the customer booking flow resolves slots pre-auth), and Postgres RLS
--     cannot restrict individual COLUMNS — a policy is all-or-nothing per row.
--     A free-text reason attached to a NAMED EMPLOYEE and readable by anyone
--     with the anon key is a privacy problem the shop-level column does not
--     have: "closed for renovation" is business information, "sick leave" is
--     personal information about a third party. The customer flow never displays
--     a reason, and the owner-facing need for one is speculative. If it is
--     wanted later it can be added with column-level GRANTs (which DO work
--     alongside RLS) or a read-only view — additive either way, and no harder
--     for having waited.
--
--   * HAS `created_at`. provider_blocked_dates does not (verified against the
--     live database, not the migrations). This table follows its two SIBLINGS
--     instead — provider_staff_services and provider_staff_availability both
--     carry it — because consistency within the staff-table family is what a
--     reader of these three tables will expect.
--
-- NOTE ON THE MIGRATION HISTORY: two migrations in this directory declare
-- provider_blocked_dates differently (001_initial_schema.sql:82 says
-- `reason text` + uuid_generate_v4(); 20260322225907:125 says `reason TEXT
-- DEFAULT ''` + gen_random_uuid()). They are unreliable as a record of the live
-- schema. The column list mirrored below was verified directly against the live
-- database on 2026-09-04, not read from either file.
--
-- After applying, regenerate src/integrations/supabase/types.ts
-- (`supabase gen types`) so the new table appears in the generated types.

BEGIN;

-- ── provider_staff_blocked_dates ─────────────────────────────────────────────
-- One row = "this staff member is off on this date". Absence of rows = no time
-- off, which is what every existing member has.
--
-- provider_id is DENORMALISED onto this table on purpose, exactly as on
-- provider_staff_services and provider_staff_availability: it is what lets the
-- composite FK below prove the staff row belongs to the claimed provider, it is
-- what the RLS owner-check reads directly instead of joining through
-- provider_staff, and it is the column the customer-side query filters on.
CREATE TABLE public.provider_staff_blocked_dates (
  provider_id  uuid        NOT NULL,
  staff_id     uuid        NOT NULL,
  blocked_date date        NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),

  -- COMPOSITE PK (staff_id, blocked_date): the row IS the fact, nothing will
  -- ever reference a day off by id, and a surrogate key would only add a column
  -- plus a second index — the same reasoning the other two staff tables record.
  --
  -- It also carries the natural invariant, mirroring provider_blocked_dates'
  -- UNIQUE (provider_id, blocked_date): a member cannot be marked off twice for
  -- the same date. And it is the writer's ON CONFLICT target.
  --
  -- Column ORDER is deliberate. Leading with staff_id means this index also
  -- serves the 5b writer's delete, which is scoped
  -- (provider_id, staff_id, blocked_date >= today) — see the RANGE-SCOPED
  -- DELETE note below, which is the single most important thing about this
  -- table's write path.
  CONSTRAINT provider_staff_blocked_dates_pkey PRIMARY KEY (staff_id, blocked_date),

  -- COMPOSITE FK carrying provider_id, identical in shape to psa_staff_fkey and
  -- pss_staff_fkey: with a plain FK on staff_id alone, provider X's row could
  -- name provider Y's staff member, and the RLS owner-check (which can only be
  -- written against one provider_id) would happily authorise it.
  --
  -- ON DELETE CASCADE, deliberately UNLIKE bookings' NO ACTION: a day off is
  -- CONFIGURATION with no historical value, whereas a booking is HISTORY that
  -- must survive a staff member leaving. In practice cascade rarely fires at all
  -- — staff are soft-deleted via is_active, never hard-deleted.
  CONSTRAINT psbd_staff_fkey FOREIGN KEY (staff_id, provider_id)
    REFERENCES public.provider_staff (id, provider_id) ON DELETE CASCADE
);

-- ── A NOTE FOR WHOEVER WRITES 5b (and for whoever copies it afterwards) ──────
-- THE WRITER'S DELETE MUST BE RANGE-SCOPED: .gte("blocked_date", today).
--
-- The owner editor commits a member's time off with the same delete-then-insert
-- the hours and services writers use. But those two replace a member's ENTIRE
-- configuration, whereas this table also holds PAST dates — and the editor, like
-- the shop's own blocked-dates list (AvailabilityTab.tsx:63), only ever shows
-- and holds FUTURE ones.
--
-- So an unscoped `DELETE WHERE staff_id = ...`, copied faithfully from the hours
-- writer, would silently destroy the member's entire time-off history on every
-- save. The hours writer has no equivalent hazard, which is exactly why copying
-- it is the natural mistake.

-- ── Index ───────────────────────────────────────────────────────────────────
-- Serves the customer-side read: every staff member's days off for one provider
-- within the booking window, in ONE query. Never per staff member, never per
-- calendar day.
CREATE INDEX idx_psbd_provider_date
  ON public.provider_staff_blocked_dates (provider_id, blocked_date);

-- ── RLS — mirrors provider_blocked_dates' CURRENT policies ───────────────────
-- Live provider_blocked_dates policies, per 20260425000001_fix_provider_availability_rls.sql:29-49
-- (the migration that fixed them, and the latest to touch them):
--   "Anyone can view blocked dates"      FOR SELECT USING (true)
--   "Provider manages own blocked dates" FOR ALL, USING and WITH CHECK both =
--       provider_id IN (SELECT id FROM provider_profiles WHERE user_id = auth.uid())
-- Replicated below with the same IN-form shape. (provider_staff and
-- provider_staff_services use an EXISTS subquery instead; both are equivalent,
-- and we follow the table this one mirrors.)
--
-- The explicit WITH CHECK is NOT optional. 20260425000001 exists precisely
-- because the original FOR ALL policies omitted it, which made PostgREST
-- silently block every insert against provider_blocked_dates. A new table
-- repeating that omission fails the same way, and 5b would present as a broken
-- editor rather than a permissions problem.
ALTER TABLE public.provider_staff_blocked_dates ENABLE ROW LEVEL SECURITY;

-- Public SELECT is REQUIRED: the customer booking flow resolves slots pre-auth
-- and already reads provider_blocked_dates, provider_staff and
-- provider_staff_availability anonymously. These rows expose only "staff member
-- N is off on date D" — strictly less than the staff list and weekly hours the
-- provider already publishes, and (see the divergence note above) carrying no
-- free text about why.
CREATE POLICY "Anyone can view staff blocked dates"
  ON public.provider_staff_blocked_dates FOR SELECT
  USING (true);

-- Owner-only writes, checked against THIS table's provider_id. Because the
-- composite FK above guarantees provider_id agrees with the staff row's own
-- provider, checking it here is both cheaper than joining through provider_staff
-- and exactly as strong: an owner cannot smuggle in another provider's staff_id.
CREATE POLICY "Provider manages own staff blocked dates"
  ON public.provider_staff_blocked_dates FOR ALL
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
