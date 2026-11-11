-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  READ-ONLY. Run the SAME text on PROD (aqlc…) and on DEV (ovpf…).        ║
-- ║  One SELECT, no writes, no DDL, no temp objects.                         ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- Output columns:  part | section | item | md5 | detail
--   part 0 = one row per SECTION: item = "<n> items", md5 = section fingerprint
--   part 1 = one row per ITEM:    md5 = md5(detail), detail = the definition
--
-- Sections:
--   meta          server_version (informational — may legitimately differ)
--   tables        public tables/views/matviews: kind, owner, view definition
--   columns       table.column: type | NULL/NOT NULL | default | identity | generated
--   constraints   table.constraint: contype + pg_get_constraintdef
--   indexes       table.index: pg_get_indexdef
--   triggers      schema.table.trigger (public + auth): trigger def + its function body
--   functions     public functions/procedures (extension-owned excluded): owner + body
--   rls           public tables: rls on/off, force on/off
--   policies      public + storage policies: permissive | roles | cmd | USING | CHECK
--   extensions    name: version + schema
--   cron          cron.job: jobname | schedule | active   (command NOT shown — it
--                 holds secrets; a missing pg_cron prints a marker row instead)
--   buckets       storage.buckets: public | size limit | mime types
--   enums         public enum types: labels in order           (extra)
--   grants_tbl    public tables/views: grantee:privilege list   (extra)
--   grants_fn     public functions: grantee:EXECUTE list        (extra)
--   realtime      tables in the supabase_realtime publication   (extra)
--
-- Normalisation: every function body has CR (\r) removed. Everything is sorted
-- with COLLATE "C" so the fingerprints do not depend on the DB locale.
-- Column order (attnum) is deliberately NOT part of any fingerprint.
--
-- NOTE: function md5s here hash "owner=…" + pg_get_functiondef(), so they will
-- NOT equal the earlier prevent_booking_conflicts hashes (df437a3a… / 3d77d9f9…).
-- Compare PROD vs DEV from this query only.
--
-- HOW TO RETURN IT: in the SQL editor results, Export → Download CSV, once per
-- project (name them prod.csv / dev.csv) and give me the two paths. Check that
-- the CSV's row count = section count + the sum of the "<n> items" values.

