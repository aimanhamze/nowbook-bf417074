-- Allow admins to delete any provider profile.
-- Previously only providers could delete their own profile, causing admin
-- deletes to be silently blocked by RLS (no error, 0 rows affected).

CREATE POLICY "Admins can delete any provider profile"
ON public.provider_profiles
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role = 'admin'
  )
);
