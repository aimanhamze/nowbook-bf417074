-- VERIFY / test plan for 20260814000001_whatsapp_booking_confirm.sql
-- Run AFTER applying the migration.
--
-- §A and §D are read-only. §B proves the client lockout. §C is wrapped in an
-- explicit ROLLBACK and persists nothing.

-- ─────────────────────────────────────────────────────────────────────────────
-- §A. Object checks (read-only)
-- ─────────────────────────────────────────────────────────────────────────────

-- A1. Both provider_profiles columns exist with the correct types and defaults.
--     Expect: whatsapp_confirm_enabled  boolean NO  default false
--             whatsapp_message_language text    NO  default 'he'::text
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name  = 'provider_profiles'
  AND column_name LIKE 'whatsapp%'
ORDER BY column_name;

-- A2. EVERY existing provider is untouched — opted out, defaulted to Hebrew.
--     Expect: enabled_count = 0, and he_count = total_providers.
SELECT count(*)                                            AS total_providers,
       count(*) FILTER (WHERE whatsapp_confirm_enabled)     AS enabled_count,
       count(*) FILTER (WHERE whatsapp_message_language = 'he') AS he_count
FROM public.provider_profiles;

-- A3. Language CHECK exists, exactly once (no duplicate-constraint drift).
--     Expect: exactly ONE row.
SELECT conname, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'public.provider_profiles'::regclass
  AND conname LIKE '%whatsapp%';

-- A4. Ledger table exists with RLS ENABLED and ZERO policies.
--     Expect: relrowsecurity = true, policy_count = 0.
SELECT c.relname,
       c.relrowsecurity AS rls_enabled,
       (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) AS policy_count
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname = 'whatsapp_send_log';

-- A5. anon / authenticated hold NO privileges on the ledger.
--     Expect: ZERO rows. If this returns anything, stop — the browser can read
--     customer phone numbers.
SELECT grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name  = 'whatsapp_send_log'
  AND grantee IN ('anon', 'authenticated');

-- A6. Indexes: the UNIQUE idempotency guard and the provider/date cap index.
--     Expect: whatsapp_send_log_booking_kind_key must say UNIQUE.
SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public' AND tablename = 'whatsapp_send_log'
ORDER BY indexname;

-- A7. Status CHECK is present with the four expected states.
SELECT conname, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'public.whatsapp_send_log'::regclass AND contype = 'c';

-- A8. NON-INTERFERENCE PROOF — bookings.status constraints are UNCHANGED.
--     Expect: the same TWO pre-existing duplicates (bookings_status_check and
--     chk_valid_status), both still listing pending/confirmed/cancelled/completed.
--     This migration must not have added, removed or altered either one.
SELECT conname, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'public.bookings'::regclass AND contype = 'c'
ORDER BY conname;

-- A9. NO DEPENDENCY on the unmerged OTP branch's tables. The new objects must
--     survive otp_requests / sendpulse_token_cache being dropped.
--     Expect: ZERO rows.
SELECT dependent.relname AS dependent_object, referenced.relname AS depends_on
FROM pg_constraint con
JOIN pg_class dependent  ON dependent.oid  = con.conrelid
JOIN pg_class referenced ON referenced.oid = con.confrelid
WHERE dependent.relname = 'whatsapp_send_log'
  AND referenced.relname IN ('otp_requests', 'sendpulse_token_cache');

-- ─────────────────────────────────────────────────────────────────────────────
-- §B. Client lockout (run each as the anon role)
-- ─────────────────────────────────────────────────────────────────────────────
-- B1. Expect: 0 rows — RLS blocks the read even though the table is in `public`.
--     SET LOCAL ROLE anon; SELECT * FROM public.whatsapp_send_log;
--
-- B2. Expect: permission denied / new row violates row-level security.
--     SET LOCAL ROLE anon;
--     INSERT INTO public.whatsapp_send_log (booking_id) VALUES (gen_random_uuid());
--
-- B3. A provider must still be able to READ AND WRITE their own opt-in columns
--     (the settings UI depends on it). Run in the APP as a logged-in provider,
--     or with SET LOCAL ROLE authenticated + a request.jwt.claims override.
--     Expect: the existing provider_profiles UPDATE policy already covers the
--     new columns — no policy change was needed, verify no error is raised.

-- ─────────────────────────────────────────────────────────────────────────────
-- §C. Functional tests. ROLLBACK-wrapped: nothing below is persisted.
--     Requires ONE real booking id — this is the FK target, so a fabricated
--     uuid would fail for the wrong reason.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- Pick any existing booking + its provider to test against.
CREATE TEMP TABLE _t AS
SELECT b.id AS booking_id, b.provider_id
FROM public.bookings b
ORDER BY b.created_at DESC
LIMIT 1;

-- C1. First claim succeeds.
--     Expect: INSERT 0 1.
INSERT INTO public.whatsapp_send_log (booking_id, provider_id, message_kind, status)
SELECT booking_id, provider_id, 'booking_confirm', 'sending' FROM _t;

