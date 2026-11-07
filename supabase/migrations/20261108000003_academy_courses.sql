-- Academy courses (feat/academy-courses, Phase 1 / migration 2 of 6).
--
-- A course belongs to one academy branch and is taught by one instructor of
-- that same branch. Seats, price and the cancellation window live here; the
-- dated meetings are academy_course_sessions (migration 3) and sign-ups are
-- course_registrations (migration 4).
--
-- Keys:
--   * provider_id -> provider_profiles(id) ON DELETE CASCADE.
--   * (instructor_id, provider_id) -> academy_instructors(id, provider_id).
--     Composite, so the instructor must belong to the course's own branch;
--     the database refuses a cross-branch instructor even if RLS were bypassed.
--     NO ACTION on delete: an instructor with courses cannot be hard-deleted
--     (deactivate instead). Deleting the whole branch still works, because
--     the provider_profiles cascade removes courses and instructors in the
--     same statement and NO ACTION is only checked at statement end.
--   * UNIQUE (id, provider_id) and UNIQUE (id, instructor_id) are the targets
--     of migration 3's composite FKs; the second one, with ON UPDATE CASCADE,
--     makes sessions follow a course's instructor change, so the instructor
--     overlap EXCLUDE re-checks against the new instructor.
--
-- Location: location_type is 'physical' (address required, no link) or
--   'online' (https link required, no address). A single CHECK keeps the two
--   columns consistent. https-only stops javascript:/http: links from being
--   rendered as a "join" button.
--
-- Money/seats: price is display-only (payment happens at the venue), NULL
--   means "no price shown". max_seats > 0, cancellation_hours >= 0.
--
-- Inactive instructor guard (trigger): a course cannot be created with, moved
--   to, or re-activated under an instructor whose is_active = false. It is a
--   trigger, not a CHECK, because it reads another table. Deactivating an
--   instructor who already has active courses is deliberately NOT blocked
--   (decided 2026-11-08); existing courses keep running until the owner
--   reassigns or deactivates them.
--
-- RLS:
--   * "Anyone can view active academy courses" SELECT: the course is active
--     AND its provider is visible (provider_profiles.is_visible), so hiding
--     a branch hides its courses from the public too.
--   * "Providers can manage own academy courses" ALL TO authenticated.
--     USING = caller owns provider_id (so the owner always sees, edits and
--     deletes their own rows, active or not, visible or not).
--     WITH CHECK = caller owns provider_id AND that provider's category is
--     'academy', so only academy branches can create a course or save one.
--     Changing a branch's category away from academy while it has live
--     registrations is refused separately (migration 6).
--
-- Grants: same hardening as academy_instructors (no TRUNCATE/TRIGGER/
--   REFERENCES for client roles; anon read-only).

BEGIN;

CREATE TABLE public.academy_courses (
  id                 uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id        uuid          NOT NULL
                                   REFERENCES public.provider_profiles(id) ON DELETE CASCADE,
  instructor_id      uuid          NOT NULL,
  name               text          NOT NULL
                                   CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  description        text          CHECK (description IS NULL OR char_length(description) <= 4000),
  image_url          text,
  location_type      text          NOT NULL
                                   CHECK (location_type IN ('physical', 'online')),
  address            text,
  online_url         text,
  price              numeric(10,2) CHECK (price IS NULL OR price >= 0),
  max_seats          integer       NOT NULL CHECK (max_seats > 0),
  cancellation_hours integer       NOT NULL DEFAULT 24 CHECK (cancellation_hours >= 0),
  is_active          boolean       NOT NULL DEFAULT true,
  created_at         timestamptz   NOT NULL DEFAULT now(),
  updated_at         timestamptz   NOT NULL DEFAULT now(),

  CONSTRAINT academy_courses_location_consistency CHECK (
    (location_type = 'physical'
       AND address IS NOT NULL AND char_length(btrim(address)) > 0
       AND online_url IS NULL)
    OR
    (location_type = 'online'
       AND online_url IS NOT NULL AND online_url ~* '^https://[^[:space:]]+$'
       AND address IS NULL)
  ),
  CONSTRAINT academy_courses_instructor_same_branch_fkey
    FOREIGN KEY (instructor_id, provider_id)
    REFERENCES public.academy_instructors (id, provider_id),
  CONSTRAINT academy_courses_id_provider_id_key   UNIQUE (id, provider_id),
  CONSTRAINT academy_courses_id_instructor_id_key UNIQUE (id, instructor_id)
);

COMMENT ON TABLE public.academy_courses IS
  'Courses of an academy branch. Dated meetings are in academy_course_sessions.';
COMMENT ON COLUMN public.academy_courses.price IS
  'Display only; paid at the venue. NULL = no price shown.';
COMMENT ON COLUMN public.academy_courses.cancellation_hours IS
  'Customers may cancel until this many hours before the FIRST session starts (Asia/Jerusalem).';

CREATE INDEX idx_academy_courses_provider_active
  ON public.academy_courses (provider_id, is_active);
CREATE INDEX idx_academy_courses_instructor
  ON public.academy_courses (instructor_id);

-- updated_at, via the project's existing helper.
CREATE TRIGGER trg_academy_courses_updated_at
  BEFORE UPDATE ON public.academy_courses
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Refuse an inactive instructor.
CREATE OR REPLACE FUNCTION public.academy_courses_require_active_instructor()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.is_active
     AND (TG_OP = 'INSERT'
          OR NEW.instructor_id IS DISTINCT FROM OLD.instructor_id
          OR OLD.is_active IS DISTINCT FROM true)
     AND NOT EXISTS (
       SELECT 1 FROM public.academy_instructors i
       WHERE i.id = NEW.instructor_id AND i.is_active
     )
  THEN
    RAISE EXCEPTION 'academy_instructor_inactive'
      USING ERRCODE = 'check_violation',
            DETAIL  = format('Instructor %s is inactive or does not exist.', NEW.instructor_id),
            HINT    = 'Activate the instructor or choose another one.';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.academy_courses_require_active_instructor() FROM PUBLIC;

CREATE TRIGGER trg_academy_courses_require_active_instructor
  BEFORE INSERT OR UPDATE OF instructor_id, is_active ON public.academy_courses
  FOR EACH ROW EXECUTE FUNCTION public.academy_courses_require_active_instructor();

ALTER TABLE public.academy_courses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view active academy courses"
  ON public.academy_courses
  FOR SELECT
  USING (
    is_active
    AND EXISTS (
      SELECT 1 FROM public.provider_profiles pp
      WHERE pp.id = academy_courses.provider_id
        AND pp.is_visible
    )
  );

CREATE POLICY "Providers can manage own academy courses"
  ON public.academy_courses
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.provider_profiles pp
      WHERE pp.id = academy_courses.provider_id
        AND pp.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.provider_profiles pp
      WHERE pp.id = academy_courses.provider_id
        AND pp.user_id = auth.uid()
        AND pp.category = 'academy'
    )
  );

REVOKE TRUNCATE, TRIGGER, REFERENCES ON public.academy_courses FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.academy_courses FROM anon;

COMMIT;
