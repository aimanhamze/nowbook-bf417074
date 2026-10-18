-- Waiting list — Phase 1: schema only.
--
-- When a day is genuinely full for the service a customer wants, they can join a
-- waiting list for that day. When a booking on that day is cancelled, declined,
-- moved or deleted, a cron-driven Edge Function (Phase 2) notifies every
-- matching waiting customer at once; the first to book wins. This migration
-- creates the storage for that and the capture trigger. NOTHING READS ANY OF IT
-- YET — no Edge Function, RPC or UI exists in this phase.
--
-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  ⚠  ORDER                                                                ║
-- ║                                                                          ║
-- ║    1. VERIFY §0 on DEV — read-only pre-checks. Save the output.          ║
-- ║    2. THIS MIGRATION on DEV.                                             ║
-- ║    3. VERIFY §A (object checks), §B (rollback-wrapped trigger tests,     ║
-- ║       DEV ONLY) and §C (app-level checklist, DEV ONLY).                  ║
-- ║    4. VERIFY §0 on PROD, then THIS MIGRATION on PROD, then §A on PROD.   ║
-- ║       Never run §B or §C on PROD: they take ACCESS EXCLUSIVE locks on    ║
-- ║       the outbox, which every cancellation writes to.                    ║
-- ║                                                                          ║
-- ║  Phase 1 is safe to ship alone. Once applied, the outbox starts to fill  ║
-- ║  on every slot-freeing write and nothing consumes it until Phase 2. That ║
-- ║  is intended: a few small rows per cancellation, and the Phase 2         ║
-- ║  dispatcher ignores events older than 30 minutes, so the backlog never   ║
-- ║  turns into messages.                                                    ║
-- ║                                                                          ║
-- ║  Rollback: VERIFY §E.                                                    ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- ── THE BOOKING-WRITE GUARANTEE ─────────────────────────────────────────────
-- §5 adds two triggers to public.bookings. They must never fail or
-- meaningfully slow a booking write. How that is guaranteed:
--
--   1. AFTER, row-level. They run only after every BEFORE trigger
--      (prevent_booking_conflicts included) and every constraint has accepted
--      the row, and an AFTER row trigger's return value is ignored. They cannot
--      change WHETHER a write is allowed or WHAT is written.
--   2. Filtered by WHEN. The condition is evaluated before the function is
--      called, and for an AFTER trigger a false WHEN means the event is not even
--      queued. Approvals, notes, check-ins, duration edits, inserts, and writes
--      to past bookings never invoke the function.
--   3. One INSERT, nothing else. No reads of other tables, no network, no
--      locks beyond ROW EXCLUSIVE on the outbox. The outbox has NO foreign keys
--      (an FK would take a KEY SHARE lock on the parent, and would FAIL during a
--      cascade delete of that parent — the exact moment many events are made)
--      and no CHECK constraints; every data column is copied verbatim from OLD.
--   4. Errors are swallowed. The INSERT sits in its own BEGIN … EXCEPTION
--      WHEN OTHERS block: a missing table, a type mismatch, a constraint, a
--      permission problem — any SQL error — is logged as a WARNING and the
--      booking write commits normally. Cost: one subtransaction per fired row.
--      Not caught, by design: query_canceled / statement_timeout (the caller
--      asked to stop) and out-of-memory / disk-full, which would fail the
--      booking write regardless of this trigger.
--   5. Transactional. The event commits or rolls back with the booking write,
--      so a cancellation that is rolled back can never notify anyone.
--   6. Kill switch: ALTER TABLE public.bookings DISABLE TRIGGER
--      trg_waitlist_capture_update; (and …_delete). Instant, no side effects.
--
-- §2 runs a type guard first: the outbox copies bookings columns, and a type
-- mismatch would make every capture INSERT fail — which point 4 would then
-- swallow, silently. The guard turns that silent failure into a loud abort here.
--
-- DELIBERATELY NOT TOUCHED:
--   * prevent_booking_conflicts() and trg_prevent_booking_conflicts, and every
--     other existing bookings trigger. No existing function is created or
--     replaced anywhere in this file (VERIFY §A8 proves it by hash).
--   * whatsapp_send_log. Waiting-list sends get their own ledger (§6) by the
--     owner's ruling: the live confirmation and reminder functions write
--     whatsapp_send_log on every booking, and this feature must not touch it.
--   * Existing RLS policies and grants on bookings and provider_profiles.
--
-- NOT IN THIS PHASE: every RPC (dispatcher claim/match in Phase 2, customer
-- join/leave in Phase 3, provider counts + list in Phase 4), the cron job, and
-- the Edge Function. Limits that depend on the clock or on provider settings
-- (booking window, max 5 active per customer) are enforced by the Phase 3 join
-- RPC, which is the only way an entry is ever created.

