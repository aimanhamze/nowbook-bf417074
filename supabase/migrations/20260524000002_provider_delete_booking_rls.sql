-- Allow providers to delete bookings on their own profile
CREATE POLICY "Providers can delete own bookings"
  ON public.bookings FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.provider_profiles pp
      WHERE pp.id = provider_id AND pp.user_id = auth.uid()
    )
  );
