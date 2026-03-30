
-- 1. FIX PRIVILEGE ESCALATION: Remove self-service role insertion
-- Users should NOT be able to assign themselves any role
DROP POLICY IF EXISTS "Users can insert their own role" ON public.user_roles;

-- Only admins can insert roles (via security definer function)
CREATE POLICY "Only admins can manage roles"
ON public.user_roles
FOR INSERT
TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 2. FIX PII LEAK: Replace overly broad profile SELECT policy
-- Current policy exposes phone, avatar_url etc to all authenticated users
DROP POLICY IF EXISTS "Authenticated can view display names" ON public.profiles;

-- Allow authenticated users to see only display_name (via a view or restrict columns isn't possible with RLS)
-- Instead, keep own-profile policy and add a restricted policy for others
-- We'll use a security definer function to allow fetching only display names
CREATE OR REPLACE FUNCTION public.get_display_name(_user_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT display_name FROM public.profiles WHERE user_id = _user_id LIMIT 1
$$;
