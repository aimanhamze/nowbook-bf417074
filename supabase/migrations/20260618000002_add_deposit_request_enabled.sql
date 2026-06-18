-- Per-provider toggle for the "ask for deposit" button on pending-appointment cards.
-- Default false: existing providers (and new ones) have the deposit button HIDDEN
-- until they opt in from their dashboard (Booking Settings tab). NOT NULL DEFAULT
-- false backfills every existing row to false on apply, which is the intended
-- behavior. This flag only controls visibility of the WhatsApp deposit-request
-- button in PendingTab; the deposit message template itself is unaffected.
ALTER TABLE public.provider_profiles
  ADD COLUMN IF NOT EXISTS deposit_request_enabled boolean NOT NULL DEFAULT false;
