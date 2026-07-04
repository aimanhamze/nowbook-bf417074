# Ehjezly — Project Summary for AI Context

## What Is This App?

**Ehjezly** is a mobile-first appointment booking PWA (Progressive Web App) built for the Israeli/Arab market. It connects customers with service providers (barbers, salons, doctors, gyms, etc.) for booking appointments. Think of it as a local "booking.com" for personal services.

- **Primary language**: Hebrew (RTL), with full Arabic and English support
- **Currency**: Israeli Shekel (₪)
- **Stack**: React 18 + TypeScript + Vite + Supabase + Tailwind CSS + Radix UI + Framer Motion + TanStack Query

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, TypeScript, Vite |
| Routing | React Router v6 (all lazy-loaded) |
| State/Data | TanStack Query (React Query v5) |
| Backend / DB | Supabase (PostgreSQL + Auth + Edge Functions + Storage) |
| UI Components | Radix UI primitives + shadcn/ui pattern |
| Styling | Tailwind CSS |
| Animation | Framer Motion |
| Forms/Validation | React Hook Form + Zod |
| Push Notifications | Web Push API via Supabase Edge Functions |
| PWA | vite-plugin-pwa |

---

## User Roles

The app has 3 roles stored in the `user_roles` table with enum `app_role: "admin" | "provider" | "user"`:

| Role | Access | Redirect on Login |
|---|---|---|
| `user` (customer) | Home, Explore, Book, Bookings, Favorites, Profile, Notifications | `/` (Home) |
| `provider` | Provider Dashboard only — cannot book | `/dashboard` |
| `admin` | Admin panel | `/admin` |

Role detection happens in `AuthContext` by querying `user_roles` table. Providers cannot book appointments (enforced in `BookAppointment.tsx`).

---

## Authentication

**File**: `src/pages/Auth.tsx`, `src/contexts/AuthContext.tsx`

- **Email + Password** sign-in via Supabase Auth
- **Google OAuth** via `lovable.auth.signInWithOAuth`
- **Forgot Password**: sends reset email → redirects to `/reset-password`
- **Dev Login Easter Egg**: tap the logo 5 times to reveal a dev login panel (uses `VITE_DEV_TEST_EMAIL` env var)
- Session is maintained via Supabase's `onAuthStateChange` listener

---

## Pages & Routes

| Path | Page | Auth Required | Description |
|---|---|---|---|
| `/` | Index | No | Home — shows categories + provider listings split into Beauty and Health sections |
| `/explore` | Explore | No | Search/filter all providers by category, name |
| `/provider/:id` | ProviderDetail | No | Provider profile with services, reviews, ratings |
| `/provider/:id/book` | BookAppointment | Yes (user) | 3-step booking wizard |
| `/booking-confirmed` | BookingConfirmed | Yes | Success screen after booking |
| `/bookings` | Bookings | Yes | User's booking history with cancel + review actions |
| `/favorites` | Favorites | Yes | Saved providers |
| `/profile` | Profile | Yes | User profile settings + language + sign out |
| `/notifications` | Notifications | Yes | In-app notification center with read/unread state |
| `/dashboard` | Dashboard | Yes (provider) | Provider management dashboard |
| `/admin` | Admin | Yes (admin) | Admin panel |
| `/auth` | Auth | No | Sign in / Google OAuth |
| `/reset-password` | ResetPassword | No | Password reset after email link |
| `/install` | Install | No | PWA install guide |

---

## Home Page (`/`)

- Shows greeting ("Good morning ☀️")
- **Category rows**: scrollable horizontal chips (Beauty & Cosmetics, Health & Medical)
- **Provider cards** split into two sections: Beauty providers and Health providers
- If the logged-in user is a provider → redirects to `/dashboard`
- If admin → redirects to `/admin`

---

## Explore Page (`/explore`)

- Full-text search bar (filters by provider name/category)
- Category filter chips
- Can deep-link with `?group=beauty` or `?group=health` to pre-filter
- Shows count of results: "X providers found"
- "Clear filters" button

