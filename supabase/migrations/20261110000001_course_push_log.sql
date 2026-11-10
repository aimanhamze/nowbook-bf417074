-- Course push claim log (feat/academy-courses, customer push).
--
-- One row per (registration, event) that the notify-course-registration Edge
-- Function has pushed — or tried to. The function INSERTs the row BEFORE
-- sending (ON CONFLICT DO NOTHING), so a second call for the same
-- registration + event finds the row and sends nothing: at most one push per
-- registration + event, even under retries or concurrent calls. A failed
-- delivery keeps its row on purpose (no retry storm; the bell row is still
-- there).
--
-- notification_id is the notifications row the push repeated (the one the
-- registration RPC wrote), kept for tracing.
--
-- Access: service role only. RLS is on with no policies, and anon /
-- authenticated get no privileges at all; clients never read or write it.

BEGIN;

CREATE TABLE public.course_push_log (
  registration_id uuid        NOT NULL
                              REFERENCES public.course_registrations (id) ON DELETE CASCADE,
  event           text        NOT NULL
                              CHECK (event IN ('new', 'confirmed', 'rejected',
                                               'cancelled_by_provider', 'cancelled_by_customer')),
  notification_id uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (registration_id, event)
);

COMMENT ON TABLE public.course_push_log IS
  'notify-course-registration claims: at most one push per registration + event. Service role only.';

ALTER TABLE public.course_push_log ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.course_push_log FROM anon, authenticated;

COMMIT;
