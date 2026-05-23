import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useProviderProfile } from "./useProviderProfile";

export function useProviderServices() {
  const { profile } = useProviderProfile();
  const queryClient = useQueryClient();

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
      const resolvedType = isFitness ? service.service_type : 'private';
      const payload = {
        name: service.name,
        duration: service.duration,
        price: service.price,
        service_type: resolvedType,
        max_capacity: resolvedType === 'group' ? service.max_capacity : 1,
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
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["provider-services"] }),
  });

  const deleteService = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("provider_services").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["provider-services"] }),
  });

  return { services: servicesQuery.data || [], isLoading: servicesQuery.isLoading, error: servicesQuery.error, upsertService, deleteService };
}
