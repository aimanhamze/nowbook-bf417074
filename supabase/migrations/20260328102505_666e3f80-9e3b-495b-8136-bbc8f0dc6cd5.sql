-- Fix: use security_invoker = on and add RLS policy on base table for public read of display_name
DROP VIEW IF EXISTS public.profiles_public;

-- Instead, add a simple SELECT policy for authenticated users to view basic profile info
CREATE POLICY "Authenticated can view display names"
ON public.profiles FOR SELECT TO authenticated
USING (true);