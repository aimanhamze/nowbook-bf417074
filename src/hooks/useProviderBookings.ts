import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useProviderProfile } from "./useProviderProfile";

export function useProviderBookings() {
  const { profile } = useProviderProfile();

  return useQuery({
    queryKey: ["provider-bookings", profile?.id],
    queryFn: async () => {
      if (!profile) return [];
      // Query bookings matching the DB uuid OR any legacy mock provider ID
      const { data, error } = await supabase
        .from("bookings")
        .select("*")
        .or(`provider_id.eq.${profile.id},provider_id.eq.${profile.id.replace(/-/g, "")}`)
        .order("booking_date", { ascending: true });
      if (error) throw error;
      return data || [];
    },
    enabled: !!profile,
  });
}
