-- Recurring appointments — Phase 1: schema, guard trigger, create + cancel RPCs.
--
-- A series is a set of NORMAL walk-in bookings that share a series_id. Every
-- booking still goes through every existing trigger (conflicts, approval,
-- lead time, walk-in linking, waiting-list capture, reminders), so nothing
-- about a single booking changes because it belongs to a series.
--
-- ORDER: VERIFY §0 → this file → §A → §B (DEV only). Then PROD: §0, this file,
-- §A. Safe to apply alone: nothing in the deployed app reads or calls any of
-- this until the client phases ship.
-- Rollback: at the end of the VERIFY file (§E, commented out).
--
-- ADDS (all new names, VERIFY §0.1):
--   1. public.recurring_series                — one row per series
--   2. public.bookings.series_id              — nullable, FK ON DELETE SET NULL
--   3. public.recurring_series_cancellations  — one row per "cancel series" action
--   4. trg_guard_booking_series_id            — who may set / change series_id
--   5. public.recurring_series_service_eligible(...) — SECURITY DEFINER
--   6. public.create_recurring_series(...)    — SECURITY INVOKER
--   7. public.cancel_recurring_series(...)    — SECURITY DEFINER
--
-- DELIBERATELY NOT TOUCHED: prevent_booking_conflicts and every other existing
-- function, trigger, policy and grant. VERIFY §0.2 / §A5 fingerprint them.
--
-- ── create_recurring_series ─────────────────────────────────────────────────
-- SECURITY INVOKER on purpose: each booking is inserted AS THE PROVIDER, under
-- the same RLS policy ("Providers can create bookings for their business") and
-- the same triggers as today's one-off walk-in insert in NewBookingSheet. The
-- only difference is series_id. The one check that must NOT depend on the
-- caller's RLS — "is this a private service?", whose session test fails OPEN
-- when rows are hidden — is delegated to the DEFINER helper in §5.
--
-- p_dates are the dates the client preview found AVAILABLE (the client owns
-- opening hours, blocked days and staff time off, exactly as for a walk-in;
-- the server owns conflicts). p_requested_count is what the provider picked
-- (2–12, the first appointment included).
--
-- Each insert runs in its own sub-transaction (BEGIN … EXCEPTION), i.e. one
-- savepoint per date. Only unique_violation (23505) — what
-- prevent_booking_conflicts raises for a taken private slot — counts as
-- "taken" and skips that date. ANY other error aborts the whole call, so a real
-- fault can never be reported as a skipped date.
--
-- Returns one row per date: (r_code, r_series_id, r_date, r_booking_id,
-- r_outcome). Never raises for a rule; the client maps codes to copy.
--   OK               r_outcome 'created' (with r_booking_id) or 'taken'
--   ALL_TAKEN        every date was taken; nothing written, r_series_id NULL
--   NOT_OWNER        signed out, or the caller does not own p_provider_id
--   SERVICE_INVALID  not this provider's, inactive, a group service, a service
--                    with upcoming scheduled sessions, or a fitness_studio
--                    provider
--   STAFF_INVALID    p_staff_id is not an active member of this provider
--   BAD_REQUEST      count outside 2–12; bad time; empty name or phone; dates
--                    empty / null / duplicated / in the past / not on one
--                    weekday 7 days apart / spanning more than the count allows
-- A refusal returns ONE row with r_date NULL and writes nothing.
--
-- A single surviving date stays a 1-appointment series (ruling 5).
--
-- ── cancel_recurring_series ─────────────────────────────────────────────────
-- p_scope 'from_here': this booking and every later one in the series.
-- p_scope 'all_upcoming': every booking in the series.
-- Either way ONLY bookings that are confirmed/pending AND start in the future
-- (Israel time) are touched; past appointments never are.
--
-- SECURITY DEFINER because it writes recurring_series_cancellations, which no
-- client may write: that row is what the series-cancel WhatsApp (Phase 5)
-- reads its count and first date from, so it must come from here and nowhere
-- else. Ownership is checked explicitly (booking's provider_profiles.user_id =
-- auth.uid()). The status UPDATE fires every existing trigger exactly as the
-- provider's single cancel does — the waiting list captures one event per
-- booking.
--
-- It sends NO messages and writes NO notifications. The per-booking
-- cancellation WhatsApp is client-triggered only (notifyBookingCancelled), so
-- the series path simply never calls it.
--
-- Returns ONE row (r_code, r_cancellation_id, r_cancelled_count,
-- r_first_booking_id, r_first_date):
--   OK                 something was cancelled; a cancellation row was written
--   NOTHING_TO_CANCEL  nothing upcoming and active in that scope
--   NOT_FOUND          signed out, unknown booking, not a series booking, or
--                      not the caller's
--   BAD_SCOPE          p_scope is not 'from_here' / 'all_upcoming'
--
-- ── trg_guard_booking_series_id ─────────────────────────────────────────────
-- Customers may INSERT and UPDATE their own booking rows, so without this a
-- customer could tag a booking with a provider's series and have it shown as
-- part of the series and swept up by a series cancel.
--   INSERT with series_id: the series must belong to NEW.provider_id, and a
--     signed-in caller must own that provider.
--   UPDATE changing series_id: refused, except (a) the series row no longer
--     exists (the FK's ON DELETE SET NULL) and (b) no signed-in user
--     (service role / SQL editor).
-- Raises P0001 'SERIES_ID_INVALID' / 'SERIES_ID_IMMUTABLE'. The app never sets
-- series_id except through create_recurring_series.

BEGIN;

-- ADD COLUMN + FK on bookings take short heavy locks. Fail fast rather than
-- queue behind a long transaction and stall every booking write behind us.
SET LOCAL lock_timeout = '5s';

-- ─────────────────────────────────────────────────────────────────────────────
-- §1. recurring_series
-- ─────────────────────────────────────────────────────────────────────────────
-- How many bookings were actually created is NOT stored: it is derivable from
-- bookings.series_id and a stored copy could only drift.
CREATE TABLE public.recurring_series (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id     uuid        NOT NULL REFERENCES public.provider_profiles(id) ON DELETE CASCADE,
  service_id      uuid        REFERENCES public.provider_services(id) ON DELETE SET NULL,
  staff_id        uuid        REFERENCES public.provider_staff(id) ON DELETE SET NULL,
  weekday         smallint    NOT NULL CHECK (weekday BETWEEN 0 AND 6),   -- 0 = Sunday
  booking_time    text        NOT NULL CHECK (booking_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  requested_count smallint    NOT NULL CHECK (requested_count BETWEEN 2 AND 12),
  created_by      uuid        NOT NULL DEFAULT auth.uid(),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX recurring_series_provider_id_idx ON public.recurring_series (provider_id);

COMMENT ON TABLE public.recurring_series IS
  'A weekly series of walk-in bookings (bookings.series_id). Created only by create_recurring_series.';

ALTER TABLE public.recurring_series ENABLE ROW LEVEL SECURITY;

-- Owner = the login that owns this branch row (multi-branch: one owner, many
-- provider_profiles rows — same IN form as the bookings provider policies).
CREATE POLICY "Owners read own recurring series"
  ON public.recurring_series FOR SELECT TO authenticated
  USING (provider_id IN (SELECT pp.id FROM public.provider_profiles pp WHERE pp.user_id = auth.uid()));

-- Needed because create_recurring_series is SECURITY INVOKER. A provider
-- inserting a series row directly gains nothing: it is only ever their own.
CREATE POLICY "Owners create own recurring series"
  ON public.recurring_series FOR INSERT TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND provider_id IN (SELECT pp.id FROM public.provider_profiles pp WHERE pp.user_id = auth.uid())
  );

REVOKE ALL ON public.recurring_series FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.recurring_series TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- §2. bookings.series_id
-- ─────────────────────────────────────────────────────────────────────────────
-- Nullable, no default: a metadata-only ADD COLUMN. Every existing and every
-- normal booking stays NULL.
ALTER TABLE public.bookings
  ADD COLUMN series_id uuid REFERENCES public.recurring_series(id) ON DELETE SET NULL;

CREATE INDEX bookings_series_id_idx ON public.bookings (series_id) WHERE series_id IS NOT NULL;

COMMENT ON COLUMN public.bookings.series_id IS
  'Recurring series this booking belongs to (NULL for normal bookings). Guarded by trg_guard_booking_series_id.';

-- ─────────────────────────────────────────────────────────────────────────────
-- §3. recurring_series_cancellations
-- ─────────────────────────────────────────────────────────────────────────────
-- One row per "cancel series" action. Written ONLY by cancel_recurring_series
-- (no INSERT policy, no INSERT grant). Phase 5's WhatsApp reads it with the
-- service role: {{3}} first_date, {{4}} cancelled_count, and first_booking_id
-- for the recipient, consent and once-only ledger key.
CREATE TABLE public.recurring_series_cancellations (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  series_id        uuid        NOT NULL REFERENCES public.recurring_series(id) ON DELETE CASCADE,
  provider_id      uuid        NOT NULL REFERENCES public.provider_profiles(id) ON DELETE CASCADE,
  first_booking_id uuid        NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  first_date       date        NOT NULL,
  cancelled_count  smallint    NOT NULL CHECK (cancelled_count BETWEEN 1 AND 12),
  scope            text        NOT NULL CHECK (scope IN ('from_here', 'all_upcoming')),
  created_by       uuid        NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX recurring_series_cancellations_series_id_idx
  ON public.recurring_series_cancellations (series_id);

COMMENT ON TABLE public.recurring_series_cancellations IS
  'One row per series cancel. Written only by cancel_recurring_series; source of the series-cancel WhatsApp parameters.';

ALTER TABLE public.recurring_series_cancellations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners read own series cancellations"
  ON public.recurring_series_cancellations FOR SELECT TO authenticated
  USING (provider_id IN (SELECT pp.id FROM public.provider_profiles pp WHERE pp.user_id = auth.uid()));

REVOKE ALL ON public.recurring_series_cancellations FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.recurring_series_cancellations TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- §4. The series_id guard
-- ─────────────────────────────────────────────────────────────────────────────
-- SECURITY DEFINER so its lookups see recurring_series regardless of the
-- caller's RLS (a customer cannot see the series rows at all).
CREATE FUNCTION public.guard_booking_series_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.series_id IS NOT DISTINCT FROM OLD.series_id THEN
      RETURN NEW;
    END IF;
    -- The FK's ON DELETE SET NULL: the series row is already gone.
    IF NEW.series_id IS NULL
       AND NOT EXISTS (SELECT 1 FROM public.recurring_series s WHERE s.id = OLD.series_id) THEN
      RETURN NEW;
    END IF;
    -- Service role / SQL editor.
    IF v_uid IS NULL THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'SERIES_ID_IMMUTABLE' USING ERRCODE = 'P0001';
  END IF;

  -- INSERT
  IF NEW.series_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.recurring_series s
                  WHERE s.id = NEW.series_id AND s.provider_id = NEW.provider_id) THEN
    RAISE EXCEPTION 'SERIES_ID_INVALID' USING ERRCODE = 'P0001';
  END IF;
  IF v_uid IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.provider_profiles pp
                      WHERE pp.id = NEW.provider_id AND pp.user_id = v_uid) THEN
    RAISE EXCEPTION 'SERIES_ID_INVALID' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$fn$;

COMMENT ON FUNCTION public.guard_booking_series_id() IS
  'BEFORE INSERT / UPDATE OF series_id on bookings: only the owning provider may tag a booking with its own series; series_id never changes afterwards.';

REVOKE ALL ON FUNCTION public.guard_booking_series_id() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_guard_booking_series_id
  BEFORE INSERT OR UPDATE OF series_id ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_booking_series_id();

-- ─────────────────────────────────────────────────────────────────────────────
-- §5. recurring_series_service_eligible — the private-service rule
-- ─────────────────────────────────────────────────────────────────────────────
-- SECURITY DEFINER with a pinned search_path so the answer never depends on
-- the caller's RLS. Found the hard way: DEV's provider_sessions has RLS on
-- and ZERO policies, so under INVOKER the provider saw no sessions and a
-- session service passed. PROD's policies happen to let the owner see them,
-- but a future RLS change there must not silently re-open that hole.
--
-- Private = this provider's, active, not a group service, no scheduled
-- sessions from p_today on, and the provider is not a fitness_studio (ruled
-- out entirely). Same "private" core as waitlist_is_private_service, written
-- here so this file does not depend on the waiting-list functions.
--
-- Reveals only a yes/no about a service whose type, status and sessions are
-- already readable by any signed-in user on PROD. EXECUTE: authenticated —
-- create_recurring_series runs as the caller, so the caller must hold it.
CREATE FUNCTION public.recurring_series_service_eligible(
  p_provider_id uuid,
  p_service_id  uuid,
  p_today       date
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT EXISTS (
           SELECT 1
             FROM public.provider_services ps
             JOIN public.provider_profiles pp ON pp.id = ps.provider_id
            WHERE ps.id = p_service_id
              AND ps.provider_id = p_provider_id
              AND COALESCE(ps.is_active, true)
              AND ps.service_type IS DISTINCT FROM 'group'
              AND pp.category IS DISTINCT FROM 'fitness_studio'
         )
     AND NOT EXISTS (
           SELECT 1 FROM public.provider_sessions s
            WHERE s.service_id = p_service_id
              AND s.session_date >= p_today
         );
$fn$;

COMMENT ON FUNCTION public.recurring_series_service_eligible(uuid, uuid, date) IS
  'True when a service may be booked as a recurring series (private, active, no upcoming sessions, provider not a fitness_studio). DEFINER: independent of the caller''s RLS.';

REVOKE ALL ON FUNCTION public.recurring_series_service_eligible(uuid, uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recurring_series_service_eligible(uuid, uuid, date) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- §6. create_recurring_series
-- ─────────────────────────────────────────────────────────────────────────────
CREATE FUNCTION public.create_recurring_series(
  p_provider_id      uuid,
  p_service_id       uuid,
  p_staff_id         uuid,
  p_booking_time     text,
  p_dates            date[],
  p_requested_count  integer,
  p_customer_name    text,
  p_customer_phone   text,
  p_guest_notes      text,
  p_whatsapp_consent boolean
)
RETURNS TABLE (r_code text, r_series_id uuid, r_date date, r_booking_id uuid, r_outcome text)
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_uid     uuid := auth.uid();
  v_today   date := (now() AT TIME ZONE 'Asia/Jerusalem')::date;
  v_dates   date[];
  v_first   date;
  v_last    date;
  v_price   public.provider_services.price%TYPE;
  v_series  uuid;
  v_day     date;
  v_id      uuid;
  v_created integer := 0;
  v_out_dates   date[] := '{}';
  v_out_ids     uuid[] := '{}';
  v_out_results text[] := '{}';
BEGIN
  -- Ownership. provider_profiles is publicly readable, so this sees the row
  -- under the caller's own permissions.
  IF v_uid IS NULL OR NOT EXISTS (
       SELECT 1 FROM public.provider_profiles pp
        WHERE pp.id = p_provider_id AND pp.user_id = v_uid) THEN
    RETURN QUERY SELECT 'NOT_OWNER'::text, NULL::uuid, NULL::date, NULL::uuid, NULL::text; RETURN;
  END IF;

  -- Private services only. Decided by the SECURITY DEFINER helper (§5), not
  -- under the caller's RLS: the session test is a NOT EXISTS, and a NOT EXISTS
  -- over rows the caller cannot see passes — it fails OPEN.
  IF NOT public.recurring_series_service_eligible(p_provider_id, p_service_id, v_today) THEN
    RETURN QUERY SELECT 'SERVICE_INVALID'::text, NULL::uuid, NULL::date, NULL::uuid, NULL::text; RETURN;
  END IF;

  -- The price, under the caller's RLS. Hidden here = not found = refused, so
  -- this read can only fail CLOSED.
  SELECT ps.price INTO v_price
    FROM public.provider_services ps
   WHERE ps.id = p_service_id AND ps.provider_id = p_provider_id;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'SERVICE_INVALID'::text, NULL::uuid, NULL::date, NULL::uuid, NULL::text; RETURN;
  END IF;

  -- Staff: NULL (no staff step) or an active member of THIS provider. Which
  -- members perform which service is client-side by design (the conflict
  -- trigger is staff-blind about services too).
  IF p_staff_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.provider_staff st
        WHERE st.id = p_staff_id AND st.provider_id = p_provider_id AND COALESCE(st.is_active, true)) THEN
    RETURN QUERY SELECT 'STAFF_INVALID'::text, NULL::uuid, NULL::date, NULL::uuid, NULL::text; RETURN;
  END IF;

  -- Shape of the request.
  SELECT array_agg(DISTINCT d ORDER BY d) INTO v_dates FROM unnest(p_dates) AS d;
  v_first := v_dates[1];
  v_last  := v_dates[cardinality(v_dates)];
  IF p_requested_count IS NULL OR p_requested_count NOT BETWEEN 2 AND 12
     OR p_booking_time IS NULL OR p_booking_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
     OR NULLIF(btrim(p_customer_name), '') IS NULL
     OR NULLIF(btrim(p_customer_phone), '') IS NULL
     OR p_dates IS NULL
     OR cardinality(p_dates) = 0
     OR array_position(p_dates, NULL) IS NOT NULL
     OR cardinality(v_dates) <> cardinality(p_dates)          -- duplicates
     OR cardinality(v_dates) > p_requested_count
     OR v_first < v_today
     OR v_last - v_first > 7 * (p_requested_count - 1)
     OR EXISTS (SELECT 1 FROM unnest(v_dates) AS d WHERE (d - v_first) % 7 <> 0) THEN
    RETURN QUERY SELECT 'BAD_REQUEST'::text, NULL::uuid, NULL::date, NULL::uuid, NULL::text; RETURN;
  END IF;

  -- The series row and its bookings are one unit: if no date survives, the
  -- deliberate RS001 below rolls the series row back with this block.
  BEGIN
    INSERT INTO public.recurring_series (provider_id, service_id, staff_id, weekday, booking_time, requested_count, created_by)
    VALUES (p_provider_id, p_service_id, p_staff_id, extract(dow FROM v_first)::smallint,
            p_booking_time, p_requested_count, v_uid)
    RETURNING id INTO v_series;

    FOREACH v_day IN ARRAY v_dates LOOP
      BEGIN
        -- Column for column the walk-in insert in NewBookingSheet.handleCreate,
        -- plus series_id. Price is read server-side, never trusted from the client.
        INSERT INTO public.bookings (
          user_id, provider_id, service_ids, booking_date, booking_time, total_price, status,
          customer_name, customer_phone, guest_notes, whatsapp_consent, staff_id, series_id
        ) VALUES (
          NULL, p_provider_id, ARRAY[p_service_id], v_day, p_booking_time, v_price, 'confirmed',
          btrim(p_customer_name), btrim(p_customer_phone), NULLIF(btrim(p_guest_notes), ''),
          COALESCE(p_whatsapp_consent, false), p_staff_id, v_series
        )
        RETURNING id INTO v_id;
        v_created     := v_created + 1;
        v_out_dates   := v_out_dates || v_day;
        v_out_ids     := v_out_ids || v_id;
        v_out_results := v_out_results || 'created'::text;
      EXCEPTION WHEN unique_violation THEN
        -- Taken between the client's check and now. Skip this date only.
        v_out_dates   := v_out_dates || v_day;
        v_out_ids     := v_out_ids || NULL::uuid;
        v_out_results := v_out_results || 'taken'::text;
      END;
    END LOOP;

    IF v_created = 0 THEN
      RAISE EXCEPTION 'ALL_TAKEN' USING ERRCODE = 'RS001';
    END IF;
  EXCEPTION WHEN SQLSTATE 'RS001' THEN
    v_series := NULL;
  END;

  RETURN QUERY
    SELECT CASE WHEN v_series IS NULL THEN 'ALL_TAKEN' ELSE 'OK' END::text,
           v_series, o.d, o.id, o.res
      FROM unnest(v_out_dates, v_out_ids, v_out_results) AS o(d, id, res)
     ORDER BY o.d;
END;
$fn$;

COMMENT ON FUNCTION public.create_recurring_series(uuid, uuid, uuid, text, date[], integer, text, text, text, boolean) IS
  'Provider creates a weekly series of walk-in bookings. INVOKER: same RLS + triggers as a one-off walk-in. Taken dates (23505) are skipped and reported.';

REVOKE ALL ON FUNCTION public.create_recurring_series(uuid, uuid, uuid, text, date[], integer, text, text, text, boolean)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_recurring_series(uuid, uuid, uuid, text, date[], integer, text, text, text, boolean)
  TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- §7. cancel_recurring_series
-- ─────────────────────────────────────────────────────────────────────────────
CREATE FUNCTION public.cancel_recurring_series(
  p_booking_id uuid,
  p_scope      text
)
RETURNS TABLE (r_code text, r_cancellation_id uuid, r_cancelled_count integer,
               r_first_booking_id uuid, r_first_date date)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_uid      uuid := auth.uid();
  v_series   uuid;
  v_provider uuid;
  v_from     timestamp;
  v_count    integer;
  v_first_id uuid;
  v_first_dt date;
  v_cancel   uuid;
BEGIN
  IF p_scope IS NULL OR p_scope NOT IN ('from_here', 'all_upcoming') THEN
    RETURN QUERY SELECT 'BAD_SCOPE'::text, NULL::uuid, NULL::integer, NULL::uuid, NULL::date; RETURN;
  END IF;

  SELECT b.series_id, b.provider_id, b.booking_date + b.booking_time::time
    INTO v_series, v_provider, v_from
    FROM public.bookings b
    JOIN public.provider_profiles pp ON pp.id = b.provider_id
   WHERE b.id = p_booking_id
     AND b.series_id IS NOT NULL
     AND v_uid IS NOT NULL
     AND pp.user_id = v_uid;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'NOT_FOUND'::text, NULL::uuid, NULL::integer, NULL::uuid, NULL::date; RETURN;
  END IF;

  WITH upd AS (
    UPDATE public.bookings b
       SET status = 'cancelled'
     WHERE b.series_id = v_series
       AND b.provider_id = v_provider
       AND b.status IN ('confirmed', 'pending')
       -- Past (and already started) appointments are never touched.
       AND ((b.booking_date + b.booking_time::time) AT TIME ZONE 'Asia/Jerusalem') > now()
       AND (p_scope = 'all_upcoming' OR (b.booking_date + b.booking_time::time) >= v_from)
    RETURNING b.id, b.booking_date, b.booking_time
  )
  SELECT count(*)::integer,
         (array_agg(upd.id ORDER BY upd.booking_date, upd.booking_time::time))[1],
         min(upd.booking_date)
    INTO v_count, v_first_id, v_first_dt
    FROM upd;

  IF v_count = 0 THEN
    RETURN QUERY SELECT 'NOTHING_TO_CANCEL'::text, NULL::uuid, 0, NULL::uuid, NULL::date; RETURN;
  END IF;

  INSERT INTO public.recurring_series_cancellations
    (series_id, provider_id, first_booking_id, first_date, cancelled_count, scope, created_by)
  VALUES (v_series, v_provider, v_first_id, v_first_dt, v_count, p_scope, v_uid)
  RETURNING id INTO v_cancel;

  RETURN QUERY SELECT 'OK'::text, v_cancel, v_count, v_first_id, v_first_dt;
END;
$fn$;

COMMENT ON FUNCTION public.cancel_recurring_series(uuid, text) IS
  'Provider cancels a series from a booking onward or all upcoming. Never touches past bookings; sends nothing; records one recurring_series_cancellations row.';

REVOKE ALL ON FUNCTION public.cancel_recurring_series(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_recurring_series(uuid, text) TO authenticated;

COMMIT;
