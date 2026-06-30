import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Provider, Service } from "@/lib/mock-data";
import type { Lang } from "@/lib/translations";
import type { SocialLinks } from "@/lib/socialLinks";
import type { AvailabilityRow } from "@/lib/providerStatus";

export interface DbProvider {
  id: string;
  user_id: string;
  business_name: string;
  category: string;
  address: string;
  about: string | null;
  phone: string | null;
  cover_image: string | null;
  avatar_image: string | null;
  average_rating: number | null;
  min_lead_time_minutes: number;
  booking_window_days?: number;
  social_links: SocialLinks | null;
  requires_booking_approval?: boolean;
  show_prices?: boolean;
  is_visible?: boolean;
  // Customer self-cancel cutoff in hours (added by 20260622000001 migration;
  // typed here so it's available before types.ts is regenerated).
  cancellation_notice_hours?: number;
}

export interface DbService {
  id: string;
  provider_id: string;
  name: string;
  duration: number;
  price: number;
  is_active: boolean;
  sort_order: number;
  service_type: string;
  max_capacity: number;
  scheduled_time: string | null;
  latest_start_time: string | null;
}

export interface SlotCapacity {
  time: string;
  bookedCount: number;
  maxCapacity: number;
  spotsLeft: number;
  isFull: boolean;
}

function dbProviderToProvider(dbp: DbProvider, services: DbService[], reviewCount = 0): Provider {
  const name = { he: dbp.business_name, ar: dbp.business_name, en: dbp.business_name };
  const address = { he: dbp.address, ar: dbp.address, en: dbp.address };
  const about = { he: dbp.about, ar: dbp.about, en: dbp.about };

  return {
    id: dbp.id,
    name,
    category: dbp.category || "barber",
    rating: dbp.average_rating ?? 0,
    reviewCount,
    image: dbp.avatar_image ?? "https://images.unsplash.com/photo-1621605815971-fbc98d665033?w=400&h=400&fit=crop",
    coverImage: dbp.cover_image ?? "",
    address,
    about,
    minLeadTimeMinutes: dbp.min_lead_time_minutes ?? 15,
    bookingWindowDays: dbp.booking_window_days ?? 14,
    socialLinks: dbp.social_links ?? null,
    requiresBookingApproval: dbp.requires_booking_approval ?? false,
    showPrices: dbp.show_prices ?? true,
    cancellationNoticeHours: dbp.cancellation_notice_hours ?? 5,
    phone: dbp.phone ?? null,
    services: services.filter(s => s.is_active).map(s => ({
      id: s.id,
      name: { he: s.name, ar: s.name, en: s.name },
      duration: s.duration,
      price: s.price,
      service_type: (s.service_type as 'private' | 'group') || 'private',
      max_capacity: s.max_capacity ?? 1,
      scheduled_time: s.scheduled_time ?? null,
      latest_start_time: s.latest_start_time ?? null,
    })),
  };
}

export function useAllProviders() {
  const dbQuery = useQuery({
    queryKey: ["all-providers"],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data: profiles, error: pErr } = await supabase
        .from("provider_profiles")
        .select("*")
        .eq("is_visible", true);
      if (pErr) throw pErr;

      const { data: services, error: sErr } = await supabase
        .from("provider_services")
        .select("*")
        .eq("is_active", true)
        .order("sort_order");
      if (sErr) throw sErr;

      // Single anon-readable round-trip: pull every review's provider_id and tally
      // counts in JS (no per-provider N+1). average_rating already gives the score;
      // this fills in the count for "4.8 (98)"-style displays.
      const { data: reviewRows, error: rErr } = await supabase
        .from("reviews")
        .select("provider_id");
      if (rErr) throw rErr;
      const reviewCounts = new Map<string, number>();
      for (const r of reviewRows || []) {
        reviewCounts.set(r.provider_id, (reviewCounts.get(r.provider_id) ?? 0) + 1);
      }

      return (profiles || []).map(p => dbProviderToProvider(
        p as DbProvider,
        (services || []).filter(s => s.provider_id === p.id) as DbService[],
        reviewCounts.get(p.id) ?? 0
      ));
    },
  });

  return {
    providers: dbQuery.data || [],
    isLoading: dbQuery.isLoading,
    error: dbQuery.error,
  };
}

export function useProviderById(id: string | undefined) {
  const { providers, isLoading } = useAllProviders();
  const provider = providers.find(p => p.id === id);
  return { provider, isLoading };
}

/**
 * Fetch a provider's weekly availability rows + blocked dates for public/read-only use
 * (e.g. status pills on the provider detail page). Reuses the same query keys as
 * useRealAvailability so React Query dedupes the network calls when both are mounted.
 */
