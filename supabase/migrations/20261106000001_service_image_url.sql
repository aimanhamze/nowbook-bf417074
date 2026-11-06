-- Optional illustrative image per service (feat/service-images).
--
-- provider_services.image_url holds the PUBLIC URL of a file in the existing
-- `provider-images` bucket, uploaded to {auth.uid()}/service-{service_id}-{ts}.ext
-- — the same folder-per-owner layout the cover/avatar uploads use, so the
-- bucket's existing "Providers can upload/update/delete their images" policies
-- (20260327130806, keyed on (storage.foldername(name))[1] = auth.uid()) already
-- cover it. No new bucket, no storage policy change.
--
-- NULL = no image: the customer UI keeps showing the existing icon, so every
-- existing row is unaffected on apply. No backfill, no default.
--
-- RLS: none needed. The live provider_services policies are
--   "Anyone can view active services"   FOR SELECT USING (true)
--   "Providers can manage own services" FOR ALL (provider owns the row)
-- and neither filters columns, so the new column is readable and writable on
-- exactly the same terms as name/price/duration.
--
-- Nullable ADD COLUMN with no default is a catalog-only change (no table
-- rewrite), but it still takes ACCESS EXCLUSIVE for an instant. Bound the wait
-- so a busy table makes this fail fast instead of queueing booking-flow reads
-- behind it — just run it again.
--
-- After applying, types.ts is NOT regenerated in this branch; the column is
-- typed by hand at the call sites (typed-here-before-regen convention).

BEGIN;

SET LOCAL lock_timeout = '3s';

ALTER TABLE public.provider_services
  ADD COLUMN IF NOT EXISTS image_url text;

COMMENT ON COLUMN public.provider_services.image_url IS
  'Public URL of an optional illustrative image in the provider-images bucket. NULL = show the default icon.';

COMMIT;
