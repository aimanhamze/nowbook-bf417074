-- VERIFY / test plan for 20261116000001_whatsapp_reminder_both.sql
--
--   §0  BEFORE the migration. REQUIRED. Read-only. SAVE 0.1 + 0.2 (rollback source).
--   §A  after the migration. Read-only object checks.
--   §B  after the migration.
--         B1  read-only: existing providers get exactly what they got before.
--         B2  ROLLBACK-wrapped behaviour tests for "both" mode. DEV ONLY.
--   §E  rollback (commented out).
--
-- Deploy order: migration -> whatsapp-booking-reminder -> UI. Rollback in reverse.


-- ═════════════════════════════════════════════════════════════════════════════
-- §0. PRE-APPLY — run before the migration
-- ═════════════════════════════════════════════════════════════════════════════

-- 0.1 The live function, verbatim. SAVE IT — it is §E's rollback source.
--     Expect: identical to 20260916000001 §3 apart from whitespace.
SELECT pg_get_functiondef('public.get_due_whatsapp_reminders(integer)'::regprocedure);

-- 0.2 Owner, security, search_path, ACL. SAVE IT.
--     Expect: prosecdef = true; proconfig = {"search_path=public, pg_temp"};
--             EXECUTE for service_role only (plus the owner).
SELECT pg_get_userbyid(p.proowner) AS owner, p.prosecdef, p.proconfig, p.provolatile, p.proacl
FROM pg_proc p
WHERE p.oid = 'public.get_due_whatsapp_reminders(integer)'::regprocedure;

-- 0.3 The hash the migration's §1 guard checks.
--     Expect: 7fa44c7143444f91af770654cf034aa6. Anything else -> the migration
--     WILL ABORT. Diff 0.1 against the repo; do not edit the hash.
SELECT md5(btrim(regexp_replace(prosrc, '[[:space:]]+', ' ', 'g'), ' ')) AS normalised_md5
FROM pg_proc
WHERE oid = 'public.get_due_whatsapp_reminders(integer)'::regprocedure;

-- 0.4 Exactly one overload.
--     Expect: 1 row, args = 'p_limit integer DEFAULT 100'.
SELECT p.oid::regprocedure AS signature, pg_get_function_arguments(p.oid) AS args
FROM pg_proc p
WHERE p.proname = 'get_due_whatsapp_reminders' AND p.pronamespace = 'public'::regnamespace;

-- 0.5 The column does not exist yet, and no '#1h' ledger keys exist.
--     Expect: 0 rows, then 0.
SELECT column_name FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'provider_profiles'
  AND column_name = 'whatsapp_reminder_both';

SELECT count(*) AS hash_1h_rows FROM public.whatsapp_send_log
WHERE message_kind LIKE 'booking_reminder:%#1h';


-- ═════════════════════════════════════════════════════════════════════════════
-- §A. OBJECT CHECKS — after the migration (read-only)
-- ═════════════════════════════════════════════════════════════════════════════

-- A1. Column shape.  Expect: whatsapp_reminder_both | boolean | NO | false
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'provider_profiles'
  AND column_name = 'whatsapp_reminder_both';

-- A2. No provider is in "both" mode; hours values untouched.
--     Expect: both_on = 0; h1 + h24 = total.
SELECT count(*)                                         AS total,
       count(*) FILTER (WHERE whatsapp_reminder_both)   AS both_on,
       count(*) FILTER (WHERE whatsapp_reminder_hours = 1)  AS h1,
       count(*) FILTER (WHERE whatsapp_reminder_hours = 24) AS h24
FROM public.provider_profiles;

-- A3. New body is live.
--     Expect: 65e695e35cccb6057d41ef2634a9971b.
SELECT md5(btrim(regexp_replace(prosrc, '[[:space:]]+', ' ', 'g'), ' ')) AS normalised_md5
FROM pg_proc
WHERE oid = 'public.get_due_whatsapp_reminders(integer)'::regprocedure;

-- A4. Signature, result and security unchanged. Compare with 0.2 / 0.4.
--     Expect: same owner/prosecdef/proconfig/provolatile/proacl as 0.2;
--             result = TABLE(r_booking_id uuid, r_provider_id uuid, r_message_kind text);
--             overloads = 1.
SELECT pg_get_userbyid(p.proowner) AS owner, p.prosecdef, p.proconfig, p.provolatile, p.proacl,
       pg_get_function_result(p.oid) AS result,
       (SELECT count(*) FROM pg_proc
        WHERE proname = 'get_due_whatsapp_reminders'
          AND pronamespace = 'public'::regnamespace) AS overloads
