-- ============================================================================
-- Admin: provider last-login timestamps
-- ----------------------------------------------------------------------------
-- last_sign_in_at lives only in auth.users, which is NOT client-readable. This
-- SECURITY DEFINER function exposes it to admins — and ONLY the two non-sensitive
-- columns (user_id + last_sign_in_at). auth.users also holds email, phone,
-- encrypted_password, tokens and metadata: NONE of those are selected here.
--
-- Same hardening as the other admin_* RPCs:
--   * SECURITY DEFINER + SET search_path = public, auth, pg_temp.
--   * FIRST statement gates on has_role(auth.uid(),'admin'); non-admins get
--     RAISE 42501 and no data.
--   * REVOKE from public/anon; GRANT EXECUTE to authenticated (gate does the
--     real authorization).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.admin_provider_last_logins()
RETURNS TABLE (
  user_id         uuid,
  last_sign_in_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'admin only' USING ERRCODE = '42501';
  END IF;

  -- Return EXACTLY two columns from auth.users — nothing else.
  RETURN QUERY
  SELECT u.id, u.last_sign_in_at
  FROM auth.users u;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_provider_last_logins() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_provider_last_logins() TO authenticated;
