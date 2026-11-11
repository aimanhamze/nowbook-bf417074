-- Course registrations (feat/academy-courses, Phase 1 / migration 4 of 6).
--
-- One row per customer sign-up to a course. Clients can READ rows (their own,
-- or their branch's) but can never write them: there are no INSERT/UPDATE/
-- DELETE policies and no write grants. Every write goes through the
-- SECURITY DEFINER RPCs in migration 5 (register / cancel / decide), which
-- take the per-course lock and enforce seats and the cancellation window.
--
-- Status lifecycle:
--   pending   -> confirmed | rejected   (provider decides; decided_at set)
--   pending   -> cancelled              (customer or provider; cancelled_by set)
--   confirmed -> cancelled              (customer or provider; cancelled_by set)
-- Consistency CHECKs (beyond the spec's status/cancelled_by lists):
--   * cancelled_by is set if and only if status = 'cancelled'.
--   * confirmed/rejected rows carry decided_at. A cancelled row may or may
--     not have it (cancelled after confirmation vs. while pending).
--
-- One active registration per customer per course:
--   partial UNIQUE (course_id, user_id) WHERE status IN ('pending','confirmed').
--   Cancelled/rejected rows stay as history and do not block a new sign-up.
--
-- Keys:
--   * (course_id, provider_id) -> academy_courses(id, provider_id)
--     ON DELETE CASCADE: provider_id always matches the course's branch,
--     and deleting a course removes its registrations.
--   * user_id -> auth.users(id) ON DELETE CASCADE.
--
-- RLS (SELECT only, TO authenticated):
--   * "Customers can view own course registrations": user_id = auth.uid().
--   * "Providers can view own branch course registrations": caller owns
--     provider_id. Deliberately NOT gated on category/visibility: a branch
--     that changes category or is hidden must still see its sign-ups.
--
-- Grants: anon gets nothing; authenticated gets SELECT only.

BEGIN;

CREATE TABLE public.course_registrations (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id    uuid        NOT NULL,
  provider_id  uuid        NOT NULL,
  user_id      uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status       text        NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending', 'confirmed', 'rejected', 'cancelled')),
  cancelled_by text        CHECK (cancelled_by IS NULL OR cancelled_by IN ('customer', 'provider')),
  decided_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT course_registrations_cancelled_by_iff_cancelled
    CHECK ((status = 'cancelled') = (cancelled_by IS NOT NULL)),
  CONSTRAINT course_registrations_decided_has_decided_at
    CHECK (status NOT IN ('confirmed', 'rejected') OR decided_at IS NOT NULL),
  CONSTRAINT course_registrations_course_provider_fkey
    FOREIGN KEY (course_id, provider_id)
    REFERENCES public.academy_courses (id, provider_id)
    ON DELETE CASCADE
);

COMMENT ON TABLE public.course_registrations IS
  'Customer sign-ups to academy courses. Read-only for clients; written only by the course registration RPCs.';

CREATE UNIQUE INDEX course_registrations_one_active_per_user
  ON public.course_registrations (course_id, user_id)
  WHERE status IN ('pending', 'confirmed');

CREATE INDEX idx_course_registrations_course_status
  ON public.course_registrations (course_id, status);
CREATE INDEX idx_course_registrations_user_status
  ON public.course_registrations (user_id, status);

CREATE TRIGGER trg_course_registrations_updated_at
  BEFORE UPDATE ON public.course_registrations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.course_registrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Customers can view own course registrations"
  ON public.course_registrations
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Providers can view own branch course registrations"
  ON public.course_registrations
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.provider_profiles pp
      WHERE pp.id = course_registrations.provider_id
        AND pp.user_id = auth.uid()
    )
  );

REVOKE ALL ON public.course_registrations FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES
  ON public.course_registrations FROM authenticated;

COMMIT;
