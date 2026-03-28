import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useProviderProfile } from "./useProviderProfile";
import { providers as mockProviders } from "@/lib/mock-data";

/** Find the mock provider ID that matches a DB provider by business name */
function findMockIdForDbProvider(businessName: string): string | null {
  const normalise = (s: string) => s.replace(/[׳']/g, "").replace(/\s+/g, " ").trim();
  const norm = normalise(businessName);
  const mock = mockProviders.find(p =>
    Object.values(p.name).some(n => normalise(n) === norm)
  );
  return mock?.id ?? null;
}

export function useProviderBookings() {
  const { profile } = useProviderProfile();

  return useQuery({
    queryKey: ["provider-bookings", profile?.id],
    queryFn: async () => {
      if (!profile) return [];
      // Build list of IDs to match: DB uuid + possible mock ID
      const ids = [profile.id];
      const mockId = findMockIdForDbProvider(profile.business_name);
      if (mockId) ids.push(mockId);

      const { data, error } = await supabase
        .from("bookings")
        .select("*")
        .in("provider_id", ids)
        .order("booking_date", { ascending: true });
      if (error) throw error;
      return data || [];
    },
    enabled: !!profile,
  });
}