BEGIN;

-- CREATE TRIGGER on bookings needs SHARE ROW EXCLUSIVE, and ADD COLUMN on
-- provider_profiles needs ACCESS EXCLUSIVE. While either waits for a lock,
-- every new booking write queues BEHIND it. Bound the wait: if the tables are
-- busy, this migration fails fast and changes nothing — just run it again.
SET LOCAL lock_timeout = '3s';

-- ─────────────────────────────────────────────────────────────────────────────
-- §1. Provider opt-in
-- ─────────────────────────────────────────────────────────────────────────────
-- Default OFF. A provider who never enables it sees no change, and their
-- customers never see a waiting list. NOT NULL with a constant default is
-- metadata-only on PG 11+: no table rewrite.

ALTER TABLE public.provider_profiles
  ADD COLUMN IF NOT EXISTS waitlist_enabled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.provider_profiles.waitlist_enabled IS
  'Provider opt-in for the customer waiting list. Default false. Turning it off closes active entries silently (Phase 4); the dispatcher also re-checks it before every send.';

-- ─────────────────────────────────────────────────────────────────────────────
-- §2. Guard: the bookings columns the outbox copies have the expected types
-- ─────────────────────────────────────────────────────────────────────────────
-- If this raises: STOP. Compare VERIFY §0.1 with the outbox in §4 and decide
-- which side is wrong. Do not edit the expected types just to make it pass.

DO $guard$
DECLARE
  v_expected constant text[][] := ARRAY[
    ARRAY['id',                'uuid'],
    ARRAY['provider_id',       'uuid'],
    ARRAY['booking_date',      'date'],
    ARRAY['booking_time',      'text'],
    ARRAY['staff_id',          'uuid'],
    ARRAY['service_ids',       'uuid[]'],
    ARRAY['duration_override', 'integer'],
    ARRAY['status',            'text'],
    ARRAY['class_schedule_id', 'uuid']
  ];
  v_actual text;
  i integer;
BEGIN
  FOR i IN 1 .. array_length(v_expected, 1) LOOP
    SELECT format_type(a.atttypid, a.atttypmod)
      INTO v_actual
      FROM pg_attribute a
     WHERE a.attrelid = 'public.bookings'::regclass
       AND a.attname  = v_expected[i][1]
       AND a.attnum > 0
       AND NOT a.attisdropped;

    IF v_actual IS DISTINCT FROM v_expected[i][2] THEN
      RAISE EXCEPTION 'bookings.% is % (expected %) — the outbox would silently stop capturing; aborting',
        v_expected[i][1], coalesce(v_actual, 'MISSING'), v_expected[i][2];
    END IF;
  END LOOP;
END
$guard$;

-- ─────────────────────────────────────────────────────────────────────────────
-- §3. waitlist_entries — one customer waiting for one day at one provider
-- ─────────────────────────────────────────────────────────────────────────────
-- Never hard-deleted by the app: leaving sets status 'left', so the send ledger
-- (§6) keeps counting rounds across the entry's life. Rows disappear only by
-- cascade (customer account, provider, service or staff member deleted).
--
-- Time of day is three booleans rather than an array, so duplicates are
-- impossible and "any time" is simply all three. Windows are judged on the
-- FREED booking's start time, Israel wall clock:
--   morning   start < 12:00
--   afternoon 12:00 <= start < 17:00
--   evening   start >= 17:00
--
-- staff_id NULL = "anyone". The composite FKs pin the service and the staff
-- member to THIS provider, the same way bookings.staff_id is pinned
-- (provider_services_id_provider_id_key / provider_staff_id_provider_id_key).
-- With staff_id NULL the composite staff FK is not checked (MATCH SIMPLE).

