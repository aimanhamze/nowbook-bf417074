import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useProviderProfile } from "./useProviderProfile";

export interface ClassScheduleEntry {
  id: string;
  provider_id: string;
  day_of_week: number; // 0=Sun … 6=Sat
  start_time: string;  // HH:MM:SS
  duration_minutes: number;
  class_name: string;
  class_type: "private" | "group";
  max_capacity: number;
  is_active: boolean;
  created_at: string | null;
  updated_at: string | null;
}

export interface ClassScheduleInsert {
  day_of_week: number;
  start_time: string;
  duration_minutes: number;
  class_name: string;
  class_type: "private" | "group";
  max_capacity: number;
}

export function useProviderClassSchedule() {
  const { profile } = useProviderProfile();
  const queryClient = useQueryClient();

  const scheduleQuery = useQuery({
    queryKey: ["provider-class-schedule", profile?.id],
    staleTime: 2 * 60 * 1000,
    queryFn: async () => {
      if (!profile) return [] as ClassScheduleEntry[];
      const { data, error } = await supabase
        .from("provider_class_schedule")
        .select("*")
        .eq("provider_id", profile.id)
        .order("day_of_week")
        .order("start_time");
      if (error) throw error;
      return (data || []) as ClassScheduleEntry[];
    },
    enabled: !!profile,
  });

  const addClass = useMutation({
    mutationFn: async (entry: ClassScheduleInsert) => {
      if (!profile) throw new Error("No provider profile");
      const { error } = await supabase.from("provider_class_schedule").insert({
        provider_id: profile.id,
        ...entry,
      });
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["provider-class-schedule"] }),
  });

  const updateClass = useMutation({
    mutationFn: async ({ id, ...updates }: Partial<ClassScheduleInsert> & { id: string }) => {
      const { error } = await supabase
        .from("provider_class_schedule")
        .update(updates)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["provider-class-schedule"] }),
  });

  const deleteClass = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("provider_class_schedule")
        .update({ is_active: false })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["provider-class-schedule"] }),
  });

  return {
    schedule: scheduleQuery.data || [],
    isLoading: scheduleQuery.isLoading,
    addClass,
    updateClass,
    deleteClass,
  };
}

// Public read-only hook used in the customer booking flow
export function useProviderClassScheduleById(providerId?: string) {
  return useQuery({
    queryKey: ["provider-class-schedule-public", providerId],
    staleTime: 2 * 60 * 1000,
    queryFn: async () => {
      if (!providerId) return [] as ClassScheduleEntry[];
      const { data, error } = await supabase
        .from("provider_class_schedule")
        .select("*")
        .eq("provider_id", providerId)
        .eq("is_active", true)
        .order("day_of_week")
        .order("start_time");
      if (error) throw error;
      return (data || []) as ClassScheduleEntry[];
    },
    enabled: !!providerId,
  });
}

// Returns how many confirmed/pending bookings exist for a given class on a specific date
export async function getClassBookingCount(
  classScheduleId: string,
  bookingDate: string
): Promise<number> {
  const { count, error } = await supabase
    .from("bookings")
    .select("id", { count: "exact", head: true })
    .eq("class_schedule_id", classScheduleId)
    .eq("booking_date", bookingDate)
    .in("status", ["confirmed", "pending"]);
  if (error) return 0;
  return count ?? 0;
}
