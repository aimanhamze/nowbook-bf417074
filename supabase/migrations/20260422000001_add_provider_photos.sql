-- Create provider_photos table
CREATE TABLE provider_photos (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  provider_id UUID NOT NULL REFERENCES provider_profiles(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  caption TEXT,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE provider_photos ENABLE ROW LEVEL SECURITY;

-- Provider can manage their own photos
CREATE POLICY "Provider manages own photos" ON provider_photos
  FOR ALL USING (
    provider_id IN (
      SELECT id FROM provider_profiles WHERE user_id = auth.uid()
    )
  );

-- Public can view photos
CREATE POLICY "Anyone can view photos" ON provider_photos
  FOR SELECT USING (true);

-- Index for fast lookups by provider
CREATE INDEX ON provider_photos(provider_id);

-- Storage bucket for provider photos (public read)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'provider-photos',
  'provider-photos',
  true,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- Authenticated users can upload to their own folder
CREATE POLICY "Provider can upload own photos" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'provider-photos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Authenticated users can delete their own photos
CREATE POLICY "Provider can delete own photos" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'provider-photos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Public can read all photos
CREATE POLICY "Anyone can view provider photos" ON storage.objects
  FOR SELECT USING (bucket_id = 'provider-photos');
