-- Create a placeholder user for the new provider
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token)
VALUES (
  gen_random_uuid(),
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  'mb.physiofit.provider@placeholder.local',
  crypt('placeholder_password_123', gen_salt('bf')),
  now(), now(), now(), '', '', '', ''
);

-- Insert provider profile
INSERT INTO provider_profiles (user_id, business_name, category, cover_image, avatar_image)
VALUES (
  (SELECT id FROM auth.users WHERE email = 'mb.physiofit.provider@placeholder.local'),
  'MB PhysioFit Clinic',
  'physiotherapy',
  'https://kvfgdbmjqquyisagpyml.supabase.co/storage/v1/object/public/provider-images/mb-physiofit-cover.jpg',
  'https://kvfgdbmjqquyisagpyml.supabase.co/storage/v1/object/public/provider-images/mb-physiofit-cover.jpg'
);

-- Add default availability (Sunday-Thursday, 9:00-17:00)
INSERT INTO provider_availability (provider_id, day_of_week, start_time, end_time, is_available)
SELECT pp.id, d.day, '09:00'::time, '17:00'::time, true
FROM provider_profiles pp
CROSS JOIN (VALUES (0),(1),(2),(3),(4)) AS d(day)
WHERE pp.business_name = 'MB PhysioFit Clinic';