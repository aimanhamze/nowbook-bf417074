-- Academy course sessions (feat/academy-courses, Phase 1 / migration 3 of 6).
--
-- One row per dated meeting of a course. Times are Asia/Jerusalem local
-- wall-clock time (decided 2026-11-08); there is no timezone column, and
-- "now" is compared as (now() AT TIME ZONE 'Asia/Jerusalem') by the RPCs.
-- A session cannot cross midnight (end_time > start_time on one date).
--
-- period: tsrange(session_date + start_time, session_date + end_time, '[)'),
--   a STORED generated column (date + time is IMMUTABLE). Half-open bounds
--   mean back-to-back sessions (one ends 12:00, the next starts 12:00) do
--   NOT overlap. The CASE guard matters: generated columns are computed
--   before CHECKs run, and tsrange(lower > upper) raises 22000 on its own, so
--   without it an end-before-start row would fail with "range lower bound
--   must be less than or equal to range upper bound" instead of the named
--   CHECK. With it, period is NULL for such a row and the CHECK rejects it
--   (23514, academy_course_sessions_end_after_start).
--
-- Instructor double-booking: EXCLUDE USING gist (instructor_id WITH =,
--   period WITH &&). One instructor cannot be in two overlapping sessions,
--   across all of the branch's courses, which also covers two overlapping
--   sessions of the same course. Uses btree_gist (migration 20261108000001)
--   for the uuid `=`. Sessions of inactive courses still count: an archived
--   course's sessions keep holding the instructor's time.
--
-- instructor_id / provider_id are copies of the course's values, never
--   trusted from the client:
--   * BEFORE INSERT trigger overwrites both from academy_courses.
--   * After insert, the composite FKs keep them honest. A client UPDATE that
--     changes either one no longer matches a course row and is refused.
--   * (course_id, instructor_id) -> academy_courses(id, instructor_id)
--     ON UPDATE CASCADE: when the owner reassigns a course, its sessions
--     follow, and the EXCLUDE re-checks them against the new instructor. If
--     the new instructor is busy, the whole course UPDATE fails (23P01) and
--     nothing changes.
--   * (course_id, provider_id) -> academy_courses(id, provider_id)
--     ON DELETE CASCADE: deleting a course removes its sessions.
--
-- RLS:
--   * "Anyone can view academy course sessions" SELECT: the session's course
--     is active AND its provider is visible.
--   * "Providers can manage own academy course sessions" ALL TO authenticated:
--     USING owner; WITH CHECK owner AND category = 'academy' (same shape as
--     academy_courses). RLS checks the row AFTER the BEFORE trigger, so it
--     judges the course's real provider, not what the client sent.
--
-- Grants: same hardening as academy_courses.

BEGIN;

CREATE TABLE public.academy_course_sessions (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id     uuid        NOT NULL,
  provider_id   uuid        NOT NULL,
  instructor_id uuid        NOT NULL,
  session_date  date        NOT NULL,
  start_time    time        NOT NULL,
  end_time      time        NOT NULL,
  period        tsrange     GENERATED ALWAYS AS (
                  CASE WHEN end_time > start_time
                       THEN tsrange(session_date + start_time, session_date + end_time, '[)')
                  END
                ) STORED,
  created_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT academy_course_sessions_end_after_start CHECK (end_time > start_time),
  CONSTRAINT academy_course_sessions_course_provider_fkey
    FOREIGN KEY (course_id, provider_id)
    REFERENCES public.academy_courses (id, provider_id)
    ON DELETE CASCADE,
  CONSTRAINT academy_course_sessions_course_instructor_fkey
    FOREIGN KEY (course_id, instructor_id)
    REFERENCES public.academy_courses (id, instructor_id)
    ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT academy_course_sessions_no_instructor_overlap
    EXCLUDE USING gist (instructor_id WITH =, period WITH &&)
);

COMMENT ON TABLE public.academy_course_sessions IS
  'Dated meetings of an academy course. Asia/Jerusalem local time; one instructor cannot be in two overlapping sessions.';
COMMENT ON COLUMN public.academy_course_sessions.instructor_id IS
  'Copy of academy_courses.instructor_id; set by trigger, kept in sync by ON UPDATE CASCADE.';

CREATE INDEX idx_academy_course_sessions_course_date
  ON public.academy_course_sessions (course_id, session_date);

-- Copy provider_id / instructor_id from the course, ignoring client values.
CREATE OR REPLACE FUNCTION public.academy_course_sessions_fill_from_course()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  c record;
BEGIN
  SELECT ac.provider_id, ac.instructor_id INTO c
  FROM public.academy_courses ac
  WHERE ac.id = NEW.course_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'academy_course_not_found'
      USING ERRCODE = 'foreign_key_violation',
            DETAIL  = format('Course %s does not exist or is not visible to you.', NEW.course_id);
  END IF;

  NEW.provider_id   := c.provider_id;
  NEW.instructor_id := c.instructor_id;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.academy_course_sessions_fill_from_course() FROM PUBLIC;

CREATE TRIGGER trg_academy_course_sessions_fill_from_course
  BEFORE INSERT ON public.academy_course_sessions
  FOR EACH ROW EXECUTE FUNCTION public.academy_course_sessions_fill_from_course();

ALTER TABLE public.academy_course_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view academy course sessions"
  ON public.academy_course_sessions
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.academy_courses ac
      JOIN public.provider_profiles pp ON pp.id = ac.provider_id
      WHERE ac.id = academy_course_sessions.course_id
        AND ac.is_active
        AND pp.is_visible
    )
  );

CREATE POLICY "Providers can manage own academy course sessions"
  ON public.academy_course_sessions
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.provider_profiles pp
      WHERE pp.id = academy_course_sessions.provider_id
        AND pp.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.provider_profiles pp
      WHERE pp.id = academy_course_sessions.provider_id
        AND pp.user_id = auth.uid()
        AND pp.category = 'academy'
    )
  );

REVOKE TRUNCATE, TRIGGER, REFERENCES ON public.academy_course_sessions FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.academy_course_sessions FROM anon;

COMMIT;