---

## Provider Detail Page (`/provider/:id`)

- Cover image (with fallback to avatar, then gradient with initials)
- Name, average rating (from `reviews` table), review count
- Address with map pin icon
- **About** section
- **Services list**: each service shows name, duration (minutes), price (₪)
  - Group services show a blue "Group Class" badge + max capacity
- **Reviews list**: pulled from `reviews` table
- **Sticky "Book Appointment" button** at bottom
- Heart/Favorite toggle (requires login)
- Share button (UI only)

---

## Booking Flow (`/provider/:id/book`) — 3 Steps

**Step 1 — Select Services**
- Multi-select list of the provider's active services
- Each service card shows name, duration, price
- Group services show a "Group Class" badge and max capacity
- Can select multiple private services (durations add up)

**Step 2 — Pick Date & Time**
- Horizontal date picker: next 14 days
- Time slots generated from provider's availability schedule (15-min steps)
- **Private services**: slots are filtered to only show times where the full requested duration fits without overlap with existing bookings
- **Group services**: shows all slots with capacity info — "X spots left", "Last spot!", "Full" (red, disabled)
- Past times for today are hidden

**Step 3 — Confirm**
- Summary card: provider name, date/time, services + durations, total price
- "Payment will be collected at the venue" note
- "Confirm Booking" button

**On Confirm**:
1. Inserts row into `bookings` table (status: "confirmed")
2. Inserts in-app notification for the customer
3. Calls `send-push` Edge Function to push-notify the provider
4. Navigates to `/booking-confirmed` with booking details in state

---

## Bookings Page (`/bookings`)

- Lists all user bookings ordered by date desc (20 per page, paginated)
- Status badges: Confirmed (green), Cancelled (red), Pending (gray)
- **Cancel button**: shown for future confirmed/pending bookings → sets status to "cancelled", creates cancellation notification, push-notifies provider
- **Leave Review button**: shown for past confirmed bookings that have no existing review
- Review form appears inline (star rating + text comment)

---

## Provider Dashboard (`/dashboard`)

Four tabs:

### 1. Services Tab
- Add, edit, delete services
- Each service: name (stored as single string, displayed in all 3 languages), duration, price, service type (private/group), max capacity
- Saves to `provider_services` table

### 2. Calendar Tab
- Shows upcoming bookings for the provider from `bookings` table
- Displays customer name (resolved via `get_display_name` DB function), date, time, services, total price

### 3. Business Profile Tab
- Edit: business name, category (dropdown), address, about text, phone
- Upload avatar image (stored in Supabase Storage)
- Upload cover image (stored in Supabase Storage)
- Saves to `provider_profiles` table

### 4. Availability Tab
- Per-day-of-week toggle (open/closed) + start time + end time
- "Block a Date" calendar picker with optional reason
- Blocked dates list with unblock button
- Data stored in `provider_availability` and `provider_blocked_dates` tables

**Push notification toggle**: Bell icon in header — providers can subscribe/unsubscribe from Web Push notifications. Subscription data stored in `push_subscriptions` table.

---

## Admin Panel (`/admin`)

Three tabs:

