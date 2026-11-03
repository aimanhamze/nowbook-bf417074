-- VERIFY for 20261103000002_waitlist_provider.sql
--
--   §0  BEFORE the migration, read-only. DEV, then PROD before the prod apply.
--   §A  after the migration, read-only. DEV and PROD.
--   §B  after the migration, DEV ONLY. Behaviour tests, all rolled back.
--   §E  rollback (commented out).


-- ═════════════════════════════════════════════════════════════════════════════
-- §0. PRE-APPLY — REQUIRED, READ-ONLY
-- ═════════════════════════════════════════════════════════════════════════════

-- 0.1 Every name is free. Expect four NULLs.
SELECT to_regprocedure('public.waitlist_close_on_disable()')            AS close_fn,
       to_regprocedure('public.waitlist_provider_counts(uuid)')         AS counts_fn,
       to_regprocedure('public.waitlist_provider_day(uuid, date)')      AS day_fn,
       (SELECT tgname FROM pg_trigger
         WHERE tgrelid = 'public.provider_profiles'::regclass
           AND tgname = 'trg_waitlist_close_on_disable')                AS trigger_name;

-- 0.2 Every column read, with its type. Expect 12 rows:
--       auth.users          id uuid, phone text
--       profiles            display_name text, phone text, user_id uuid
--       provider_profiles   user_id uuid, waitlist_enabled boolean
--       provider_services   name text
--       provider_staff      name text
--       waitlist_entries    ended_at timestamp with time zone, entry_date date, status text
SELECT n.nspname AS schema, c.relname AS tbl, a.attname AS col, format_type(a.atttypid, a.atttypmod) AS type
FROM pg_attribute a
JOIN pg_class c ON c.oid = a.attrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE a.attnum > 0 AND NOT a.attisdropped
  AND (n.nspname, c.relname, a.attname) IN (
    ('auth', 'users', 'id'), ('auth', 'users', 'phone'),
    ('public', 'profiles', 'display_name'), ('public', 'profiles', 'phone'), ('public', 'profiles', 'user_id'),
    ('public', 'provider_profiles', 'user_id'), ('public', 'provider_profiles', 'waitlist_enabled'),
    ('public', 'provider_services', 'name'), ('public', 'provider_staff', 'name'),
    ('public', 'waitlist_entries', 'ended_at'), ('public', 'waitlist_entries', 'entry_date'),
    ('public', 'waitlist_entries', 'status'))
ORDER BY 1, 2, 3;

-- 0.3 Existing provider_profiles triggers. SAVE THIS LIST: §A2 expects exactly
--     these plus trg_waitlist_close_on_disable.
SELECT tgname, tgenabled, pg_get_triggerdef(oid) AS def
FROM pg_trigger
WHERE tgrelid = 'public.provider_profiles'::regclass AND NOT tgisinternal
ORDER BY tgname;

-- 0.4 What the §2 backfill will close: active entries at providers whose flag
--     is off. Informational (expected 0). After the migration this is 0.
SELECT count(*) AS active_entries_at_off_providers
FROM public.waitlist_entries w
JOIN public.provider_profiles p ON p.id = w.provider_id
WHERE w.status = 'active' AND p.waitlist_enabled IS NOT TRUE;


-- ═════════════════════════════════════════════════════════════════════════════
-- §A. AFTER THE MIGRATION — READ-ONLY
-- ═════════════════════════════════════════════════════════════════════════════

-- A1. Expect 3 rows, all prosecdef true and proconfig {"search_path=public, pg_temp"}:
--       waitlist_close_on_disable()         anon false, authenticated false
--       waitlist_provider_counts(uuid)      anon false, authenticated true
--       waitlist_provider_day(uuid,date)    anon false, authenticated true
SELECT p.oid::regprocedure AS fn, p.prosecdef, p.proconfig,
       has_function_privilege('anon', p.oid, 'EXECUTE')          AS anon,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated
FROM pg_proc p
WHERE p.oid IN (to_regprocedure('public.waitlist_close_on_disable()'),
                to_regprocedure('public.waitlist_provider_counts(uuid)'),
                to_regprocedure('public.waitlist_provider_day(uuid, date)'))
ORDER BY 1;

-- A2. Re-run §0.3. Expect the saved rows UNCHANGED plus one new row:
--       trg_waitlist_close_on_disable | O | CREATE TRIGGER … AFTER UPDATE OF
--       waitlist_enabled ON public.provider_profiles FOR EACH ROW WHEN
--       ((old.waitlist_enabled IS TRUE) AND (new.waitlist_enabled IS NOT TRUE)) …

