-- VERIFY / test plan for 20260916000001_bookings_whatsapp_consent.sql
--
-- ORDER:
--   §0  BEFORE the migration. REQUIRED. Read-only.
--   §A  after the migration. Read-only object checks.
--   §B  after the migration. Read-only: proves no existing row changed behaviour.
--   §C  after the migration. ROLLBACK-wrapped behaviour + RLS tests; persists nothing.
--   §D  ongoing monitoring, once the functions and UI ship.
--   §E  rollback script (commented out).
--
-- Deploy order (repeated from the migration header):
--   migration -> both Edge Functions -> UI. Rollback in reverse.

-- ═════════════════════════════════════════════════════════════════════════════
-- §0. PRE-APPLY — RUN BEFORE THE MIGRATION. REQUIRED, NOT OPTIONAL.
-- ═════════════════════════════════════════════════════════════════════════════
-- The migration CREATE OR REPLACEs get_due_whatsapp_reminders. Do not apply it
-- until the live definition below has been read and diffed against
-- supabase/migrations/20260814000002_whatsapp_booking_reminder.sql §2.
-- (bookings.duration_override reached prod with no migration; the repo is not
-- proof of what is deployed.)
--
-- SAVE THE OUTPUT OF 0.1 AND 0.2. It is the rollback source for §E.

-- 0.1 The live function, verbatim. Diff against the repo file.
--     Expect: identical to 20260814000002 §2, apart from whitespace/line endings.
SELECT pg_get_functiondef('public.get_due_whatsapp_reminders(integer)'::regprocedure);

-- 0.2 Owner, security, search_path and grants — restored as-is on rollback.
--     Expect: prosecdef = true; proconfig = {"search_path=public, pg_temp"};
--             EXECUTE granted to service_role only (plus the owner).
SELECT p.proname,
       pg_get_userbyid(p.proowner)       AS owner,
       p.prosecdef,
       p.proconfig,
       p.provolatile,
       p.proacl
FROM pg_proc p
WHERE p.oid = 'public.get_due_whatsapp_reminders(integer)'::regprocedure;

-- 0.3 No other overloads exist that the migration would leave stale.
--     Expect: exactly ONE row, args = 'p_limit integer DEFAULT 100'.
SELECT p.oid::regprocedure AS signature,
       pg_get_function_arguments(p.oid) AS args
FROM pg_proc p
WHERE p.proname = 'get_due_whatsapp_reminders'
  AND p.pronamespace = 'public'::regnamespace;

-- 0.4 The same hash the migration's §1 guard computes.
--     Expect: 1e31f9be02dc7793be20233afdc1656d  (the 20260814000002 body).
--     Anything else means the migration WILL ABORT — and that prod differs from
--     the repo. Investigate with 0.1; do not edit the hash in the migration.
SELECT md5(btrim(regexp_replace(prosrc, '[[:space:]]+', ' ', 'g'), ' ')) AS normalised_md5
FROM pg_proc
WHERE oid = 'public.get_due_whatsapp_reminders(integer)'::regprocedure;

-- 0.5 The column does not exist yet (and nothing with a similar name drifted in).
--     Expect: 0 rows.
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'bookings'
  AND column_name ILIKE '%consent%';

-- 0.6 Baseline size of bookings, for the metadata-only ALTER.
--     Informational: NOT NULL DEFAULT false does not rewrite the table on PG 11+.
SELECT count(*) AS bookings_rows, current_setting('server_version') AS pg_version
FROM public.bookings;


-- ═════════════════════════════════════════════════════════════════════════════
-- §A. OBJECT CHECKS — after the migration (read-only)
-- ═════════════════════════════════════════════════════════════════════════════

-- A1. Column shape.
--     Expect: whatsapp_consent | boolean | NO | false
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'bookings'
  AND column_name = 'whatsapp_consent';

-- A2. Every existing row is false.
--     Expect: consented = 0.
SELECT count(*)                                  AS total,
       count(*) FILTER (WHERE whatsapp_consent)  AS consented
FROM public.bookings;

-- A3. The function now carries the new predicate, and hashes to this
--     migration's body.
--     Expect: has_consent_predicate = true;
--             normalised_md5 = 7fa44c7143444f91af770654cf034aa6.
SELECT position('OR b.whatsapp_consent' IN prosrc) > 0                     AS has_consent_predicate,
       md5(btrim(regexp_replace(prosrc, '[[:space:]]+', ' ', 'g'), ' ')) AS normalised_md5
