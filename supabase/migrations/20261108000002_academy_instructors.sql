-- Academy instructors (feat/academy-courses, Phase 1 / migration 1 of 6).
--
-- One row per instructor of an academy branch. Instructors are display
-- records (name, bio, photo), not app users: there is deliberately NO phone
-- or any other contact column, so nothing here is PII beyond a display name.
--
-- Keys:
--   * provider_id -> provider_profiles(id) ON DELETE CASCADE, same as
--     provider_staff: deleting a branch removes its instructors.
--   * UNIQUE (id, provider_id) is the target of the composite FK from
--     academy_courses (migration 2), so a course can only point at an
--     instructor of its OWN branch, enforced by the database rather than
--     by the client.
--
-- RLS (mirrors provider_staff):
--   * "Anyone can view academy instructors" SELECT USING (true). Inactive
--     instructors stay readable so historical courses still render a name;
--     the UI filters on is_active.
--   * "Providers can manage own academy instructors" ALL, USING and
--     WITH CHECK both require the caller to own provider_id, so an owner
--     cannot move a row to, or create one under, another branch.
--
-- Grants: Supabase's default grants give anon/authenticated every table
-- privilege and leave RLS to gate rows. TRUNCATE is not gated by RLS, so it
-- is revoked here, along with TRIGGER/REFERENCES, and anon loses write
-- privileges outright (an anonymous caller can never own a branch).

BEGIN;

CREATE TABLE public.academy_instructors (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id   uuid        NOT NULL
                            REFERENCES public.provider_profiles(id) ON DELETE CASCADE,
  name          text        NOT NULL
                            CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  bio           text        CHECK (bio IS NULL OR char_length(bio) <= 2000),
  photo_url     text,
  is_active     boolean     NOT NULL DEFAULT true,
  display_order integer     NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT academy_instructors_id_provider_id_key UNIQUE (id, provider_id)
);

COMMENT ON TABLE public.academy_instructors IS
  'Instructors of an academy branch. Display-only records; no contact details by design.';
COMMENT ON COLUMN public.academy_instructors.photo_url IS
  'Public URL in the provider-images bucket. NULL = show initials.';

CREATE INDEX idx_academy_instructors_provider_order
  ON public.academy_instructors (provider_id, is_active, display_order);

ALTER TABLE public.academy_instructors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view academy instructors"
  ON public.academy_instructors
  FOR SELECT
  USING (true);

CREATE POLICY "Providers can manage own academy instructors"
  ON public.academy_instructors
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.provider_profiles pp
      WHERE pp.id = academy_instructors.provider_id
        AND pp.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.provider_profiles pp
      WHERE pp.id = academy_instructors.provider_id
        AND pp.user_id = auth.uid()
    )
  );

REVOKE TRUNCATE, TRIGGER, REFERENCES ON public.academy_instructors FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.academy_instructors FROM anon;

COMMIT;
