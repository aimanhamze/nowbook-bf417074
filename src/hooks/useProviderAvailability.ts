import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useProviderProfile } from "./useProviderProfile";

export function useProviderAvailability() {
  const { profile } = useProviderProfile();
  const queryClient = useQueryClient();

  const availabilityQuery = useQuery({
    queryKey: ["provider-availability", profile?.id],
    queryFn: async () => {
      if (!profile) return [];
      const { data, error } = await supabase
        .from("provider_availability")
        .select("*")
        .eq("provider_id", profile.id)
        .order("day_of_week");
      if (error) throw error;
      return data || [];
    },
    enabled: !!profile,
  });

  const upsertAvailability = useMutation({
    mutationFn: async (slot: {
      day_of_week: number;
      start_time: string;
      end_time: string;
      is_available: boolean;
    }) => {
      if (!profile) throw new Error("No provider profile");

      const { start_time, end_time, is_available } = slot;

      // Attempt UPDATE on the existing row
      const { data: updated, error: updateError } = await supabase
        .from("provider_availability")
        .update({ start_time, end_time, is_available })
        .eq("provider_id", profile.id)
        .eq("day_of_week", slot.day_of_week)
        .select("id");

      if (updateError) throw updateError;

      // If no row was matched, insert a new one
      if (!updated?.length) {
        const { error: insertError } = await supabase
          .from("provider_availability")
          .insert({ provider_id: profile.id, ...slot });
        if (insertError) throw insertError;
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["provider-availability"] }),
  });

  const blockedDatesQuery = useQuery({
    queryKey: ["provider-blocked-dates", profile?.id],
    queryFn: async () => {
      if (!profile) return [];
      const { data, error } = await supabase
        .from("provider_blocked_dates")
        .select("*")
        .eq("provider_id", profile.id)
        .order("blocked_date");
      if (error) throw error;
      return data || [];
    },
    enabled: !!profile,
  });

  const blockDate = useMutation({
    mutationFn: async (vals: { blocked_date: string; reason?: string }) => {
      if (!profile) throw new Error("No provider profile");
      const { error } = await supabase
        .from("provider_blocked_dates")
        .insert({ provider_id: profile.id, ...vals });
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["provider-blocked-dates"] }),
  });

  const unblockDate = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("provider_blocked_dates").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["provider-blocked-dates"] }),
  });

  return {
    availability: availabilityQuery.data || [],
    blockedDates: blockedDatesQuery.data || [],
    isLoading: availabilityQuery.isLoading,
    error: availabilityQuery.error,
    upsertAvailability,
    blockDate,
    unblockDate,
  };
}