FROM pg_proc
WHERE oid = 'public.get_due_whatsapp_reminders(integer)'::regprocedure;

-- A4. Security properties survived the replace. Compare with 0.2.
--     Expect: identical owner, prosecdef, proconfig, provolatile, proacl.
SELECT p.proname,
       pg_get_userbyid(p.proowner) AS owner,
       p.prosecdef,
       p.proconfig,
       p.provolatile,
       p.proacl
FROM pg_proc p
WHERE p.oid = 'public.get_due_whatsapp_reminders(integer)'::regprocedure;

--     Expect: only service_role (plus the owner).
SELECT grantee, privilege_type
FROM information_schema.routine_privileges
WHERE routine_schema = 'public' AND routine_name = 'get_due_whatsapp_reminders'
ORDER BY grantee;

-- A5. Still exactly one overload.
--     Expect: 1.
SELECT count(*) AS overloads
FROM pg_proc
WHERE proname = 'get_due_whatsapp_reminders'
  AND pronamespace = 'public'::regnamespace;


-- ═════════════════════════════════════════════════════════════════════════════
-- §B. NO BEHAVIOUR CHANGE FOR EXISTING ROWS — after the migration (read-only)
-- ═════════════════════════════════════════════════════════════════════════════
-- Runs the NEW function and an inline replica of the OLD 20260814000002
-- predicate in ONE statement, so now() is the same instant for both. While
-- every row is whatsapp_consent = false (A2), the two sets must be identical.
-- Run this BEFORE any consented walk-in exists (i.e. before the UI ships).
--
-- Expect: only_in_new = 0 AND only_in_old = 0.

