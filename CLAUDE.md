# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # Start dev server (localhost:8080)
npm run build        # Production build
npm run build:dev    # Dev-mode build
npm run lint         # ESLint
npm run test         # Run Vitest tests once
npm run test:watch   # Vitest in watch mode
npm run preview      # Preview production build
```

**Required environment variables** (`.env`):
```
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
```

**Supabase Edge Function secrets**: `VAPID_KEYS`, `ALLOWED_ORIGIN`

## Architecture

**Ehjezly** is a mobile-first appointment booking PWA for the Israeli/Arab market. Stack: React 18 + TypeScript + Vite + Supabase + Tailwind CSS + Radix UI (shadcn/ui).

### Routing & Auth (`src/App.tsx`)
All pages are `React.lazy()`-loaded with `<Suspense>` + `<ErrorBoundary>` wrappers. Route guards:
- `<ProtectedRoute>` — requires authenticated session
- `<AdminRoute>` — requires `admin` role

### Role System
Three roles stored in the `user_roles` table and read by `AuthContext`:
- `user` — customer; can book, view bookings, favorites, notifications
- `provider` — only accesses their dashboard; cannot book
- `admin` — only accesses admin panel

### Data Layer (`src/hooks/`)
All async data goes through **TanStack Query v5** hooks. Key hooks:
- `useAllProviders()` — fetches all providers + services, runs slot availability logic
- `useProviderAvailability()` — weekly schedule + blocked dates
- `useProviderBookings()` — paginated booking list for providers
- `usePushSubscription()` — Web Push subscribe/unsubscribe via Edge Function

DB → UI conversion is done with `dbProviderToProvider()` transformer functions inside hooks.

### Supabase (`src/integrations/supabase/`)
- `client.ts` — singleton Supabase client (localStorage persistence)
- `types.ts` — **auto-generated** — do not edit manually; regenerate with `supabase gen types`
- Edge Functions: `send-push`, `booking-reminder`, `create-provider`

Key tables: `profiles`, `user_roles`, `provider_profiles`, `provider_services`, `provider_availability`, `provider_blocked_dates`, `bookings`, `reviews`, `favorites`, `notifications`, `push_subscriptions`

### Database permissions — rules for every new migration
Supabase's default privileges grant new objects in `public` to `anon` and `authenticated` **by name**. `REVOKE ... FROM PUBLIC` does not remove a named grant, so a migration that only revokes from PUBLIC leaves the object open to anyone holding the public anon key.
- **Every new function**: `REVOKE ALL ON FUNCTION ... FROM PUBLIC, anon, authenticated;` — all three, by name — then `GRANT EXECUTE` only to the roles that call it (`authenticated` for a client RPC, `service_role` for an edge function or cron, `anon` only when a logged-out screen calls it). Trigger functions get no grant.
- **Every new table**: `REVOKE ALL ON ... FROM PUBLIC, anon, authenticated;` then grant what is used. No `anon` grant unless a logged-out screen reads the table, and never an `anon` write grant.
- **Every VERIFY** asserts the result with `has_function_privilege` / `has_table_privilege` for `anon`, `authenticated` and `service_role`.
- `SECURITY DEFINER` functions pin `search_path` and check `auth.uid()` / ownership inside: the grant is not the only guard.

### Contexts (`src/contexts/`)
- `AuthContext` — session, user object, role detection; wrap all authenticated UI
- `LangContext` — active language (`he`/`ar`/`en`), RTL/LTR direction, `t()` translation lookup. Hebrew is the default and is RTL.

### Booking Flow (`src/pages/BookAppointment.tsx`)
Three-step wizard:
1. **Service selection** — multi-select with duration & price
2. **Date/time picker** — 14-day horizontal scroll, 15-minute slots
3. **Confirmation** — summary, "pay at venue" note

Slot availability (`useRealAvailability()`): generates 15-min slots, filters overlaps against existing bookings, respects blocked dates and weekly schedule. Group services expose `spotsLeft` / `isFull` computed in the client by `getGroupSlotsWithCapacity()` (inside `useRealAvailability()`) from the busy slots. The `get_slot_capacity()` DB function is NOT called by the app (service_role only since 2026-11-17).

### UI Conventions
- **Styling**: Tailwind + HSL CSS variables for theming; dark mode via `next-themes`
- **Animations**: Framer Motion
- **Forms**: React Hook Form + Zod; all form fields validated at schema level
- **Toasts**: Sonner (`<Toaster>`) — use `toast.success/error` not the custom `use-toast`
- **Icons**: Lucide React exclusively
- All `src/components/ui/` files are shadcn/ui primitives — prefer extending over replacing

### Build
Vite splits output into three manual chunks: `vendor-react`, `vendor-ui`, `vendor-supabase`. PWA via `vite-plugin-pwa` with Workbox autoUpdate strategy.

## Known Issues — Follow-up

- **`getProviderStatus` does not handle past-midnight closing times.** If `provider_availability.end_time` is e.g. `02:00` (next day), the helper compares `nowMins < 120` and reports closed all day. Affects Home status pills and Provider Detail status pill. Fix would need to detect `end_time < start_time` and treat as cross-midnight window.
- **`getProviderStatus` does not handle mid-day breaks.** Schema is one row per `(provider_id, day_of_week)`, so a provider open `09:00–12:00` and `16:00–22:00` cannot be represented; the helper treats whatever single window is stored as contiguous. Schema + helper change required.
- **`get_provider_busy_slots` has no date-range cap.** It is callable while logged out by design and returns only date, time, service ids, staff id and duration (no customer data), but it accepts any provider and any range, so one call can read a provider's whole booking volume. Follow-up: cap the range (the app asks for the booking window only).
- **DEV/PROD parity — `average_rating`.** On PROD `provider_profiles.average_rating` is kept current by `trg_update_provider_rating` (AFTER INSERT OR UPDATE OR DELETE on `reviews`, function `update_provider_average_rating()`), so the old "stale average_rating" ticket is closed there. DEV has neither the function nor the trigger: ratings on DEV go stale. Part of the DEV/PROD parity ticket.