CREATE TABLE IF NOT EXISTS public.waitlist_entries (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider_id      uuid        NOT NULL REFERENCES public.provider_profiles(id) ON DELETE CASCADE,
  entry_date       date        NOT NULL,
  service_id       uuid        NOT NULL,
  staff_id         uuid        NULL,

  wants_morning    boolean     NOT NULL DEFAULT false,
  wants_afternoon  boolean     NOT NULL DEFAULT false,
  wants_evening    boolean     NOT NULL DEFAULT false,

  --   active    waiting
  --   fulfilled the customer booked with this provider on this date
  --   expired   the date passed
  --   left      the customer left the list
  --   closed    the provider turned the feature off (silently)
  status           text        NOT NULL DEFAULT 'active',
  ended_at         timestamptz NULL,

  -- Rounds notified so far (ruling 3: at most 2, at least 60 minutes apart).
  -- The authoritative cap is the ledger's CHECK + UNIQUE in §6; this is the
  -- cheap filter the matcher reads.
  notify_count     smallint    NOT NULL DEFAULT 0,
  last_notified_at timestamptz NULL,

  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT waitlist_entries_service_fk
    FOREIGN KEY (service_id, provider_id)
    REFERENCES public.provider_services (id, provider_id) ON DELETE CASCADE,
  CONSTRAINT waitlist_entries_staff_fk
    FOREIGN KEY (staff_id, provider_id)
    REFERENCES public.provider_staff (id, provider_id) ON DELETE CASCADE,
  CONSTRAINT waitlist_entries_window_check
    CHECK (wants_morning OR wants_afternoon OR wants_evening),
  CONSTRAINT waitlist_entries_status_check
    CHECK (status IN ('active', 'fulfilled', 'expired', 'left', 'closed')),
  CONSTRAINT waitlist_entries_ended_check
    CHECK ((status = 'active') = (ended_at IS NULL)),
  CONSTRAINT waitlist_entries_notify_count_check
    CHECK (notify_count BETWEEN 0 AND 2),
  CONSTRAINT waitlist_entries_notified_check
    CHECK ((notify_count = 0) = (last_notified_at IS NULL))
);

COMMENT ON TABLE public.waitlist_entries IS
  'Customer waiting-list entries: one customer, one provider, one day. Created only by the Phase 3 join RPC; customers read their own rows. Never hard-deleted by the app — see status.';

-- Ruling 5: one active entry per customer per provider per day. Leading with
-- user_id, it also serves "my active entries" (/bookings, the max-5 count).
CREATE UNIQUE INDEX IF NOT EXISTS waitlist_entries_one_active_per_day
  ON public.waitlist_entries (user_id, provider_id, entry_date)
  WHERE status = 'active';

-- The matcher and the provider's per-day counts: active entries for a
-- provider's day.
CREATE INDEX IF NOT EXISTS waitlist_entries_provider_day_active_idx
  ON public.waitlist_entries (provider_id, entry_date)
  WHERE status = 'active';

DROP TRIGGER IF EXISTS update_waitlist_entries_updated_at ON public.waitlist_entries;
CREATE TRIGGER update_waitlist_entries_updated_at
  BEFORE UPDATE ON public.waitlist_entries
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.waitlist_entries ENABLE ROW LEVEL SECURITY;

-- Read-only to the customer who owns the row. No INSERT/UPDATE/DELETE policy:
-- every write goes through SECURITY DEFINER RPCs (Phase 3/4), which is where
-- the booking window, the max-5 cap and service/staff eligibility are checked.
DROP POLICY IF EXISTS "Customers read own waitlist entries" ON public.waitlist_entries;
CREATE POLICY "Customers read own waitlist entries"
  ON public.waitlist_entries FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- Belt and braces on top of RLS: Supabase grants new public tables to anon and
-- authenticated by default.
REVOKE ALL ON public.waitlist_entries FROM anon;
REVOKE ALL ON public.waitlist_entries FROM authenticated;
GRANT SELECT ON public.waitlist_entries TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- §4. waitlist_events — the outbox
-- ─────────────────────────────────────────────────────────────────────────────
-- One row per slot-freeing write, holding the booking's OLD values. For a
-- deletion this row is the only remaining record of the slot, which is why it
-- copies everything the matcher needs instead of pointing at the booking.
--
-- NO FOREIGN KEYS and NO CHECK constraints, on purpose (see the header,
-- point 3). Data columns are nullable for the same reason: the capture INSERT
-- must have no way to fail on content. The dispatcher drops malformed rows.
--
-- The processing columns are written only by the Phase 2 dispatcher, which
-- claims with FOR UPDATE SKIP LOCKED and never locks this table as a whole.

CREATE TABLE IF NOT EXISTS public.waitlist_events (
  id                bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  -- Copied from OLD.
  booking_id        uuid,
  provider_id       uuid,
  booking_date      date,
  booking_time      text,
  staff_id          uuid,
  service_ids       uuid[],
  duration_override integer,
  old_status        text,

  -- NEW.status, or NULL for a deletion.
  new_status        text,
  --   deactivated  status left confirmed/pending (cancel, decline)
  --   moved        date or time changed while still active (reschedule)
  --   deleted      the row was deleted while active
  change_kind       text,

  created_at        timestamptz NOT NULL DEFAULT now(),

  -- Dispatcher bookkeeping (Phase 2).
  claimed_at        timestamptz,
  attempts          integer     NOT NULL DEFAULT 0,
  processed_at      timestamptz,
  outcome           text,
  last_error        text
);

