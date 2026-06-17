-- ============================================================================
-- Admin Dashboard RPCs — Phase 1
-- ----------------------------------------------------------------------------
-- The admin has NO SELECT policy on `bookings` (blocked like anon). Rather than
-- opening bookings RLS, these SECURITY DEFINER functions read bookings server-
-- side and return ONLY shaped, PRICE-FREE results to authenticated admins.
--
-- SECURITY MODEL (applies to every function below):
--   * SECURITY DEFINER + `SET search_path = public, pg_temp` (no hijacking).
--   * FIRST statement gates on public.has_role(auth.uid(), 'admin'); a non-admin
--     (or anon, where auth.uid() IS NULL) gets RAISE EXCEPTION, never data.
--   * total_price / customer_phone / notes are NEVER selected or returned.
--   * Customer identity is limited to a display/guest name — never phone/email.
--
-- TIMEZONE: the app serves Israel. "Today"/week boundaries are computed in
--   Asia/Jerusalem:
--     - booking_date is a plain DATE (the appointment's local calendar day) and
--       is compared directly to the Jerusalem "today".
--     - created_at is timestamptz and is bucketed via
--       (created_at AT TIME ZONE 'Asia/Jerusalem')::date.
--   "This week" = rolling 7-day window ending today (today-6 .. today).
--   "Last week" = preceding 7 days (today-13 .. today-7).
--
-- service_ids is an array of service ids; element type is cast to text on both
-- sides (ps.id::text = ANY(b.service_ids::text[])) so the join is correct
-- whether the column is uuid[] or text[].
-- ============================================================================

-- NOTE: bookings.booking_time is a TEXT column in this database (HH:MM[:SS]),
-- not a `time` type — the list RPCs below return it as text accordingly.
--
-- Drop first so re-applying this migration can change return signatures cleanly
-- (CREATE OR REPLACE cannot alter a function's RETURNS TABLE column types).
DROP FUNCTION IF EXISTS public.admin_dashboard_counts();
DROP FUNCTION IF EXISTS public.admin_bookings_over_time(date, date);
DROP FUNCTION IF EXISTS public.admin_provider_booking_counts();
DROP FUNCTION IF EXISTS public.admin_recent_bookings(integer);
DROP FUNCTION IF EXISTS public.admin_today_bookings();
DROP FUNCTION IF EXISTS public.admin_pending_bookings();

-- ----------------------------------------------------------------------------
-- 1. admin_dashboard_counts() — single-row KPI bundle (counts only)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_dashboard_counts()
RETURNS TABLE (
  bookings_today          integer,
  pending_approval        integer,
  bookings_this_week      integer,
  bookings_last_week      integer,
  total_active_providers  integer,
  total_users             integer,
  new_users_this_week     integer,
  new_providers_this_week integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Jerusalem')::date;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'admin only' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    (SELECT count(*) FROM public.bookings
       WHERE booking_date = v_today)::int,
    (SELECT count(*) FROM public.bookings
       WHERE status = 'pending')::int,
    (SELECT count(*) FROM public.bookings
       WHERE booking_date BETWEEN v_today - 6 AND v_today)::int,
    (SELECT count(*) FROM public.bookings
       WHERE booking_date BETWEEN v_today - 13 AND v_today - 7)::int,
    (SELECT count(*) FROM public.provider_profiles
       WHERE is_visible IS TRUE)::int,
    (SELECT count(*) FROM public.profiles)::int,
    (SELECT count(*) FROM public.profiles
       WHERE (created_at AT TIME ZONE 'Asia/Jerusalem')::date
             BETWEEN v_today - 6 AND v_today)::int,
    (SELECT count(*) FROM public.provider_profiles
       WHERE (created_at AT TIME ZONE 'Asia/Jerusalem')::date
             BETWEEN v_today - 6 AND v_today)::int;
END;
$$;

-- ----------------------------------------------------------------------------
-- 2. admin_bookings_over_time(p_from, p_to) — one row per day (zero-filled)
--    Counts by booking_date (appointment day). For a time-series chart.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_bookings_over_time(
  p_from date,
  p_to   date
)
RETURNS TABLE (
  day            date,
  bookings_count integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'admin only' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    d::date AS day,
    (SELECT count(*) FROM public.bookings b
       WHERE b.booking_date = d::date)::int AS bookings_count
  FROM generate_series(p_from, p_to, interval '1 day') AS d
  ORDER BY d;
END;
$$;

-- ----------------------------------------------------------------------------
-- 3. admin_provider_booking_counts() — every provider incl. dormant (0)
--    LEFT JOIN so zero-booking providers appear. No money. Sorted busiest first.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_provider_booking_counts()
RETURNS TABLE (
  provider_id    uuid,
  business_name  text,
  bookings_count integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'admin only' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    pp.id,
    pp.business_name,
    count(b.id)::int AS bookings_count
  FROM public.provider_profiles pp
  LEFT JOIN public.bookings b ON b.provider_id = pp.id
  GROUP BY pp.id, pp.business_name
  ORDER BY count(b.id) DESC, pp.business_name ASC;
END;
$$;

-- ----------------------------------------------------------------------------
-- Shared shape for operational booking lists (#4/#5). Implemented as three
-- thin, separately-gated functions for clarity. Columns are identical:
--   booking_id, booking_date, booking_time, status, business_name,
--   service_name (joined, comma-separated), customer_name (display/guest only).
-- NO price, NO phone, NO notes.
-- ----------------------------------------------------------------------------

-- 4. admin_recent_bookings(p_limit) — newest first, across the platform
CREATE OR REPLACE FUNCTION public.admin_recent_bookings(
  p_limit integer DEFAULT 20
)
RETURNS TABLE (
  booking_id    uuid,
  booking_date  date,
  booking_time  text,
  status        text,
  business_name text,
  service_name  text,
  customer_name text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'admin only' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    b.id,
    b.booking_date,
    b.booking_time,
    b.status,
    pp.business_name,
    (SELECT string_agg(ps.name, ', ')
       FROM public.provider_services ps
       WHERE ps.id::text = ANY(b.service_ids::text[])),
    COALESCE(pr.display_name, b.customer_name)
  FROM public.bookings b
  LEFT JOIN public.provider_profiles pp ON pp.id = b.provider_id
  LEFT JOIN public.profiles pr          ON pr.user_id = b.user_id
  ORDER BY b.created_at DESC
  LIMIT GREATEST(p_limit, 0);
END;
$$;

-- 5a. admin_today_bookings() — today's appointments (Asia/Jerusalem), by time
CREATE OR REPLACE FUNCTION public.admin_today_bookings()
RETURNS TABLE (
  booking_id    uuid,
  booking_date  date,
  booking_time  text,
  status        text,
  business_name text,
  service_name  text,
  customer_name text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Jerusalem')::date;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'admin only' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    b.id,
    b.booking_date,
    b.booking_time,
    b.status,
    pp.business_name,
    (SELECT string_agg(ps.name, ', ')
       FROM public.provider_services ps
       WHERE ps.id::text = ANY(b.service_ids::text[])),
    COALESCE(pr.display_name, b.customer_name)
  FROM public.bookings b
  LEFT JOIN public.provider_profiles pp ON pp.id = b.provider_id
  LEFT JOIN public.profiles pr          ON pr.user_id = b.user_id
  WHERE b.booking_date = v_today
  ORDER BY b.booking_time ASC;
END;
$$;

-- 5b. admin_pending_bookings() — pending-approval queue, platform-wide
CREATE OR REPLACE FUNCTION public.admin_pending_bookings()
RETURNS TABLE (
  booking_id    uuid,
  booking_date  date,
  booking_time  text,
  status        text,
  business_name text,
  service_name  text,
  customer_name text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'admin only' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    b.id,
    b.booking_date,
    b.booking_time,
    b.status,
    pp.business_name,
    (SELECT string_agg(ps.name, ', ')
       FROM public.provider_services ps
       WHERE ps.id::text = ANY(b.service_ids::text[])),
    COALESCE(pr.display_name, b.customer_name)
  FROM public.bookings b
  LEFT JOIN public.provider_profiles pp ON pp.id = b.provider_id
  LEFT JOIN public.profiles pr          ON pr.user_id = b.user_id
  WHERE b.status = 'pending'
  ORDER BY b.booking_date ASC, b.booking_time ASC;
END;
$$;

-- ----------------------------------------------------------------------------
-- Grants: callable only by authenticated users; the internal admin gate does
-- the real authorization. Revoke from anon/public for defense in depth.
-- ----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.admin_dashboard_counts()                 FROM public, anon;
REVOKE ALL ON FUNCTION public.admin_bookings_over_time(date, date)     FROM public, anon;
REVOKE ALL ON FUNCTION public.admin_provider_booking_counts()          FROM public, anon;
REVOKE ALL ON FUNCTION public.admin_recent_bookings(integer)           FROM public, anon;
REVOKE ALL ON FUNCTION public.admin_today_bookings()                   FROM public, anon;
REVOKE ALL ON FUNCTION public.admin_pending_bookings()                 FROM public, anon;

GRANT EXECUTE ON FUNCTION public.admin_dashboard_counts()              TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_bookings_over_time(date, date)  TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_provider_booking_counts()       TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_recent_bookings(integer)        TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_today_bookings()                TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_pending_bookings()              TO authenticated;
