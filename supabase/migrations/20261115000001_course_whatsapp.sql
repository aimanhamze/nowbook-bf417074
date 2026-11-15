-- Academy WhatsApp (feat/academy-whatsapp, Phase 1): the queue + ledger and
-- the SQL side of the dispatcher. Sends nothing by itself.
--
-- Templates (Meta, Utility; sent by the course-whatsapp-dispatch Edge
-- Function, Phase 2): course_{approved,declined,cancelled,reminder}_{hebrew,arabic}.
--
-- WHAT THIS ADDS
--   §1 course_whatsapp_log — one row per (registration, message kind). It is
--      the queue AND the ledger: UNIQUE (registration_id, message_kind) means
--      at most one message per registration per kind, ever. whatsapp_send_log
--      (bookings) is not touched.
--   §2 trg_course_whatsapp_capture — AFTER UPDATE OF status on
--      course_registrations. Queues:
--        pending -> confirmed                         course_approved
--        pending -> rejected                          course_declined
--        pending|confirmed -> cancelled (by provider) course_cancelled
--      A customer's own cancel queues nothing. The three registration RPCs
--      are NOT replaced; the trigger sees their writes. It can never fail the
--      write: any error becomes a WARNING.
--   §3 course_whatsapp_due_reminders — who is due a course reminder.
--   §4 course_whatsapp_claim — what the dispatcher may send now.
--   §5 course_whatsapp_has_work — the cron's cheap guard.
--
-- RULES (rulings 2026-11-15)
--   * Nothing is claimed in quiet hours (22:00–08:00 Israel time); the
--     waiting list's waitlist_is_quiet_hours() is the one definition.
--   * Approved / declined / cancelled wait 2 minutes, then are sent only if
--     the registration is STILL in that state. Approve-then-cancel inside the
--     2 minutes sends only "cancelled".
--   * Skipped at claim time, with the reason kept in error_code:
--       REGISTRATION_GONE  the registration no longer exists (course deleted)
--       SUPERSEDED         the registration moved on
--       STALE              queued more than 24 hours ago
--       COURSE_INACTIVE    the course is switched off
--       PROVIDER_DISABLED  whatsapp_confirm_enabled is off
--     No check on the branch being hidden (is_visible) — deliberately.
--   * Reminder: once per registration, never repeated. Due when the
--     registration is confirmed, the course is active, the branch has
--     whatsapp_reminder_enabled, the FIRST session starts between 3 and 24
--     hours from now, and the registration was approved at least 24 hours
--     before that start (a later approval message already carries the date).
--
-- WHO MAY CALL: service_role only. The table: RLS on, zero policies,
--   nothing granted to anon / authenticated.
--
-- DEPENDS ON (checked by VERIFY §0): public.waitlist_is_quiet_hours(timestamptz),
--   public.set_updated_at(), provider_profiles.whatsapp_confirm_enabled /
--   whatsapp_reminder_enabled, academy_course_sessions.period.
--
-- DEPLOY ORDER: this migration (DEV, then PROD) -> course-whatsapp-dispatch
--   function + secrets -> cron (VERIFY §C, last) -> settings wording.
--   Rows queued before the cron runs are skipped as STALE after 24 hours,
--   never sent late.
--
-- ROLLBACK: VERIFY §R.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- §1. course_whatsapp_log
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE public.course_whatsapp_log (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- No FK on purpose: deleting a course cascades its registrations, and the
  -- record of what was sent about them must survive that.
  registration_id  uuid        NOT NULL,
  course_id        uuid        NOT NULL,
  provider_id      uuid        REFERENCES public.provider_profiles(id) ON DELETE CASCADE,
  -- The recipient. Deleting the person deletes what was sent to them.
  user_id          uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  message_kind     text        NOT NULL
                   CHECK (message_kind IN ('course_approved', 'course_declined',
                                           'course_cancelled', 'course_reminder')),

  --   queued   waiting for the dispatcher (approved / declined / cancelled)
  --   sending  claimed; the dispatcher is about to call SendPulse
  --   sent     SendPulse accepted it
  --   failed   SendPulse refused it, or the call threw — never retried
  --   skipped  never attempted; error_code says why
  -- A row stuck in 'sending' is fixed by hand. There are no automatic
  -- retries: a duplicate message to a real customer cannot be undone.
  status           text        NOT NULL DEFAULT 'queued'
                   CHECK (status IN ('queued', 'sending', 'sent', 'failed', 'skipped')),

  phone_digits         text,
  template_name        text,
  language_code        text,
  sendpulse_message_id text,
  missing_message_id   boolean     NOT NULL DEFAULT false,
  error_code           text,

  claimed_at       timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.course_whatsapp_log IS
  'Academy WhatsApp queue + ledger: one row per (registration, message kind), ever. Filled by trg_course_whatsapp_capture and course_whatsapp_claim; service_role only.';

-- THE once-only guard. Full, not partial: a failed send must not free the
-- slot for a second attempt.
CREATE UNIQUE INDEX course_whatsapp_log_registration_kind_key
  ON public.course_whatsapp_log (registration_id, message_kind);

-- The dispatcher's queue scan.
CREATE INDEX course_whatsapp_log_queued_idx
  ON public.course_whatsapp_log (created_at)
  WHERE status = 'queued';

-- Audit: what did this branch send, newest first.
CREATE INDEX course_whatsapp_log_provider_created_idx
  ON public.course_whatsapp_log (provider_id, created_at DESC);

CREATE TRIGGER trg_course_whatsapp_log_updated_at
  BEFORE UPDATE ON public.course_whatsapp_log
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.course_whatsapp_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.course_whatsapp_log FROM anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- §2. Capture: registration status change -> queued message
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.course_whatsapp_capture()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_kind text;
BEGIN
  v_kind := CASE
    WHEN OLD.status = 'pending' AND NEW.status = 'confirmed' THEN 'course_approved'
    WHEN OLD.status = 'pending' AND NEW.status = 'rejected'  THEN 'course_declined'
    WHEN OLD.status IN ('pending', 'confirmed') AND NEW.status = 'cancelled'
         AND NEW.cancelled_by = 'provider'                   THEN 'course_cancelled'
  END;
  IF v_kind IS NULL THEN
    RETURN NULL;
  END IF;

  BEGIN
    INSERT INTO public.course_whatsapp_log
      (registration_id, course_id, provider_id, user_id, message_kind)
    VALUES (NEW.id, NEW.course_id, NEW.provider_id, NEW.user_id, v_kind)
    ON CONFLICT (registration_id, message_kind) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    -- The approval / decline / cancel must stand even if queueing fails.
    RAISE WARNING 'course_whatsapp_capture: % not queued for registration % (% %)',
      v_kind, NEW.id, SQLSTATE, SQLERRM;
  END;
  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.course_whatsapp_capture() IS
  'AFTER UPDATE OF status on course_registrations: queues course_approved / course_declined / course_cancelled (provider cancels only). Never fails the write.';

CREATE TRIGGER trg_course_whatsapp_capture
  AFTER UPDATE OF status ON public.course_registrations
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.course_whatsapp_capture();

-- ─────────────────────────────────────────────────────────────────────────────
-- §3. Who is due a course reminder at p_now
-- ─────────────────────────────────────────────────────────────────────────────
-- The course starts at its earliest session (Asia/Jerusalem wall clock, the
-- same "first start" the registration RPCs use). Quiet hours are checked by
-- the callers, not here.
CREATE OR REPLACE FUNCTION public.course_whatsapp_due_reminders(
  p_now   timestamptz DEFAULT now(),
  p_limit integer     DEFAULT 50
)
RETURNS TABLE (
  r_registration_id uuid,
  r_course_id       uuid,
  r_provider_id     uuid,
  r_user_id         uuid,
  r_starts_at       timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH firsts AS (
    SELECT s.course_id,
           (min(lower(s.period)) AT TIME ZONE 'Asia/Jerusalem') AS starts_at
    FROM public.academy_course_sessions s
    WHERE s.course_id IN (SELECT r.course_id FROM public.course_registrations r
                          WHERE r.status = 'confirmed')
    GROUP BY s.course_id
  )
  SELECT r.id, r.course_id, r.provider_id, r.user_id, f.starts_at
  FROM public.course_registrations r
  JOIN public.academy_courses ac   ON ac.id = r.course_id
  JOIN public.provider_profiles pp ON pp.id = r.provider_id
  JOIN firsts f                    ON f.course_id = r.course_id
  WHERE r.status = 'confirmed'
    AND ac.is_active
    AND pp.whatsapp_reminder_enabled
    AND f.starts_at - p_now >= interval '3 hours'
    AND f.starts_at - p_now <= interval '24 hours'
    AND r.decided_at <= f.starts_at - interval '24 hours'
    AND NOT EXISTS (
      SELECT 1 FROM public.course_whatsapp_log l
      WHERE l.registration_id = r.id AND l.message_kind = 'course_reminder'
    )
  ORDER BY f.starts_at
  LIMIT greatest(coalesce(p_limit, 0), 0);
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- §4. Claim: skip what must not be sent, then hand out what may
-- ─────────────────────────────────────────────────────────────────────────────
-- Returns every row now in 'sending' that the dispatcher must send.
-- p_now exists for VERIFY §B; the dispatcher never passes it.
-- The dispatcher still re-reads the registration before calling SendPulse.
CREATE OR REPLACE FUNCTION public.course_whatsapp_claim(
  p_limit integer     DEFAULT 50,
  p_now   timestamptz DEFAULT now()
)
RETURNS TABLE (r_log_id uuid, r_registration_id uuid, r_message_kind text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_limit   integer := least(greatest(coalesce(p_limit, 0), 0), 500);
  v_settled timestamptz := p_now - interval '2 minutes';
BEGIN
  IF public.waitlist_is_quiet_hours(p_now) THEN
    RETURN;
  END IF;

  -- 1. Settled queued messages that must not go out: record why.
  UPDATE public.course_whatsapp_log l
     SET status = 'skipped', error_code = s.code
  FROM (
    SELECT q.id,
           CASE
             WHEN r.id IS NULL THEN 'REGISTRATION_GONE'
             WHEN NOT ((q.message_kind = 'course_approved'  AND r.status = 'confirmed')
                    OR (q.message_kind = 'course_declined'  AND r.status = 'rejected')
                    OR (q.message_kind = 'course_cancelled' AND r.status = 'cancelled'))
               THEN 'SUPERSEDED'
             WHEN q.created_at < p_now - interval '24 hours' THEN 'STALE'
             WHEN ac.id IS NULL OR NOT ac.is_active THEN 'COURSE_INACTIVE'
             WHEN pp.id IS NULL OR NOT pp.whatsapp_confirm_enabled THEN 'PROVIDER_DISABLED'
           END AS code
    FROM public.course_whatsapp_log q
    LEFT JOIN public.course_registrations r ON r.id = q.registration_id
    LEFT JOIN public.academy_courses ac     ON ac.id = q.course_id
    LEFT JOIN public.provider_profiles pp   ON pp.id = q.provider_id
    WHERE q.status = 'queued'
      AND q.message_kind <> 'course_reminder'
      AND q.created_at <= v_settled
    FOR UPDATE OF q SKIP LOCKED
  ) s
  WHERE l.id = s.id AND s.code IS NOT NULL;

  -- 2. The rest of the settled queue, oldest first.
  RETURN QUERY
  WITH c AS (
    SELECT q.id
    FROM public.course_whatsapp_log q
    WHERE q.status = 'queued'
      AND q.message_kind <> 'course_reminder'
      AND q.created_at <= v_settled
    ORDER BY q.created_at
    LIMIT v_limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.course_whatsapp_log l
     SET status = 'sending', claimed_at = now()
  FROM c
  WHERE l.id = c.id
  RETURNING l.id, l.registration_id, l.message_kind;

  -- 3. Due reminders: the INSERT is the claim (the unique index decides
  --    races between two dispatcher runs).
  RETURN QUERY
  INSERT INTO public.course_whatsapp_log
    (registration_id, course_id, provider_id, user_id, message_kind, status, claimed_at)
  SELECT d.r_registration_id, d.r_course_id, d.r_provider_id, d.r_user_id,
         'course_reminder', 'sending', now()
  FROM public.course_whatsapp_due_reminders(p_now, v_limit) d
  ON CONFLICT (registration_id, message_kind) DO NOTHING
  RETURNING id, registration_id, message_kind;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- §5. The cron's guard: is there anything to do right now?
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.course_whatsapp_has_work(p_now timestamptz DEFAULT now())
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT NOT public.waitlist_is_quiet_hours(p_now)
     AND (EXISTS (SELECT 1 FROM public.course_whatsapp_log q
                  WHERE q.status = 'queued'
                    AND q.message_kind <> 'course_reminder'
                    AND q.created_at <= p_now - interval '2 minutes')
          OR EXISTS (SELECT 1 FROM public.course_whatsapp_due_reminders(p_now, 1)));
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- §6. Grants — service_role only
-- ─────────────────────────────────────────────────────────────────────────────
-- Supabase grants EXECUTE on new functions to anon and authenticated
-- directly, so revoking from PUBLIC alone is not enough.
DO $grants$
DECLARE
  fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.course_whatsapp_capture()',
    'public.course_whatsapp_due_reminders(timestamptz, integer)',
    'public.course_whatsapp_claim(integer, timestamptz)',
    'public.course_whatsapp_has_work(timestamptz)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', fn);
  END LOOP;
  -- The trigger function is never called directly (EXECUTE is checked only
  -- at CREATE TRIGGER), so nobody needs it; the other three are the
  -- dispatcher's.
  EXECUTE 'REVOKE ALL ON FUNCTION public.course_whatsapp_capture() FROM service_role';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.course_whatsapp_due_reminders(timestamptz, integer) TO service_role';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.course_whatsapp_claim(integer, timestamptz) TO service_role';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.course_whatsapp_has_work(timestamptz) TO service_role';
END
$grants$;

COMMIT;
