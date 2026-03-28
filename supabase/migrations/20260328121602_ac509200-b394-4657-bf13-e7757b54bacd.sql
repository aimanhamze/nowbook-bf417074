CREATE POLICY "Providers can delete bookings for their business"
ON public.bookings
FOR DELETE
TO authenticated
USING (provider_id IN (
  SELECT id::text FROM provider_profiles WHERE user_id = auth.uid()
));