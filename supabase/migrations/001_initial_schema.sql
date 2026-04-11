-- ============================================================
-- 001_initial_schema.sql
-- Full initial schema for the NowBook application
-- ============================================================

-- ============================================================
-- EXTENSIONS
-- ============================================================
create extension if not exists "uuid-ossp";


-- ============================================================
-- ENUMS
-- ============================================================
create type public.app_role as enum ('admin', 'provider', 'user');


-- ============================================================
-- TABLES
-- ============================================================

-- profiles
create table public.profiles (
  id             uuid primary key default uuid_generate_v4(),
  user_id        uuid not null unique references auth.users(id) on delete cascade,
  display_name   text,
  avatar_url     text,
  phone          text,
  preferred_lang text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- user_roles
create table public.user_roles (
  id      uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role    public.app_role not null,
  unique (user_id, role)
);

-- provider_profiles
create table public.provider_profiles (
  id            uuid primary key default uuid_generate_v4(),
  user_id       uuid not null unique references auth.users(id) on delete cascade,
  business_name text not null default '',
  category      text not null default '',
  about         text,
  address       text,
  phone         text,
  avatar_image  text,
  cover_image   text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- provider_services
create table public.provider_services (
  id          uuid primary key default uuid_generate_v4(),
  provider_id uuid not null references public.provider_profiles(id) on delete cascade,
  name        text not null,
  price       numeric not null default 0,
  duration    integer not null default 60,  -- minutes
  is_active   boolean not null default true,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- provider_availability
create table public.provider_availability (
  id           uuid primary key default uuid_generate_v4(),
  provider_id  uuid not null references public.provider_profiles(id) on delete cascade,
  day_of_week  integer not null check (day_of_week between 0 and 6),  -- 0=Sun … 6=Sat
  start_time   text not null default '09:00',
  end_time     text not null default '17:00',
  is_available boolean not null default true,
  unique (provider_id, day_of_week)
);

-- provider_blocked_dates
create table public.provider_blocked_dates (
  id           uuid primary key default uuid_generate_v4(),
  provider_id  uuid not null references public.provider_profiles(id) on delete cascade,
  blocked_date date not null,
  reason       text,
  unique (provider_id, blocked_date)
);

-- bookings
create table public.bookings (
  id           uuid primary key default uuid_generate_v4(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  provider_id  uuid not null references public.provider_profiles(id) on delete cascade,
  service_ids  uuid[] not null,
  booking_date date not null,
  booking_time text not null,
  status       text not null default 'pending'
                 check (status in ('pending', 'confirmed', 'cancelled', 'completed')),
  total_price  numeric not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- reviews
create table public.reviews (
  id           uuid primary key default uuid_generate_v4(),
  provider_id  uuid not null references public.provider_profiles(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  booking_id   uuid unique references public.bookings(id) on delete set null,
  rating       integer not null check (rating between 1 and 5),
  comment      text,
  display_name text,
  created_at   timestamptz not null default now()
);

-- favorites
create table public.favorites (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  provider_id uuid not null references public.provider_profiles(id) on delete cascade,
  created_at  timestamptz not null default now(),
  unique (user_id, provider_id)
);

-- notifications
create table public.notifications (
  id         uuid primary key default uuid_generate_v4(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  title      text not null,
  body       text,
  type       text not null default 'info',
  url        text,
  is_read    boolean not null default false,
  created_at timestamptz not null default now()
);

-- push_subscriptions
create table public.push_subscriptions (
  id         uuid primary key default uuid_generate_v4(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  endpoint   text not null,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now(),
  unique (user_id, endpoint)
);


-- ============================================================
-- FUNCTIONS
-- ============================================================

-- Generic updated_at trigger function
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Auto-create profile + default user role on sign-up
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (user_id, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'display_name', new.email)
  )
  on conflict (user_id) do nothing;

  insert into public.user_roles (user_id, role)
  values (new.id, 'user')
  on conflict (user_id, role) do nothing;

  return new;
end;
$$;

-- Check if a user has a given role
create or replace function public.has_role(
  _user_id uuid,
  _role    public.app_role
)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.user_roles
    where user_id = _user_id and role = _role
  );
$$;

-- Return a user's display name
create or replace function public.get_display_name(_user_id uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(display_name, 'User')
  from public.profiles
  where user_id = _user_id
  limit 1;
$$;

-- Convert "HH:MM" time string to minutes since midnight
create or replace function public.booking_time_to_minutes(_time text)
returns integer language sql immutable as $$
  select (split_part(_time, ':', 1)::integer * 60) + split_part(_time, ':', 2)::integer;
$$;


-- ============================================================
-- TRIGGERS
-- ============================================================

-- updated_at on profiles
create trigger trg_profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- updated_at on provider_profiles
create trigger trg_provider_profiles_updated_at
  before update on public.provider_profiles
  for each row execute function public.set_updated_at();

-- updated_at on provider_services
create trigger trg_provider_services_updated_at
  before update on public.provider_services
  for each row execute function public.set_updated_at();

-- updated_at on bookings
create trigger trg_bookings_updated_at
  before update on public.bookings
  for each row execute function public.set_updated_at();

-- new user → profile + role
create trigger trg_on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

alter table public.profiles             enable row level security;
alter table public.user_roles           enable row level security;
alter table public.provider_profiles    enable row level security;
alter table public.provider_services    enable row level security;
alter table public.provider_availability enable row level security;
alter table public.provider_blocked_dates enable row level security;
alter table public.bookings             enable row level security;
alter table public.reviews              enable row level security;
alter table public.favorites            enable row level security;
alter table public.notifications        enable row level security;
alter table public.push_subscriptions   enable row level security;


-- ---------- profiles ----------
create policy "Users can view any profile"
  on public.profiles for select using (true);

create policy "Users can update own profile"
  on public.profiles for update using (auth.uid() = user_id);

create policy "Users can insert own profile"
  on public.profiles for insert with check (auth.uid() = user_id);


-- ---------- user_roles ----------
create policy "Users can view own roles"
  on public.user_roles for select using (auth.uid() = user_id);

create policy "Admins can manage all roles"
  on public.user_roles for all
  using (public.has_role(auth.uid(), 'admin'));


-- ---------- provider_profiles ----------
create policy "Anyone can view provider profiles"
  on public.provider_profiles for select using (true);

create policy "Providers can insert own profile"
  on public.provider_profiles for insert with check (auth.uid() = user_id);

create policy "Providers can update own profile"
  on public.provider_profiles for update using (auth.uid() = user_id);

create policy "Providers can delete own profile"
  on public.provider_profiles for delete using (auth.uid() = user_id);


-- ---------- provider_services ----------
create policy "Anyone can view active services"
  on public.provider_services for select using (true);

create policy "Providers can manage own services"
  on public.provider_services for all
  using (
    exists (
      select 1 from public.provider_profiles pp
      where pp.id = provider_id and pp.user_id = auth.uid()
    )
  );


-- ---------- provider_availability ----------
create policy "Anyone can view availability"
  on public.provider_availability for select using (true);

create policy "Providers can manage own availability"
  on public.provider_availability for all
  using (
    exists (
      select 1 from public.provider_profiles pp
      where pp.id = provider_id and pp.user_id = auth.uid()
    )
  );


-- ---------- provider_blocked_dates ----------
create policy "Anyone can view blocked dates"
  on public.provider_blocked_dates for select using (true);

create policy "Providers can manage own blocked dates"
  on public.provider_blocked_dates for all
  using (
    exists (
      select 1 from public.provider_profiles pp
      where pp.id = provider_id and pp.user_id = auth.uid()
    )
  );


-- ---------- bookings ----------
create policy "Users can view own bookings"
  on public.bookings for select
  using (
    auth.uid() = user_id
    or exists (
      select 1 from public.provider_profiles pp
      where pp.id = provider_id and pp.user_id = auth.uid()
    )
  );

create policy "Users can create own bookings"
  on public.bookings for insert with check (auth.uid() = user_id);

create policy "Users can update own bookings"
  on public.bookings for update
  using (
    auth.uid() = user_id
    or exists (
      select 1 from public.provider_profiles pp
      where pp.id = provider_id and pp.user_id = auth.uid()
    )
  );

create policy "Users can delete own bookings"
  on public.bookings for delete using (auth.uid() = user_id);


-- ---------- reviews ----------
create policy "Anyone can view reviews"
  on public.reviews for select using (true);

create policy "Users can create own reviews"
  on public.reviews for insert with check (auth.uid() = user_id);

create policy "Users can update own reviews"
  on public.reviews for update using (auth.uid() = user_id);

create policy "Users can delete own reviews"
  on public.reviews for delete using (auth.uid() = user_id);


-- ---------- favorites ----------
create policy "Users can view own favorites"
  on public.favorites for select using (auth.uid() = user_id);

create policy "Users can manage own favorites"
  on public.favorites for all using (auth.uid() = user_id);


-- ---------- notifications ----------
create policy "Users can view own notifications"
  on public.notifications for select using (auth.uid() = user_id);

create policy "Users can update own notifications"
  on public.notifications for update using (auth.uid() = user_id);

create policy "Users can delete own notifications"
  on public.notifications for delete using (auth.uid() = user_id);

create policy "Service role can insert notifications"
  on public.notifications for insert
  with check (true);


-- ---------- push_subscriptions ----------
create policy "Users can manage own push subscriptions"
  on public.push_subscriptions for all using (auth.uid() = user_id);
