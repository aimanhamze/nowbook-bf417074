-- Fix RLS policies for provider_availability and provider_blocked_dates.
-- The original FOR ALL policies lacked an explicit WITH CHECK clause, which
-- caused Supabase/PostgREST to silently block INSERT operations (upserts).

-- ── provider_availability ────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Anyone can view availability"           ON public.provider_availability;
DROP POLICY IF EXISTS "Providers can manage own availability"  ON public.provider_availability;
DROP POLICY IF EXISTS "Providers can manage their availability" ON public.provider_availability;
DROP POLICY IF EXISTS "Provider manages own availability"      ON public.provider_availability;

CREATE POLICY "Anyone can view availability"
  ON public.provider_availability FOR SELECT
  USING (true);

CREATE POLICY "Provider manages own availability"
  ON public.provider_availability FOR ALL
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

-- ── provider_blocked_dates ───────────────────────────────────────────────────
DROP POLICY IF EXISTS "Anyone can view blocked dates"             ON public.provider_blocked_dates;
DROP POLICY IF EXISTS "Providers can manage own blocked dates"    ON public.provider_blocked_dates;
DROP POLICY IF EXISTS "Providers can manage their blocked dates"  ON public.provider_blocked_dates;
DROP POLICY IF EXISTS "Provider manages own blocked dates"        ON public.provider_blocked_dates;

CREATE POLICY "Anyone can view blocked dates"
  ON public.provider_blocked_dates FOR SELECT
  USING (true);

CREATE POLICY "Provider manages own blocked dates"
  ON public.provider_blocked_dates FOR ALL
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
