
-- Allow providers to view profiles of customers who have bookings with them
CREATE POLICY "Providers can view their customers profiles"
ON public.profiles
FOR SELECT
TO authenticated
USING (
  user_id IN (
    SELECT b.user_id FROM public.bookings b
    WHERE b.provider_id IN (
      SELECT pp.id::text FROM public.provider_profiles pp
      WHERE pp.user_id = auth.uid()
    )
  )
);
