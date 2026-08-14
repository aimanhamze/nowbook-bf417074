-- WhatsApp booking-confirmation messages — provider opt-in + send ledger.
--
-- Backs the `whatsapp-booking-confirm` Edge Function, which sends a
-- Meta-approved WhatsApp template to the customer when a booking becomes
-- confirmed. Two templates exist (Hebrew / Arabic) with an identical
-- 5-parameter body; the provider picks which one their customers receive.
--
-- STRICTLY ADDITIVE. Two new columns with safe defaults plus one new private
-- table. Nothing existing references either, so every current provider and
-- every current code path behaves exactly as before until a provider opts in.
--
-- DELIBERATELY NOT TOUCHED (verified against the live DB before writing):
--   * bookings_status_check / chk_valid_status — two duplicate CHECK
--     constraints on bookings.status carrying identical value sets
--     ('pending','confirmed','cancelled','completed'). Pre-existing drift,
--     out of scope for this branch.
--   * prevent_booking_conflicts, enforce_booking_approval_status, and every
--     other booking trigger.
--   * otp_requests / sendpulse_token_cache — tables belonging to an unmerged
--     OTP branch that may yet be discarded. NOTHING here references them, and
--     the Edge Function caches its SendPulse OAuth token in module scope
--     precisely so dropping those tables can never break this feature.
--
-- NOTE FOR THE FUNCTION AUTHOR: bookings.status allows 'completed' as well as
-- 'confirmed'. The send must test `status = 'confirmed'` exactly — never
-- "not pending" — or a completed booking would trigger a late confirmation.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- §1. Provider opt-in
-- ─────────────────────────────────────────────────────────────────────────────
-- Default OFF: an existing provider must deliberately enable this before a
-- single message is sent on their behalf. Language defaults to Hebrew, matching
-- the app's default locale.

ALTER TABLE public.provider_profiles
  ADD COLUMN IF NOT EXISTS whatsapp_confirm_enabled  boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS whatsapp_message_language text    NOT NULL DEFAULT 'he';

-- Only 'he' and 'ar' are valid: there is no approved English template, so an
-- 'en' value would have no template to send and would fail at Meta.
-- Dropped first so re-running the migration cannot accumulate duplicates —
-- the exact drift that bookings.status already suffers from.
ALTER TABLE public.provider_profiles
  DROP CONSTRAINT IF EXISTS provider_profiles_whatsapp_message_language_check;

ALTER TABLE public.provider_profiles
  ADD CONSTRAINT provider_profiles_whatsapp_message_language_check
  CHECK (whatsapp_message_language IN ('he', 'ar'));

COMMENT ON COLUMN public.provider_profiles.whatsapp_confirm_enabled IS
  'Provider opt-in for WhatsApp booking-confirmation messages. Default false; no message is sent for a provider with this off.';
COMMENT ON COLUMN public.provider_profiles.whatsapp_message_language IS
  'Which approved WhatsApp template to send: he | ar. Resolved server-side only — never from a client-supplied value.';

-- ─────────────────────────────────────────────────────────────────────────────
-- §2. whatsapp_send_log — send ledger AND idempotency guard
-- ─────────────────────────────────────────────────────────────────────────────
-- Every send is billable and goes out from the business's WhatsApp number, so
-- "send exactly once per booking" is enforced HERE, in the database, not in
-- application logic that a double-click or a retry can race past.

CREATE TABLE IF NOT EXISTS public.whatsapp_send_log (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  booking_id   uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,

  -- The kind of message sent for that booking. Today always 'booking_confirm'.
  -- Deliberately free text rather than an enum: if a rescheduled booking should
  -- later re-send, the kind can carry the slot it refers to (e.g.
  -- 'booking_confirm:2026-08-15T14:30') and the unique index below keeps
  -- working unchanged — no schema migration needed for that decision.
  message_kind text NOT NULL DEFAULT 'booking_confirm',

  -- Denormalized for auditing: "what did this provider send, and when" stays
  -- answerable without joining bookings, whose rows may be deleted.
  provider_id  uuid REFERENCES public.provider_profiles(id) ON DELETE CASCADE,

  -- Digits-only recipient, as handed to SendPulse (e.g. 972501234567).
  -- Retained for delivery diagnostics and billing reconciliation.
  phone_digits text,

  template_name text,
  language_code text,

  -- 'sending' is written BEFORE the API call to claim the booking; the row is
  -- then moved to a terminal state.
  --   sent    — SendPulse accepted the message
  --   failed  — SendPulse rejected it, or the call threw
  --   skipped — never attempted (no phone / invalid phone / cap reached)
  status text NOT NULL DEFAULT 'sending',

  -- WhatsApp message id, when SendPulse returns one. Not needed yet; a future
  -- button-enabled template needs it to correlate replies. NEVER fabricated —
  -- if the response omits it, the send is still recorded as successful and
  -- missing_message_id is set so the gap is queryable rather than invisible.
  sendpulse_message_id text,
  missing_message_id   boolean NOT NULL DEFAULT false,

  error_code text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.whatsapp_send_log
  DROP CONSTRAINT IF EXISTS whatsapp_send_log_status_check;

ALTER TABLE public.whatsapp_send_log
  ADD CONSTRAINT whatsapp_send_log_status_check
  CHECK (status IN ('sending', 'sent', 'failed', 'skipped'));

-- ── THE idempotency guard ────────────────────────────────────────────────────
-- Claim-before-send: the function INSERTs a 'sending' row first. Two concurrent
-- confirmations race on this index; the loser gets unique violation 23505 and
-- returns "already handled" WITHOUT calling SendPulse.
--
-- Deliberately a FULL unique index, not a partial one over status='sent'. A
-- partial index would free the claim the moment a send failed, re-opening the
-- double-send window on retry — and a "failure" that was actually delivered
-- (SendPulse accepted, then the response was lost) would produce a duplicate
-- message. A stuck claim is recoverable by hand; a duplicate message to a real
-- customer is not.
--
-- To deliberately permit a re-send (e.g. after correcting a bad phone number),
-- delete the log row for that booking. That is an explicit admin action by
-- design — there is no automatic retry anywhere in this feature.
CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_send_log_booking_kind_key
  ON public.whatsapp_send_log (booking_id, message_kind);

-- Audit support only: per-provider send history, newest first. The runaway-loop
-- ceiling is the UNIQUE index above (one message per booking, ever) and the
-- WHATSAPP_CONFIRM_PHONES allowlist — not a rate cap.
CREATE INDEX IF NOT EXISTS whatsapp_send_log_provider_created_idx
  ON public.whatsapp_send_log (provider_id, created_at DESC);

-- ── Access ───────────────────────────────────────────────────────────────────
-- RLS on with ZERO policies = anon and authenticated get nothing. service_role
-- has BYPASSRLS, which is the only way this table is ever touched.
-- Do NOT add FORCE ROW LEVEL SECURITY: it would also apply to the table owner
-- and break any SECURITY DEFINER helper added here later.
ALTER TABLE public.whatsapp_send_log ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.whatsapp_send_log FROM anon, authenticated;

COMMENT ON TABLE public.whatsapp_send_log IS
  'Ledger of outbound WhatsApp booking-confirmation messages, and the idempotency guard that makes each send once-only. Edge Function / service-role access only; no client access, referenced by no existing feature.';

COMMIT;