-- C2. THE CORE TEST — a second claim for the same (booking_id, message_kind)
--     must FAIL. This is what makes a double-click or retry unable to send
--     twice.
--     Expect: ERROR duplicate key value violates unique constraint
--             "whatsapp_send_log_booking_kind_key"  (SQLSTATE 23505)
--     Run this statement on its own and confirm the error, then continue in a
--     fresh transaction (an error aborts the rest of this block).
-- INSERT INTO public.whatsapp_send_log (booking_id, message_kind, status)
-- SELECT booking_id, 'booking_confirm', 'sending' FROM _t;

-- C3. Terminal transition works, and a message id can be recorded.
--     Expect: UPDATE 1, status 'sent'.
UPDATE public.whatsapp_send_log
SET status = 'sent', sendpulse_message_id = 'wamid.TEST', updated_at = now()
WHERE booking_id = (SELECT booking_id FROM _t) AND message_kind = 'booking_confirm';

SELECT 'C3' AS test, status, sendpulse_message_id, missing_message_id
FROM public.whatsapp_send_log WHERE booking_id = (SELECT booking_id FROM _t);

-- C4. A DIFFERENT message_kind for the SAME booking is allowed. This is the
--     forward-compat path for a future reschedule re-send — it must not need a
--     schema change.
--     Expect: INSERT 0 1.
INSERT INTO public.whatsapp_send_log (booking_id, message_kind, status)
SELECT booking_id, 'booking_confirm:2026-08-15T14:30', 'sending' FROM _t;

-- C5. Status CHECK rejects an unknown state.
--     Expect: ERROR violates check constraint "whatsapp_send_log_status_check".
-- INSERT INTO public.whatsapp_send_log (booking_id, message_kind, status)
-- SELECT booking_id, 'bogus-kind', 'delivered' FROM _t;

-- C6. Language CHECK rejects 'en' — there is no approved English template.
--     Expect: ERROR violates check constraint
--             "provider_profiles_whatsapp_message_language_check".
-- UPDATE public.provider_profiles SET whatsapp_message_language = 'en'
-- WHERE id = (SELECT provider_id FROM _t);

-- C7. 'ar' is accepted.
--     Expect: UPDATE 1.
UPDATE public.provider_profiles SET whatsapp_message_language = 'ar'
WHERE id = (SELECT provider_id FROM _t);

-- C8. Audit query shape — per-provider send history over a window. There is no
--     rate cap; the UNIQUE index and the allowlist are the ceiling.
--     Expect: a small integer; EXPLAIN shows whatsapp_send_log_provider_created_idx.
SELECT 'C8' AS test, count(*) AS sends_last_24h
FROM public.whatsapp_send_log
WHERE provider_id = (SELECT provider_id FROM _t)
  AND created_at >= now() - interval '24 hours';

ROLLBACK;

-- Confirm the rollback really did leave nothing behind.
-- Expect: 0.
SELECT count(*) AS rows_left FROM public.whatsapp_send_log;

-- ─────────────────────────────────────────────────────────────────────────────
-- §D. After types.ts is regenerated (pre-Edge-Function gate)
-- ─────────────────────────────────────────────────────────────────────────────
-- D1. `supabase gen types` must now emit whatsapp_confirm_enabled and
--     whatsapp_message_language on provider_profiles, and a whatsapp_send_log
--     table. Once it does, the new hook mutations do NOT need the
--     `as never` cast that useProviderProfile.ts:95-110 uses for columns whose
--     migration has not yet been applied.
-- D2. Sanity-check that no existing provider was flipped on by the migration:
--       SELECT business_name FROM public.provider_profiles
--       WHERE whatsapp_confirm_enabled;
--     Expect: zero rows until someone deliberately opts in via the new UI.

-- ─────────────────────────────────────────────────────────────────────────────
-- §E. OPERATIONAL — stuck-claim check. Run periodically during allowlist
--     rollout, BY HAND.
-- ─────────────────────────────────────────────────────────────────────────────
-- The Edge Function writes a 'sending' row to claim a booking before calling
-- SendPulse, then moves it to a terminal state. Its catch block resolves a claim
-- that never got there. But if the Deno instance is KILLED between the two
-- (timeout, OOM, redeploy), no catch runs and the row stays 'sending' forever.
--
-- Because the UNIQUE index treats 'sending' as a claim, such a booking will
-- never be retried — it silently got no confirmation message.
--
-- E1. Find stranded claims.
--     Expect: ZERO rows in normal operation.
SELECT id, booking_id, provider_id, created_at, now() - created_at AS stuck_for
FROM public.whatsapp_send_log
WHERE status = 'sending'
  AND created_at < now() - interval '15 minutes'
ORDER BY created_at;

-- E2. If E1 returns rows, DO NOT bulk-clear them, and DO NOT schedule a job to
--     do it. Auto-clearing a stuck claim re-opens the double-send window, which
--     is the one failure in this feature that cannot be undone: a duplicate
--     WhatsApp message to a real customer is unrecallable, and repeated
--     duplicates degrade the sender quality rating for ALL traffic.
--
--     A non-empty E1 is a SYMPTOM, not a queue to drain. It means the function
--     is dying mid-flight — investigate the Edge Function logs for timeouts
--     before touching any row.
--
--     To deliberately release ONE claim after confirming from the SendPulse
--     dashboard that no message went out for that booking:
--       DELETE FROM public.whatsapp_send_log WHERE id = '<the id from E1>';
--     One row at a time, each justified by evidence. Never a blanket DELETE.
