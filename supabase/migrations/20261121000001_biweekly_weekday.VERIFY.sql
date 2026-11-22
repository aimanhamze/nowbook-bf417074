-- VERIFY / test plan for 20261121000001_biweekly_weekday.sql
--
--   §0  BEFORE the migration. Read-only. Note the results (§A compares).
--   §A  after the migration. Read-only object checks.
--   §B  ONE DO block testing both constraints; ends in a PASS/FAIL exception,
--       so nothing it does is kept. DEV ONLY.
--   §E  rollback (commented out).
--
-- Run each statement on its own. Run on DEV first, then PROD (skip §B on PROD).
-- Deploy order: migration -> waitlist-dispatch -> app. Rollback in reverse.


-- ═════════════════════════════════════════════════════════════════════════════
-- §0. PRE-APPLY — run before the migration
-- ═════════════════════════════════════════════════════════════════════════════

-- 0.1 The new columns do not exist yet. Expect ZERO rows.
SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'provider_availability'
  AND column_name IN ('repeat_every_weeks', 'repeat_anchor_date');

-- 0.2 The new constraints do not exist yet. Expect ZERO rows.
SELECT conname
FROM pg_constraint
WHERE conrelid = 'public.provider_availability'::regclass
  AND conname IN ('provider_availability_repeat_every_weeks_check',
                  'provider_availability_repeat_anchor_check');

-- 0.3 day_of_week numbering. Expect min 0, max 6, fri_dow 5.
--     (PROD 2026-11-21: 0 / 6 / 336 rows.) NOTE the row count for A3.
SELECT min(day_of_week) AS min_dow, max(day_of_week) AS max_dow, count(*) AS total_rows,
       EXTRACT(DOW FROM date '2026-11-27') AS fri_dow
FROM public.provider_availability;

-- 0.4 Table-level grants. NOTE the result; A5 must match it exactly.
--     (PROD 2026-11-21: anon and authenticated both
--      DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE.)
SELECT grantee, string_agg(privilege_type, ', ' ORDER BY privilege_type) AS privs
FROM information_schema.role_table_grants
WHERE table_schema = 'public' AND table_name = 'provider_availability'
  AND grantee IN ('anon', 'authenticated')
GROUP BY grantee
ORDER BY grantee;

-- 0.5 Column-level grants. Expect ZERO rows (PROD 2026-11-21: none).
--     Any row here means new columns would NOT be readable — stop and report.
SELECT grantee, column_name, privilege_type
FROM information_schema.column_privileges cp
WHERE table_schema = 'public' AND table_name = 'provider_availability'
  AND grantee IN ('anon', 'authenticated')
  AND NOT EXISTS (
    SELECT 1 FROM information_schema.role_table_grants tg
    WHERE tg.table_schema = cp.table_schema AND tg.table_name = cp.table_name
      AND tg.grantee = cp.grantee AND tg.privilege_type = cp.privilege_type
  );


-- ═════════════════════════════════════════════════════════════════════════════
-- §A. POST-APPLY — read-only object checks
-- ═════════════════════════════════════════════════════════════════════════════

-- A1. The columns. Expect TWO rows:
--     repeat_anchor_date  date      YES  (null default)
--     repeat_every_weeks  smallint  NO   1
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'provider_availability'
  AND column_name IN ('repeat_every_weeks', 'repeat_anchor_date')
ORDER BY column_name;

-- A2. The constraints. Expect TWO rows, both convalidated = true:
--     provider_availability_repeat_anchor_check
--       CHECK (((repeat_every_weeks = 1) OR ((repeat_anchor_date IS NOT NULL)
--              AND (EXTRACT(dow FROM repeat_anchor_date) = (day_of_week)::numeric))))
--     provider_availability_repeat_every_weeks_check
--       CHECK ((repeat_every_weeks = ANY (ARRAY[1, 2])))
--     (Postgres prints its own normalised form; the casts may differ slightly.)
SELECT conname, convalidated, pg_get_constraintdef(oid) AS def
FROM pg_constraint
WHERE conrelid = 'public.provider_availability'::regclass
  AND conname IN ('provider_availability_repeat_every_weeks_check',
                  'provider_availability_repeat_anchor_check')
ORDER BY conname;