export function usePublicProviderSchedule(providerId: string | undefined) {
  const availabilityQuery = useQuery({
    queryKey: ["provider-availability-public", providerId],
    queryFn: async () => {
      if (!providerId) return [];
      const { data, error } = await supabase
        .from("provider_availability")
        .select("*")
        .eq("provider_id", providerId)
        .order("day_of_week");
      if (error) throw error;
      return data || [];
    },
    enabled: !!providerId,
  });

  const blockedDatesQuery = useQuery({
    queryKey: ["provider-blocked-dates-public", providerId],
    queryFn: async () => {
      if (!providerId) return [];
      const { data, error } = await supabase
        .from("provider_blocked_dates")
        .select("blocked_date")
        .eq("provider_id", providerId);
      if (error) throw error;
      return (data || []).map(d => d.blocked_date);
    },
    enabled: !!providerId,
  });

  return {
    availability: availabilityQuery.data || [],
    blockedDates: blockedDatesQuery.data || [],
    isLoading: availabilityQuery.isLoading || blockedDatesQuery.isLoading,
  };
}

export interface ProviderSchedule {
  availability: AvailabilityRow[];
  blockedDates: string[];
}

/**
 * Batched schedule fetch for ALL providers — used by the Home page to render
 * open/closed status pills without an N+1 per-provider query. Two round-trips
 * total (availability + future blocked dates), grouped by provider_id in JS.
 */
export function useAllProviderSchedules() {
  const availabilityQuery = useQuery({
    queryKey: ["all-provider-availability"],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("provider_availability")
        .select("provider_id, day_of_week, start_time, end_time, is_available");
      if (error) throw error;
      return data || [];
    },
  });

  const blockedDatesQuery = useQuery({
    queryKey: ["all-provider-blocked-dates"],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const today = new Date().toISOString().slice(0, 10);
      const { data, error } = await supabase
        .from("provider_blocked_dates")
        .select("provider_id, blocked_date")
        .gte("blocked_date", today);
      if (error) throw error;
      return data || [];
    },
  });

  const schedulesByProviderId = useMemo(() => {
    const map = new Map<string, ProviderSchedule>();
    const ensure = (id: string): ProviderSchedule => {
      let entry = map.get(id);
      if (!entry) {
        entry = { availability: [], blockedDates: [] };
        map.set(id, entry);
      }
      return entry;
    };

    for (const row of availabilityQuery.data || []) {
      ensure(row.provider_id).availability.push({
        day_of_week: row.day_of_week,
        start_time: row.start_time,
        end_time: row.end_time,
        is_available: row.is_available,
      });
    }
    for (const row of blockedDatesQuery.data || []) {
      ensure(row.provider_id).blockedDates.push(row.blocked_date);
    }
    return map;
  }, [availabilityQuery.data, blockedDatesQuery.data]);

  return {
    schedulesByProviderId,
    isLoading: availabilityQuery.isLoading || blockedDatesQuery.isLoading,
  };
}

/** Fetch real availability for a provider */
// The availability window the client fetches busy slots for. Must be >= the
// booking date strip shown in the UI (currently 14 days in both BookAppointment
// and NewBookingSheet) so every bookable day's conflicts are covered.
const AVAILABILITY_WINDOW_DAYS = 60;

