-- VERIFY / test plan for 20260814000002_whatsapp_booking_reminder.sql
-- Run AFTER applying the migration.
--
-- §A and §D are read-only. §C is ROLLBACK-wrapped and persists nothing.
-- §A6 is the most important check in this file: it is the exact defect that has
-- silently prevented booking-reminder from EVER running in production.

-- ─────────────────────────────────────────────────────────────────────────────
-- §A. Object checks (read-only)
-- ─────────────────────────────────────────────────────────────────────────────

-- A1. Both columns exist with the right types and defaults.
--     Expect: whatsapp_reminder_enabled boolean NO false
--             whatsapp_reminder_hours   integer NO 24
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'provider_profiles'
  AND column_name LIKE 'whatsapp_reminder%'
ORDER BY column_name;

-- A2. EVERY existing provider is untouched: opted out, 24h default.
--     Expect: enabled_count = 0 and h24_count = total.
SELECT count(*)                                          AS total_providers,
       count(*) FILTER (WHERE whatsapp_reminder_enabled) AS enabled_count,
       count(*) FILTER (WHERE whatsapp_reminder_hours = 24) AS h24_count
FROM public.provider_profiles;

-- A3. Lead-time CHECK exists exactly once (no duplicate-constraint drift).
--     Expect: ONE row.
SELECT conname, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'public.provider_profiles'::regclass
  AND conname LIKE '%whatsapp_reminder%';

-- A4. RPC is SECURITY DEFINER with a pinned search_path, and EXECUTE is granted
--     to service_role ONLY.
--     Expect: prosecdef = true; proconfig contains search_path=public, pg_temp.
SELECT proname, prosecdef, proconfig, pg_get_function_result(oid) AS returns
FROM pg_proc
WHERE proname = 'get_due_whatsapp_reminders' AND pronamespace = 'public'::regnamespace;

--     Expect: only 'service_role'.
SELECT grantee, privilege_type
FROM information_schema.routine_privileges
WHERE routine_schema = 'public' AND routine_name = 'get_due_whatsapp_reminders'
ORDER BY grantee;

-- A5. NO new table was created, and whatsapp_send_log was NOT altered.
--     Expect: whatsapp_send_log only; its columns unchanged from the previous
--     migration (no reminder-specific column added).
SELECT c.relname
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname LIKE 'whatsapp%'
ORDER BY c.relname;

-- ─────────────────────────────────────────────────────────────────────────────
-- A6. ⚠ THE CRLF CHECK — the defect that broke booking-reminder.
--     A bare CR (0x0d) anywhere in a cron command makes pg_net reject the
--     headers argument with "Character with value 0x0d must be escaped", every
--     run, forever, while cron.job_run_details still reports the job as fired.
--     Run this AFTER scheduling §4.
--     Expect: has_cr = false for the whatsapp job.
--     (booking-reminder-every-15min will show TRUE — that is the known
--      pre-existing bug on its own ticket. Do NOT fix it here.)
-- ─────────────────────────────────────────────────────────────────────────────
SELECT jobname,
       active,
       schedule,
       position(chr(13) in command) > 0 AS has_cr,
       length(command)                  AS command_len
FROM cron.job
ORDER BY jobname;

-- A7. Proof the job actually reaches the network. cron.job_run_details showing
--     'succeeded' only means the statement ran — pg_net queues the POST
--     asynchronously, so an empty _http_response is the real failure signal.
--     Expect, within ~15 minutes of scheduling: at least one row, status_code 200.
SELECT id, status_code, error_msg, created
FROM net._http_response
ORDER BY created DESC
LIMIT 10;

-- ─────────────────────────────────────────────────────────────────────────────
-- §B. Client lockout (run as the anon role)
-- ─────────────────────────────────────────────────────────────────────────────
-- B1. Expect: permission denied for function get_due_whatsapp_reminders.
--     SET LOCAL ROLE anon; SELECT * FROM public.get_due_whatsapp_reminders(10);
--
-- B2. A provider must still be able to read/write their own opt-in columns via
--     the existing provider_profiles UPDATE policy — no policy change was made.
--     Verify in the app as a logged-in provider; expect no error.

-- ─────────────────────────────────────────────────────────────────────────────
-- §C. Window behaviour. ROLLBACK-wrapped: nothing below is persisted.
--     Uses a real provider + real booking, mutated in-transaction.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- Pick one confirmed, non-walk-in booking to drive the tests.
CREATE TEMP TABLE _t AS
SELECT b.id AS booking_id, b.provider_id
FROM public.bookings b
WHERE b.status = 'confirmed'
  AND (b.user_id IS NOT NULL OR b.linked_user_id IS NOT NULL)
ORDER BY b.created_at DESC
LIMIT 1;

