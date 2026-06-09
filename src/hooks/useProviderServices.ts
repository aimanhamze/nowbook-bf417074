import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useProviderProfile } from "./useProviderProfile";

export function useProviderServices() {
  const { profile } = useProviderProfile();
  const queryClient = useQueryClient();

  // A service write (incl. max_capacity) must refresh every cache that carries
  // service data, not just the provider's own list:
  //   • ["provider-services"]        → this dashboard list / openEdit
  //   • ["provider-services-public"] → useRealAvailability (customer slot logic)
  //   • ["all-providers"]            → provider.services[] used by the booking
  //                                    flow, ProviderDetail and Home
  // Without the latter two, the new capacity saves but the UI keeps showing the
  // stale value (e.g. 1) because those queries are never re-fetched.
  const invalidateServiceCaches = () => {
    queryClient.invalidateQueries({ queryKey: ["provider-services"] });
    queryClient.invalidateQueries({ queryKey: ["provider-services-public"] });
    queryClient.invalidateQueries({ queryKey: ["all-providers"] });
  };

  const servicesQuery = useQuery({
    queryKey: ["provider-services", profile?.id],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      if (!profile) return [];
      const { data, error } = await supabase
        .from("provider_services")
        .select("*")
        .eq("provider_id", profile.id)
        .order("sort_order");
      if (error) throw error;
      return data || [];
    },
    enabled: !!profile,
  });

  const upsertService = useMutation({
    mutationFn: async (service: {
      id?: string;
      name: string;
      duration: number;
      price: number;
      service_type: 'private' | 'group';
      max_capacity: number;
      scheduled_time?: string | null;
    }) => {
      if (!profile) throw new Error("No provider profile");
      const isFitness = profile.category === 'fitness_studio';
      // Group remains fitness-only. Private services (any provider) may now
      // carry a per-slot capacity (>= 1, default 1) without becoming a group:
      // 1 = ordinary single-customer service, higher = multiple customers can
      // book the same time. Capacity enforcement lives in the booking trigger.
      const resolvedType = isFitness ? service.service_type : 'private';
      const payload = {
        name: service.name,
        duration: service.duration,
        price: service.price,
        service_type: resolvedType,
        max_capacity: resolvedType === 'group'
          ? service.max_capacity
          : Math.max(1, service.max_capacity || 1),
        scheduled_time: service.scheduled_time || null,
      };
      if (service.id) {
        const { error } = await supabase
          .from("provider_services")
          .update(payload)
          .eq("id", service.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("provider_services")
          .insert({ provider_id: profile.id, ...payload });
        if (error) throw error;
      }
    },
    onSuccess: invalidateServiceCaches,
  });

  const deleteService = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("provider_services").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidateServiceCaches,
  });

  return { services: servicesQuery.data || [], isLoading: servicesQuery.isLoading, error: servicesQuery.error, upsertService, deleteService };
}
