-- Drop existing INSERT policy
DROP POLICY IF EXISTS "Providers can insert their own profile" ON public.provider_profiles;

-- Only admins can create new provider profiles
CREATE POLICY "Only admins can create provider profiles"
ON public.provider_profiles
FOR INSERT
TO authenticated
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- Admins can view all provider profiles (already covered by "Anyone can view")
-- Admins can update any provider profile
CREATE POLICY "Admins can update any provider profile"
ON public.provider_profiles
FOR UPDATE
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role));

-- Admins can delete provider profiles
CREATE POLICY "Admins can delete provider profiles"
ON public.provider_profiles
FOR DELETE
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role));