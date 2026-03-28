-- Update bookings with mock provider_id '1' to use the actual DB provider UUID
-- Mock provider "1" = "הג׳נטלמן" = DB provider ffaa27e1-d3cc-4cf1-8791-3bc6324f9cb0
UPDATE bookings 
SET provider_id = 'ffaa27e1-d3cc-4cf1-8791-3bc6324f9cb0'
WHERE provider_id = '1';

-- Also update the RLS policy to handle both uuid and legacy mock IDs
-- by allowing the provider to see their bookings
DROP POLICY IF EXISTS "Providers can view bookings for their business" ON bookings;
CREATE POLICY "Providers can view bookings for their business"
ON bookings FOR SELECT TO authenticated
USING (
  provider_id IN (
    SELECT id::text FROM provider_profiles WHERE user_id = auth.uid()
  )
);