COMMENT ON TABLE public.waitlist_events IS
  'Outbox of slot-freeing booking writes, filled by trg_waitlist_capture_*. No FKs or CHECKs by design: the capture insert must not be able to fail. service_role only.';

-- The dispatcher's scan: unprocessed events in arrival order.
CREATE INDEX IF NOT EXISTS waitlist_events_pending_idx
  ON public.waitlist_events (id)
  WHERE processed_at IS NULL;

-- RLS on with ZERO policies: anon and authenticated get nothing. The capture
-- function is SECURITY DEFINER and owned by the table owner, which bypasses RLS
-- (no FORCE ROW LEVEL SECURITY — do not add it, or every capture insert would
-- fail and be swallowed). service_role has BYPASSRLS for the dispatcher.
ALTER TABLE public.waitlist_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.waitlist_events FROM anon;
REVOKE ALL ON public.waitlist_events FROM authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- §5. The capture trigger
-- ─────────────────────────────────────────────────────────────────────────────
-- "Active" = confirmed or pending: the exact set prevent_booking_conflicts
-- treats as holding a slot, so declining a pending request frees a slot too.
--
-- Captured (one event per write):
--   * an active row whose status becomes anything else
--     — customer cancel, provider cancel, provider decline, group-class cancel
--   * an active row whose booking_date or booking_time changes
--     — provider reschedule, customer reschedule (incl. the flip to pending)
--   * an active row deleted — provider delete, and cascades (customer account
--     deleted, provider/branch deleted)
--
-- Not captured, by the WHEN clauses:
--   * class bookings (class_schedule_id set) — out of scope for v1. Group
--     SERVICES are captured and dropped by the dispatcher, which can look up
--     service_type; a WHEN clause cannot.
--   * bookings dated before yesterday. A day of slack absorbs CURRENT_DATE
--     being UTC while bookings are Israel dates; the dispatcher applies the
--     exact Israel-time past and lead-time rules. This mostly keeps bulk
--     deletes of old history (account deletion cascades) out of the outbox.
--   * duration_override changes — shortened bookings are out of v1 (ruling 9).
--   * staff_id changes — nothing in the app writes them after insert.
--
-- The UPDATE trigger deliberately has NO column list (no UPDATE OF …). The WHEN
-- clause is what decides, so a status flipped by some BEFORE trigger on an
-- UPDATE that never named status is still caught. The price is evaluating a
-- few comparisons on every bookings UPDATE, which is negligible.
--
-- New function name, absent before this migration (VERIFY §0.4); CREATE OR
-- REPLACE only so that re-running this file is safe.

CREATE OR REPLACE FUNCTION public.waitlist_capture_freed_slot()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  BEGIN
    INSERT INTO public.waitlist_events (
      booking_id, provider_id, booking_date, booking_time, staff_id,
      service_ids, duration_override, old_status, new_status, change_kind
    ) VALUES (
      OLD.id, OLD.provider_id, OLD.booking_date, OLD.booking_time, OLD.staff_id,
      OLD.service_ids, OLD.duration_override, OLD.status,
      CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE NEW.status END,
      CASE
        WHEN TG_OP = 'DELETE'                         THEN 'deleted'
        WHEN NEW.status NOT IN ('confirmed', 'pending') THEN 'deactivated'
        ELSE 'moved'
      END
    );
  EXCEPTION WHEN OTHERS THEN
    -- Never let the waiting list fail a booking write. See the header, point 4.
    RAISE WARNING 'waitlist_capture_freed_slot: event not recorded for booking % (% %)',
      OLD.id, SQLSTATE, SQLERRM;
  END;
  RETURN NULL;
END;
$fn$;

COMMENT ON FUNCTION public.waitlist_capture_freed_slot() IS
  'AFTER trigger on bookings: copies a freed slot into waitlist_events. One INSERT inside an EXCEPTION block; can never fail the booking write.';

