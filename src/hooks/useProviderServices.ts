import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useProviderProfile } from "./useProviderProfile";

export function useProviderServices() {
  const { profile } = useProviderProfile();
  const queryClient = useQueryClient();

  const servicesQuery = useQuery({
    queryKey: ["provider-services", profile?.id],
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
    }) => {
      if (!profile) throw new Error("No provider profile");
      if (service.id) {
        const { error } = await supabase
          .from("provider_services")
          .update({ name: service.name, duration: service.duration, price: service.price })
          .eq("id", service.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("provider_services")
          .insert({ provider_id: profile.id, name: service.name, duration: service.duration, price: service.price });
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

  return { services: servicesQuery.data || [], isLoading: servicesQuery.isLoading, upsertService, deleteService };
}
