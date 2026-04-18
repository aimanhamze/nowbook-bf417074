-- Fix RLS policies for provider_profiles to allow:
-- 1. Providers to update their own profile
-- 2. Admins to update any profile

-- Drop existing UPDATE policies to avoid conflicts
DROP POLICY IF EXISTS "Providers can update their own profile" ON public.provider_profiles;
DROP POLICY IF EXISTS "Admins can update any provider profile" ON public.provider_profiles;

-- Providers can update their own profile
CREATE POLICY "Providers can update their own profile"
ON public.provider_profiles
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- Admins can update any provider profile
CREATE POLICY "Admins can update any provider profile"
ON public.provider_profiles
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role = 'admin'
  )
)
WITH CHECK (true);
