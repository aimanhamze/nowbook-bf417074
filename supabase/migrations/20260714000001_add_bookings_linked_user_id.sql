-- Phase 1 of walk-in → account linking.
--
-- Provider-created walk-ins are stored with user_id IS NULL and the customer's
-- details as free text (customer_name / customer_phone). This migration adds a
-- SEPARATE nullable column, linked_user_id, that a later phase (Phase 2 match
-- trigger, Phase 4 signup RPC) will set to a matching account so that customer
-- can SEE the booking in their own list.
--
-- SAFETY / SCOPE (additive only):
--   * linked_user_id is NULL for every existing row → zero behavior change today.
--   * We extend ONLY the SELECT policy so a linked customer can VIEW the row.
--   * INSERT / UPDATE / DELETE policies are intentionally LEFT UNTOUCHED. Their
--     customer arm is auth.uid() = user_id, and walk-ins keep user_id NULL, so a
--     linked customer can never update or delete a provider-owned walk-in. This
--     is the "see-but-not-alter" boundary.
--   * The prevent_booking_conflicts trigger keys on user_id (not linked_user_id),
--     so linking cannot introduce false booking conflicts → no trigger change.
--
-- After applying, regenerate src/integrations/supabase/types.ts
-- (`supabase gen types`) so linked_user_id appears in the generated types.

BEGIN;

-- ── 1. Additive column ───────────────────────────────────────────────────────
-- ON DELETE SET NULL (NOT CASCADE): if the linked customer account is deleted,
-- the provider's booking must survive — the provider owns that record — so we
-- only drop the link, never the row. Contrast user_id, which is ON DELETE
-- CASCADE because a customer's OWN self-booked rows go with the account.
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS linked_user_id uuid NULL
  REFERENCES auth.users(id) ON DELETE SET NULL;

-- ── 2. Extend the SELECT policy ONLY ─────────────────────────────────────────
-- Reproduces the LIVE "Users can view own bookings" policy VERBATIM (own row OR
-- the provider-owns-this-booking EXISTS check) and adds exactly ONE line:
--   OR (auth.uid() = linked_user_id)
-- Nothing else changes. INSERT/UPDATE/DELETE policies are not referenced here.
DROP POLICY IF EXISTS "Users can view own bookings" ON public.bookings;
CREATE POLICY "Users can view own bookings" ON public.bookings
  FOR SELECT USING (
    (auth.uid() = user_id)
    OR (auth.uid() = linked_user_id)
    OR (EXISTS (
      SELECT 1 FROM public.provider_profiles pp
      WHERE pp.id = bookings.provider_id AND pp.user_id = auth.uid()
    ))
  );

COMMIT;
