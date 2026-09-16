-- Walk-in WhatsApp consent — bookings.whatsapp_consent + reminder eligibility.
--
-- A walk-in (user_id IS NULL AND linked_user_id IS NULL) may receive WhatsApp
-- template messages about its appointment ONLY when the provider records, at
-- booking time, that the customer agreed. Consent is per booking, not per
-- customer, and covers every message kind for that booking: confirmation,
-- reminder and provider cancellation.
--
-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  ⚠  DEPLOY ORDER — REQUIRED, NOT A SUGGESTION                            ║
-- ║                                                                          ║
-- ║    1. THIS MIGRATION  (column + get_due_whatsapp_reminders)              ║
-- ║    2. BOTH EDGE FUNCTIONS  whatsapp-booking-confirm                      ║
-- ║                            whatsapp-booking-reminder                     ║
-- ║    3. THE UI  (NewBookingSheet checkbox + insert payload)                ║
-- ║                                                                          ║
-- ║  Functions before this migration: both SELECT bookings.whatsapp_consent. ║
-- ║  Against a database without the column that select errors, so            ║
-- ║  whatsapp-booking-confirm returns 500 on EVERY confirmation and          ║
-- ║  cancellation — ACCOUNT HOLDERS INCLUDED — and every reminder fails.     ║
-- ║                                                                          ║
-- ║  UI before this migration: the walk-in insert names a column that does   ║
-- ║  not exist, so creating ANY walk-in fails.                               ║
-- ║                                                                          ║
-- ║  Rollback runs in REVERSE: UI -> functions -> this migration (restore    ║
-- ║  the §0 dump of the RPC from the VERIFY file, then drop the column).     ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  ⚠  RUN §0 OF THE VERIFY FILE FIRST                                      ║
-- ║                                                                          ║
-- ║  §3 CREATE OR REPLACEs get_due_whatsapp_reminders. The live definition   ║
-- ║  must be dumped and diffed against 20260814000002 BEFORE this runs —     ║
-- ║  bookings.duration_override reached prod with no migration, so the repo  ║
-- ║  is not proof of what is deployed.                                       ║
-- ║                                                                          ║
-- ║  §1 below also ENFORCES it: the migration aborts, changing nothing, if   ║
-- ║  the live body is not the 20260814000002 body (or this migration's own   ║
-- ║  body, so a re-run is safe).                                             ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- EXISTING ROWS: the column defaults to false and every existing booking
-- receives false, so nothing already stored changes behaviour. In particular
-- no existing walk-in becomes due for a reminder.
--
-- DELIBERATELY NOT TOUCHED:
--   * Account-holder and LINKED walk-in eligibility. The reminder predicate is
--     only WIDENED by `OR b.whatsapp_consent`; every row it returned before, it
--     still returns. Linked walk-ins (linked_user_id set) have an account and
--     are already eligible — consent is never consulted for them.
--   * whatsapp_send_log, provider_profiles, RLS policies, grants on bookings.
--     A provider writes the column through the existing "Providers can create
--     bookings for their business" INSERT policy. Customers cannot set it on a
--     walk-in: their INSERT/UPDATE policies require auth.uid() = user_id.
--   * The link_walkin_to_account trigger and link_my_walkins RPC.
--   * The looseDigits "00972" allowlist bug in both functions (separate ticket).
--
-- NO CONSTRAINT tying consent to walk-ins: on an account or linked booking the
-- flag is simply never read. A CHECK such as
-- (NOT whatsapp_consent OR (user_id IS NULL AND linked_user_id IS NULL)) would
-- make link_walkin_to_account (insert) and link_my_walkins (later UPDATE) FAIL
-- for any consented walk-in whose phone matches an account.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- §1. Guard: refuse to replace a function body we have not seen
-- ─────────────────────────────────────────────────────────────────────────────
-- Compares an md5 of the live prosrc, WHITESPACE-NORMALISED (every run of
-- [[:space:]] — space/tab/CR/LF/FF/VT — collapsed to one space, then trimmed;
-- neither body contains a non-ASCII space). Normalising is
-- deliberate: the 20260814000002 file was authored with CRLF line endings, and
-- whether CRs survived depends on how it was pasted — a CR-only difference must
-- not block the migration. Any change to a token, comment word or predicate
-- still changes the hash.
--
-- Accepted hashes:
--   1e31f9be02dc7793be20233afdc1656d  body of 20260814000002 (expected in prod)
--   7fa44c7143444f91af770654cf034aa6  body of §3 below (re-run of this file)
--
-- If this raises: STOP. Diff the §0 dump from the VERIFY file against the repo
-- and decide what the live version should be. Do not edit the hash to pass.

