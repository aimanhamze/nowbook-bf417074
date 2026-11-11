-- Course registration RPCs (feat/academy-courses, Phase 1 / migration 5 of 6).
--
-- The ONLY write path into course_registrations (migration 4 gives clients
-- SELECT only). All four functions are SECURITY DEFINER with
-- search_path = '' and fully-qualified names.
--
-- Grants: Supabase's default privileges on schema public grant EXECUTE on
--   every new function directly to anon and authenticated (verified on DEV
--   2026-11-08), so REVOKE ... FROM PUBLIC alone would leave them callable.
--   Each function is revoked from PUBLIC, anon and authenticated, then
--   granted explicitly:
--     register_for_course, cancel_course_registration,
--     decide_course_registration  -> authenticated
--     get_course_seat_counts      -> anon, authenticated
--
-- Time: sessions are Asia/Jerusalem wall-clock (migration 3). "Now" is
--   (now() AT TIME ZONE 'Asia/Jerusalem'), a timestamp without time zone
--   comparable with lower(period). A course "starts" at its earliest
--   session's start.
--
-- Concurrency: register / cancel / decide take
--   pg_advisory_xact_lock(hashtextextended('course_registration:' || course_id, 0))
--   so seat counting and the insert are serialised per course. Two customers
--   racing for the last seat cannot both get it. The partial UNIQUE from
--   migration 4 is the backstop for duplicate active registrations.
--
-- Errors are RAISE EXCEPTION '<UPPER_SNAKE>' (SQLSTATE P0001), like the
-- package RPCs, so the frontend can match on the message:
--   NOT_AUTHENTICATED, COURSE_NOT_AVAILABLE, CANNOT_REGISTER_OWN_COURSE,
--   COURSE_HAS_NO_SESSIONS, COURSE_ALREADY_STARTED, ALREADY_REGISTERED,
--   COURSE_FULL, REGISTRATION_NOT_FOUND, REGISTRATION_NOT_ACTIVE,
--   CANCELLATION_WINDOW_CLOSED, REGISTRATION_NOT_PENDING, INVALID_DECISION,
--   TOO_MANY_COURSES.
--   REGISTRATION_NOT_FOUND is also what a caller who is neither the customer
--   nor the branch owner gets, so registration ids cannot be probed.
--
-- Notifications: in-app rows only (push is sent by the frontend via
--   notify-user after the RPC, Phase 4+). Types:
--     course_registration_new        -> branch owner, on register
--     course_registration_confirmed  -> customer, on decide(confirmed)
--     course_registration_rejected   -> customer, on decide(rejected)
--     course_registration_cancelled  -> the OTHER side, on cancel
--   Hebrew copy and /dashboard (provider) or /bookings (customer) links,
--   matching the existing booking_* notifications.

BEGIN;

-- ─── register_for_course ────────────────────────────────────────────────
-- Refuses: inactive course; hidden or non-academy branch; caller owns the
-- branch (owner_id = caller covers every branch of that owner); no sessions;
-- first session already started; caller already has a pending/confirmed
-- registration; pending + confirmed >= max_seats.
-- Re-registering after a cancelled or rejected registration is allowed.
-- Returns the new registration id (status 'pending').
CREATE OR REPLACE FUNCTION public.register_for_course(p_course_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_course record;
  v_first  timestamp;
  v_taken  integer;
  v_reg_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('course_registration:' || p_course_id::text, 0));

  SELECT ac.id, ac.provider_id, ac.name, ac.max_seats, ac.is_active,
         pp.user_id AS owner_id, pp.is_visible, pp.category
    INTO v_course
  FROM public.academy_courses ac
  JOIN public.provider_profiles pp ON pp.id = ac.provider_id
  WHERE ac.id = p_course_id;

  IF NOT FOUND
     OR NOT v_course.is_active
     OR NOT v_course.is_visible
     OR v_course.category IS DISTINCT FROM 'academy' THEN
    RAISE EXCEPTION 'COURSE_NOT_AVAILABLE';
  END IF;

  IF v_course.owner_id = v_uid THEN
    RAISE EXCEPTION 'CANNOT_REGISTER_OWN_COURSE';
  END IF;

  SELECT min(lower(s.period)) INTO v_first
  FROM public.academy_course_sessions s
  WHERE s.course_id = p_course_id;

  IF v_first IS NULL THEN
    RAISE EXCEPTION 'COURSE_HAS_NO_SESSIONS';
  END IF;

  IF v_first <= (now() AT TIME ZONE 'Asia/Jerusalem') THEN
    RAISE EXCEPTION 'COURSE_ALREADY_STARTED';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.course_registrations r
    WHERE r.course_id = p_course_id
      AND r.user_id = v_uid
      AND r.status IN ('pending', 'confirmed')
  ) THEN
    RAISE EXCEPTION 'ALREADY_REGISTERED';
  END IF;

  SELECT count(*) INTO v_taken
  FROM public.course_registrations r
  WHERE r.course_id = p_course_id
    AND r.status IN ('pending', 'confirmed');

  IF v_taken >= v_course.max_seats THEN
    RAISE EXCEPTION 'COURSE_FULL';
  END IF;

  INSERT INTO public.course_registrations (course_id, provider_id, user_id, status)
  VALUES (p_course_id, v_course.provider_id, v_uid, 'pending')
  RETURNING id INTO v_reg_id;

  IF v_course.owner_id IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, title, body, type, url)
    VALUES (v_course.owner_id,
            'בקשת הרשמה חדשה לקורס',
            format('לקוח ביקש להירשם לקורס %s', v_course.name),
            'course_registration_new',
            '/dashboard');
  END IF;

  RETURN v_reg_id;
