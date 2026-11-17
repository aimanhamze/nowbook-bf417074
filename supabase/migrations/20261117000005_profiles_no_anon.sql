-- P1 — profiles: no access for logged-out callers.
--
-- ORDER: VERIFY §0 → this file → VERIFY §A → §B1 (→ §B2 on DEV only),
--        on DEV and then on PROD. Then the smoke list at the end of VERIFY.
-- Safe to re-run: ALTER POLICY ... TO and REVOKE are no-ops when applied.
-- Rollback: VERIFY §E.
--
-- WHY. profiles holds every customer's display_name and PHONE (2,466 rows
-- with a phone on PROD, 2026-11-17). The table's only SELECT policy,
--   "Users can view any profile"  FOR SELECT TO {public} USING (true)
-- applies to anon, and anon holds the table-level SELECT grant (Supabase's
-- default privileges grant every table privilege to anon by name). So one
-- request with the public anon key — the key shipped in the app bundle —
-- returns every customer's name and phone number.
--
-- WHAT THIS DOES — two statements, nothing else:
--   1. The SELECT policy now applies to authenticated only. USING (true) is
--      deliberately kept: a signed-in user can still read any profile, exactly
--      as today, so nothing in the app changes for a logged-in user. Narrowing
--      it to "own row / admin / my customers" is P2, its own migration.
--   2. anon loses EVERY privilege on the table, not only SELECT. anon also
--      held INSERT / UPDATE / DELETE / TRUNCATE; RLS blocked the first three,
--      and nothing logged-out writes a profile.
-- The other policies on profiles (update own, insert own) are NOT touched.
--
-- WHO READS profiles (checked 2026-11-17 — every one needs a session):
--   own row ...... Auth.tsx afterAuth (right after sign-in), NameGate
--                  (enabled only for a signed-in customer), Index and Profile
--                  ("user-profile", enabled: !!user), BookAppointment (inside
--                  `if (user)`, on a ProtectedRoute), useCancelBooking.
--   provider ..... useProviderBookings, customerContacts, useCustomerPackages
--                  (their customers' name / phone), provider_customers()
--                  (SECURITY INVOKER, granted to authenticated only).
--   admin ........ AdminUsers (select *), behind AdminRoute.
--   No embedded select (`profiles(...)` inside another table's select)
--   exists in src/. The public provider page, the booking flow before login,
--   the academy pages and /auth read no profile: review author names are
--   stored on the review itself.
--   Edge functions (waitlist-dispatch, whatsapp-booking-confirm,
--   whatsapp-booking-reminder) read profiles with the SERVICE ROLE, which
--   bypasses both the grant and RLS — unaffected.
--   SQL: handle_new_user, link_walkin_to_account, get_display_name,
--   package_request_purchase, the admin_* functions and waitlist_provider_day
--   are SECURITY DEFINER — unaffected. VERIFY §0c / §0d confirm on each
--   database that no policy of another table and no anon-callable INVOKER
--   function depends on anon reading profiles.
--
-- ONE BEHAVIOUR CHANGE TO KNOW ABOUT. A request sent with NO usable session
-- (supabase-js falls back to the anon key) used to return the row; it now
-- returns 401 "permission denied for table profiles". Every reader above
-- runs with a session, so this only matters for a DEAD session whose `user`
-- is still in React state. There, NameGate ignores the error and treats the
-- missing row as "no name yet", so that customer would see the name screen
-- instead of the app. Today that case works only because of the hole. Flagged for a small client follow-up (treat a failed read as
-- "unknown", not "nameless"); not part of this migration.

BEGIN;

ALTER POLICY "Users can view any profile" ON public.profiles TO authenticated;

REVOKE ALL ON public.profiles FROM anon;

COMMIT;
