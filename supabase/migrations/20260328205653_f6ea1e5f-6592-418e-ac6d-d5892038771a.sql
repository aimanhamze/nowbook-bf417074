-- Create a placeholder user for the new provider
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token)
VALUES (
  gen_random_uuid(),
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  'baraa.sleman.provider@placeholder.local',
  crypt('placeholder_password_123', gen_salt('bf')),
  now(),
  now(),
  now(),
  '',
  '',
  '',
  ''
);

-- Now insert the provider profile
INSERT INTO provider_profiles (user_id, business_name, category, address, about, phone)
VALUES (
  (SELECT id FROM auth.users WHERE email = 'baraa.sleman.provider@placeholder.local'),
  'BODY PHYSICAL THERAPY - BARAA SLEMAN',
  'physiotherapy',
  '',
  '',
  ''
);

-- Add default availability (Sunday-Thursday, 9:00-17:00)
INSERT INTO provider_availability (provider_id, day_of_week, start_time, end_time, is_available)
SELECT 
  pp.id,
  d.day,
  '09:00'::time,
  '17:00'::time,
  true
FROM provider_profiles pp
CROSS JOIN (VALUES (0),(1),(2),(3),(4)) AS d(day)
WHERE pp.business_name = 'BODY PHYSICAL THERAPY - BARAA SLEMAN';