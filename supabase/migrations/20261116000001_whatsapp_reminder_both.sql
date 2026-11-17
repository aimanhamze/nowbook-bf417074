-- WhatsApp reminders — "both" lead time (24 hours AND 1 hour before).
--
-- A provider could choose ONE reminder lead time (1h or 24h). This adds a third
-- choice, "both": the same Meta template goes out twice per appointment, once in
-- each window.
--
-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  ⚠  DEPLOY ORDER — REQUIRED                                              ║
-- ║                                                                          ║
-- ║    1. THIS MIGRATION  (column + get_due_whatsapp_reminders)              ║
-- ║    2. EDGE FUNCTION   whatsapp-booking-reminder                          ║
-- ║    3. THE UI          (/notification-settings third option)              ║
-- ║                                                                          ║
-- ║  The new function SELECTs provider_profiles.whatsapp_reminder_both; on a ║
-- ║  database without the column every reminder run fails.                   ║
-- ║                                                                          ║
-- ║  Migration before the function is SAFE: until the UI ships no provider   ║
-- ║  can be in "both" mode, so the RPC returns exactly what it returns       ║
-- ║  today (VERIFY §B1 proves it). Even if a row were flipped by hand, the   ║
-- ║  old function would skip its '#1h' key as SLOT_CHANGED and write no      ║
-- ║  ledger row — no message, no harm.                                       ║
-- ║                                                                          ║
-- ║  Rollback runs in REVERSE: UI -> function -> this migration (restore the ║
-- ║  §0 dump of the RPC from the VERIFY file; the column may stay).          ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  ⚠  RUN §0 OF THE VERIFY FILE FIRST                                      ║
-- ║  §1 below ENFORCES it: the migration aborts, changing nothing, unless    ║
-- ║  the live body is the 20260916000001 body (or this file's own body, so a ║
-- ║  re-run is safe).                                                        ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- MUST NOT CHANGE — and does not:
--   Providers on a single lead time (1h or 24h) get exactly the reminders they
--   get today, under exactly the same ledger key 'booking_reminder:<slot>'.
--   Every existing provider is whatsapp_reminder_both = false after this runs.
--   VERIFY §B1 compares this function against an inline replica of the old one
--   in a single statement and must return zero differences.
--
-- DELIBERATELY NOT TOUCHED:
--   * whatsapp_reminder_hours and its CHECK (1, 24). In "both" mode it is
--     ignored but kept, so switching back restores a stored value.
--   * whatsapp_send_log — schema and the UNIQUE (booking_id, message_kind)
--     index unchanged. "Both" mode is told apart by the message_kind string.
--   * prevent_booking_conflicts, every trigger on bookings, RLS, the cron job.
--   * Walk-in consent, status and date-prefilter predicates — copied verbatim.
--   * The RPC signature and return columns, so no DROP FUNCTION is needed and
--     the deployed Edge Function keeps working against it.
--
-- ALSO FIXED HERE (security): EXECUTE on get_due_whatsapp_reminders was
-- granted to anon and authenticated on both DEV and PROD. §4 revokes it by
-- name; only service_role keeps it. See §4.
--
-- KNOWN, KEPT (ticket, not this change): in single 24h mode a booking made
-- less than 24h ahead (e.g. 20h) is reminded within ~15 minutes of booking,
-- because the [18h, 24h] window is already open. "Both" mode does not do this
-- (see the created_at rule in §3); single mode is left exactly as it is.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- §1. Guard: refuse to replace a function body we have not seen
-- ─────────────────────────────────────────────────────────────────────────────
-- Same whitespace-normalised md5 as 20260916000001 §1.
--
-- Accepted hashes:
--   7fa44c7143444f91af770654cf034aa6  body of 20260916000001 (expected live)
--   65e695e35cccb6057d41ef2634a9971b  body of §3 below (re-run of this file)
--
-- If this raises: STOP. Diff the VERIFY §0.1 dump against the repo and decide
-- what the live version should be. Do not edit the hash to pass.

DO $guard$
DECLARE
  v_fn   regprocedure := to_regprocedure('public.get_due_whatsapp_reminders(integer)');
  v_hash text;
BEGIN
  IF v_fn IS NULL THEN
    RAISE EXCEPTION 'get_due_whatsapp_reminders(integer) does not exist; aborting';
  END IF;

  SELECT md5(btrim(regexp_replace(p.prosrc, '[[:space:]]+', ' ', 'g'), ' '))
  INTO v_hash
  FROM pg_proc p
  WHERE p.oid = v_fn;

  IF v_hash NOT IN ('7fa44c7143444f91af770654cf034aa6',
                    '65e695e35cccb6057d41ef2634a9971b') THEN
    RAISE EXCEPTION 'live get_due_whatsapp_reminders differs from the repo (normalised md5 %); run VERIFY §0 and diff before applying', v_hash;
  END IF;
