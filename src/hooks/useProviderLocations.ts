import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface ProviderLocation {
  id: string;
  business_name: string;
  category: string;
  average_rating: number | null;
  latitude: number;
  longitude: number;
  avatar_image: string | null;
  address: string | null;
}

export function useProviderLocations() {
  const query = useQuery({
    queryKey: ["provider-locations"],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("provider_profiles")
        .select("id, business_name, category, average_rating, latitude, longitude, avatar_image, address")
        .not("latitude", "is", null)
        .not("longitude", "is", null);
      if (error) throw error;
      return (data ?? []) as ProviderLocation[];
    },
  });

  return {
    locations: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
  };
}