FROM pg_proc p
WHERE p.oid = 'public.get_due_whatsapp_reminders(integer)'::regprocedure;


-- ═════════════════════════════════════════════════════════════════════════════
-- §B1. NO CHANGE FOR EXISTING PROVIDERS — read-only, DEV and PROD
-- ═════════════════════════════════════════════════════════════════════════════
-- The NEW function vs an inline replica of the OLD (20260916000001) body, in one
-- statement so now() is the same instant for both. While A2 says both_on = 0
-- the two sets must be identical. Run before the UI ships.
--
-- Expect: only_in_new = 0 AND only_in_old = 0. (due_now is informational.)

WITH new_rpc AS (
  SELECT r_booking_id, r_provider_id, r_message_kind
  FROM public.get_due_whatsapp_reminders(100000)
),
old_rpc AS (
  SELECT c.id AS r_booking_id, c.provider_id AS r_provider_id, c.reminder_kind AS r_message_kind
  FROM (
    SELECT b.id, b.provider_id,
           ((b.booking_date + left(b.booking_time, 5)::time) AT TIME ZONE 'Asia/Jerusalem') AS starts_at,
           p.whatsapp_reminder_hours AS lead_hours,
           'booking_reminder:' || to_char(b.booking_date, 'YYYY-MM-DD')
                               || 'T' || left(b.booking_time, 5) AS reminder_kind
    FROM public.bookings b
    JOIN public.provider_profiles p ON p.id = b.provider_id
    WHERE b.status = 'confirmed'
      AND p.whatsapp_reminder_enabled
      AND (b.user_id IS NOT NULL OR b.linked_user_id IS NOT NULL OR b.whatsapp_consent)
      AND b.booking_date BETWEEN current_date - 1 AND current_date + 2
  ) c
  WHERE c.starts_at > now()
    AND c.starts_at - now() <= make_interval(hours => c.lead_hours)
    AND c.starts_at - now() >= CASE WHEN c.lead_hours = 1
                                    THEN interval '30 minutes'
                                    ELSE interval '18 hours' END
    AND NOT EXISTS (SELECT 1 FROM public.whatsapp_send_log l
                    WHERE l.booking_id = c.id AND l.message_kind = c.reminder_kind)
)
SELECT (SELECT count(*) FROM (SELECT * FROM new_rpc EXCEPT SELECT * FROM old_rpc) x) AS only_in_new,
       (SELECT count(*) FROM (SELECT * FROM old_rpc EXCEPT SELECT * FROM new_rpc) x) AS only_in_old,
       (SELECT count(*) FROM new_rpc)                                                AS due_now;


-- ═════════════════════════════════════════════════════════════════════════════
-- §B2. "BOTH" MODE BEHAVIOUR — ROLLBACK-wrapped, DEV ONLY, run the block at once
-- ═════════════════════════════════════════════════════════════════════════════
-- Mutates one real account booking and its provider inside a transaction and
-- rolls everything back. now() is frozen for the whole transaction, so ledger
-- rows inserted below get created_at = the same instant the RPC compares with.
--
-- If moving the booking raises (prevent_booking_conflicts, staff hours, etc.),
-- change the OFFSET to pick another booking — a test-data collision, not a
-- failure of the migration. If T0 is not 1, there is nothing to test with: stop.

BEGIN;

CREATE TEMP TABLE _t ON COMMIT DROP AS
SELECT b.id AS booking_id, b.provider_id
FROM public.bookings b
WHERE b.status = 'confirmed'
  AND b.user_id IS NOT NULL
  AND b.class_schedule_id IS NULL
ORDER BY b.created_at DESC
LIMIT 1 OFFSET 0;

CREATE TEMP VIEW _due AS
SELECT r.r_message_kind
FROM public.get_due_whatsapp_reminders(100000) r
JOIN _t ON r.r_booking_id = _t.booking_id;