-- Trigger functions cannot be called directly anyway; this is hygiene.
REVOKE ALL ON FUNCTION public.waitlist_capture_freed_slot() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_waitlist_capture_update ON public.bookings;
CREATE TRIGGER trg_waitlist_capture_update
  AFTER UPDATE ON public.bookings
  FOR EACH ROW
  WHEN (
        OLD.status IN ('confirmed', 'pending')
    AND OLD.class_schedule_id IS NULL
    AND OLD.booking_date >= CURRENT_DATE - 1
    AND (
          NEW.status NOT IN ('confirmed', 'pending')
       OR NEW.booking_date IS DISTINCT FROM OLD.booking_date
       OR NEW.booking_time IS DISTINCT FROM OLD.booking_time
    )
  )
  EXECUTE FUNCTION public.waitlist_capture_freed_slot();

DROP TRIGGER IF EXISTS trg_waitlist_capture_delete ON public.bookings;
CREATE TRIGGER trg_waitlist_capture_delete
  AFTER DELETE ON public.bookings
  FOR EACH ROW
  WHEN (
        OLD.status IN ('confirmed', 'pending')
    AND OLD.class_schedule_id IS NULL
    AND OLD.booking_date >= CURRENT_DATE - 1
  )
  EXECUTE FUNCTION public.waitlist_capture_freed_slot();

-- ─────────────────────────────────────────────────────────────────────────────
-- §6. waitlist_send_log — send ledger AND round claim
-- ─────────────────────────────────────────────────────────────────────────────
-- Same claim-before-send pattern as whatsapp_send_log, and a separate table by
-- ruling: this feature never writes whatsapp_send_log.
--
-- One row per notification ROUND for an entry, not per channel. The dispatcher
-- INSERTs the 'sending' row FIRST. The loser of a race gets unique violation
-- 23505 and sends nothing on ANY channel. The row is written even when
-- WhatsApp itself is skipped (no phone, no name, not allowlisted, status
-- 'skipped'), because bell and push for that round hang on the same claim.
--
-- Ruling 3, enforced in the database: message_kind may only be
-- 'waitlist_slot:1' or 'waitlist_slot:2', and the UNIQUE index allows each once
-- per entry, so a third round cannot be recorded, whatever the dispatcher
-- does. The 60-minute spacing is the dispatcher's (it needs the clock).
--
-- A FULL unique index, not a partial one over status = 'sent', for the reason
-- given on whatsapp_send_log: a "failure" that was actually delivered must not
-- free the claim for a duplicate.
--
-- event_id and freed_booking_id have no FKs: outbox rows are purged, and the
-- freed booking may already be deleted.

CREATE TABLE IF NOT EXISTS public.waitlist_send_log (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  waitlist_entry_id    uuid        NOT NULL REFERENCES public.waitlist_entries(id) ON DELETE CASCADE,
  message_kind         text        NOT NULL,
  provider_id          uuid        REFERENCES public.provider_profiles(id) ON DELETE CASCADE,

  -- The slot this round told the customer about.
  event_id             bigint,
  freed_booking_id     uuid,
  slot_date            date,
  slot_time            text,

  -- Digits-only recipient as handed to SendPulse, plus template details.
  phone_digits         text,
  template_name        text,
  language_code        text,

  --   sending  claimed, WhatsApp call not finished
  --   sent     SendPulse accepted it
  --   failed   SendPulse rejected it, or the call threw
  --   skipped  WhatsApp not attempted (bell/push may still have gone out)
  status               text        NOT NULL DEFAULT 'sending',
  sendpulse_message_id text,
  missing_message_id   boolean     NOT NULL DEFAULT false,
  error_code           text,

  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT waitlist_send_log_kind_check
    CHECK (message_kind IN ('waitlist_slot:1', 'waitlist_slot:2')),
  CONSTRAINT waitlist_send_log_status_check
    CHECK (status IN ('sending', 'sent', 'failed', 'skipped'))
);

COMMENT ON TABLE public.waitlist_send_log IS
  'Waiting-list notification ledger: one row per round per entry, claimed before any channel sends. Max 2 rounds per entry (kind CHECK + UNIQUE). service_role only.';

CREATE UNIQUE INDEX IF NOT EXISTS waitlist_send_log_entry_kind_key
  ON public.waitlist_send_log (waitlist_entry_id, message_kind);

-- Audit: per-provider send history, newest first.
CREATE INDEX IF NOT EXISTS waitlist_send_log_provider_created_idx
  ON public.waitlist_send_log (provider_id, created_at DESC);

DROP TRIGGER IF EXISTS update_waitlist_send_log_updated_at ON public.waitlist_send_log;
CREATE TRIGGER update_waitlist_send_log_updated_at
  BEFORE UPDATE ON public.waitlist_send_log
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.waitlist_send_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.waitlist_send_log FROM anon;
REVOKE ALL ON public.waitlist_send_log FROM authenticated;

COMMIT;
