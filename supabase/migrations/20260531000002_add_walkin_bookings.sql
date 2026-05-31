-- Walk-in bookings: a provider creates a booking for a customer who has no app
-- account. Such rows have user_id IS NULL and carry the customer's details in
-- new guest columns. They are always inserted as 'confirmed' (the provider is
-- deliberately creating them — there is no one to approve, and no account to
-- notify). Availability / conflict / capacity rules still apply via the existing
-- prevent_booking_conflicts trigger; lead time is already bypassed for providers.

-- ── 1. Allow walk-in rows: user_id becomes nullable ──────────────────────────
-- App bookings still set user_id = auth.uid(); only provider-created walk-ins
-- leave it NULL. The new INSERT policy below gates who may create NULL rows.
ALTER TABLE public.bookings
  ALTER COLUMN user_id DROP NOT NULL;

-- ── 2. Guest detail columns (nullable; NULL for normal app bookings) ─────────
-- guest_notes is intentionally separate from treatment_notes (the provider's
-- private post-visit log) — different purpose, do not overload.
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS customer_name  text,
  ADD COLUMN IF NOT EXISTS customer_phone text,
  ADD COLUMN IF NOT EXISTS guest_notes    text;

-- ── 3. INSERT policy for provider-created bookings ───────────────────────────
-- The existing "Users can create their own bookings" (WITH CHECK auth.uid() =
-- user_id) is left untouched and still covers normal customer bookings. This
-- adds a parallel path: a provider may insert a booking for any provider_id they
-- own (provider_id is uuid → SELECT id, no cast). This is the ONLY way a
-- user_id IS NULL row can be created, which is what makes the approval-skip in
-- step 4 safe from abuse.
DROP POLICY IF EXISTS "Providers can create bookings for their business" ON public.bookings;
CREATE POLICY "Providers can create bookings for their business"
  ON public.bookings FOR INSERT TO authenticated
  WITH CHECK (
    provider_id IN (
      SELECT id FROM public.provider_profiles WHERE user_id = auth.uid()
    )
  );

-- ── 4. Approval trigger: never downgrade a walk-in to 'pending' ──────────────
-- CREATE OR REPLACE keeps the existing trg_enforce_booking_approval_status
-- binding intact (no DROP FUNCTION). The only change is the first guard: a
-- walk-in (user_id IS NULL) keeps its 'confirmed' status regardless of the
-- provider's requires_booking_approval setting. Customer inserts always carry a
-- non-NULL user_id, so their behavior is unchanged.
CREATE OR REPLACE FUNCTION public.enforce_booking_approval_status()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_requires_approval boolean;
BEGIN
  -- Provider-created walk-in: deliberately confirmed, no one to approve.
  IF NEW.user_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Only relevant for newly-created bookings claiming a slot.
  IF NEW.status <> 'confirmed' THEN
    RETURN NEW;
  END IF;

  SELECT requires_booking_approval INTO v_requires_approval
  FROM public.provider_profiles
  WHERE id = NEW.provider_id;

  IF v_requires_approval IS TRUE THEN
    NEW.status := 'pending';
  END IF;

  RETURN NEW;
END;
$$;