-- A3. Every existing row is unchanged in meaning: every week, no anchor.
--     Expect: total_rows = 0.3's count, every_week = total_rows,
--             biweekly = 0, with_anchor = 0.
SELECT count(*)                                              AS total_rows,
       count(*) FILTER (WHERE repeat_every_weeks = 1)        AS every_week,
       count(*) FILTER (WHERE repeat_every_weeks = 2)        AS biweekly,
       count(*) FILTER (WHERE repeat_anchor_date IS NOT NULL) AS with_anchor
FROM public.provider_availability;

-- A4. No other constraint was added or dropped. Expect the same list as before
--     PLUS the two above (compare against the repo's earlier migrations if unsure).
SELECT conname, contype
FROM pg_constraint
WHERE conrelid = 'public.provider_availability'::regclass
ORDER BY conname;

-- A5. Table-level grants. Expect IDENTICAL to 0.4.
SELECT grantee, string_agg(privilege_type, ', ' ORDER BY privilege_type) AS privs
FROM information_schema.role_table_grants
WHERE table_schema = 'public' AND table_name = 'provider_availability'
  AND grantee IN ('anon', 'authenticated')
GROUP BY grantee
ORDER BY grantee;

-- A6. Still no column-level grants (same query as 0.5). Expect ZERO rows.
SELECT grantee, column_name, privilege_type
FROM information_schema.column_privileges cp
WHERE table_schema = 'public' AND table_name = 'provider_availability'
  AND grantee IN ('anon', 'authenticated')
  AND NOT EXISTS (
    SELECT 1 FROM information_schema.role_table_grants tg
    WHERE tg.table_schema = cp.table_schema AND tg.table_name = cp.table_name
      AND tg.grantee = cp.grantee AND tg.privilege_type = cp.privilege_type
  );

-- A7. The new columns are readable the way the app will read them.
--     Expect: one row per day_of_week 0–6 present, every row (1, NULL).
SELECT day_of_week, repeat_every_weeks, repeat_anchor_date, count(*) AS n
FROM public.provider_availability
GROUP BY day_of_week, repeat_every_weeks, repeat_anchor_date
ORDER BY day_of_week;


-- ═════════════════════════════════════════════════════════════════════════════
-- §B. CONSTRAINT BEHAVIOUR — ONE DO BLOCK, DEV ONLY
-- ═════════════════════════════════════════════════════════════════════════════
-- Run the block on its own. It updates ONE real provider_availability row
-- through the five cases and ALWAYS ends in an exception, so nothing it did is
-- kept:
--   ERROR: FAIL <case>: …   -> that case failed (everything rolled back)
--   ERROR: PASS: …          -> all five cases passed (everything rolled back)
--
--   C1  2 + anchor on the row's weekday      -> accepted
--   C2  2 + NULL anchor                      -> rejected by repeat_anchor_check
--   C3  2 + anchor one day off the weekday   -> rejected by repeat_anchor_check
--   C4  3 (+ valid anchor)                   -> rejected by repeat_every_weeks_check
--   C5  1 + NULL anchor                      -> accepted
--
-- Anchors are built from Sunday 2026-11-22 + day_of_week, so the "good" anchor
-- is always on the row's weekday and the "bad" one (good + 1) never is.
-- Rejected cases run in their own sub-block; a rejection that comes from the
-- wrong constraint, or any other error, is a FAIL.

DO $b$
DECLARE
  v_id   uuid;
  v_dow  integer;
  v_good date;
  v_bad  date;
  v_con  text;
  v_n    integer;
BEGIN
  SELECT id, day_of_week INTO v_id, v_dow
  FROM public.provider_availability
  WHERE repeat_every_weeks = 1
  ORDER BY provider_id, day_of_week
  LIMIT 1;

  IF v_id IS NULL THEN
    RAISE EXCEPTION 'FAIL C0: got no provider_availability row, want one to test with';
  END IF;

  v_good := date '2026-11-22' + v_dow;   -- 2026-11-22 is a Sunday (dow 0)
  v_bad  := v_good + 1;

  IF EXTRACT(DOW FROM v_good) <> v_dow THEN
    RAISE EXCEPTION 'FAIL C0: good anchor % has dow %, want %', v_good, EXTRACT(DOW FROM v_good), v_dow;
  END IF;

  -- C1. 2 + anchor on the row's weekday -> accepted.
  BEGIN
    UPDATE public.provider_availability
       SET repeat_every_weeks = 2, repeat_anchor_date = v_good
     WHERE id = v_id;
    GET DIAGNOSTICS v_n = ROW_COUNT;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'FAIL C1 valid every-2-weeks row: got error "%", want accepted', SQLERRM;
  END;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'FAIL C1 valid every-2-weeks row: updated % row(s), want 1', v_n;
  END IF;

  -- C2. 2 + NULL anchor -> rejected by repeat_anchor_check.
  v_con := NULL;
  BEGIN
    UPDATE public.provider_availability
       SET repeat_every_weeks = 2, repeat_anchor_date = NULL
     WHERE id = v_id;
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME;
  END;
  IF v_con IS DISTINCT FROM 'provider_availability_repeat_anchor_check' THEN
    RAISE EXCEPTION 'FAIL C2 every-2-weeks with no anchor: rejected by %, want provider_availability_repeat_anchor_check', coalesce(v_con, 'nothing (accepted)');
  END IF;

  -- C3. 2 + anchor on the wrong weekday -> rejected by repeat_anchor_check.
  v_con := NULL;
  BEGIN
    UPDATE public.provider_availability
       SET repeat_every_weeks = 2, repeat_anchor_date = v_bad
     WHERE id = v_id;
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME;
  END;
  IF v_con IS DISTINCT FROM 'provider_availability_repeat_anchor_check' THEN
    RAISE EXCEPTION 'FAIL C3 anchor % on wrong weekday (row dow %): rejected by %, want provider_availability_repeat_anchor_check', v_bad, v_dow, coalesce(v_con, 'nothing (accepted)');
  END IF;

  -- C4. 3 -> rejected by repeat_every_weeks_check. The anchor is the valid
  --     one, so the anchor check PASSES (its second branch holds) and only
  --     the value check can reject the row.
  v_con := NULL;
  BEGIN
    UPDATE public.provider_availability
       SET repeat_every_weeks = 3, repeat_anchor_date = v_good
     WHERE id = v_id;
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME;
  END;
  IF v_con IS DISTINCT FROM 'provider_availability_repeat_every_weeks_check' THEN
    RAISE EXCEPTION 'FAIL C4 repeat_every_weeks = 3: rejected by %, want provider_availability_repeat_every_weeks_check', coalesce(v_con, 'nothing (accepted)');
  END IF;

  -- C5. 1 + NULL anchor -> accepted (back to every week).
  BEGIN
    UPDATE public.provider_availability
       SET repeat_every_weeks = 1, repeat_anchor_date = NULL
     WHERE id = v_id;
    GET DIAGNOSTICS v_n = ROW_COUNT;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'FAIL C5 every week, no anchor: got error "%", want accepted', SQLERRM;
  END;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'FAIL C5 every week, no anchor: updated % row(s), want 1', v_n;
  END IF;

  RAISE EXCEPTION 'PASS: §B C1–C5 all passed on provider_availability % (dow %, anchor %) — everything rolled back', v_id, v_dow, v_good;
END
$b$;


-- ═════════════════════════════════════════════════════════════════════════════
-- §E. ROLLBACK — only after the app and waitlist-dispatch are reverted
-- ═════════════════════════════════════════════════════════════════════════════
-- Both the reverted-to app and function must no longer name the columns, or
-- the Home pill query and every waitlist dispatch run fail.
-- Dropping the columns DISCARDS every provider's every-2-weeks setting; note
-- them first if any exist:
--   SELECT provider_id, day_of_week, repeat_anchor_date
--   FROM public.provider_availability WHERE repeat_every_weeks = 2;
--
-- ALTER TABLE public.provider_availability DROP CONSTRAINT IF EXISTS provider_availability_repeat_anchor_check;
-- ALTER TABLE public.provider_availability DROP CONSTRAINT IF EXISTS provider_availability_repeat_every_weeks_check;
-- ALTER TABLE public.provider_availability DROP COLUMN IF EXISTS repeat_anchor_date;
-- ALTER TABLE public.provider_availability DROP COLUMN IF EXISTS repeat_every_weeks;
--
-- After: 0.1 and 0.2 return ZERO rows again; A5 still matches 0.4.
