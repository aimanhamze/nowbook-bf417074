import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { providers as mockProviders, categoryNames, getAvailableSlots as getMockAvailableSlots } from "@/lib/mock-data";
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
    id: `db-${dbp.id}`,
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
    queryKey: ["all-db-providers"],
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

  const allProviders = [...mockProviders, ...(dbQuery.data || [])];

  return {
    providers: allProviders,
    isLoading: dbQuery.isLoading,
  };
}

export function useProviderById(id: string | undefined) {
  const { providers, isLoading } = useAllProviders();
  const provider = providers.find(p => p.id === id);
  return { provider, isLoading };
}

/** Fetch real availability for a db provider, or return mock slots */
export function useRealAvailability(providerId: string | undefined) {
  const isDbProvider = providerId?.startsWith("db-");
  const dbId = isDbProvider ? providerId?.replace("db-", "") : null;

  const availabilityQuery = useQuery({
    queryKey: ["provider-availability-public", dbId],
    queryFn: async () => {
      if (!dbId) return [];
      const { data, error } = await supabase
        .from("provider_availability")
        .select("*")
        .eq("provider_id", dbId)
        .order("day_of_week");
      if (error) throw error;
      return data || [];
    },
    enabled: !!dbId,
  });

  const blockedDatesQuery = useQuery({
    queryKey: ["provider-blocked-dates-public", dbId],
    queryFn: async () => {
      if (!dbId) return [];
      const { data, error } = await supabase
        .from("provider_blocked_dates")
        .select("blocked_date")
        .eq("provider_id", dbId);
      if (error) throw error;
      return (data || []).map(d => d.blocked_date);
    },
    enabled: !!dbId,
  });

  const bookingsQuery = useQuery({
    queryKey: ["provider-bookings-public", dbId],
    queryFn: async () => {
      if (!dbId) return [];
      const { data, error } = await supabase
        .from("bookings")
        .select("booking_date, booking_time")
        .eq("provider_id", dbId)
        .in("status", ["confirmed", "pending"]);
      if (error) throw error;
      return data || [];
    },
    enabled: !!dbId,
  });

  const getAvailableSlots = (date: Date): string[] => {
    if (!isDbProvider) {
      return getMockAvailableSlots(providerId || "", date);
    }

    const dow = date.getDay();
    const dateStr = date.toISOString().split("T")[0];

    if ((blockedDatesQuery.data || []).includes(dateStr)) return [];

    const slot = (availabilityQuery.data || []).find(a => a.day_of_week === dow);
    if (!slot || !slot.is_available) return [];

    // Get booked times for this date
    const bookedTimes = (bookingsQuery.data || [])
      .filter(b => b.booking_date === dateStr)
      .map(b => b.booking_time);

    // Generate 30-min slots, excluding already booked ones
    const start = parseTime(slot.start_time);
    const end = parseTime(slot.end_time);
    const slots: string[] = [];
    for (let t = start; t < end; t += 30) {
      const h = Math.floor(t / 60);
      const m = t % 60;
      const timeStr = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
      if (!bookedTimes.includes(timeStr)) {
        slots.push(timeStr);
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
