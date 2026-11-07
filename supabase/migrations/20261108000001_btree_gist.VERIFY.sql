-- VERIFY for 20261108000001_btree_gist.sql. Read-only; run on DEV.

-- §0 BEFORE applying — expect installed_version = NULL, default_version = 1.7.
SELECT name, default_version, installed_version
FROM pg_available_extensions
WHERE name = 'btree_gist';

-- §A AFTER applying.

-- A1. Installed in the extensions schema.
--     Expect one row: btree_gist | 1.7 | extensions
SELECT e.extname, e.extversion, n.nspname AS schema
FROM pg_extension e
JOIN pg_namespace n ON n.oid = e.extnamespace
WHERE e.extname = 'btree_gist';

-- A2. A uuid GiST operator class now exists (what migration 3's EXCLUDE needs).
--     Expect one row: gist_uuid_ops
SELECT opc.opcname
FROM pg_opclass opc
JOIN pg_am am ON am.oid = opc.opcmethod
WHERE am.amname = 'gist' AND opc.opcname = 'gist_uuid_ops';

-- §R ROLLBACK (only before migration 3 exists; it depends on this).
-- DROP EXTENSION IF EXISTS btree_gist;