-- C0. Baseline: provider opted OUT -> the RPC returns nothing for it.
--     Expect: 0 rows for this provider.
SELECT 'C0' AS test, count(*) AS rows_for_provider
FROM public.get_due_whatsapp_reminders(500) r, _t
WHERE r.r_provider_id = _t.provider_id;

-- Opt the provider in, 24h lead, and move the booking to ~20h out (inside the
-- 18h-24h window). Times are Israel wall-clock, matching how they are stored.
UPDATE public.provider_profiles
SET whatsapp_reminder_enabled = true, whatsapp_reminder_hours = 24
WHERE id = (SELECT provider_id FROM _t);

UPDATE public.bookings
SET booking_date = ((now() AT TIME ZONE 'Asia/Jerusalem') + interval '20 hours')::date,
    booking_time = to_char((now() AT TIME ZONE 'Asia/Jerusalem') + interval '20 hours', 'HH24:MI')
WHERE id = (SELECT booking_id FROM _t);

-- C1. Inside the 24h window -> returned, with a slot-scoped message_kind.
--     Expect: 1 row; r_message_kind like 'booking_reminder:YYYY-MM-DDTHH:MI'.
SELECT 'C1' AS test, r.r_booking_id, r.r_message_kind
FROM public.get_due_whatsapp_reminders(500) r, _t
WHERE r.r_booking_id = _t.booking_id;

-- C2. Too far out (30h) -> NOT yet due.
--     Expect: 0 rows.
UPDATE public.bookings
SET booking_date = ((now() AT TIME ZONE 'Asia/Jerusalem') + interval '30 hours')::date,
    booking_time = to_char((now() AT TIME ZONE 'Asia/Jerusalem') + interval '30 hours', 'HH24:MI')
WHERE id = (SELECT booking_id FROM _t);

SELECT 'C2' AS test, count(*) AS should_be_zero
FROM public.get_due_whatsapp_reminders(500) r, _t
WHERE r.r_booking_id = _t.booking_id;

-- C3. Below FLOOR for a 24h provider (2h out) -> dropped, NOT sent late.
--     Expect: 0 rows.
UPDATE public.bookings
SET booking_date = ((now() AT TIME ZONE 'Asia/Jerusalem') + interval '2 hours')::date,
    booking_time = to_char((now() AT TIME ZONE 'Asia/Jerusalem') + interval '2 hours', 'HH24:MI')
WHERE id = (SELECT booking_id FROM _t);

SELECT 'C3' AS test, count(*) AS should_be_zero
FROM public.get_due_whatsapp_reminders(500) r, _t
WHERE r.r_booking_id = _t.booking_id;

-- C4. Switch the provider to a 1h lead -> the SAME 2h-out booking is still not
--     due (2h > 1h lead), proving the window follows the provider setting.
--     Expect: 0 rows.
UPDATE public.provider_profiles SET whatsapp_reminder_hours = 1
WHERE id = (SELECT provider_id FROM _t);

SELECT 'C4' AS test, count(*) AS should_be_zero
FROM public.get_due_whatsapp_reminders(500) r, _t
WHERE r.r_booking_id = _t.booking_id;

-- C5. 45 minutes out on a 1h lead -> due (inside [30min, 1h]).
--     Expect: 1 row.
UPDATE public.bookings
SET booking_date = ((now() AT TIME ZONE 'Asia/Jerusalem') + interval '45 minutes')::date,
    booking_time = to_char((now() AT TIME ZONE 'Asia/Jerusalem') + interval '45 minutes', 'HH24:MI')
WHERE id = (SELECT booking_id FROM _t);

SELECT 'C5' AS test, count(*) AS should_be_one
FROM public.get_due_whatsapp_reminders(500) r, _t
WHERE r.r_booking_id = _t.booking_id;

-- C6. 10 minutes out -> below the 30-minute FLOOR, dropped.
--     "Late is worse than never" for the 1h lead.
--     Expect: 0 rows.
UPDATE public.bookings
SET booking_date = ((now() AT TIME ZONE 'Asia/Jerusalem') + interval '10 minutes')::date,
    booking_time = to_char((now() AT TIME ZONE 'Asia/Jerusalem') + interval '10 minutes', 'HH24:MI')
WHERE id = (SELECT booking_id FROM _t);

SELECT 'C6' AS test, count(*) AS should_be_zero
FROM public.get_due_whatsapp_reminders(500) r, _t
WHERE r.r_booking_id = _t.booking_id;

-- C7. HARD GUARD: an appointment 30 minutes in the PAST is never returned.
--     Expect: 0 rows.
UPDATE public.bookings
SET booking_date = ((now() AT TIME ZONE 'Asia/Jerusalem') - interval '30 minutes')::date,
    booking_time = to_char((now() AT TIME ZONE 'Asia/Jerusalem') - interval '30 minutes', 'HH24:MI')