END;
$$;

-- ─── cancel_course_registration ─────────────────────────────────────────
-- Caller is the customer (cancelled_by = 'customer') or the branch owner
-- (cancelled_by = 'provider'); anyone else gets REGISTRATION_NOT_FOUND.
-- Only pending/confirmed rows can be cancelled.
-- Customer: refused once the course has started, and after
--   first_start - cancellation_hours (exactly at the deadline is still
--   allowed). A course whose sessions were all deleted has no start, so the
--   customer may cancel.
-- Owner: any time.
-- Notifies the other side.
CREATE OR REPLACE FUNCTION public.cancel_course_registration(p_registration_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_course_id uuid;
  v_reg       record;
  v_actor     text;
  v_first     timestamp;
  v_now       timestamp := (now() AT TIME ZONE 'Asia/Jerusalem');
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  SELECT r.course_id INTO v_course_id
  FROM public.course_registrations r
  WHERE r.id = p_registration_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'REGISTRATION_NOT_FOUND';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('course_registration:' || v_course_id::text, 0));

  SELECT r.id, r.user_id, r.status, ac.name AS course_name,
         ac.cancellation_hours, pp.user_id AS owner_id
    INTO v_reg
  FROM public.course_registrations r
  JOIN public.academy_courses ac ON ac.id = r.course_id
  JOIN public.provider_profiles pp ON pp.id = r.provider_id
  WHERE r.id = p_registration_id
  FOR UPDATE OF r;

  IF v_reg.user_id = v_uid THEN
    v_actor := 'customer';
  ELSIF v_reg.owner_id = v_uid THEN
    v_actor := 'provider';
  ELSE
    RAISE EXCEPTION 'REGISTRATION_NOT_FOUND';
  END IF;

  IF v_reg.status NOT IN ('pending', 'confirmed') THEN
    RAISE EXCEPTION 'REGISTRATION_NOT_ACTIVE';
  END IF;

  IF v_actor = 'customer' THEN
    SELECT min(lower(s.period)) INTO v_first
    FROM public.academy_course_sessions s
    WHERE s.course_id = v_course_id;

    IF v_first IS NOT NULL THEN
      IF v_now >= v_first THEN
        RAISE EXCEPTION 'COURSE_ALREADY_STARTED';
      END IF;
      IF v_now > v_first - make_interval(hours => v_reg.cancellation_hours) THEN
        RAISE EXCEPTION 'CANCELLATION_WINDOW_CLOSED';
      END IF;
    END IF;
  END IF;

  UPDATE public.course_registrations
     SET status = 'cancelled', cancelled_by = v_actor
   WHERE id = p_registration_id;

  IF v_actor = 'customer' THEN
    IF v_reg.owner_id IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, title, body, type, url)
      VALUES (v_reg.owner_id,
              'הרשמה לקורס בוטלה ❌',
              format('לקוח ביטל את ההרשמה לקורס %s', v_reg.course_name),
              'course_registration_cancelled',
              '/dashboard');
    END IF;
  ELSE
    INSERT INTO public.notifications (user_id, title, body, type, url)
    VALUES (v_reg.user_id,
            'ההרשמה לקורס בוטלה ❌',
            format('ההרשמה שלך לקורס %s בוטלה על ידי הספק', v_reg.course_name),
            'course_registration_cancelled',
            '/bookings');
  END IF;
