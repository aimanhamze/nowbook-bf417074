-- P2 — profiles: a signed-in user reads only the profiles they have a reason
-- to read.
--
-- ORDER: 20261117000008 (bookings user_id index) first.
--        Then VERIFY §0 → this file → VERIFY §A → §B1 → §B2 (DEV only) → §C,
--        on DEV and then on PROD. Then the smoke list at the end of VERIFY.
-- Safe to re-run: CREATE OR REPLACE, REVOKE/GRANT and ALTER POLICY ... USING
-- are idempotent; the rename is guarded.
-- Rollback: VERIFY §E.
--
-- WHY. P1 (20261117000005) closed profiles to logged-out callers but kept
-- USING (true) for authenticated: any signed-in customer can still read every
-- other customer's name and phone. Signing up needs only a phone number.
--
-- THE RULE. A signed-in user may read a profile row when it is
--   1. their OWN row, or
--   2. they are an ADMIN, or
--   3. they OWN A BRANCH that the profile's user has dealt with:
--        a booking            bookings.user_id         (ANY status)
--        a package            customer_packages.customer_id (ANY status)
--        a course registration course_registrations.user_id (ANY status)
--      at ANY branch of that owner (provider_profiles.user_id = the caller).
-- Any status on purpose: the provider's customer list and booking history
-- include cancelled bookings, and a customer whose only booking was cancelled
-- must keep their name there (ruling 2026-11-17).
--
-- WHO READS profiles, AND UNDER WHICH PART OF THE RULE (checked 2026-11-17):
--   own row ........ Auth.tsx afterAuth, NameGate, Index, Profile,
--                    BookAppointment, useCancelBooking
--   admin .......... AdminUsers (select *)
--   booking ........ useProviderBookings (calendar, pending, history) and
--                    provider_customers() — SECURITY INVOKER, so it reads
--                    profiles under THIS policy; it only ever asks for the
--                    user_ids of the provider's own bookings, which is
--                    exactly the booking relationship. VERIFY §B1 T3 proves
--                    its output is unchanged.
--   package ........ useCustomerPackages
--   course ......... customerContacts → useAcademyRegistrations
--   NOT under this policy at all:
--     * edge functions — waitlist-dispatch, whatsapp-booking-confirm and
--       whatsapp-booking-reminder read profiles through their SERVICE-ROLE
--       client. No edge function builds a client from the caller's JWT; the
--       anon-key clients are used for auth.getUser() only.
--     * SECURITY DEFINER SQL — admin_* functions, waitlist_provider_day (the
--       provider's waiting-list names), package_request_purchase,
--       link_walkin_to_account, handle_new_user.
--     * walk-ins and linked walk-ins — name and phone live on the booking;
--       no reader looks a linked_user_id up in profiles.
--     * staff — provider_staff has no user id; staff are not accounts.
--
-- WHAT EACH ROLE SEES AFTERWARDS
--   customer ........ their own row. Never another customer, including
--                     another customer of the same provider.
--   provider-owner .. their own row + everyone with a booking, package or
--                     course registration at any of their branches. Never
--                     another provider's customers.
--   admin ........... everyone.        logged out ... nothing (P1).
--
-- WHY A HELPER FUNCTION. Written inline, the three EXISTS would run under the
-- CALLER's row-level security on bookings, customer_packages and
-- course_registrations — policies that differ between DEV and PROD. A
-- SECURITY DEFINER helper depends on the data only. It takes the customer's
-- id and always uses auth.uid() as the owner, so calling it directly reveals
-- only "is this user one of MY customers" — never anything about another
-- provider. authenticated needs EXECUTE because the policy calls it as the
-- querying role (same reason has_role keeps its grant).
--
-- COST. The policy is evaluated per row that survives the query's own filter.
-- Every provider read filters user_id IN (batch), which uses the unique index
-- on profiles.user_id first, so the helper runs once per requested customer:
-- at most three index probes (bookings.user_id — 20261117000008 —,
-- customer_packages.customer_id, course_registrations.user_id) plus the
-- owner's branches by provider_profiles.user_id. auth.uid() and has_role are
-- wrapped in (SELECT …), so they are evaluated once per query, and they come
-- BEFORE the helper in the OR: for an own-row read or an admin the helper is
-- not reached. VERIFY §0b checks the five indexes; §C shows the real plan.
--
-- KNOWN GAP, NOT FIXED HERE (ticket, HIGH, own branch right after this): a
-- provider can CREATE the relationship. The provider INSERT policy on
-- bookings checks only that the branch is theirs, not that user_id is NULL,
-- and "Provider manages own customer packages" is FOR ALL with the same
-- check — so a provider who knows a user id (review authors' ids are
-- publicly readable: second ticket) can insert a row for it and then read
-- that profile. Far narrower than before P2, and provider accounts are
-- admin-created, but it is the remaining way in.
--
-- THE POLICY IS RENAMED. "Users can view any profile" would now be a lie that
-- someone later "fixes" back to true. New name:
--   "Profiles: own row, admin, or my customers"

BEGIN;

-- ── 1. Helper ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_my_customer(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
  SELECT p_user_id IS NOT NULL
     AND (SELECT auth.uid()) IS NOT NULL
     AND (
           EXISTS (
             SELECT 1
             FROM public.bookings b
             JOIN public.provider_profiles pp ON pp.id = b.provider_id
             WHERE b.user_id = p_user_id
               AND pp.user_id = (SELECT auth.uid())
           )
        OR EXISTS (
             SELECT 1
             FROM public.customer_packages cp
             JOIN public.provider_profiles pp ON pp.id = cp.provider_id
             WHERE cp.customer_id = p_user_id
               AND pp.user_id = (SELECT auth.uid())
           )
        OR EXISTS (
             SELECT 1
             FROM public.course_registrations r
             JOIN public.provider_profiles pp ON pp.id = r.provider_id
             WHERE r.user_id = p_user_id
               AND pp.user_id = (SELECT auth.uid())
           )
         );
$fn$;

COMMENT ON FUNCTION public.is_my_customer(uuid) IS
  'True when the CALLER (auth.uid()) owns a branch at which p_user_id has a booking, a package or a course registration, in any status. Used by the SELECT policy on profiles. SECURITY DEFINER so the answer never depends on the caller''s RLS on those tables.';

-- PUBLIC, anon and authenticated BY NAME (the named default grants survive a
-- revoke from PUBLIC), then only the role the policy runs as.
REVOKE ALL ON FUNCTION public.is_my_customer(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_my_customer(uuid) TO authenticated;

-- ── 2. Policy ──────────────────────────────────────────────────────────────
-- Renamed only if it still carries the old name, so a re-run is a no-op.
DO $rename$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies
             WHERE schemaname = 'public' AND tablename = 'profiles'
               AND policyname = 'Users can view any profile') THEN
    ALTER POLICY "Users can view any profile" ON public.profiles
      RENAME TO "Profiles: own row, admin, or my customers";
  END IF;
END;
$rename$;

-- Cheapest test first: own row, then admin (once per query), then the helper.
ALTER POLICY "Profiles: own row, admin, or my customers" ON public.profiles
  TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR (SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role))
    OR public.is_my_customer(user_id)
  );

COMMIT;
