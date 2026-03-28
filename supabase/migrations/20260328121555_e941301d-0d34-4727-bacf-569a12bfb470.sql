CREATE POLICY "Providers can update bookings for their business"
ON public.bookings
FOR UPDATE
TO authenticated
USING (provider_id IN (
  SELECT id::text FROM provider_profiles WHERE user_id = auth.uid()
));