-- A3. Re-run §0.4. Expect 0.


-- ═════════════════════════════════════════════════════════════════════════════
-- §B. BEHAVIOUR TESTS — DEV ONLY, PERSISTS NOTHING
-- ═════════════════════════════════════════════════════════════════════════════
-- Calls the RPCs as the provider's owner, as another provider's owner, as a
-- customer and signed out (by setting the JWT claims auth.uid() reads), and
-- flips the flag to exercise the trigger.
--
-- ⚠  THE BLOCK ALWAYS ENDS IN AN ERROR — that is how it rolls back.
--      SUCCESS = an error starting "PASS:".   Anything else = report it.
--
-- SETUP: set v_provider to a DEV provider_profiles.id. DEV needs a second
-- provider owned by a different account, and two customer accounts (no
-- provider/admin role).

DO $verify$
DECLARE
  v_provider uuid := NULL;   -- ← SET THIS to a DEV provider_profiles.id

  v_today date := (now() AT TIME ZONE 'Asia/Jerusalem')::date;
  v_owner uuid; v_other uuid; v_other_owner uuid;
  u1 uuid; u2 uuid;
  s uuid; s_other uuid; sx uuid;
  e1 uuid; e2 uuid; e3 uuid; e_past uuid; e_left uuid; e_other uuid;
  v_left_ended timestamptz := now() - interval '1 day';
  v_phone text;
  v_got text;