END;
$$;

-- ─── decide_course_registration ─────────────────────────────────────────
-- Branch owner only; pending -> confirmed | rejected only. Sets decided_at
-- and notifies the customer. Confirming does not change the seat count
-- (pending already holds a seat); rejecting frees one.
CREATE OR REPLACE FUNCTION public.decide_course_registration(
  p_registration_id uuid,
  p_decision        text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_course_id uuid;
  v_reg       record;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  IF p_decision IS NULL OR p_decision NOT IN ('confirmed', 'rejected') THEN
    RAISE EXCEPTION 'INVALID_DECISION';
  END IF;

  SELECT r.course_id INTO v_course_id
  FROM public.course_registrations r
  WHERE r.id = p_registration_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'REGISTRATION_NOT_FOUND';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('course_registration:' || v_course_id::text, 0));

  SELECT r.id, r.user_id, r.status, ac.name AS course_name, pp.user_id AS owner_id
    INTO v_reg
  FROM public.course_registrations r
  JOIN public.academy_courses ac ON ac.id = r.course_id
  JOIN public.provider_profiles pp ON pp.id = r.provider_id
  WHERE r.id = p_registration_id
  FOR UPDATE OF r;

  IF v_reg.owner_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'REGISTRATION_NOT_FOUND';
  END IF;

  IF v_reg.status <> 'pending' THEN
    RAISE EXCEPTION 'REGISTRATION_NOT_PENDING';
  END IF;

  UPDATE public.course_registrations
     SET status = p_decision, decided_at = now()
   WHERE id = p_registration_id;

  IF p_decision = 'confirmed' THEN
    INSERT INTO public.notifications (user_id, title, body, type, url)
    VALUES (v_reg.user_id,
            'ההרשמה לקורס אושרה ✅',
            format('ההרשמה שלך לקורס %s אושרה', v_reg.course_name),
            'course_registration_confirmed',
            '/bookings');
  ELSE
    INSERT INTO public.notifications (user_id, title, body, type, url)
    VALUES (v_reg.user_id,
            'בקשת ההרשמה לקורס נדחתה',
            format('בקשת ההרשמה שלך לקורס %s נדחתה', v_reg.course_name),
            'course_registration_rejected',
            '/bookings');
  END IF;
END;
$$;

-- ─── get_course_seat_counts ─────────────────────────────────────────────
-- Counts only: max_seats, taken (pending + confirmed), free. Only for active
-- courses of visible branches; other ids are silently omitted. No customer
-- data. Capped at 200 ids per call.
CREATE OR REPLACE FUNCTION public.get_course_seat_counts(p_course_ids uuid[])
RETURNS TABLE (course_id uuid, max_seats integer, taken integer, free integer)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF coalesce(cardinality(p_course_ids), 0) > 200 THEN
    RAISE EXCEPTION 'TOO_MANY_COURSES';
  END IF;

  RETURN QUERY
  SELECT ac.id,
         ac.max_seats,
         count(r.id)::integer,
         greatest(ac.max_seats - count(r.id), 0)::integer
  FROM public.academy_courses ac
  JOIN public.provider_profiles pp ON pp.id = ac.provider_id
  LEFT JOIN public.course_registrations r
         ON r.course_id = ac.id
        AND r.status IN ('pending', 'confirmed')
  WHERE ac.id = ANY (p_course_ids)
    AND ac.is_active
    AND pp.is_visible
  GROUP BY ac.id, ac.max_seats;
END;
$$;

-- ─── Grants ─────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.register_for_course(uuid)               FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cancel_course_registration(uuid)        FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.decide_course_registration(uuid, text)  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_course_seat_counts(uuid[])          FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.register_for_course(uuid)              TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_course_registration(uuid)       TO authenticated;
GRANT EXECUTE ON FUNCTION public.decide_course_registration(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_course_seat_counts(uuid[])         TO anon, authenticated;

COMMIT;
