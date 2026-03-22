import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useProviderProfile } from "./useProviderProfile";

export function useProviderBookings() {
  const { profile } = useProviderProfile();

  return useQuery({
    queryKey: ["provider-bookings", profile?.id],
    queryFn: async () => {
      if (!profile) return [];
      const { data, error } = await supabase
        .from("bookings")
        .select("*")
        .eq("provider_id", profile.id)
        .order("booking_date", { ascending: true });
      if (error) throw error;
      return data || [];
    },
    enabled: !!profile,
  });
}
