
-- Create role enum
CREATE TYPE public.app_role AS ENUM ('admin', 'provider', 'user');

-- Create user_roles table
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role app_role NOT NULL,
  UNIQUE (user_id, role)
);

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Security definer function to check roles
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

-- RLS: users can read their own roles
CREATE POLICY "Users can view their own roles"
  ON public.user_roles FOR SELECT
  USING (auth.uid() = user_id);

-- Provider profiles table
CREATE TABLE public.provider_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  business_name TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'barber',
  address TEXT DEFAULT '',
  about TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  cover_image TEXT DEFAULT '',
  avatar_image TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.provider_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Providers can view their own profile"
  ON public.provider_profiles FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Providers can insert their own profile"
  ON public.provider_profiles FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Providers can update their own profile"
  ON public.provider_profiles FOR UPDATE
  USING (auth.uid() = user_id);

-- Public read for customers to see provider info
CREATE POLICY "Anyone can view provider profiles"
  ON public.provider_profiles FOR SELECT
  USING (true);

CREATE TRIGGER update_provider_profiles_updated_at
  BEFORE UPDATE ON public.provider_profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Provider services table
CREATE TABLE public.provider_services (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id UUID REFERENCES public.provider_profiles(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  duration INTEGER NOT NULL DEFAULT 30,
  price INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.provider_services ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Providers can manage their own services"
  ON public.provider_services FOR ALL
  USING (
    provider_id IN (SELECT id FROM public.provider_profiles WHERE user_id = auth.uid())
  );

CREATE POLICY "Anyone can view active services"
  ON public.provider_services FOR SELECT
  USING (is_active = true);

CREATE TRIGGER update_provider_services_updated_at
  BEFORE UPDATE ON public.provider_services
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Provider availability (weekly schedule)
CREATE TABLE public.provider_availability (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id UUID REFERENCES public.provider_profiles(id) ON DELETE CASCADE NOT NULL,
  day_of_week INTEGER NOT NULL CHECK (day_of_week >= 0 AND day_of_week <= 6),
  start_time TIME NOT NULL DEFAULT '09:00',
  end_time TIME NOT NULL DEFAULT '17:00',
  is_available BOOLEAN NOT NULL DEFAULT true,
  UNIQUE (provider_id, day_of_week)
);

ALTER TABLE public.provider_availability ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Providers can manage their availability"
  ON public.provider_availability FOR ALL
  USING (
    provider_id IN (SELECT id FROM public.provider_profiles WHERE user_id = auth.uid())
  );

CREATE POLICY "Anyone can view availability"
  ON public.provider_availability FOR SELECT
  USING (true);

-- Blocked dates (days off, vacations)
CREATE TABLE public.provider_blocked_dates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id UUID REFERENCES public.provider_profiles(id) ON DELETE CASCADE NOT NULL,
  blocked_date DATE NOT NULL,
  reason TEXT DEFAULT '',
  UNIQUE (provider_id, blocked_date)
);

ALTER TABLE public.provider_blocked_dates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Providers can manage their blocked dates"
  ON public.provider_blocked_dates FOR ALL
  USING (
    provider_id IN (SELECT id FROM public.provider_profiles WHERE user_id = auth.uid())
  );

CREATE POLICY "Anyone can view blocked dates"
  ON public.provider_blocked_dates FOR SELECT
  USING (true);

-- Also allow providers to see bookings made at their business
CREATE POLICY "Providers can view bookings for their business"
  ON public.bookings FOR SELECT
  USING (
    provider_id IN (
      SELECT id::text FROM public.provider_profiles WHERE user_id = auth.uid()
    )
  );
