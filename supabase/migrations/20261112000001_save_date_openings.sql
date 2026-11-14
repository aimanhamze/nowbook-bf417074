-- Special opening days: save_date_openings.
--
-- A weekly provider can OPEN a normally-closed date (or give an open date
-- different hours). The opening is a provider_date_overrides row with
-- is_available = true; resolveDayHours reads overrides in both modes with the
-- precedence blocked -> override -> normal hours.
--
-- This RPC writes one or more openings with the same window and optional
-- single break, in ONE transaction. Blocked still always wins in the resolver,
-- so a date that is also blocked would stay closed: if any date is blocked the
-- call fails with DATES_BLOCKED unless p_replace_blocks = true, in which case
-- those blocks are deleted in the same transaction (the UI asks first).
--
-- SECURITY INVOKER: runs as the caller, so the existing owner RLS on
-- provider_date_overrides and provider_blocked_dates applies to every write.
-- The explicit ownership check only turns "RLS filtered it out" into a clear
-- error instead of a silent no-op.
--
-- p_provider_id is required because a multi-branch owner edits the ACTIVE
-- branch, which auth.uid() alone cannot identify.
--
-- Not for fitness_studio (hours = class schedule) or academy (dated courses).
--
-- Errors (SQLERRM): NOT_AUTHENTICATED, PROVIDER_NOT_FOUND,
-- OPENINGS_NOT_SUPPORTED, NO_DATES, TOO_MANY_DATES, DATE_IN_PAST,
-- INVALID_HOURS, INVALID_BREAK, DATES_BLOCKED.
--
-- Returns the number of override rows written (inserted or updated).

CREATE OR REPLACE FUNCTION public.save_date_openings(
  p_provider_id    uuid,
  p_dates          date[],
  p_start          text,
  p_end            text,
  p_break_start    text    DEFAULT NULL,
  p_break_end      text    DEFAULT NULL,
  p_replace_blocks boolean DEFAULT false
)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_hhmm     constant text := '^([01][0-9]|2[0-3]):[0-5][0-9]$';
  v_today    date := (now() AT TIME ZONE 'Asia/Jerusalem')::date;
  v_category text;
  v_dates    date[];
  v_n        integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  SELECT category INTO v_category
  FROM public.provider_profiles
  WHERE id = p_provider_id AND user_id = auth.uid();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PROVIDER_NOT_FOUND';
  END IF;
  IF v_category IN ('fitness_studio', 'academy') THEN
    RAISE EXCEPTION 'OPENINGS_NOT_SUPPORTED';
  END IF;

  -- Distinct, sorted, NULLs dropped. 90 = the longest booking window option.
  SELECT array_agg(DISTINCT d ORDER BY d) INTO v_dates
  FROM unnest(p_dates) AS d
  WHERE d IS NOT NULL;
  IF v_dates IS NULL THEN
    RAISE EXCEPTION 'NO_DATES';
  END IF;
  IF cardinality(v_dates) > 90 THEN
    RAISE EXCEPTION 'TOO_MANY_DATES';
  END IF;
  IF v_dates[1] < v_today THEN
    RAISE EXCEPTION 'DATE_IN_PAST';
  END IF;

  -- Same-day window only (past-midnight hours are not supported anywhere).
  -- Format is checked in its own IF before any ::time cast: SQL does not
  -- promise OR short-circuits, and a bad string must not surface as 22007.
  IF p_start IS NULL OR p_end IS NULL OR p_start !~ v_hhmm OR p_end !~ v_hhmm THEN
    RAISE EXCEPTION 'INVALID_HOURS';
  END IF;
  IF p_end::time <= p_start::time THEN
    RAISE EXCEPTION 'INVALID_HOURS';
  END IF;

  -- Optional single break: both or neither, ordered, inside the window.
  IF (p_break_start IS NULL) <> (p_break_end IS NULL) THEN
    RAISE EXCEPTION 'INVALID_BREAK';
  END IF;
  IF p_break_start IS NOT NULL THEN
    IF p_break_start !~ v_hhmm OR p_break_end !~ v_hhmm THEN
      RAISE EXCEPTION 'INVALID_BREAK';
    END IF;
    IF p_break_end::time <= p_break_start::time
       OR p_break_start::time < p_start::time
       OR p_break_end::time > p_end::time THEN
      RAISE EXCEPTION 'INVALID_BREAK';
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.provider_blocked_dates
    WHERE provider_id = p_provider_id AND blocked_date = ANY (v_dates)
  ) THEN
    IF NOT coalesce(p_replace_blocks, false) THEN
      RAISE EXCEPTION 'DATES_BLOCKED';
    END IF;
    DELETE FROM public.provider_blocked_dates
    WHERE provider_id = p_provider_id AND blocked_date = ANY (v_dates);
  END IF;

  INSERT INTO public.provider_date_overrides
    (provider_id, override_date, is_available, start_time, end_time, break_start, break_end)
  SELECT p_provider_id, d, true, p_start, p_end, p_break_start::time, p_break_end::time
  FROM unnest(v_dates) AS d
  ON CONFLICT (provider_id, override_date) DO UPDATE
    SET is_available = true,
        start_time   = EXCLUDED.start_time,
        end_time     = EXCLUDED.end_time,
        break_start  = EXCLUDED.break_start,
        break_end    = EXCLUDED.break_end;
  GET DIAGNOSTICS v_n = ROW_COUNT;

  RETURN v_n;
END;
$$;

REVOKE ALL ON FUNCTION public.save_date_openings(uuid, date[], text, text, text, text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.save_date_openings(uuid, date[], text, text, text, text, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.save_date_openings(uuid, date[], text, text, text, text, boolean) TO authenticated;
