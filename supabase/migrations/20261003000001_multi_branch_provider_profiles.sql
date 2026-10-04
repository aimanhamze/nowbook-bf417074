-- Multi-branch providers, Phase 2: let one owner (auth user) own several
-- provider_profiles rows, one per branch.
--
-- WHAT THIS DOES, IN ORDER (one transaction — any guard failure rolls back all):
--   1. GUARD  "Provider manages own availability" is a PERMISSIVE ALL policy in
--             the multi-row-safe `provider_id IN (SELECT …)` form, with both
--             USING and WITH CHECK. A permissive ALL policy's WITH CHECK governs
--             INSERT and USING + WITH CHECK govern UPDATE, so it fully covers the
--             two policies dropped in step 2.
--   2. DROP   the two LIVE-ONLY single-row provider_availability policies
--             ("Provider can insert own availability" / "Provider can update own
--             availability"). They use `provider_id = (SELECT id … WHERE user_id
--             = auth.uid())`; with two rows that scalar subquery raises
--             "more than one row returned by a subquery" and the owner could not
--             save hours. They exist in no migration — found by the Phase 0 audit.
--   3. GUARD  no policy anywhere in `public` still resolves provider_profiles by
--             user_id through a scalar subquery, and no function upserts
--             provider_profiles ON CONFLICT (user_id) (it needs the UNIQUE).
--   4. DROP   the provider-side INSERT and DELETE policies on provider_profiles.
--             Branches are created only by create-provider / create-branch
--             (service role) and deleted only by delete-provider / delete-branch
--             (service role) or the existing admin DELETE policy. No app code
--             inserts or deletes provider_profiles from the client.
--             GUARD: no INSERT/DELETE/ALL policy remains that is not admin-gated.
--   5. DROP   UNIQUE (user_id) and add a plain index for the owner lookup
--             (useProviderProfile reads every row for the signed-in user).
--
-- BEHAVIOUR: zero change for every existing provider. Every owner has exactly
-- one row today (Phase 0), and nothing here creates rows. A second row only
-- appears when an admin runs create-branch.
--
-- PRECONDITION: Phase 1 client code (useProviderProfile writes by id, no upsert
-- on user_id) is deployed. Clients still on pre-Phase-1 code lose cover/avatar
-- upload once the UNIQUE is gone (their upsert's ON CONFLICT (user_id) has no
-- matching constraint).
--
-- ROLLBACK: the UNIQUE can be re-added only while no owner has more than one row:
--   ALTER TABLE public.provider_profiles
--     ADD CONSTRAINT provider_profiles_user_id_key UNIQUE (user_id);
--   DROP INDEX IF EXISTS public.idx_provider_profiles_user_id;
-- The VERIFY file holds the two dropped provider_profiles policies verbatim
-- (live definitions, Phase 0) and a PRE-APPLY query that captures the two
-- provider_availability ones, whose exact live text is not in any migration.
--
-- OUT OF SCOPE (known drift, deliberately untouched): provider_class_schedule
-- has duplicate ALL policies. prevent_booking_conflicts is not touched — a staff
-- member working at two branches is two staff rows, and cross-branch
-- double-booking of one person is an accepted limitation.

BEGIN;

-- ── 1. GUARD: the ALL policy covers INSERT and UPDATE ──────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'provider_availability'
      AND policyname = 'Provider manages own availability'
      AND cmd        = 'ALL'
      AND permissive = 'PERMISSIVE'
      AND qual       ~* 'provider_id\s+IN\s*\(\s*SELECT'
      AND with_check ~* 'provider_id\s+IN\s*\(\s*SELECT'
  ) THEN
    RAISE EXCEPTION
      'MULTI_BRANCH_GUARD: "Provider manages own availability" is missing or not a permissive ALL policy in IN form with USING and WITH CHECK — dropping the single-row policies would lock providers out of their hours';
  END IF;
END
$$;

-- ── 2. Drop the live-only single-row provider_availability policies ────────
DROP POLICY IF EXISTS "Provider can insert own availability" ON public.provider_availability;
DROP POLICY IF EXISTS "Provider can update own availability" ON public.provider_availability;

-- ── 3. GUARD: nothing else depends on one row per user ─────────────────────
DO $$
DECLARE
  offenders text;
BEGIN
  -- Scalar-subquery policies resolving the caller's provider row by user_id.
  -- `provider_id IN (SELECT …)` and EXISTS(…) forms are multi-row safe and are
  -- not matched; a scalar lookup by provider id (the PK) is safe and is not
  -- matched either, because the pattern requires `user_id = auth.uid()`.
  SELECT string_agg(format('%I.%I', tablename, policyname), ', ')
    INTO offenders
  FROM pg_policies
  WHERE schemaname = 'public'
    AND (   coalesce(qual, '')       ~* '=\s*\(\s*SELECT[^)]*FROM\s+(public\.)?provider_profiles[^)]*user_id\s*=\s*auth\.uid\(\)'
         OR coalesce(with_check, '') ~* '=\s*\(\s*SELECT[^)]*FROM\s+(public\.)?provider_profiles[^)]*user_id\s*=\s*auth\.uid\(\)');

  IF offenders IS NOT NULL THEN
    RAISE EXCEPTION
      'MULTI_BRANCH_GUARD: single-row policies still resolve provider_profiles by user_id: %', offenders;
  END IF;

  -- Functions that upsert provider_profiles on user_id need the UNIQUE.
  SELECT string_agg(p.proname, ', ')
    INTO offenders
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.prosrc ~* 'insert\s+into\s+(public\.)?provider_profiles[^;]*on\s+conflict\s*\(\s*user_id\s*\)';

  IF offenders IS NOT NULL THEN
    RAISE EXCEPTION
      'MULTI_BRANCH_GUARD: functions upsert provider_profiles ON CONFLICT (user_id): %', offenders;
  END IF;
END
$$;

-- ── 4. provider_profiles INSERT and DELETE become admin-only ───────────────
-- Not replaced: creation is service-role only (create-provider, create-branch);
-- deletion keeps the existing "Admins can delete any provider profile".
DROP POLICY IF EXISTS "Providers can insert own profile" ON public.provider_profiles;
DROP POLICY IF EXISTS "Providers can delete own profile" ON public.provider_profiles;

DO $$
DECLARE
  offenders text;
BEGIN
  SELECT string_agg(format('%s (%s)', policyname, cmd), ', ')
    INTO offenders
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename  = 'provider_profiles'
    AND cmd IN ('INSERT', 'DELETE', 'ALL')
    AND (coalesce(qual, '') || coalesce(with_check, '')) !~* 'role\s*=\s*''admin''';

  IF offenders IS NOT NULL THEN
    RAISE EXCEPTION
      'MULTI_BRANCH_GUARD: non-admin INSERT/DELETE policies remain on provider_profiles: %', offenders;
  END IF;
END
$$;

-- ── 5. One owner, many rows ────────────────────────────────────────────────
-- No IF EXISTS: the live name was confirmed in Phase 0, and if anything (an
-- unknown FK) depends on this constraint the drop must fail loudly.
ALTER TABLE public.provider_profiles
  DROP CONSTRAINT provider_profiles_user_id_key;

CREATE INDEX IF NOT EXISTS idx_provider_profiles_user_id
  ON public.provider_profiles (user_id);

COMMIT;