WITH new_rpc AS (
  SELECT r_booking_id, r_provider_id, r_message_kind
  FROM public.get_due_whatsapp_reminders(100000)
),
old_predicate AS (
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
      AND (b.user_id IS NOT NULL OR b.linked_user_id IS NOT NULL)   -- the OLD gate
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
SELECT (SELECT count(*) FROM (SELECT * FROM new_rpc EXCEPT SELECT * FROM old_predicate) x) AS only_in_new,
       (SELECT count(*) FROM (SELECT * FROM old_predicate EXCEPT SELECT * FROM new_rpc) x) AS only_in_old,
       (SELECT count(*) FROM new_rpc)                                                      AS due_now;


-- ═════════════════════════════════════════════════════════════════════════════
-- §C. BEHAVIOUR + RLS — ROLLBACK-wrapped; nothing below is persisted
-- ═════════════════════════════════════════════════════════════════════════════
-- Uses a real walk-in and a real provider, mutated in-transaction. Run the whole
-- block at once. If moving the booking raises from prevent_booking_conflicts or
-- the lead-time trigger, pick a different walk-in (change the ORDER BY / OFFSET)
-- — that is a test-data collision, not a failure of this migration.
--
-- If _t is empty, there is no confirmed unlinked walk-in in the database to test
-- with; every §C result will read 0 and proves nothing. Stop and say so.

BEGIN;

CREATE TEMP TABLE _t AS
SELECT b.id AS booking_id, b.provider_id, pp.user_id AS provider_user_id
FROM public.bookings b
JOIN public.provider_profiles pp ON pp.id = b.provider_id
WHERE b.status = 'confirmed'
  AND b.user_id IS NULL
  AND b.linked_user_id IS NULL
ORDER BY b.created_at DESC
LIMIT 1;

-- C0. A test walk-in was found.
--     Expect: 1.
SELECT 'C0' AS test, count(*) AS should_be_one FROM _t;

-- Opt the provider in at a 24h lead and move the walk-in to ~20h out, inside
-- the [18h, 24h] window. Israel wall-clock, as stored.
UPDATE public.provider_profiles
SET whatsapp_reminder_enabled = true, whatsapp_reminder_hours = 24
WHERE id = (SELECT provider_id FROM _t);

UPDATE public.bookings
SET booking_date = ((now() AT TIME ZONE 'Asia/Jerusalem') + interval '20 hours')::date,
    booking_time = to_char((now() AT TIME ZONE 'Asia/Jerusalem') + interval '20 hours', 'HH24:MI'),
    whatsapp_consent = false
WHERE id = (SELECT booking_id FROM _t);

-- C1. Walk-in, in window, NO consent -> still excluded.
--     Expect: 0.
SELECT 'C1' AS test, count(*) AS should_be_zero
FROM public.get_due_whatsapp_reminders(100000) r, _t
WHERE r.r_booking_id = _t.booking_id;

-- C2. Same walk-in WITH consent -> due, slot-scoped kind.
--     Expect: 1 row; r_message_kind like 'booking_reminder:YYYY-MM-DDTHH:MI'.
UPDATE public.bookings SET whatsapp_consent = true
WHERE id = (SELECT booking_id FROM _t);

SELECT 'C2' AS test, r.r_booking_id, r.r_message_kind
FROM public.get_due_whatsapp_reminders(100000) r, _t
WHERE r.r_booking_id = _t.booking_id;

-- C3. Consent does NOT bypass the provider's reminder switch.
--     Expect: 0.
UPDATE public.provider_profiles SET whatsapp_reminder_enabled = false
WHERE id = (SELECT provider_id FROM _t);

SELECT 'C3' AS test, count(*) AS should_be_zero
FROM public.get_due_whatsapp_reminders(100000) r, _t
WHERE r.r_booking_id = _t.booking_id;

UPDATE public.provider_profiles SET whatsapp_reminder_enabled = true
WHERE id = (SELECT provider_id FROM _t);

-- C4. Consent does NOT bypass the provider's lead time: switch to 1h and the
--     20h-out booking is no longer due.
--     Expect: 0.
UPDATE public.provider_profiles SET whatsapp_reminder_hours = 1
WHERE id = (SELECT provider_id FROM _t);

SELECT 'C4' AS test, count(*) AS should_be_zero
FROM public.get_due_whatsapp_reminders(100000) r, _t
WHERE r.r_booking_id = _t.booking_id;

UPDATE public.provider_profiles SET whatsapp_reminder_hours = 24
WHERE id = (SELECT provider_id FROM _t);

-- C5. Consent does NOT bypass the ledger: once reminded for this slot, gone.
--     Expect: 0.
INSERT INTO public.whatsapp_send_log (booking_id, message_kind, provider_id, status)
SELECT r.r_booking_id, r.r_message_kind, r.r_provider_id, 'sent'
FROM public.get_due_whatsapp_reminders(100000) r, _t
WHERE r.r_booking_id = _t.booking_id;

SELECT 'C5' AS test, count(*) AS should_be_zero
FROM public.get_due_whatsapp_reminders(100000) r, _t
WHERE r.r_booking_id = _t.booking_id;

DELETE FROM public.whatsapp_send_log
WHERE booking_id = (SELECT booking_id FROM _t);

-- C6. Consent does NOT bypass status: a cancelled consented walk-in is excluded.
--     Expect: 0.
UPDATE public.bookings SET status = 'cancelled'
WHERE id = (SELECT booking_id FROM _t);

SELECT 'C6' AS test, count(*) AS should_be_zero
FROM public.get_due_whatsapp_reminders(100000) r, _t
WHERE r.r_booking_id = _t.booking_id;

UPDATE public.bookings SET status = 'confirmed'
WHERE id = (SELECT booking_id FROM _t);

-- C7. Ruling B — LINKED walk-ins are unchanged: eligible with consent = false.
--     Links the walk-in to its own provider's user id purely as a stand-in
--     account id (linked_user_id has no trigger on UPDATE).
--     Expect: 1.
UPDATE public.bookings
SET linked_user_id = (SELECT provider_user_id FROM _t),
    whatsapp_consent = false
WHERE id = (SELECT booking_id FROM _t);

SELECT 'C7' AS test, count(*) AS should_be_one
FROM public.get_due_whatsapp_reminders(100000) r, _t
WHERE r.r_booking_id = _t.booking_id;

UPDATE public.bookings SET linked_user_id = NULL, whatsapp_consent = false
WHERE id = (SELECT booking_id FROM _t);

-- ── RLS: who can set whatsapp_consent on a walk-in ───────────────────────────
-- The authenticated role cannot read the temp table, so ids travel in
-- transaction-local settings.
SELECT set_config('verify.walkin_id',   (SELECT booking_id::text       FROM _t), true),
       set_config('verify.provider_uid', (SELECT provider_user_id::text FROM _t), true),
       set_config('verify.customer_uid', (
         SELECT ur.user_id::text
         FROM public.user_roles ur
         WHERE ur.role = 'user'
           AND ur.user_id <> (SELECT provider_user_id FROM _t)
         LIMIT 1), true);

-- C8. A CUSTOMER cannot set consent on a walk-in (UPDATE policy requires
--     auth.uid() = user_id, and a walk-in's user_id is NULL).
--     Expect: 0 rows updated.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
                  json_build_object('sub', current_setting('verify.customer_uid'), 'role', 'authenticated')::text,
                  true);

WITH u AS (
  UPDATE public.bookings SET whatsapp_consent = true
  WHERE id = current_setting('verify.walkin_id')::uuid
  RETURNING 1
)
SELECT 'C8' AS test, count(*) AS should_be_zero FROM u;

-- C9. The OWNING PROVIDER can (existing "Providers can update bookings for
--     their business" policy — no policy was added or changed).
--     Expect: 1 row updated.
SELECT set_config('request.jwt.claims',
                  json_build_object('sub', current_setting('verify.provider_uid'), 'role', 'authenticated')::text,
                  true);

WITH u AS (
  UPDATE public.bookings SET whatsapp_consent = true
  WHERE id = current_setting('verify.walkin_id')::uuid
  RETURNING 1
)
SELECT 'C9' AS test, count(*) AS should_be_one FROM u;

-- C10. The client roles still cannot call the RPC.
--      Expect: ERROR permission denied for function get_due_whatsapp_reminders.
--      Run on its own if you want to see it; it aborts the transaction, which
--      rolls back like the ROLLBACK below would anyway.
--   SELECT * FROM public.get_due_whatsapp_reminders(1);

RESET ROLE;

ROLLBACK;

-- Confirm the rollback left nothing behind.
-- Expect: consented = 0.
SELECT count(*) FILTER (WHERE whatsapp_consent) AS consented
FROM public.bookings;


-- ═════════════════════════════════════════════════════════════════════════════
-- §D. MONITORING — once the Edge Functions and UI have shipped
-- ═════════════════════════════════════════════════════════════════════════════

-- D1. Consented walk-ins per provider. Consent should only ever appear for
--     providers with whatsapp_confirm_enabled = true (the checkbox is hidden
--     otherwise). Any row with confirm_enabled = false means the UI guard leaked.
SELECT b.provider_id,
       p.business_name,
       p.whatsapp_confirm_enabled AS confirm_enabled,
       count(*)                   AS consented_walkins
FROM public.bookings b
JOIN public.provider_profiles p ON p.id = b.provider_id
WHERE b.whatsapp_consent
  AND b.user_id IS NULL
  AND b.linked_user_id IS NULL
GROUP BY 1, 2, 3
ORDER BY consented_walkins DESC;

-- D2. What actually happened to consented walk-ins' messages.
--     WALKIN_INVALID_PHONE should be ZERO: the UI blocks invalid numbers when the
--     box is ticked, so any occurrence means the UI and function checks drifted.
SELECT CASE WHEN l.message_kind LIKE 'booking_reminder:%' THEN 'booking_reminder'
            ELSE l.message_kind END AS kind,
       l.status,
       l.error_code,
       count(*)
FROM public.whatsapp_send_log l
JOIN public.bookings b ON b.id = l.booking_id
WHERE b.whatsapp_consent
  AND b.user_id IS NULL
  AND b.linked_user_id IS NULL
GROUP BY 1, 2, 3
ORDER BY 1, 2, 3;

-- D3. Sends to walk-ins WITHOUT consent. Must always be empty — any row is the
--     exact damage this feature exists to prevent.
--     Expect: 0 rows.
SELECT l.id, l.booking_id, l.message_kind, l.status, l.created_at
FROM public.whatsapp_send_log l
JOIN public.bookings b ON b.id = l.booking_id
WHERE b.user_id IS NULL
  AND b.linked_user_id IS NULL
  AND NOT b.whatsapp_consent
  AND l.status IN ('sending', 'sent');


-- ═════════════════════════════════════════════════════════════════════════════
-- §E. ROLLBACK — ONLY after the UI and both Edge Functions are reverted
-- ═════════════════════════════════════════════════════════════════════════════
-- Dropping the column while the new functions are deployed breaks every
-- confirmation, account holders included (same failure as a wrong deploy order).
--
-- 1. Restore the function: paste and run the pg_get_functiondef output saved
--    from §0.1 (it is a complete CREATE OR REPLACE statement). Then re-apply the
--    grants captured in §0.2, which for the repo version are:
--
-- REVOKE ALL ON FUNCTION public.get_due_whatsapp_reminders(integer) FROM PUBLIC;
-- GRANT EXECUTE ON FUNCTION public.get_due_whatsapp_reminders(integer) TO service_role;
--
-- 2. Verify: §0.4 hash is back to 1e31f9be02dc7793be20233afdc1656d.
--
-- 3. Drop the column. Consent recorded in the meantime is lost.
--
-- ALTER TABLE public.bookings DROP COLUMN IF EXISTS whatsapp_consent;