DO $guard$
DECLARE
  v_fn   regprocedure := to_regprocedure('public.get_due_whatsapp_reminders(integer)');
  v_hash text;
BEGIN
  IF v_fn IS NULL THEN
    RAISE EXCEPTION 'get_due_whatsapp_reminders(integer) does not exist — 20260814000002 is not applied; aborting';
  END IF;

  SELECT md5(btrim(regexp_replace(p.prosrc, '[[:space:]]+', ' ', 'g'), ' '))
  INTO v_hash
  FROM pg_proc p
  WHERE p.oid = v_fn;

  IF v_hash NOT IN ('1e31f9be02dc7793be20233afdc1656d',
                    '7fa44c7143444f91af770654cf034aa6') THEN
    RAISE EXCEPTION 'live get_due_whatsapp_reminders differs from the repo (normalised md5 %); run VERIFY §0 and diff before applying', v_hash;
  END IF;
END
$guard$;

-- ─────────────────────────────────────────────────────────────────────────────
-- §2. The consent column
-- ─────────────────────────────────────────────────────────────────────────────
-- NOT NULL DEFAULT false with a constant default is metadata-only on PG 11+:
-- no table rewrite, no long lock on bookings.

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS whatsapp_consent boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.bookings.whatsapp_consent IS
  'Provider-recorded at booking time: the walk-in customer agreed to receive WhatsApp messages about THIS appointment (confirmation, reminder, cancellation). Read only when user_id AND linked_user_id are both NULL. Default false.';

-- ─────────────────────────────────────────────────────────────────────────────
-- §3. get_due_whatsapp_reminders — walk-in predicate narrowed
-- ─────────────────────────────────────────────────────────────────────────────
-- BYTE-IDENTICAL to 20260814000002 §2 except the walk-in comment and predicate:
--
--   before:  AND (b.user_id IS NOT NULL OR b.linked_user_id IS NOT NULL)
--   after:   AND (b.user_id IS NOT NULL OR b.linked_user_id IS NOT NULL
--                 OR b.whatsapp_consent)
--
-- whatsapp_consent is NOT NULL, so there is no three-valued-logic trap: this is
-- exactly NOT (user_id IS NULL AND linked_user_id IS NULL AND NOT consent),
-- the same gate the two Edge Functions apply. If the functions and this RPC
-- ever disagree, a consented walk-in is either never discovered or discovered
-- and then skipped — keep all three in step.
--
-- Everything else — the Israel-time window, the floors, the hard past guard,
-- the slot-scoped ledger anti-join, ordering and cap — is unchanged; see
-- 20260814000002 for the reasoning behind each.

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

-- ─────────────────────────────────────────────────────────────────────────────
-- §4. Grants — restated, unchanged (service_role only)
-- ─────────────────────────────────────────────────────────────────────────────
-- CREATE OR REPLACE keeps the existing ACL; restating makes this file correct
-- on its own rather than dependent on what the previous migration left.

REVOKE ALL ON FUNCTION public.get_due_whatsapp_reminders(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_due_whatsapp_reminders(integer) TO service_role;

COMMIT;