END
$guard$;

-- ─────────────────────────────────────────────────────────────────────────────
-- §2. The "both" flag
-- ─────────────────────────────────────────────────────────────────────────────
-- A separate boolean rather than a third value in whatsapp_reminder_hours:
--   * additive — no CHECK change, no rewrite of existing values;
--   * no magic number (25, 0, -1) meaning "both";
--   * the deployed function reads only whatsapp_reminder_hours, so a provider
--     flagged "both" before the new function ships simply keeps getting their
--     single reminder.
-- NOT NULL DEFAULT false with a constant default is metadata-only on PG 11+.

ALTER TABLE public.provider_profiles
  ADD COLUMN IF NOT EXISTS whatsapp_reminder_both boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.provider_profiles.whatsapp_reminder_both IS
  'When true, WhatsApp reminders go out at BOTH 24h and 1h before the appointment and whatsapp_reminder_hours is ignored. Default false (single lead time from whatsapp_reminder_hours). Governed by whatsapp_reminder_enabled.';

-- ─────────────────────────────────────────────────────────────────────────────
-- §3. get_due_whatsapp_reminders — one candidate per (booking, lead)
-- ─────────────────────────────────────────────────────────────────────────────
-- LEADS. Each booking expands to one row per lead: [24, 1] in "both" mode,
-- otherwise [whatsapp_reminder_hours]. Windows are unchanged and DISJOINT
--     lead 24h -> delta in [18h,    24h]
--     lead  1h -> delta in [30min,   1h]
-- so a booking is returned at most once per run, and twice over its lifetime.
--
-- LEDGER KEYS (the string claimed in whatsapp_send_log.message_kind):
--     single mode, either lead    'booking_reminder:<slot>'       (unchanged)
--     both mode, 24h              'booking_reminder:<slot>'       (same key)
--     both mode, 1h               'booking_reminder:<slot>#1h'
--   <slot> is 'YYYY-MM-DDTHH:MI', as before. The '#1h' key keeps the
--   'booking_reminder:' prefix so existing LIKE 'booking_reminder:%' monitoring
--   still counts it. The Edge Function must accept both shapes — see the deploy
--   order above.
--
-- ALREADY SENT? (anti-join), per row:
--     single 24h   old key exists                                   (= today)
--     single 1h    old key exists, OR a '#1h' row exists
--     both 24h     old key exists
--     both 1h      '#1h' row exists, OR an old-key row created less than 6h
--                  before the appointment
--   Why each extra clause is there:
--     * single 1h / '#1h' : switching from both -> 1h after the both-mode 1h
--       reminder went out (on a booking that never had a 24h one) must not
--       resend it. A provider who never used "both" has no '#1h' rows, so for
--       them this is exactly today's check.
--     * both 24h / old key: switching 24h -> both after the 24h reminder went
--       out must not resend it. (An old-key row written in 1h mode cannot
--       exist yet while the 24h window is open: it is only ever written under
--       1h before the slot, and the slot is part of the key.)
--     * both 1h / old key under 6h: switching 1h -> both after the 1h
--       reminder went out must not resend it. An old-key row is written inside
--       the window it was due in — 24h-lead rows at >= 18h before the slot,
--       1h-lead rows at <= 1h — so "created less than 6h before the slot"
--       identifies a 1h reminder unambiguously. Any threshold strictly between
--       1h and 18h works; 6h leaves wide margin on both sides.
--
-- CREATED-LATE RULE ("both" mode only): a lead is skipped when the booking was
-- created after (starts_at - lead). So a booking made 20h ahead gets only the
-- 1h reminder, and one made 45 minutes ahead gets none. Single modes are NOT
-- subject to this rule — that would change today's behaviour (see the ticket
-- note in the header). A pending booking confirmed late is judged by its
-- created_at, not its confirmation time.
--
-- RESCHEDULES: unchanged mechanism — the slot is part of every key, so a moved
-- booking earns fresh reminders for its new slot (24h if the new slot is still
-- >= 18h away and the booking is old enough, then 1h). The old slot's 1h
-- reminder never fires because candidates are built from the CURRENT slot.

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
      b.created_at,
      -- Israel wall-clock -> a true instant, DST-correct.
      ((b.booking_date + left(b.booking_time, 5)::time)
        AT TIME ZONE 'Asia/Jerusalem') AS starts_at,
      p.whatsapp_reminder_both         AS both_mode,
      leads.hours                      AS lead_hours,
      -- The slot key, shared by every lead of this booking.
      'booking_reminder:' || to_char(b.booking_date, 'YYYY-MM-DD')
                          || 'T' || left(b.booking_time, 5) AS slot_key
    FROM public.bookings b
    JOIN public.provider_profiles p ON p.id = b.provider_id
    -- One row per lead: both leads in "both" mode, else the single stored one.
    CROSS JOIN LATERAL unnest(
      CASE WHEN p.whatsapp_reminder_both
           THEN ARRAY[24, 1]
           ELSE ARRAY[p.whatsapp_reminder_hours]
      END
    ) AS leads(hours)
    WHERE b.status = 'confirmed'                        -- exactly; 'completed' is not 'confirmed'
      AND p.whatsapp_reminder_enabled
      -- Walk-ins are excluded UNLESS the provider recorded that the customer
      -- agreed (bookings.whatsapp_consent). Account and linked bookings are
      -- eligible regardless of the flag.
      AND (b.user_id IS NOT NULL OR b.linked_user_id IS NOT NULL
           OR b.whatsapp_consent)
      -- Coarse date prefilter so the planner can use a date index instead of
      -- evaluating AT TIME ZONE over the whole table. Deliberately wider than
      -- any window below (max lead is 24h).
      AND b.booking_date BETWEEN current_date - 1 AND current_date + 2
  ),
  keyed AS (
    SELECT
      c.*,
      -- Returned to the caller so the Edge Function claims the ledger row with
      -- EXACTLY the key this anti-join tested.
      CASE WHEN c.both_mode AND c.lead_hours = 1
           THEN c.slot_key || '#1h'
           ELSE c.slot_key
      END AS reminder_kind
    FROM candidate c
  )
  SELECT k.id, k.provider_id, k.reminder_kind
  FROM keyed k
  WHERE k.starts_at > now()                                        -- HARD GUARD
    AND k.starts_at - now() <= make_interval(hours => k.lead_hours)
    AND k.starts_at - now() >= CASE WHEN k.lead_hours = 1
                                    THEN interval '30 minutes'
                                    ELSE interval '18 hours'
                               END
    -- Created-late rule, "both" mode only.
    AND (NOT k.both_mode
         OR k.created_at <= k.starts_at - make_interval(hours => k.lead_hours))
    AND NOT EXISTS (
      SELECT 1
      FROM public.whatsapp_send_log l
      WHERE l.booking_id = k.id
        AND (
              -- A '#1h' row settles the 1h lead in either mode.
              (k.lead_hours = 1 AND l.message_kind = k.slot_key || '#1h')
              -- The old key settles every lead, except the both-mode 1h lead,
              -- where it counts only if it was itself a 1h reminder.
           OR (l.message_kind = k.slot_key
               AND (NOT (k.both_mode AND k.lead_hours = 1)
                    OR l.created_at > k.starts_at - interval '6 hours'))
            )
    )
  -- Soonest first: under the cap, an urgent reminder must never be starved by
  -- a batch of distant ones.
  ORDER BY k.starts_at
  LIMIT greatest(p_limit, 0);
