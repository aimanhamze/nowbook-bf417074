import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Provider, Service } from "@/lib/mock-data";
import type { Lang } from "@/lib/translations";

export interface DbProvider {
  id: string;
  user_id: string;
  business_name: string;
  category: string;
  address: string;
  about: string;
  phone: string;
  cover_image: string;
  avatar_image: string;
}

export interface DbService {
  id: string;
  provider_id: string;
  name: string;
  duration: number;
  price: number;
  is_active: boolean;
  sort_order: number;
}

function dbProviderToProvider(dbp: DbProvider, services: DbService[]): Provider {
  const name = { he: dbp.business_name, ar: dbp.business_name, en: dbp.business_name };
  const address = { he: dbp.address, ar: dbp.address, en: dbp.address };
  const about = { he: dbp.about, ar: dbp.about, en: dbp.about };

  return {
    id: dbp.id,
    name,
    category: dbp.category || "barber",
    rating: 0,
    reviewCount: 0,
    distance: "—",
    image: dbp.avatar_image || "https://images.unsplash.com/photo-1621605815971-fbc98d665033?w=400&h=400&fit=crop",
    coverImage: dbp.cover_image || "",
    address,
    about,
    services: services.filter(s => s.is_active).map(s => ({
      id: s.id,
      name: { he: s.name, ar: s.name, en: s.name },
      duration: s.duration,
      price: s.price,
    })),
    photos: [],
    workingHours: [],
    reviews: [],
  };
}

export function useAllProviders() {
  const dbQuery = useQuery({
    queryKey: ["all-providers"],
    queryFn: async () => {
      const { data: profiles, error: pErr } = await supabase
        .from("provider_profiles")
        .select("*");
      if (pErr) throw pErr;

      const { data: services, error: sErr } = await supabase
        .from("provider_services")
        .select("*")
        .eq("is_active", true)
        .order("sort_order");
      if (sErr) throw sErr;

      return (profiles || []).map(p => dbProviderToProvider(
        p as DbProvider,
        (services || []).filter(s => s.provider_id === p.id) as DbService[]
      ));
    },
  });

  return {
    providers: dbQuery.data || [],
    isLoading: dbQuery.isLoading,
  };
}

export function useProviderById(id: string | undefined) {
  const { providers, isLoading } = useAllProviders();
  const provider = providers.find(p => p.id === id);
  return { provider, isLoading };
}

/** Fetch real availability for a provider */
export function useRealAvailability(providerId: string | undefined) {
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
    queryKey: ["provider-bookings-public", providerId],
    queryFn: async () => {
      if (!providerId) return [];
      const { data, error } = await supabase
        .from("bookings")
        .select("booking_date, booking_time, service_ids")
        .eq("provider_id", providerId)
        .in("status", ["confirmed", "pending"]);
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
        .select("id, duration")
        .eq("provider_id", providerId);
      if (error) throw error;
      return data || [];
    },
    enabled: !!providerId,
  });

  const getAvailableSlots = (date: Date, requestedDuration?: number): string[] => {
    if (!providerId) return [];

    const dow = date.getDay();
    const dateStr = date.toISOString().split("T")[0];

    if ((blockedDatesQuery.data || []).includes(dateStr)) return [];

    const slot = (availabilityQuery.data || []).find(a => a.day_of_week === dow);
    if (!slot || !slot.is_available) return [];

    const services = servicesQuery.data || [];

    // Build list of booked intervals [start, end) in minutes
    const bookedIntervals: { start: number; end: number }[] = [];
    (bookingsQuery.data || [])
      .filter(b => b.booking_date === dateStr)
      .forEach(b => {
        const bookingStart = parseTime(b.booking_time);
        const totalDuration = (b.service_ids || []).reduce((sum: number, sid: string) => {
          const svc = services.find(s => s.id === sid);
          return sum + (svc?.duration || 30);
        }, 0);
        bookedIntervals.push({ start: bookingStart, end: bookingStart + totalDuration });
      });

    // Generate 15-min slots, excluding ones that would overlap with existing bookings
    const SLOT_STEP = 15;
    const start = parseTime(slot.start_time);
    const end = parseTime(slot.end_time);
    const neededDuration = requestedDuration || SLOT_STEP;

    const slots: string[] = [];
    for (let t = start; t + neededDuration <= end; t += SLOT_STEP) {
      const overlaps = bookedIntervals.some(
        bi => t < bi.end && bi.start < t + neededDuration
      );
      if (!overlaps) {
        const h = Math.floor(t / 60);
        const m = t % 60;
        slots.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
      }
    }
    return slots;
  };

  return { getAvailableSlots, isLoading: availabilityQuery.isLoading };
}

function parseTime(timeStr: string): number {
  const [h, m] = timeStr.split(":").map(Number);
  return h * 60 + (m || 0);
}