WHERE id = (SELECT booking_id FROM _t);

SELECT 'C7' AS test, count(*) AS should_be_zero
FROM public.get_due_whatsapp_reminders(500) r, _t
WHERE r.r_booking_id = _t.booking_id;

-- C8. Ledger anti-join: put the booking back in the 1h window, record a send,
--     and confirm it stops being returned.
UPDATE public.bookings
SET booking_date = ((now() AT TIME ZONE 'Asia/Jerusalem') + interval '45 minutes')::date,
    booking_time = to_char((now() AT TIME ZONE 'Asia/Jerusalem') + interval '45 minutes', 'HH24:MI')
WHERE id = (SELECT booking_id FROM _t);

INSERT INTO public.whatsapp_send_log (booking_id, message_kind, provider_id, status)
SELECT r.r_booking_id, r.r_message_kind, r.r_provider_id, 'sent'
FROM public.get_due_whatsapp_reminders(500) r, _t
WHERE r.r_booking_id = _t.booking_id;

--     Expect: 0 rows — already reminded for this slot.
SELECT 'C8' AS test, count(*) AS should_be_zero
FROM public.get_due_whatsapp_reminders(500) r, _t
WHERE r.r_booking_id = _t.booking_id;

-- C9. RESCHEDULE BEHAVIOUR — read this result carefully, it is a judgement call.
--     Move the booking to a DIFFERENT slot still inside the 1h window. Because
--     message_kind is slot-scoped, the booking becomes due again and the
--     customer receives a corrected reminder for the new time.
--     Expect: 1 row, with a DIFFERENT r_message_kind than C8 recorded.
--     If you would rather one reminder per booking FOREVER (accepting that a
--     rescheduled customer keeps the stale time), change the two references to
--     d.reminder_kind in the migration to the literal 'booking_reminder'.
UPDATE public.bookings
SET booking_date = ((now() AT TIME ZONE 'Asia/Jerusalem') + interval '50 minutes')::date,
    booking_time = to_char((now() AT TIME ZONE 'Asia/Jerusalem') + interval '50 minutes', 'HH24:MI')
WHERE id = (SELECT booking_id FROM _t);

SELECT 'C9' AS test, r.r_message_kind AS new_slot_kind
FROM public.get_due_whatsapp_reminders(500) r, _t
WHERE r.r_booking_id = _t.booking_id;

-- C10. Cancelled bookings are never returned, whatever the window says.
--      Expect: 0 rows.
UPDATE public.bookings SET status = 'cancelled' WHERE id = (SELECT booking_id FROM _t);

SELECT 'C10' AS test, count(*) AS should_be_zero
FROM public.get_due_whatsapp_reminders(500) r, _t
WHERE r.r_booking_id = _t.booking_id;

-- C11. The cap is honoured.
--      Expect: at most 1 row overall.
SELECT 'C11' AS test, count(*) AS should_be_at_most_1
FROM public.get_due_whatsapp_reminders(1);

ROLLBACK;

-- Confirm the rollback left nothing behind.
-- Expect: 0.
SELECT count(*) AS reminder_rows_left
FROM public.whatsapp_send_log
WHERE message_kind LIKE 'booking_reminder%';

-- ─────────────────────────────────────────────────────────────────────────────
-- §D. Backfill sizing — RUN BEFORE WIDENING THE ALLOWLIST
-- ─────────────────────────────────────────────────────────────────────────────
-- On the first run after a provider opts in, every confirmed booking already
-- inside their window fires at once. Size that before it happens.
--
-- D1. How many would fire immediately, per lead time?
SELECT p.whatsapp_reminder_hours AS lead_hours, count(*) AS would_fire_now
FROM public.bookings b
JOIN public.provider_profiles p ON p.id = b.provider_id
WHERE b.status = 'confirmed'
  AND p.whatsapp_reminder_enabled
  AND (b.user_id IS NOT NULL OR b.linked_user_id IS NOT NULL)
  AND b.booking_date BETWEEN current_date - 1 AND current_date + 2
  AND ((b.booking_date + left(b.booking_time,5)::time) AT TIME ZONE 'Asia/Jerusalem') > now()
  AND ((b.booking_date + left(b.booking_time,5)::time) AT TIME ZONE 'Asia/Jerusalem') - now()
      <= make_interval(hours => p.whatsapp_reminder_hours)
GROUP BY 1;

-- D2. Dry run of the real thing, without sending: what the next cron tick would
--     pick up right now.
SELECT * FROM public.get_due_whatsapp_reminders(100);

-- D3. Planner check — the coarse date prefilter should keep this off a seq scan
--     as bookings grows. If it seq-scans a large table, consider an index on
--     bookings (status, booking_date); do NOT add one blindly.
EXPLAIN ANALYZE SELECT * FROM public.get_due_whatsapp_reminders(100);