$fn$;

-- ─────────────────────────────────────────────────────────────────────────────
-- §4. Grants — CLOSE the anon/authenticated hole (service_role only)
-- ─────────────────────────────────────────────────────────────────────────────
-- SECURITY FIX. Read live on DEV and PROD before this migration:
--   proacl = {postgres=X/postgres, anon=X/postgres,
--             authenticated=X/postgres, service_role=X/postgres}
-- The function is SECURITY DEFINER, so anyone holding the public anon key
-- (it ships in the client bundle) could call it and list every due booking's
-- id, provider and slot.
--
-- Why the previous migrations' "REVOKE ... FROM PUBLIC" did not prevent this:
-- Supabase's default privileges grant EXECUTE on new public functions to anon
-- and authenticated BY NAME. Revoking from PUBLIC removes only the PUBLIC
-- pseudo-role grant, never those named grants. They must be revoked by name.
--
-- Nothing legitimate loses access: the only caller is the
-- whatsapp-booking-reminder Edge Function, which uses the service_role key.
-- No client code calls this RPC.
--
-- VERIFY §A4/§A5 assert proacl = postgres + service_role ONLY and that
-- has_function_privilege is false for anon and authenticated.

REVOKE EXECUTE ON FUNCTION public.get_due_whatsapp_reminders(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_due_whatsapp_reminders(integer) TO service_role;

COMMIT;
