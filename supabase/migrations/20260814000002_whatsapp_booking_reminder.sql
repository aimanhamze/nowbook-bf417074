-- WhatsApp appointment reminders — provider opt-in + due-booking discovery.
--
-- Backs the `whatsapp-booking-reminder` Edge Function, which is CRON-DRIVEN:
-- there is no user, no Bearer token and no caller to authorize. The function
-- discovers eligible bookings itself via the RPC below.
--
-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  ⚠  CRLF WARNING — READ BEFORE EDITING §4                                ║
-- ║                                                                          ║
-- ║  The existing `booking-reminder-every-15min` cron job has NEVER           ║
-- ║  successfully run in production. Its command was authored with Windows    ║
-- ║  CRLF line endings and the anon key was wrapped across a line break in    ║
-- ║  the middle of the JWT, so pg_net rejects the headers argument every      ║
-- ║  time with:                                                              ║
-- ║      invalid input syntax for type json ...                              ║
-- ║      Character with value 0x0d must be escaped.                          ║
-- ║  net._http_response has zero rows — the POST is never even queued, while  ║
-- ║  cron.job_run_details still reports the job as having fired.              ║
-- ║                                                                          ║
-- ║  THEREFORE, in §4 below:                                                 ║
-- ║    * keep the whole headers expression on ONE line — never wrap it;      ║
-- ║    * never paste a key or secret across a line break;                    ║
-- ║    * a bare CR (0x0d) anywhere inside the JSON breaks it identically.    ║
-- ║  §A6 of the VERIFY file greps the stored command for CR and MUST pass.    ║
-- ║                                                                          ║
-- ║  ALSO CONFIRMED IN PRACTICE: a $cron$ … $cron$ DOLLAR-QUOTED body        ║
-- ║  preserves the CRs of whatever was pasted into it, so the job stores a    ║
-- ║  command containing 0x0d and fails exactly like booking-reminder — even   ║
-- ║  with the headers themselves unwrapped. Scheduling with a SINGLE-LINE     ║
-- ║  ORDINARY STRING LITERAL instead of a dollar-quoted block fixed it.       ║
-- ║  Prefer the single-line form; if you do use $cron$, re-run §A6 after.     ║
-- ║                                                                          ║
-- ║  Headers are built with jsonb_build_object rather than a JSON string      ║
-- ║  literal so the object cannot be malformed by stray whitespace at all.    ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- DELIBERATELY NOT TOUCHED (constraint F):
--   * supabase/functions/booking-reminder and its cron job. Its CRLF failure
--     is a separate bug on a separate ticket. Fixing it here would entangle
--     two unrelated changes.
--   * whatsapp_send_log — REUSED as-is with a new message_kind. No second log
--     table, and no schema change to it.
--   * whatsapp_message_language — REUSED. One language setting governs every
--     WhatsApp message a provider sends.
--
-- Verified live before writing: bookings.booking_date is a real DATE column,
-- so the date + time arithmetic below is safe.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- §1. Provider opt-in, separate from confirmations
-- ─────────────────────────────────────────────────────────────────────────────
-- Default OFF and independent of whatsapp_confirm_enabled: a provider may want
-- confirmations without reminders, or the reverse.

ALTER TABLE public.provider_profiles
  ADD COLUMN IF NOT EXISTS whatsapp_reminder_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS whatsapp_reminder_hours   integer NOT NULL DEFAULT 24;

-- Dropped first so re-running cannot accumulate duplicates — the exact drift
-- bookings.status already suffers from (bookings_status_check + chk_valid_status).
ALTER TABLE public.provider_profiles
  DROP CONSTRAINT IF EXISTS provider_profiles_whatsapp_reminder_hours_check;

ALTER TABLE public.provider_profiles
  ADD CONSTRAINT provider_profiles_whatsapp_reminder_hours_check
  CHECK (whatsapp_reminder_hours IN (1, 24));

COMMENT ON COLUMN public.provider_profiles.whatsapp_reminder_enabled IS
  'Provider opt-in for WhatsApp appointment reminders. Default false; independent of whatsapp_confirm_enabled.';
COMMENT ON COLUMN public.provider_profiles.whatsapp_reminder_hours IS
  'Reminder lead time in hours: 1 or 24. Language comes from whatsapp_message_language (shared with confirmations).';

-- ─────────────────────────────────────────────────────────────────────────────
-- §2. get_due_whatsapp_reminders — the entire eligibility decision, in SQL
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY IN SQL RATHER THAN THE FUNCTION:
--
--   TIMEZONE. booking_date + booking_time are Israel wall-clock values while
--   the Edge Function runs in UTC. `AT TIME ZONE 'Asia/Jerusalem'` resolves
--   them through Postgres's own tz database, so DST is correct by construction.
--   The JS approach in booking-reminder derives ONE offset per run and applies
--   it to bookings up to 48h out, which misapplies it across a DST boundary,
--   and it relies on `new Date("...")` parsing as local with the runtime
--   happening to be UTC. Neither hazard exists here.
--
--   COST. The window, the opt-in join, the ledger anti-join and the cap all
--   happen in one indexed query, instead of pulling two days of bookings into
--   the function and filtering them in JS on every run.
--
-- WINDOW — one-sided on purpose:
--
--     Δ = starts_at - now()          send when   FLOOR <= Δ <= LEAD
--
--     lead 24h -> Δ in [18h,    24h]
--     lead  1h -> Δ in [30min,   1h]
--
--   The first run after Δ drops below LEAD sends; every later run inside the
--   window finds a ledger row and skips. A MISSED RUN THEREFORE SELF-HEALS,
--   which the existing 60-75 minute two-sided window cannot do — miss that
--   15-minute slot and the reminder is lost forever.
--
--   FLOOR is what enforces "late is worse than never": for the 1h lead, a
--   reminder that would land under 30 minutes ahead is dropped, not sent.
--
--   starts_at > now() is a HARD GUARD — never remind about a past appointment.
--
-- RESCHEDULES: message_kind is SLOT-SCOPED ('booking_reminder:<date>T<time>').
-- A reminder already sent for a slot that then moves would tell the customer to
-- arrive at the wrong time, so a rescheduled booking earns a fresh, correct
-- reminder for its new slot. The free-text message_kind column was designed for
-- exactly this.
--   TO MAKE REMINDERS ONCE-PER-BOOKING INSTEAD, change the two references to
--   d.reminder_kind below to the literal 'booking_reminder'. That is the whole
--   change; nothing else depends on it.

