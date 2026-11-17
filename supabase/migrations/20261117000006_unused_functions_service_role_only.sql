-- (b1) get_slot_capacity and get_display_name: EXECUTE for service_role only.
--
-- ORDER: VERIFY §0 → this file → VERIFY §A → §B, on DEV and then on PROD.
-- Safe to re-run: REVOKE and GRANT are no-ops when already applied.
-- Rollback: VERIFY §E.
-- Grants only. No function body is changed.
--
-- WHY. Both are SECURITY DEFINER and hold EXECUTE for PUBLIC, anon and
-- authenticated (acl {=X, anon=X, authenticated=X, …} on DEV and PROD), so
-- anyone holding the public anon key can call them through PostgREST:
--   get_display_name(uuid)   returns any user's display_name by user id.
--                            profiles is closed to logged-out callers since
--                            20261117000005; this function was a second way
--                            to the same names.
--   get_slot_capacity(uuid, date, text, uuid)
--                            returns max_capacity / booked_count /
--                            available_spots / is_full for one slot. Counts
--                            only, no personal data — but nothing calls it.
--
-- WHO CALLS THEM (checked 2026-11-17): nobody.
--   * src/ ...................... no call. Group capacity is computed in the
--                                 client (getGroupSlotsWithCapacity); CLAUDE.md
--                                 said otherwise and is corrected in this
--                                 commit. The only match in src/ is the
--                                 generated types.ts.
--   * supabase/functions/ ....... no call.
--   * other SQL ................. the audit grids (PROD + DEV) show neither
--                                 inside any RLS policy. VERIFY §0b re-checks
--                                 on each database: function bodies, policies,
--                                 views, column defaults and cron jobs.
-- service_role keeps EXECUTE so the functions stay usable from an edge
-- function or the SQL editor; nothing is dropped.
--
-- NOT IN THE REPO: get_slot_capacity exists on PROD and DEV but no migration
-- creates it. Its PROD definition is recorded in the search_path commit (c).
-- Like 20261117000004, this file finds the functions by name — every
-- overload — so a database with a different argument list neither fails nor
-- leaves an overload open. VERIFY §A asserts the result.

BEGIN;

DO $b1_grants$
DECLARE
  fn    regprocedure;
  found integer := 0;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('get_slot_capacity', 'get_display_name')
    ORDER BY p.proname
  LOOP
    -- PUBLIC, anon and authenticated BY NAME: the named grants are the ones a
    -- revoke from PUBLIC alone leaves behind.
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
    found := found + 1;
    RAISE NOTICE 'service_role only: %', fn;
  END LOOP;

  IF found <> 2 THEN
    RAISE NOTICE 'expected 2 functions, found % — compare with VERIFY §0a', found;
  END IF;
END;
$b1_grants$;

COMMIT;
