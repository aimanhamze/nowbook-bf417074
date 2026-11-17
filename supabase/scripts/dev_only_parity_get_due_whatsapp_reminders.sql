-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  DEV ONLY (ovpfjlqlfzxjfcbrtwra). NOT A MIGRATION.                       ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- Schema parity: DEV's get_due_whatsapp_reminders is an OLD body without the
-- walk-in consent predicate ("OR b.whatsapp_consent"). Read by the user
-- 2026-11-17:
--
--   DEV   normalised md5 8c956a4f96d7c750abdd59fe910a0e8f   (old body)
--   PROD  normalised md5 7fa44c7143444f91af770654cf034aa6   (20260916000001 §3)
--
-- NOTE: 8c956a4f… is NOT the hash of the repo's 20260814000002 body either
-- (that is 1e31f9be02dc7793be20233afdc1656d). So DEV holds a body that matches
-- no repo file. This script replaces it anyway, because that is the point, but
-- if you want a record of what DEV had, save
--   SELECT pg_get_functiondef('public.get_due_whatsapp_reminders(integer)'::regprocedure);
-- before running.
--
-- This installs EXACTLY the body of 20260916000001 §3 (copied from that file
-- byte for byte), so DEV then passes the guard in 20261116000001 §1.
--
-- SAFE IF PASTED INTO PROD: the guard aborts before any change unless the live
-- hash is exactly 8c956a4f…. PROD is 7fa44c…, so nothing happens there.
--
-- Grants are NOT touched: CREATE OR REPLACE keeps the existing ACL. The
-- anon/authenticated EXECUTE hole is closed by 20261116000001 §4, on both
-- projects, right after this.
--
-- Requires bookings.whatsapp_consent on DEV (the body references it); the
-- guard checks for it.
--
-- Run the whole file at once. The LAST statement prints the new hash, which
-- must be 7fa44c7143444f91af770654cf034aa6.

BEGIN;

SET LOCAL lock_timeout = '5s';

DO $guard$
DECLARE
  v_fn   regprocedure := to_regprocedure('public.get_due_whatsapp_reminders(integer)');
  v_hash text;
BEGIN
  IF v_fn IS NULL THEN
    RAISE EXCEPTION 'ABORT: get_due_whatsapp_reminders(integer) does not exist. Nothing changed.';
  END IF;

  SELECT md5(btrim(regexp_replace(p.prosrc, '[[:space:]]+', ' ', 'g'), ' '))
  INTO v_hash
  FROM pg_proc p
  WHERE p.oid = v_fn;

  IF v_hash <> '8c956a4f96d7c750abdd59fe910a0e8f' THEN
    RAISE EXCEPTION 'ABORT: live hash is %, not the DEV drift hash 8c956a4f96d7c750abdd59fe910a0e8f (is this PROD, or already fixed?). Nothing changed.', v_hash;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'bookings'
                    AND column_name = 'whatsapp_consent') THEN
    RAISE EXCEPTION 'ABORT: bookings.whatsapp_consent does not exist on this database; the 20260916000001 body needs it. Nothing changed.';
  END IF;
END
$guard$;

-- ── Verbatim from supabase/migrations/20260916000001_bookings_whatsapp_consent.sql §3 ──
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
      -- Walk-ins are excluded UNLESS the provider recorded that the customer
      -- agreed (bookings.whatsapp_consent). Account and linked bookings are
      -- eligible regardless of the flag.
      AND (b.user_id IS NOT NULL OR b.linked_user_id IS NOT NULL
           OR b.whatsapp_consent)
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
-- ── end verbatim ──

-- Post-check inside the transaction: a wrong result rolls everything back.
DO $check$
DECLARE
  v_hash text;
BEGIN
  SELECT md5(btrim(regexp_replace(prosrc, '[[:space:]]+', ' ', 'g'), ' '))
  INTO v_hash
  FROM pg_proc
  WHERE oid = 'public.get_due_whatsapp_reminders(integer)'::regprocedure;

  IF v_hash <> '7fa44c7143444f91af770654cf034aa6' THEN
    RAISE EXCEPTION 'ABORT: installed body hashes to %, want 7fa44c7143444f91af770654cf034aa6. Rolled back, nothing changed.', v_hash;
  END IF;
END
$check$;

COMMIT;

-- Expect: normalised_md5 = 7fa44c7143444f91af770654cf034aa6 (same as PROD).
SELECT md5(btrim(regexp_replace(prosrc, '[[:space:]]+', ' ', 'g'), ' ')) AS normalised_md5
FROM pg_proc
WHERE oid = 'public.get_due_whatsapp_reminders(integer)'::regprocedure;
