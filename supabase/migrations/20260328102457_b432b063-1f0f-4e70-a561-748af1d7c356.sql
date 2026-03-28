-- Allow anyone authenticated to view display_name from profiles (for booking display)
-- We'll create a view that exposes only non-sensitive fields
CREATE OR REPLACE VIEW public.profiles_public
WITH (security_invoker = off) AS
  SELECT user_id, display_name, avatar_url
  FROM public.profiles;

-- Grant access to the view
GRANT SELECT ON public.profiles_public TO authenticated;
GRANT SELECT ON public.profiles_public TO anon;