BEGIN
  IF v_provider IS NULL THEN RAISE EXCEPTION 'SETUP: set v_provider first'; END IF;
  IF to_regprocedure('public.waitlist_provider_day(uuid, date)') IS NULL THEN
    RAISE EXCEPTION 'SETUP: the migration is not applied';
  END IF;

  CREATE FUNCTION pg_temp.wl_as(p_uid uuid) RETURNS void LANGUAGE sql AS $h$
    SELECT set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true),
           set_config('request.jwt.claims',
                      CASE WHEN p_uid IS NULL THEN '' ELSE json_build_object('sub', p_uid, 'role', 'authenticated')::text END,
                      true);
  $h$;
  -- Counts as "date=n,…" relative to today, as the given caller.
  CREATE FUNCTION pg_temp.wl_counts(p_uid uuid, p_prov uuid) RETURNS text LANGUAGE plpgsql AS $h$
  DECLARE v text;
  BEGIN
    PERFORM pg_temp.wl_as(p_uid);
    SELECT string_agg(((c.entry_date - (now() AT TIME ZONE 'Asia/Jerusalem')::date))::text || '=' || c.waiting, ','
                      ORDER BY c.entry_date)
      INTO v FROM public.waitlist_provider_counts(p_prov) c;
    RETURN coalesce(v, '');
  END $h$;
  CREATE FUNCTION pg_temp.wl_day_n(p_uid uuid, p_prov uuid, p_date date) RETURNS integer LANGUAGE plpgsql AS $h$
  DECLARE v integer;
  BEGIN
    PERFORM pg_temp.wl_as(p_uid);
    SELECT count(*) INTO v FROM public.waitlist_provider_day(p_prov, p_date);
    RETURN v;
  END $h$;
  CREATE FUNCTION pg_temp.expect(p_label text, p_got text, p_want text) RETURNS void LANGUAGE plpgsql AS $h$
  BEGIN
    IF p_got IS DISTINCT FROM p_want THEN
      RAISE EXCEPTION 'FAIL %: got %, want %', p_label, coalesce(p_got, 'NULL'), p_want;
    END IF;
  END $h$;

  -- ── Setup ──────────────────────────────────────────────────────────────────
  SELECT user_id INTO v_owner FROM public.provider_profiles WHERE id = v_provider;
  IF v_owner IS NULL THEN RAISE EXCEPTION 'SETUP: provider % not found', v_provider; END IF;
  SELECT id, user_id INTO v_other, v_other_owner FROM public.provider_profiles
   WHERE user_id <> v_owner ORDER BY created_at, id LIMIT 1;
  IF v_other IS NULL THEN RAISE EXCEPTION 'SETUP: need a second provider owned by another account'; END IF;

  SELECT u.id INTO u1 FROM auth.users u
   WHERE u.id NOT IN (v_owner, v_other_owner)
     AND NOT EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = u.id AND r.role::text IN ('provider', 'admin'))
   ORDER BY u.created_at, u.id LIMIT 1;
  SELECT u.id INTO u2 FROM auth.users u
   WHERE u.id NOT IN (v_owner, v_other_owner, u1)
     AND NOT EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = u.id AND r.role::text IN ('provider', 'admin'))
   ORDER BY u.created_at, u.id LIMIT 1;
  IF u2 IS NULL THEN RAISE EXCEPTION 'SETUP: need 2 customer accounts'; END IF;

  -- Nothing of the customers' own at these two providers gets in the way.
  UPDATE public.waitlist_entries SET status = 'left', ended_at = now()
   WHERE user_id IN (u1, u2) AND provider_id IN (v_provider, v_other) AND status = 'active';

  UPDATE public.provider_profiles SET waitlist_enabled = true WHERE id IN (v_provider, v_other);

  INSERT INTO public.provider_services (provider_id, name, duration, service_type, max_capacity)
    VALUES (v_provider, 'WL VERIFY 4A', 30, 'private', 1) RETURNING id INTO s;
  INSERT INTO public.provider_services (provider_id, name, duration, service_type, max_capacity)
    VALUES (v_other, 'WL VERIFY 4A OTHER', 30, 'private', 1) RETURNING id INTO s_other;
  INSERT INTO public.provider_staff (provider_id, name) VALUES (v_provider, 'WL VERIFY X') RETURNING id INTO sx;

  -- u1's name and a profile phone; the RPC prefers the account phone if any.
  UPDATE public.profiles SET display_name = 'WL VERIFY ONE', phone = '0501111111' WHERE user_id = u1;
  IF NOT FOUND THEN
    INSERT INTO public.profiles (user_id, display_name, phone) VALUES (u1, 'WL VERIFY ONE', '0501111111');
  END IF;
  SELECT coalesce(nullif(btrim(phone), ''), '0501111111') INTO v_phone FROM auth.users WHERE id = u1;

  INSERT INTO public.waitlist_entries (user_id, provider_id, entry_date, service_id, staff_id, wants_morning, wants_afternoon, wants_evening)
    VALUES (u1, v_provider, v_today + 2, s, sx, true, false, true) RETURNING id INTO e1;
  INSERT INTO public.waitlist_entries (user_id, provider_id, entry_date, service_id, wants_morning, wants_afternoon, wants_evening)
    VALUES (u2, v_provider, v_today + 2, s, true, true, true) RETURNING id INTO e2;
  INSERT INTO public.waitlist_entries (user_id, provider_id, entry_date, service_id, wants_evening)
    VALUES (u1, v_provider, v_today + 3, s, true) RETURNING id INTO e3;
  INSERT INTO public.waitlist_entries (user_id, provider_id, entry_date, service_id, wants_morning)
    VALUES (u2, v_provider, v_today - 1, s, true) RETURNING id INTO e_past;           -- not yet expired
  INSERT INTO public.waitlist_entries (user_id, provider_id, entry_date, service_id, wants_morning, status, ended_at)
    VALUES (u2, v_provider, v_today + 3, s, true, 'left', v_left_ended) RETURNING id INTO e_left;
  INSERT INTO public.waitlist_entries (user_id, provider_id, entry_date, service_id, wants_morning)
    VALUES (u1, v_other, v_today + 2, s_other, true) RETURNING id INTO e_other;

  -- ── Counts and list: only the owner, only active entries from today ───────
  PERFORM pg_temp.expect('counts as owner', pg_temp.wl_counts(v_owner, v_provider), '2=2,3=1');
  PERFORM pg_temp.expect('counts as another provider', pg_temp.wl_counts(v_other_owner, v_provider), '');
  PERFORM pg_temp.expect('counts as customer', pg_temp.wl_counts(u1, v_provider), '');
  PERFORM pg_temp.expect('counts signed out', pg_temp.wl_counts(NULL, v_provider), '');
  PERFORM pg_temp.expect('other owner sees own provider only', pg_temp.wl_counts(v_other_owner, v_other), '2=1');

  PERFORM pg_temp.expect('day list as owner', pg_temp.wl_day_n(v_owner, v_provider, v_today + 2)::text, '2');
  PERFORM pg_temp.expect('day list as another provider', pg_temp.wl_day_n(v_other_owner, v_provider, v_today + 2)::text, '0');
  PERFORM pg_temp.expect('day list as customer', pg_temp.wl_day_n(u1, v_provider, v_today + 2)::text, '0');
  PERFORM pg_temp.expect('day list signed out', pg_temp.wl_day_n(NULL, v_provider, v_today + 2)::text, '0');
  PERFORM pg_temp.expect('day list skips a left entry', pg_temp.wl_day_n(v_owner, v_provider, v_today + 3)::text, '1');

  PERFORM pg_temp.wl_as(v_owner);
  SELECT string_agg(concat_ws('|', d.customer_name, d.customer_phone, d.service_name, coalesce(d.staff_name, 'ANYONE'),
                              d.wants_morning, d.wants_afternoon, d.wants_evening), ' / ' ORDER BY d.created_at, d.entry_id)
    INTO v_got
    FROM public.waitlist_provider_day(v_provider, v_today + 2) d
   WHERE d.entry_id = e1;
  PERFORM pg_temp.expect('day list row', v_got, concat_ws('|', 'WL VERIFY ONE', v_phone, 'WL VERIFY 4A', 'WL VERIFY X', true, false, true));
  IF NOT EXISTS (SELECT 1 FROM public.waitlist_provider_day(v_provider, v_today + 2) d
                  WHERE d.entry_id = e2 AND d.staff_name IS NULL) THEN
    RAISE EXCEPTION 'FAIL day list: the "anyone" entry should have staff_name NULL';
  END IF;

  -- ── Trigger: only true → false closes, and only this provider's entries ───
  UPDATE public.provider_profiles SET business_name = business_name WHERE id = v_provider;
  UPDATE public.provider_profiles SET waitlist_enabled = true WHERE id = v_provider;
  SELECT string_agg(status, ',' ORDER BY status) INTO v_got FROM public.waitlist_entries WHERE id IN (e1, e2, e3, e_past);
  PERFORM pg_temp.expect('other updates close nothing', v_got, 'active,active,active,active');

  UPDATE public.provider_profiles SET waitlist_enabled = false WHERE id = v_provider;
  SELECT string_agg(status || ':' || (ended_at IS NOT NULL)::text, ',') INTO v_got
    FROM public.waitlist_entries WHERE id IN (e1, e2, e3, e_past);
  PERFORM pg_temp.expect('off closes every active entry', v_got, 'closed:true,closed:true,closed:true,closed:true');
  IF NOT EXISTS (SELECT 1 FROM public.waitlist_entries WHERE id = e_left AND status = 'left' AND ended_at = v_left_ended) THEN
    RAISE EXCEPTION 'FAIL off: an already-ended entry was changed';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.waitlist_entries WHERE id = e_other AND status = 'active') THEN
    RAISE EXCEPTION 'FAIL off: another provider''s entry was closed';
  END IF;
  PERFORM pg_temp.expect('counts with the flag off', pg_temp.wl_counts(v_owner, v_provider), '');
  -- An entry that is somehow still active while the flag is off is not shown.
  INSERT INTO public.waitlist_entries (user_id, provider_id, entry_date, service_id, wants_morning)
    VALUES (u2, v_provider, v_today + 4, s, true);
  PERFORM pg_temp.expect('counts ignore a stray entry while off', pg_temp.wl_counts(v_owner, v_provider), '');
  PERFORM pg_temp.expect('day list ignores it while off', pg_temp.wl_day_n(v_owner, v_provider, v_today + 4)::text, '0');
  UPDATE public.waitlist_entries SET status = 'left', ended_at = now()
   WHERE user_id = u2 AND provider_id = v_provider AND entry_date = v_today + 4 AND status = 'active';

  UPDATE public.provider_profiles SET waitlist_enabled = true WHERE id = v_provider;
  SELECT count(*)::text INTO v_got FROM public.waitlist_entries WHERE id IN (e1, e2, e3, e_past) AND status = 'closed';
  PERFORM pg_temp.expect('on again reopens nothing', v_got, '4');
  PERFORM pg_temp.expect('counts after on again', pg_temp.wl_counts(v_owner, v_provider), '');

  RAISE EXCEPTION 'PASS: every check passed. This error is deliberate — it rolled back the test services, staff, entries, the profile edit and both providers'' settings. Nothing was persisted.';
END
$verify$;

-- B-after. Expect 0.
SELECT count(*) AS leftover_services FROM public.provider_services WHERE name LIKE 'WL VERIFY 4A%';


-- ═════════════════════════════════════════════════════════════════════════════
-- §E. ROLLBACK — commented out
-- ═════════════════════════════════════════════════════════════════════════════
-- Entries already closed by the trigger or the backfill stay closed.
--
-- BEGIN;
-- SET LOCAL lock_timeout = '3s';
-- DROP TRIGGER IF EXISTS trg_waitlist_close_on_disable ON public.provider_profiles;
-- DROP FUNCTION IF EXISTS public.waitlist_close_on_disable();
-- DROP FUNCTION IF EXISTS public.waitlist_provider_counts(uuid);
-- DROP FUNCTION IF EXISTS public.waitlist_provider_day(uuid, date);
-- COMMIT;
