-- Per-provider customer-cancellation cutoff (in hours before the appointment).
-- A customer may self-cancel a booking only while it is still more than
-- `cancellation_notice_hours` away; inside that window the cancel button is
-- replaced with call/WhatsApp (UI-only enforcement, same as the previous
-- hardcoded 5-hour rule in Bookings.tsx — there is no server-side gate).
--
-- NOT NULL DEFAULT 5 backfills every existing row to 5 on apply, so launch
-- behavior is unchanged (the old hardcoded threshold was also 5). New providers
-- also default to 5. 0 = customers can always cancel (no late-cancel block).
--
-- CHECK 0..72 mirrors the UI range (0–72h, i.e. up to 3 days) and protects the
-- column from out-of-range writes regardless of client. This is distinct from
-- `min_lead_time_minutes` (the BOOKING lead time) — different feature, untouched.
ALTER TABLE public.provider_profiles
  ADD COLUMN IF NOT EXISTS cancellation_notice_hours integer NOT NULL DEFAULT 5;

ALTER TABLE public.provider_profiles
  DROP CONSTRAINT IF EXISTS provider_profiles_cancellation_notice_hours_check;

ALTER TABLE public.provider_profiles
  ADD CONSTRAINT provider_profiles_cancellation_notice_hours_check
  CHECK (cancellation_notice_hours BETWEEN 0 AND 72);
