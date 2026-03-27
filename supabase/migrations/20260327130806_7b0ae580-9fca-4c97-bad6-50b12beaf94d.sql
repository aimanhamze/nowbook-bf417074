INSERT INTO storage.buckets (id, name, public)
VALUES ('provider-images', 'provider-images', true);

CREATE POLICY "Providers can upload their images"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'provider-images'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "Providers can update their images"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'provider-images'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "Providers can delete their images"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'provider-images'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "Anyone can view provider images"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'provider-images');