-- Moves the test booking to now() + p_ahead (Israel wall clock) and sets its
-- created_at to now() - p_age. Temp function — dropped with the session.
CREATE FUNCTION pg_temp.place(p_ahead interval, p_age interval) RETURNS void
LANGUAGE sql AS $$
  UPDATE public.bookings
  SET booking_date = ((now() AT TIME ZONE 'Asia/Jerusalem') + p_ahead)::date,
      booking_time = to_char((now() AT TIME ZONE 'Asia/Jerusalem') + p_ahead, 'HH24:MI'),
      created_at   = now() - p_age
  WHERE id = (SELECT booking_id FROM _t);
  DELETE FROM public.whatsapp_send_log WHERE booking_id = (SELECT booking_id FROM _t);
$$;

-- Ledger row for the test booking with a given key and created_at.
CREATE FUNCTION pg_temp.logged(p_kind text, p_at timestamptz) RETURNS void
LANGUAGE sql AS $$
  INSERT INTO public.whatsapp_send_log (booking_id, provider_id, message_kind, status, created_at)
  SELECT booking_id, provider_id, p_kind, 'sent', p_at FROM _t;
$$;

-- T0. Expect 1.
SELECT 'T0 test booking found' AS test, count(*) AS expect_1 FROM _t;

UPDATE public.provider_profiles
SET whatsapp_reminder_enabled = true, whatsapp_reminder_both = true, whatsapp_reminder_hours = 24
WHERE id = (SELECT provider_id FROM _t);

-- T1. Both mode, 20h ahead, booked days ago -> the 24h reminder, OLD key shape.
--     Expect: 1 row, kind 'booking_reminder:YYYY-MM-DDTHH:MI' (no '#1h').
SELECT pg_temp.place(interval '20 hours', interval '3 days');
SELECT 'T1 both 24h' AS test, r_message_kind FROM _due;

-- T2. Once sent, not again.  Expect 0.
SELECT pg_temp.logged((SELECT r_message_kind FROM _due), now());
SELECT 'T2 both 24h sent' AS test, count(*) AS expect_0 FROM _due;

-- T3. Both mode, 45 min ahead -> the 1h reminder, '#1h' key.
--     Expect: 1 row ending in '#1h'.
SELECT pg_temp.place(interval '45 minutes', interval '3 days');
SELECT 'T3 both 1h' AS test, r_message_kind FROM _due;

-- T4. 24h reminder for this slot already sent (old key, created 20h before) ->
--     the 1h reminder is STILL due.  Expect 1 row ending in '#1h'.
SELECT pg_temp.logged(
  'booking_reminder:' || to_char((now() AT TIME ZONE 'Asia/Jerusalem') + interval '45 minutes', 'YYYY-MM-DD"T"HH24:MI'),
  now() - interval '19 hours 15 minutes');
SELECT 'T4 24h sent, 1h still due' AS test, r_message_kind FROM _due;

-- T5. '#1h' sent -> nothing.  Expect 0.
SELECT pg_temp.logged((SELECT r_message_kind FROM _due), now());
SELECT 'T5 both 1h sent' AS test, count(*) AS expect_0 FROM _due;

-- T6. Switch both -> single 1h after the '#1h' went out (booking made 10h
--     ahead, so no 24h row exists) -> NOT resent.  Expect 0.
SELECT pg_temp.place(interval '45 minutes', interval '10 hours');
SELECT pg_temp.logged((SELECT r_message_kind FROM _due), now());
UPDATE public.provider_profiles SET whatsapp_reminder_both = false, whatsapp_reminder_hours = 1
WHERE id = (SELECT provider_id FROM _t);
SELECT 'T6 both->1h no resend' AS test, count(*) AS expect_0 FROM _due;

-- T7. Single 1h mode, old key sent, then switch 1h -> both -> NOT resent.
--     Expect: first 1 row (old key, no '#1h'), then 0.
SELECT pg_temp.place(interval '45 minutes', interval '3 days');
SELECT 'T7a single 1h key' AS test, r_message_kind FROM _due;
SELECT pg_temp.logged((SELECT r_message_kind FROM _due), now());
UPDATE public.provider_profiles SET whatsapp_reminder_both = true
WHERE id = (SELECT provider_id FROM _t);
SELECT 'T7b 1h->both no resend' AS test, count(*) AS expect_0 FROM _due;

