-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  DEV ONLY (ovpfjlqlfzxjfcbrtwra). NOT A MIGRATION.                       ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- Schema parity: DEV is missing a constraint that PROD has.
--
--   PROD: CONSTRAINT provider_services_id_provider_id_key UNIQUE (id, provider_id)
--         plus the unique index of the same name that backs it.
--   DEV:  only provider_services_pkey PRIMARY KEY (id).
--
-- It was added by 20260803000001_add_provider_staff_services.sql §1, which
-- evidently never reached DEV in full. 20261017000001_waitlist_schema.sql needs
-- it for the composite FK waitlist_entries_service_fk, so run this on DEV
-- BEFORE that migration. Afterwards VERIFY §0.5 returns 2 rows on DEV, as it
-- does on PROD.
--
-- Safe if pasted into PROD by mistake: the guard aborts before any change when
-- the constraint, or any relation with that name, already exists.
--
-- No data risk: id is the primary key, so (id, provider_id) is already unique.
-- ADD CONSTRAINT takes a brief ACCESS EXCLUSIVE lock on provider_services to
-- build the index; lock_timeout keeps it from queueing behind a long reader.

BEGIN;

SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF to_regclass('public.provider_services') IS NULL THEN
    RAISE EXCEPTION 'ABORT: public.provider_services does not exist. Nothing changed.';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_constraint
             WHERE conname = 'provider_services_id_provider_id_key') THEN
    RAISE EXCEPTION 'ABORT: constraint provider_services_id_provider_id_key already exists (is this PROD?). Nothing changed.';
  END IF;

  IF to_regclass('public.provider_services_id_provider_id_key') IS NOT NULL THEN
    RAISE EXCEPTION 'ABORT: a relation named provider_services_id_provider_id_key already exists (index without the constraint?). Nothing changed — investigate by hand.';
  END IF;

  ALTER TABLE public.provider_services
    ADD CONSTRAINT provider_services_id_provider_id_key UNIQUE (id, provider_id);
END
$$;

COMMIT;

-- Check. Expect 1 row each:
--   provider_services_id_provider_id_key | provider_services | UNIQUE (id, provider_id)
--   provider_services_id_provider_id_key | CREATE UNIQUE INDEX provider_services_id_provider_id_key ON public.provider_services USING btree (id, provider_id)
SELECT conname, conrelid::regclass AS on_table, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conname = 'provider_services_id_provider_id_key';

SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND indexname = 'provider_services_id_provider_id_key';