WITH
tbl AS (
  SELECT c.oid, c.relname, c.relkind
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind IN ('r','p','v','m','f')
),
items AS (
  -- meta
  SELECT 'meta' AS sec, 'server_version' AS item, current_setting('server_version') AS detail

  -- tables
  UNION ALL
  SELECT 'tables', t.relname,
         concat_ws(E'\n',
           CASE t.relkind WHEN 'r' THEN 'table' WHEN 'p' THEN 'partitioned table'
                          WHEN 'v' THEN 'view' WHEN 'm' THEN 'materialized view'
                          WHEN 'f' THEN 'foreign table' END,
           'owner=' || pg_get_userbyid(c.relowner),
           CASE WHEN t.relkind IN ('v','m') THEN pg_get_viewdef(t.oid, true) END)
  FROM tbl t JOIN pg_class c ON c.oid = t.oid

  -- columns
  UNION ALL
  SELECT 'columns', t.relname || '.' || a.attname,
         concat_ws(' | ',
           format_type(a.atttypid, a.atttypmod),
           CASE WHEN a.attnotnull THEN 'NOT NULL' ELSE 'NULL' END,
           'default=' || coalesce(pg_get_expr(d.adbin, d.adrelid), '—'),
           CASE WHEN a.attidentity::text <> '' THEN 'identity=' || a.attidentity::text END,
           CASE WHEN a.attgenerated::text <> '' THEN 'generated=' || a.attgenerated::text END)
  FROM tbl t
  JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum > 0 AND NOT a.attisdropped
  LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum

  -- constraints
  UNION ALL
  SELECT 'constraints', t.relname || '.' || co.conname,
         co.contype::text || ' ' || pg_get_constraintdef(co.oid)
  FROM tbl t JOIN pg_constraint co ON co.conrelid = t.oid

  -- indexes
  UNION ALL
  SELECT 'indexes', i.tablename || '.' || i.indexname, i.indexdef
  FROM pg_indexes i WHERE i.schemaname = 'public'

  -- triggers (public + auth, e.g. on_auth_user_created) with the function body
  UNION ALL
  SELECT 'triggers', n.nspname || '.' || c.relname || '.' || tg.tgname,
         pg_get_triggerdef(tg.oid, true)
         || E'\n-- function: ' || tg.tgfoid::regprocedure::text
         || E'\n' || replace(pg_get_functiondef(tg.tgfoid), E'\r', '')
  FROM pg_trigger tg
  JOIN pg_class c ON c.oid = tg.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE NOT tg.tgisinternal AND n.nspname IN ('public', 'auth')

  -- functions (public, not owned by an extension, no aggregates)
  UNION ALL
  SELECT 'functions', p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
         'owner=' || pg_get_userbyid(p.proowner) || E'\n'
         || replace(pg_get_functiondef(p.oid), E'\r', '')
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.prokind IN ('f','p')
    AND NOT EXISTS (SELECT 1 FROM pg_depend dep
                     WHERE dep.classid = 'pg_proc'::regclass
                       AND dep.objid = p.oid AND dep.deptype = 'e')

  -- rls
  UNION ALL
  SELECT 'rls', t.relname,
         'rls=' || c.relrowsecurity || ' force=' || c.relforcerowsecurity
  FROM tbl t JOIN pg_class c ON c.oid = t.oid
  WHERE t.relkind IN ('r','p')

  -- policies (public + storage)
  UNION ALL
  SELECT 'policies', pol.schemaname || '.' || pol.tablename || '.' || pol.policyname,
         concat_ws(' | ', pol.permissive, pol.roles::text, pol.cmd,
                   'USING ' || coalesce(pol.qual, '—'),
                   'CHECK ' || coalesce(pol.with_check, '—'))
  FROM pg_policies pol
  WHERE pol.schemaname IN ('public', 'storage')

  -- extensions
  UNION ALL
  SELECT 'extensions', e.extname, 'version=' || e.extversion || ' schema=' || en.nspname
  FROM pg_extension e JOIN pg_namespace en ON en.oid = e.extnamespace

  -- cron (dynamic, so the query still runs where pg_cron is missing)
  UNION ALL
  SELECT 'cron',
         coalesce((xpath('/row/jobname/text()', r))[1]::text, '(no jobname)'),
         concat_ws(' | ',
           'schedule=' || coalesce((xpath('/row/schedule/text()', r))[1]::text, '—'),
           'active='   || coalesce((xpath('/row/active/text()',   r))[1]::text, '—'))
  FROM unnest(xpath('/table/row',
         CASE WHEN to_regclass('cron.job') IS NOT NULL
              THEN query_to_xml('SELECT jobname, schedule, active FROM cron.job', false, false, '')
              ELSE '<table/>'::xml END)) AS r
  UNION ALL
  SELECT 'cron', '(cron.job does not exist — pg_cron not installed)', '—'
  WHERE to_regclass('cron.job') IS NULL

  -- storage buckets
  UNION ALL
  SELECT 'buckets', b.id,
         concat_ws(' | ', 'name=' || b.name, 'public=' || b.public,
                   'size_limit=' || coalesce(b.file_size_limit::text, '—'),
                   'mime=' || coalesce(b.allowed_mime_types::text, '—'))
  FROM storage.buckets b

  -- enums (extra)
  UNION ALL
  SELECT 'enums', ty.typname,
         string_agg(en.enumlabel, ',' ORDER BY en.enumsortorder)
  FROM pg_type ty
  JOIN pg_namespace n ON n.oid = ty.typnamespace
  JOIN pg_enum en ON en.enumtypid = ty.oid
  WHERE n.nspname = 'public'
  GROUP BY ty.typname

  -- table grants (extra)
  UNION ALL
  SELECT 'grants_tbl', t.relname,
         coalesce((SELECT string_agg(g, ', ' ORDER BY g COLLATE "C")
                     FROM (SELECT CASE WHEN a.grantee = 0 THEN 'PUBLIC'
                                       ELSE pg_get_userbyid(a.grantee)::text END
                                  || ':' || a.privilege_type AS g
                             FROM aclexplode(c.relacl) a) s),
                  '(default acl)')
  FROM tbl t JOIN pg_class c ON c.oid = t.oid

  -- function grants (extra) — NULL acl means the default: EXECUTE to PUBLIC
  UNION ALL
  SELECT 'grants_fn', p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
         coalesce((SELECT string_agg(g, ', ' ORDER BY g COLLATE "C")
                     FROM (SELECT CASE WHEN a.grantee = 0 THEN 'PUBLIC'
                                       ELSE pg_get_userbyid(a.grantee)::text END
                                  || ':' || a.privilege_type AS g
                             FROM aclexplode(p.proacl) a) s),
                  '(default acl: PUBLIC EXECUTE)')
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.prokind IN ('f','p')
    AND NOT EXISTS (SELECT 1 FROM pg_depend dep
                     WHERE dep.classid = 'pg_proc'::regclass
                       AND dep.objid = p.oid AND dep.deptype = 'e')

  -- realtime publication (extra)
  UNION ALL
  SELECT 'realtime', pt.schemaname || '.' || pt.tablename, 'in supabase_realtime'
  FROM pg_publication_tables pt
  WHERE pt.pubname = 'supabase_realtime'
),
h AS (
  SELECT sec,
         coalesce(item, '(null)') AS item,
         coalesce(detail, '(null)') AS detail,
         md5(coalesce(detail, '(null)')) AS item_md5
  FROM items
)
SELECT * FROM (
  SELECT 0 AS part, sec AS section, count(*)::text || ' items' AS item,
         md5(string_agg(item || '=' || item_md5, E'\n' ORDER BY item COLLATE "C")) AS md5,
         NULL::text AS detail
  FROM h GROUP BY sec
  UNION ALL
  SELECT 1, sec, item, item_md5, detail FROM h
) out
ORDER BY part, section COLLATE "C", item COLLATE "C";