-- T8. Single 24h mode, sent, then switch 24h -> both -> NOT resent.
--     Expect: 0.
UPDATE public.provider_profiles SET whatsapp_reminder_both = false, whatsapp_reminder_hours = 24
WHERE id = (SELECT provider_id FROM _t);
SELECT pg_temp.place(interval '20 hours', interval '3 days');
SELECT pg_temp.logged((SELECT r_message_kind FROM _due), now());
UPDATE public.provider_profiles SET whatsapp_reminder_both = true
WHERE id = (SELECT provider_id FROM _t);
SELECT 'T8 24h->both no resend' AS test, count(*) AS expect_0 FROM _due;

-- T9. Both mode, booking MADE 2h ago for 20h ahead -> no 24h reminder.
--     Expect 0.
SELECT pg_temp.place(interval '20 hours', interval '2 hours');
SELECT 'T9 made <24h ahead: no 24h' AS test, count(*) AS expect_0 FROM _due;

-- T10. ...but that same booking gets its 1h reminder.
--      Expect 1 row ending in '#1h'.
SELECT pg_temp.place(interval '45 minutes', interval '19 hours');
SELECT 'T10 made <24h ahead: 1h yes' AS test, r_message_kind FROM _due;

-- T11. Both mode, booking made 10 min ago for 45 min ahead -> none.  Expect 0.
SELECT pg_temp.place(interval '45 minutes', interval '10 minutes');
SELECT 'T11 made <1h ahead: none' AS test, count(*) AS expect_0 FROM _due;

-- T12. SINGLE 24h mode is NOT subject to the created-late rule (unchanged
--      behaviour, ticketed): made 2h ago for 20h ahead -> still due.
--      Expect 1 row, old key.
UPDATE public.provider_profiles SET whatsapp_reminder_both = false, whatsapp_reminder_hours = 24
WHERE id = (SELECT provider_id FROM _t);
SELECT pg_temp.place(interval '20 hours', interval '2 hours');
SELECT 'T12 single 24h unchanged' AS test, r_message_kind FROM _due;

-- T13. Reschedule after the 24h reminder: new slot -> new key, due again.
--      Expect 1 row whose key differs from the logged one.
UPDATE public.provider_profiles SET whatsapp_reminder_both = true
WHERE id = (SELECT provider_id FROM _t);
SELECT pg_temp.place(interval '20 hours', interval '3 days');
SELECT pg_temp.logged((SELECT r_message_kind FROM _due), now());
UPDATE public.bookings
SET booking_date = ((now() AT TIME ZONE 'Asia/Jerusalem') + interval '22 hours')::date,
    booking_time = to_char((now() AT TIME ZONE 'Asia/Jerusalem') + interval '22 hours', 'HH24:MI')
WHERE id = (SELECT booking_id FROM _t);
SELECT 'T13 rescheduled' AS test, r_message_kind,
       r_message_kind <> (SELECT message_kind FROM public.whatsapp_send_log
                          WHERE booking_id = (SELECT booking_id FROM _t)) AS new_key
FROM _due;

-- T14. Reminders switched off -> nothing, in both mode.  Expect 0.
UPDATE public.provider_profiles SET whatsapp_reminder_enabled = false
WHERE id = (SELECT provider_id FROM _t);
SELECT 'T14 disabled' AS test, count(*) AS expect_0 FROM _due;

ROLLBACK;

-- After the rollback.  Expect: both_on = 0.
SELECT count(*) FILTER (WHERE whatsapp_reminder_both) AS both_on FROM public.provider_profiles;


-- ═════════════════════════════════════════════════════════════════════════════
-- §E. ROLLBACK — only after the UI and the Edge Function are reverted
-- ═════════════════════════════════════════════════════════════════════════════
-- 1. Run the CREATE OR REPLACE saved from 0.1, then:
-- REVOKE ALL ON FUNCTION public.get_due_whatsapp_reminders(integer) FROM PUBLIC;
-- GRANT EXECUTE ON FUNCTION public.get_due_whatsapp_reminders(integer) TO service_role;
-- 2. 0.3 hash is back to 7fa44c7143444f91af770654cf034aa6.
-- 3. Optional — the column is harmless if left:
-- ALTER TABLE public.provider_profiles DROP COLUMN IF EXISTS whatsapp_reminder_both;