### Stats
- Users count, Providers count, Total bookings, Confirmed bookings, Reviews, Notifications
- Total Revenue (sum of confirmed bookings' `total_price`)
- Cancelled bookings count

### Providers
- List all providers with edit/delete
- Create new provider (creates Supabase Auth user + `user_roles` entry + `provider_profiles` entry)
- Edit provider details

### Users
- List all user profiles

---

## Notifications System

**In-app notifications** stored in `notifications` table:
- Fields: `title`, `body`, `url`, `type`, `is_read`, `user_id`, `created_at`
- Types: `booking_new`, `booking_cancelled`, `booking_confirmed`, `reminder`, `general`
- Unread count shown as badge in BottomNav (bell icon)
- Mark individual or all as read
- Clicking navigates to the notification's `url`

**Web Push notifications** via `push_subscriptions` table + `send-push` Edge Function:
- Providers can subscribe to receive push notifications when a customer books or cancels
- Customers receive push confirmation of bookings (if subscribed)

**Edge Functions** (in `supabase/functions/`):
- `send-push`: sends Web Push to a provider's subscriptions
- `notify-user`: sends notification to a specific user
- `booking-reminder`: scheduled reminders (cron)
- `create-provider`: creates provider account from admin panel

---

## Availability & Slot Logic

**File**: `src/hooks/useAllProviders.ts` — `useRealAvailability()`

### For Private Services:
1. Check if the date is in `provider_blocked_dates` → return [] if blocked
2. Find the day-of-week row in `provider_availability`
3. Generate 15-minute slots from start_time to end_time
4. For each slot, check if the requested duration overlaps any existing booking interval
5. Return only non-overlapping slots

### For Group Services:
1. Same blocked-date check
2. Generate all 15-min slots
3. For each slot, count how many existing bookings are at that exact time
4. Return slots with: `bookedCount`, `maxCapacity`, `spotsLeft`, `isFull`
5. UI shows capacity status; full slots are disabled

---

## Data Models (Supabase Tables)

| Table | Purpose |
|---|---|
| `profiles` | User profile: display_name, avatar_url, phone, preferred_lang |
| `user_roles` | Maps user_id → role (admin/provider/user) |
| `provider_profiles` | Provider business info: name, category, address, about, images |
| `provider_services` | Services offered: name, duration, price, type, max_capacity |
| `provider_availability` | Weekly schedule per day_of_week: start_time, end_time, is_available |
| `provider_blocked_dates` | Specific dates blocked by the provider |
| `bookings` | Appointment records: user_id, provider_id, service_ids[], date, time, price, status |
| `reviews` | Post-appointment reviews: rating (1-5), comment, booking_id (unique) |
| `favorites` | User–provider favorite relationships |
| `notifications` | In-app notification records |
| `push_subscriptions` | Web Push subscription endpoints |

**DB Functions**:
- `get_display_name(user_id)` — returns user's display name
- `has_role(role, user_id)` — role check
- `booking_time_to_minutes(time)` — converts HH:MM to minutes
- `get_slot_capacity(provider_id, date, time, service_id)` — returns capacity info for a group slot

---

## Multilingual Support

**File**: `src/lib/translations.ts`, `src/contexts/LangContext.tsx`

- Supports: Hebrew (`he`), Arabic (`ar`), English (`en`)
- Hebrew is default and primary
- All UI strings go through `t("key")` hook
- RTL/LTR handled via `isRtl` from `LangContext`
- Provider names/addresses/about text are stored as plain strings (same value shown in all languages — not separately translated)
- Service names stored as single string in DB, displayed same across languages
- Date formatting uses `date-fns` with per-language locales (`he`, `ar`, `enUS`)

---

## Categories

**Beauty & Cosmetics**: barber ✂️, salon 💇, nails 💅, brows 👁️, spa 🧖, skincare ✨, makeup 💄

**Health & Medical**: orthopedic 🦴, dentist 🦷, eye_doctor 👁️‍🗨️, dermatologist 🩺, physiotherapy 💪, pediatrician 👶

**Fitness**: gym 🏋️, fitness_studio 🤸

---

## Navigation (Bottom Nav)

5 tabs for customers:
1. **Home** (`/`) — house icon
2. **Explore** (`/explore`) — search icon
3. **Bookings** (`/bookings`) — calendar icon
4. **Favorites** (`/favorites`) — heart icon
5. **Profile** (`/profile`) — user icon + bell for notifications

Unread notification badge shown on bell icon.
BottomNav is hidden on: `/auth`, `/dashboard`, `/admin`, `/provider/:id/book`, `/booking-confirmed`, `/reset-password`, `/install`.

---

## Key Files Map

```
src/
├── App.tsx                          # Router + providers setup
├── contexts/
│   ├── AuthContext.tsx              # Auth state, isProvider, isAdmin, signOut
│   └── LangContext.tsx              # Language switching, t(), isRtl
├── hooks/
│   ├── useAllProviders.ts           # Fetch all providers + slot availability logic
│   ├── useProviderProfile.ts        # Provider's own profile (for dashboard)
│   ├── useProviderServices.ts       # CRUD for provider services
│   ├── useProviderAvailability.ts   # Weekly schedule + blocked dates CRUD
│   ├── useProviderBookings.ts       # Provider's booking list (for calendar tab)
│   ├── useReviews.ts                # Reviews fetch + submit
│   ├── useFavorites.ts              # Toggle/check favorites
│   ├── usePushSubscription.ts       # Web Push subscribe/unsubscribe
│   └── useAllProviders.ts           # Also exports useRealAvailability()
├── lib/
│   ├── mock-data.ts                 # Type definitions + category arrays
│   └── translations.ts              # All UI strings in he/ar/en
├── pages/
│   ├── Index.tsx                    # Home (customer)
│   ├── Explore.tsx                  # Provider search/filter
│   ├── ProviderDetail.tsx           # Provider profile page
│   ├── BookAppointment.tsx          # 3-step booking wizard
│   ├── BookingConfirmed.tsx         # Success screen
│   ├── Bookings.tsx                 # Customer booking history
│   ├── Favorites.tsx                # Saved providers
│   ├── Profile.tsx                  # User profile settings
│   ├── Notifications.tsx            # Notification center
│   ├── Dashboard.tsx                # Provider dashboard shell
│   ├── Admin.tsx                    # Admin panel shell
│   ├── Auth.tsx                     # Login/OAuth
│   └── ResetPassword.tsx            # Password reset
├── components/
│   ├── layout/BottomNav.tsx         # Global bottom navigation
│   ├── dashboard/
│   │   ├── ServicesTab.tsx          # Add/edit/delete services
│   │   ├── CalendarTab.tsx          # Provider's booking list
│   │   ├── BusinessProfileTab.tsx   # Profile edit + image upload
│   │   └── AvailabilityTab.tsx      # Weekly schedule + block dates
│   ├── admin/
│   │   ├── AdminStats.tsx           # Platform statistics
│   │   ├── AdminProviders.tsx       # Provider management list
│   │   ├── AdminUsers.tsx           # User list
│   │   ├── CreateProviderDialog.tsx # Create provider form
│   │   └── EditProviderDialog.tsx   # Edit provider form
│   ├── home/
│   │   ├── ProviderCard.tsx         # Provider card in listing
│   │   ├── CategoryRow.tsx          # Horizontal category chips
│   │   └── SearchBar.tsx            # Search input
│   └── reviews/
│       ├── ReviewCard.tsx           # Display a review
│       └── ReviewForm.tsx           # Star rating + comment form
└── integrations/supabase/
    ├── client.ts                    # Supabase client init
    └── types.ts                     # Auto-generated DB types
```

---

## Environment Variables

```
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
VITE_DEV_TEST_EMAIL=        # Pre-fills dev login email (optional)
VITE_DEV_TEST_PASSWORD=     # Not used in code, for reference only
```

---

## Business Logic Rules

1. **Providers cannot book appointments** — enforced at UI level in `BookAppointment.tsx`
2. **Admins cannot book** — redirected to `/admin` from home
3. **One review per booking** — enforced by unique constraint on `reviews.booking_id`
4. **Cancellation**: only future bookings can be cancelled; cancellation notifies both customer and provider
5. **Slot generation**: 15-minute intervals; slot only shown if provider is open that day, date not blocked, and duration fits without overlap
6. **Group class slots**: all slots shown regardless of bookings, but full slots are disabled; capacity tracked in real-time
7. **Payment**: always "pay at venue" — no payment processing in the app
8. **Provider profile setup**: must be done by admin — providers cannot self-register; they see "contact admin" if no profile exists