export function useRealAvailability(providerId: string | undefined) {
  // Local date window [today, today + AVAILABILITY_WINDOW_DAYS]. Use LOCAL date
  // strings (toLocalDateStr, NOT toISOString) so the window matches how
  // booking_date is stored/compared and the queryKey stays stable within a day.
  const windowEnd = new Date();
  windowEnd.setDate(windowEnd.getDate() + AVAILABILITY_WINDOW_DAYS);
  const fromStr = toLocalDateStr(new Date());
  const toStr = toLocalDateStr(windowEnd);

  const availabilityQuery = useQuery({
    queryKey: ["provider-availability-public", providerId],
    queryFn: async () => {
      if (!providerId) return [];
      const { data, error } = await supabase
        .from("provider_availability")
        .select("*")
        .eq("provider_id", providerId)
        .order("day_of_week");
      if (error) throw error;
      return data || [];
    },
    enabled: !!providerId,
  });

  const blockedDatesQuery = useQuery({
    queryKey: ["provider-blocked-dates-public", providerId],
    queryFn: async () => {
      if (!providerId) return [];
      const { data, error } = await supabase
        .from("provider_blocked_dates")
        .select("blocked_date")
        .eq("provider_id", providerId);
      if (error) throw error;
      return (data || []).map(d => d.blocked_date);
    },
    enabled: !!providerId,
  });

  const bookingsQuery = useQuery({
    queryKey: ["provider-bookings-public", providerId, fromStr, toStr],
    queryFn: async () => {
      if (!providerId) return [];
      // RPC (SECURITY DEFINER) instead of a direct select: RLS hides other
      // customers' and walk-in (user_id NULL) bookings from a customer, so a
      // direct select returned an incomplete set and offered taken slots. The
      // RPC returns only non-PII timing columns (booking_date, booking_time,
      // service_ids) for the provider's active bookings in the window.
      const { data, error } = await supabase.rpc("get_provider_busy_slots", {
        p_provider_id: providerId,
        p_from_date: fromStr,
        p_to_date: toStr,
      });
      if (error) throw error;
      return data || [];
    },
    enabled: !!providerId,
  });

  const servicesQuery = useQuery({
    queryKey: ["provider-services-public", providerId],
    queryFn: async () => {
      if (!providerId) return [];
      const { data, error } = await supabase
        .from("provider_services")
        .select("id, duration, service_type, max_capacity, latest_start_time, is_parallel")
        .eq("provider_id", providerId);
      if (error) throw error;
      return data || [];
    },
    enabled: !!providerId,
  });

  // Per-provider DISPLAY granularity for the slot grid. provider_profiles is
  // anon-readable (same channel useAllProviders uses), so this works for the
  // customer booking view AND the provider walk-in sheet. Display-only: it sets
  // the spacing of candidate start-times, never any booking/overlap logic.
  const slotIntervalQuery = useQuery({
    queryKey: ["provider-slot-interval", providerId],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      if (!providerId) return null;
      const { data, error } = await supabase
        .from("provider_profiles")
        // Cast: column added by 20260630000001 migration; types.ts regenerated
        // after apply (matches cancellation_notice_hours / booking_window_days).
        .select("slot_interval_minutes")
        .eq("id", providerId)
        .maybeSingle();
      if (error) throw error;
      return data as { slot_interval_minutes?: number } | null;
    },
    enabled: !!providerId,
  });

  // Defensive fallback to 15 when the column/value is missing (matches the
  // migration default → zero change for providers who never set it).
  const slotStep = slotIntervalQuery.data?.slot_interval_minutes || 15;

  /**
   * Returns available time slots for private services.
   *
   * Capacity model — "same-service pool, cross-service exclusive" — applied
   * identically here and in the prevent_booking_conflicts trigger's private
   * branch. For an incoming booking of service `primaryServiceId` with capacity
   * `capacity` over a candidate interval, among the bookings that overlap it:
   *   CLAUSE 1 (cross-service = exclusive): if ANY overlap is for a DIFFERENT
   *     primary service, hide the slot (provider is otherwise occupied).
   *   CLAUSE 2 (same-service pool): if same-service overlaps >= capacity, hide.
   *   else show.
   * `primaryServiceId` is the incoming service id; each existing booking's
   * primary service is service_ids[0] (= the trigger's service_ids[1]).
   *
   * With capacity 1 this reduces to "any overlap blocks" — a different-service
   * overlap trips clause 1, a same-service overlap trips clause 2 (count >= 1) —
   * exactly the pre-capacity behavior, so normal services are unaffected.
   *
   * The overlap test (t < bi.end && bi.start < t + neededDuration) is the same
   * half-open interval intersection the trigger uses
   * (new_start < b.end && b.start < new_start + new_duration), so the client
   * never offers a slot the trigger would reject, nor hides one it would allow.
   */
  const getAvailableSlots = (date: Date, requestedDuration?: number, capacity = 1, primaryServiceId?: string, latestStartTime?: string | null): string[] => {
    if (!providerId) return [];

    const dow = date.getDay();
    const dateStr = toLocalDateStr(date);

    if ((blockedDatesQuery.data || []).includes(dateStr)) return [];

    // provider_availability is the single source of truth: every provider has a
    // row per day. No row, or is_available=false → the day is closed.
    const slot = (availabilityQuery.data || []).find(a => a.day_of_week === dow);
    if (!slot || !slot.is_available) return [];

    const services = servicesQuery.data || [];

    // Build list of booked intervals [start, end) in minutes, keeping each
    // booking's primary service id (service_ids[0], = the trigger's
    // service_ids[1]) so the same-service / cross-service rule can be applied.
    const bookedIntervals: { start: number; end: number; serviceId: string | undefined }[] = [];
    (bookingsQuery.data || [])
      .filter(b => b.booking_date === dateStr)
      .forEach(b => {
        const bookingStart = parseTime(b.booking_time);
        const totalDuration = (b.service_ids || []).reduce((sum: number, sid: string) => {
          const svc = services.find(s => s.id === sid);
          return sum + (svc?.duration || 30);
        }, 0);
        bookedIntervals.push({
          start: bookingStart,
          end: bookingStart + totalDuration,
          serviceId: (b.service_ids || [])[0],
        });
      });

    // SLOT_STEP = display granularity (provider's slot_interval_minutes). It only
    // controls the SPACING of offered start-times; it is decoupled from
    // neededDuration (which keeps its own 15-min fallback) so changing the
    // interval never changes how long a booking is or the overlap math below.
    const SLOT_STEP = slotStep;
    const start = parseTime(slot.start_time);
    const end = parseTime(slot.end_time);
    const neededDuration = requestedDuration || 15;

    const breakStart = slot.break_start ? parseTime(slot.break_start) : null;
    const breakEnd = slot.break_end ? parseTime(slot.break_end) : null;

    const slotCapacity = capacity > 0 ? capacity : 1;
    // PARALLEL EXCEPTION (mirrors prevent_booking_conflicts Clause 1): a
    // cross-service overlap is NOT a conflict when BOTH the incoming primary
    // service and the existing booking's primary service have is_parallel=true.
    // Missing service / flag → treated non-parallel (still blocks), matching the
    // trigger's COALESCE(..., false) fail-safe. This only relaxes the
    // cross-service mirror; same-service capacity (Clause 2) and group logic are
    // untouched, so a parallel service never bypasses its own capacity.
    const isParallel = (sid: string | undefined): boolean =>
      !!services.find(s => s.id === sid)?.is_parallel;
    const newIsParallel = isParallel(primaryServiceId);
    const latestStartMins = latestStartTime ? parseTime(latestStartTime) : null;
    const slots: string[] = [];
    for (let t = start; t + neededDuration <= end; t += SLOT_STEP) {
      if (latestStartMins !== null && t > latestStartMins) continue;
      const overlapping = bookedIntervals.filter(
        bi => t < bi.end && bi.start < t + neededDuration
      );
      // CLAUSE 1 (cross-service exclusive): an overlap for a DIFFERENT primary
      // service blocks the slot — UNLESS both services are parallel (exception
      // above). CLAUSE 2 (same-service pool): same-service overlaps may share up
      // to slotCapacity. Mirrors the trigger's clauses exactly; with capacity 1
      // and no parallel flag this is "any overlap blocks".
      const hasDifferentService = overlapping.some(
        bi => bi.serviceId !== primaryServiceId
          && !(newIsParallel && isParallel(bi.serviceId))
      );
      const sameServiceCount = overlapping.filter(bi => bi.serviceId === primaryServiceId).length;
      const inBreak = breakStart !== null && breakEnd !== null
        && t >= breakStart && t < breakEnd;
      if (!hasDifferentService && sameServiceCount < slotCapacity && !inBreak) {
        const h = Math.floor(t / 60);
        const m = t % 60;
        slots.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
      }
    }
    return slots;
  };

  /** Returns ALL time slots with capacity info for group services */
  const getGroupSlotsWithCapacity = (date: Date, maxCapacity: number): SlotCapacity[] => {
    if (!providerId) return [];

    const dow = date.getDay();
    const dateStr = toLocalDateStr(date);

    if ((blockedDatesQuery.data || []).includes(dateStr)) return [];

    // Single source of truth: no row, or is_available=false → the day is closed.
    const slot = (availabilityQuery.data || []).find(a => a.day_of_week === dow);
    if (!slot || !slot.is_available) return [];

    // Same display granularity as private slots (provider's slot_interval_minutes,
    // 15 fallback). The `+ 30` minimum-window check below is unchanged.
    const SLOT_STEP = slotStep;
    const start = parseTime(slot.start_time);
    const end = parseTime(slot.end_time);

    const breakStart = slot.break_start ? parseTime(slot.break_start) : null;
    const breakEnd = slot.break_end ? parseTime(slot.break_end) : null;

    const bookingsForDate = (bookingsQuery.data || []).filter(b => b.booking_date === dateStr);

    const result: SlotCapacity[] = [];
    for (let t = start; t + 30 <= end; t += SLOT_STEP) {
      const inBreak = breakStart !== null && breakEnd !== null
        && t >= breakStart && t < breakEnd;
      if (inBreak) continue;
      const h = Math.floor(t / 60);
      const m = t % 60;
      const time = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
      const bookedCount = bookingsForDate.filter(b => b.booking_time === time).length;
      const spotsLeft = Math.max(0, maxCapacity - bookedCount);
      result.push({ time, bookedCount, maxCapacity, spotsLeft, isFull: bookedCount >= maxCapacity });
    }
    return result;
  };

  return { getAvailableSlots, getGroupSlotsWithCapacity, isLoading: availabilityQuery.isLoading };
}

function parseTime(timeStr: string): number {
  const [h, m] = timeStr.split(":").map(Number);
  return h * 60 + (m || 0);
}

// Local calendar date as "YYYY-MM-DD". Must stay consistent with date.getDay()
// (also local) and with how booking_date is written everywhere (local
// format(date, "yyyy-MM-dd")). Using toISOString() here would yield the UTC
// date, which rolls back a day for local-midnight inputs in Israel's timezone.
function toLocalDateStr(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
