import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

// Typed wrappers around the Phase 1 admin RPCs (SECURITY DEFINER, admin-gated,
// price-free). Each RPC raises 42501 for non-admins — TanStack surfaces that as
// the query's `error`, which the UI renders as a graceful per-section fallback
// (never a broken page). Mirrors the app's existing useQuery hook style.

type Fns = Database["public"]["Functions"];
export type AdminCounts = Fns["admin_dashboard_counts"]["Returns"][number];
export type AdminBookingRow = Fns["admin_recent_bookings"]["Returns"][number];
export type AdminProviderCount = Fns["admin_provider_booking_counts"]["Returns"][number];
export type AdminTrendPoint = Fns["admin_bookings_over_time"]["Returns"][number];

// KPI bundle — single-row RPC; we unwrap to the row (or null while loading/error).
export function useAdminCounts() {
  return useQuery({
    queryKey: ["admin-dashboard-counts"],
    queryFn: async (): Promise<AdminCounts | null> => {
      const { data, error } = await supabase.rpc("admin_dashboard_counts");
      if (error) throw error;
      return data?.[0] ?? null;
    },
    staleTime: 60_000,
  });
}

export function useAdminPendingBookings() {
  return useQuery({
    queryKey: ["admin-pending-bookings"],
    queryFn: async (): Promise<AdminBookingRow[]> => {
      const { data, error } = await supabase.rpc("admin_pending_bookings");
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 30_000,
  });
}

export function useAdminTodayBookings() {
  return useQuery({
    queryKey: ["admin-today-bookings"],
    queryFn: async (): Promise<AdminBookingRow[]> => {
      const { data, error } = await supabase.rpc("admin_today_bookings");
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 30_000,
  });
}

export function useAdminRecentBookings(limit = 20) {
  return useQuery({
    queryKey: ["admin-recent-bookings", limit],
    queryFn: async (): Promise<AdminBookingRow[]> => {
      const { data, error } = await supabase.rpc("admin_recent_bookings", { p_limit: limit });
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 30_000,
  });
}

export function useAdminProviderCounts() {
  return useQuery({
    queryKey: ["admin-provider-counts"],
    queryFn: async (): Promise<AdminProviderCount[]> => {
      const { data, error } = await supabase.rpc("admin_provider_booking_counts");
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 60_000,
  });
}

// Bookings-over-time series. Defaults to the last 30 days (inclusive of today),
// computed in local time on the client — the RPC itself buckets by booking_date.
export function useAdminBookingsOverTime(days = 30) {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - (days - 1));
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const p_from = fmt(from);
  const p_to = fmt(to);
  return useQuery({
    queryKey: ["admin-bookings-over-time", p_from, p_to],
    queryFn: async (): Promise<AdminTrendPoint[]> => {
      const { data, error } = await supabase.rpc("admin_bookings_over_time", { p_from, p_to });
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 60_000,
  });
}

export interface AdminReview {
  id: string;
  rating: number;
  comment: string | null;
  display_name: string | null;
  created_at: string;
  business_name: string | null;
}

// Reviews read straight from the reviews table (already admin-readable),
// enriched with the provider business name. `maxRating` optionally limits to
// low ratings (the dashboard shows only the <=2 strip).
async function fetchReviews(limit: number, maxRating?: number): Promise<AdminReview[]> {
  let query = supabase
    .from("reviews")
    .select("id, rating, comment, display_name, created_at, provider_id")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (maxRating !== undefined) query = query.lte("rating", maxRating);

  const { data: reviews, error } = await query;
  if (error) throw error;
  if (!reviews?.length) return [];

  const providerIds = [...new Set(reviews.map((r) => r.provider_id))];
  const { data: providers } = await supabase
    .from("provider_profiles")
    .select("id, business_name")
    .in("id", providerIds);
  const nameMap = new Map((providers || []).map((p) => [p.id, p.business_name]));

  return reviews.map((r) => ({
    id: r.id,
    rating: r.rating,
    comment: r.comment,
    display_name: r.display_name,
    created_at: r.created_at,
    business_name: nameMap.get(r.provider_id) ?? null,
  }));
}

export function useAdminRecentReviews(limit = 8) {
  return useQuery({
    queryKey: ["admin-recent-reviews", limit],
    queryFn: () => fetchReviews(limit),
    staleTime: 60_000,
  });
}

// Recent low ratings (<=2 stars) only — the dashboard's reduced attention strip.
export function useAdminLowRatings(limit = 5) {
  return useQuery({
    queryKey: ["admin-low-ratings", limit],
    queryFn: () => fetchReviews(limit, 2),
    staleTime: 60_000,
  });
}

interface LastLoginRow {
  user_id: string;
  last_sign_in_at: string | null;
}

// Provider last-login times via the admin_provider_last_logins() RPC (auth.users
// is not client-readable). One fetch for all providers → a user_id → timestamp
// map. The RPC is not in the generated types until its migration is applied +
// types regenerated, so it is called through a narrow cast (kept off `any`).
export function useAdminLastLogins() {
  return useQuery({
    queryKey: ["admin-provider-last-logins"],
    queryFn: async (): Promise<Map<string, string | null>> => {
      // Cast the CLIENT (not the method) so the call stays a bound member
      // expression — extracting supabase.rpc into a variable would lose `this`
      // and throw before any request is sent. The RPC isn't in the generated
      // types until its migration is applied, hence the narrow cast.
      const client = supabase as unknown as {
        rpc: (fn: string) => Promise<{ data: LastLoginRow[] | null; error: unknown }>;
      };
      const { data, error } = await client.rpc("admin_provider_last_logins");
      if (error) throw error;
      const map = new Map<string, string | null>();
      for (const r of data ?? []) map.set(r.user_id, r.last_sign_in_at);
      return map;
    },
    staleTime: 60_000,
  });
}
