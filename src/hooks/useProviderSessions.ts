import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useProviderProfile } from "./useProviderProfile";
import { format } from "date-fns";

export interface ProviderSession {
  id: string;
  provider_id: string;
  service_id: string;
  session_date: string; // yyyy-MM-dd
  session_time: string; // HH:MM:SS
  created_at: string;
}

export function useProviderSessions() {
  const { profile } = useProviderProfile();
  const queryClient = useQueryClient();

  const sessionsQuery = useQuery({
    queryKey: ["provider-sessions", profile?.id],
    staleTime: 2 * 60 * 1000,
    queryFn: async () => {
      if (!profile) return [] as ProviderSession[];
      const today = format(new Date(), "yyyy-MM-dd");
      const { data, error } = await supabase
        .from("provider_sessions")
        .select("*")
        .eq("provider_id", profile.id)
        .gte("session_date", today)
        .order("session_date")
        .order("session_time");
      if (error) throw error;
      return (data || []) as ProviderSession[];
    },
    enabled: !!profile,
  });

  const addSession = useMutation({
    mutationFn: async (session: { service_id: string; session_date: string; session_time: string }) => {
      if (!profile) throw new Error("No provider profile");
      const { error } = await supabase.from("provider_sessions").insert({
        provider_id: profile.id,
        service_id: session.service_id,
        session_date: session.session_date,
        session_time: session.session_time,
      });
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["provider-sessions"] }),
  });

  const deleteSession = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("provider_sessions").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["provider-sessions"] }),
  });

  return {
    sessions: sessionsQuery.data || [],
    isLoading: sessionsQuery.isLoading,
    addSession,
    deleteSession,
  };
}

// Hook for reading sessions for a specific provider (used in booking flow)
export function useProviderSessionsById(providerId?: string) {
  return useQuery({
    queryKey: ["provider-sessions-public", providerId],
    staleTime: 2 * 60 * 1000,
    queryFn: async () => {
      if (!providerId) return [] as ProviderSession[];
      const today = format(new Date(), "yyyy-MM-dd");
      const { data, error } = await supabase
        .from("provider_sessions")
        .select("*")
        .eq("provider_id", providerId)
        .gte("session_date", today)
        .order("session_date")
        .order("session_time");
      if (error) throw error;
      return (data || []) as ProviderSession[];
    },
    enabled: !!providerId,
  });
}
