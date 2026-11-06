-- VERIFY for 20261106000001_service_image_url.sql. Read-only; run on DEV.

-- §0 BEFORE applying — expect ZERO rows (the column does not exist yet).
SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'provider_services' AND column_name = 'image_url';

-- §A AFTER applying.

-- A1. Column exists: text, nullable, no default.
--     Expect one row: image_url | text | YES | NULL
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'provider_services' AND column_name = 'image_url';

-- A2. Every existing row is NULL (nothing changed for current services).
--     Expect: with_image = 0
SELECT COUNT(*) AS total, COUNT(image_url) AS with_image
FROM public.provider_services;

-- A3. Policies on provider_services are unchanged by this migration.
--     Expect the same rows as before the apply (no column filters anywhere).
SELECT policyname, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'provider_services'
ORDER BY policyname;

-- A4. Storage policies on provider-images still key on the owner folder.
--     Expect INSERT/UPDATE/DELETE with (storage.foldername(name))[1] = auth.uid()::text,
--     and a public SELECT for bucket_id = 'provider-images'.
SELECT policyname, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'storage' AND tablename = 'objects'
  AND (qual LIKE '%provider-images%' OR with_check LIKE '%provider-images%')
ORDER BY policyname;

-- §R ROLLBACK (only if needed; drops any uploaded image links, not the files).
-- ALTER TABLE public.provider_services DROP COLUMN IF EXISTS image_url;
