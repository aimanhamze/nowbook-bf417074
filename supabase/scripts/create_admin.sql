-- ============================================================
-- create_admin.sql
-- Creates a test admin user for development purposes.
-- Run this in the Supabase SQL Editor (Dashboard → SQL Editor).
--
-- After running, add these to your .env:
--   VITE_DEV_TEST_EMAIL=admin@test.dev
--   VITE_DEV_TEST_PASSWORD=Admin1234!
-- ============================================================

do $$
declare
  v_user_id uuid;
begin
  -- Create the user in auth.users if it doesn't already exist
  if not exists (
    select 1 from auth.users where email = 'admin@test.dev'
  ) then
    insert into auth.users (
      id,
      instance_id,
      email,
      encrypted_password,
      email_confirmed_at,
      raw_app_meta_data,
      raw_user_meta_data,
      created_at,
      updated_at,
      role,
      aud
    ) values (
      gen_random_uuid(),
      '00000000-0000-0000-0000-000000000000',
      'admin@test.dev',
      crypt('Admin1234!', gen_salt('bf')),
      now(),
      '{"provider":"email","providers":["email"]}',
      '{"display_name":"Dev Admin"}',
      now(),
      now(),
      'authenticated',
      'authenticated'
    );
  end if;

  -- Fetch the user id
  select id into v_user_id from auth.users where email = 'admin@test.dev';

  -- Ensure profile exists (trigger may already handle this)
  insert into public.profiles (user_id, display_name)
  values (v_user_id, 'Dev Admin')
  on conflict (user_id) do nothing;

  -- Grant admin role (and base user role)
  insert into public.user_roles (user_id, role)
  values (v_user_id, 'user')
  on conflict (user_id, role) do nothing;

  insert into public.user_roles (user_id, role)
  values (v_user_id, 'admin')
  on conflict (user_id, role) do nothing;

  raise notice 'Admin user ready: admin@test.dev (id: %)', v_user_id;
end;
$$;