CREATE OR REPLACE FUNCTION public.get_due_whatsapp_reminders(p_limit integer DEFAULT 100)
RETURNS TABLE (r_booking_id uuid, r_provider_id uuid, r_message_kind text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  WITH candidate AS (
    SELECT
      b.id,
      b.provider_id,
      -- Israel wall-clock -> a true instant, DST-correct.
      ((b.booking_date + left(b.booking_time, 5)::time)
        AT TIME ZONE 'Asia/Jerusalem') AS starts_at,
      p.whatsapp_reminder_hours        AS lead_hours,
      -- The slot key. Returned to the caller so the Edge Function claims the
      -- ledger row with EXACTLY the key this anti-join tested — deriving it
      -- twice would risk the two drifting apart.
      'booking_reminder:' || to_char(b.booking_date, 'YYYY-MM-DD')
                          || 'T' || left(b.booking_time, 5) AS reminder_kind
    FROM public.bookings b
    JOIN public.provider_profiles p ON p.id = b.provider_id
    WHERE b.status = 'confirmed'                        -- exactly; 'completed' is not 'confirmed'
      AND p.whatsapp_reminder_enabled
      -- Walk-ins are excluded: the customer never opted in to template
      -- messages, and the provider-typed phone is free text.
      AND (b.user_id IS NOT NULL OR b.linked_user_id IS NOT NULL)
      -- Coarse date prefilter so the planner can use a date index instead of
      -- evaluating AT TIME ZONE over the whole table. Deliberately wider than
      -- any window above (max lead is 24h).
      AND b.booking_date BETWEEN current_date - 1 AND current_date + 2
  )
  SELECT c.id, c.provider_id, c.reminder_kind
  FROM candidate c
  WHERE c.starts_at > now()                                        -- HARD GUARD
    AND c.starts_at - now() <= make_interval(hours => c.lead_hours)
    AND c.starts_at - now() >= CASE WHEN c.lead_hours = 1
                                    THEN interval '30 minutes'
                                    ELSE interval '18 hours'
                               END
    AND NOT EXISTS (
      SELECT 1
      FROM public.whatsapp_send_log l
      WHERE l.booking_id = c.id
        AND l.message_kind = c.reminder_kind
    )
  -- Soonest first: under the cap, an urgent reminder must never be starved by
  -- a batch of distant ones.
  ORDER BY c.starts_at
  LIMIT greatest(p_limit, 0);
$fn$;

-- ─────────────────────────────────────────────────────────────────────────────
-- §3. Grants — service_role only
-- ─────────────────────────────────────────────────────────────────────────────

REVOKE ALL ON FUNCTION public.get_due_whatsapp_reminders(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_due_whatsapp_reminders(integer) TO service_role;

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────────
-- §4. Cron schedule — RUN SEPARATELY, AFTER FILLING IN THE PLACEHOLDERS
-- ─────────────────────────────────────────────────────────────────────────────
-- Outside the transaction above: a cron failure must not roll back the schema.
--
-- ⚠  Replace <ANON_KEY> and <CRON_SECRET> with real values and KEEP THE
--    jsonb_build_object CALL ON ONE LINE. See the CRLF warning at the top of
--    this file — this is the exact statement shape that has silently prevented
--    the existing booking-reminder job from ever running.
--
-- x-cron-secret exists because the platform JWT gate is satisfied by the ANON
-- key, which ships inside the client bundle. That is adequate for the in-app
-- reminder function, which only writes notification rows; it is NOT adequate
-- for a function that spends money sending WhatsApp messages. The Edge Function
-- compares this header in constant time and returns 401 without it.
--
-- Every 15 minutes, matching the existing cadence. One job serves both lead
-- times: the one-sided windows give the 1h lead 2-3 chances inside its
-- 30-minute band, so a second job would buy nothing.

-- SELECT cron.schedule('whatsapp-booking-reminder-15min', '*/15 * * * *', $cron$
--   SELECT net.http_post(
--     url := 'https://aqlcjjrgsxispdjwrnqf.supabase.co/functions/v1/whatsapp-booking-reminder',
--     headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer <ANON_KEY>', 'x-cron-secret', '<CRON_SECRET>'),
--     body := '{}'::jsonb
--   );
-- $cron$);

-- To remove it (the reminder-specific kill switch — instant, global, no deploy):
--   SELECT cron.unschedule('whatsapp-booking-reminder-15min');
