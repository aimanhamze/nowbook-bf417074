import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useProviderProfile } from "./useProviderProfile";

// `enabled` gates every query here, mirroring useProviderServices(enabled) and
// useProviderStaffServices(enabled). It DEFAULTS TO TRUE, so all four existing
// callers (AvailabilityTab, CalendarTab, MonthlyAvailabilityCalendar,
// NewBookingSheet) pass nothing and are completely unaffected. It exists for
// the Staff page (useStaffToday), which needs the shop's rows only once the
// provider has staff members — and would otherwise fire three queries for
// providers who have no staff at all.
export function useProviderAvailability(enabled = true) {
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
    enabled: !!profile && enabled,
  });

  const upsertAvailability = useMutation({
    mutationFn: async (slot: {
      day_of_week: number;
      start_time: string;
      end_time: string;
      is_available: boolean;
      break_start?: string | null;
      break_end?: string | null;
    }) => {
      if (!profile) throw new Error("No provider profile");

      const { start_time, end_time, is_available, break_start, break_end } = slot;

      // Attempt UPDATE on the existing row
      const { data: updated, error: updateError } = await supabase
        .from("provider_availability")
        .update({ start_time, end_time, is_available, break_start: break_start ?? null, break_end: break_end ?? null })
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
    enabled: !!profile && enabled,
  });

  // Blocking/unblocking a date must refresh not just the provider's own list but
  // also the customer-facing views that read blocked dates: the booking resolver
  // and ProviderDetail pill (provider-blocked-dates-public) and the Home pills
  // (all-provider-blocked-dates). Without these, a block only showed up after the
  // 5-min staleTime. getProviderStatus itself is untouched — it just gets fresh
  // blocked-date input sooner.
  const invalidateBlocked = () => {
    queryClient.invalidateQueries({ queryKey: ["provider-blocked-dates"] });
    queryClient.invalidateQueries({ queryKey: ["provider-blocked-dates-public"] });
    queryClient.invalidateQueries({ queryKey: ["all-provider-blocked-dates"] });
    queryClient.invalidateQueries({ queryKey: ["all-providers"] });
  };

  const blockDate = useMutation({
    mutationFn: async (vals: { blocked_date: string; reason?: string }) => {
      if (!profile) throw new Error("No provider profile");
      const { error } = await supabase
        .from("provider_blocked_dates")
        .insert({ provider_id: profile.id, ...vals });
      if (error) throw error;
    },
    onSuccess: invalidateBlocked,
  });

  const unblockDate = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("provider_blocked_dates").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidateBlocked,
  });

  // ── Monthly per-date overrides (only used when availability_mode = 'monthly') ─
  // Provider-side list, kept on a DISTINCT key from the customer resolver's
  // ["provider-date-overrides", providerId] query so the two caches never collide
  // (this one selects *). Mutations invalidate BOTH so customer availability
  // updates live the moment a provider edits a day.
  const dateOverridesQuery = useQuery({
    queryKey: ["provider-date-overrides-manage", profile?.id],
    queryFn: async () => {
      if (!profile) return [];
      const { data, error } = await supabase
        .from("provider_date_overrides")
        .select("*")
        .eq("provider_id", profile.id)
        .order("override_date");
      if (error) throw error;
      return data || [];
    },
    enabled: !!profile && enabled,
  });

  const invalidateOverrides = () => {
    queryClient.invalidateQueries({ queryKey: ["provider-date-overrides-manage"] });
    // Customer booking view reads overrides via this key (useAllProviders).
    queryClient.invalidateQueries({ queryKey: ["provider-date-overrides"] });
    queryClient.invalidateQueries({ queryKey: ["all-providers"] });
  };

  const upsertDateOverride = useMutation({
    mutationFn: async (o: {
      override_date: string;
      is_available: boolean;
      start_time: string;
      end_time: string;
      break_start?: string | null;
      break_end?: string | null;
    }) => {
      if (!profile) throw new Error("No provider profile");
      const { error } = await supabase
        .from("provider_date_overrides")
        .upsert(
          {
            provider_id: profile.id,
            override_date: o.override_date,
            is_available: o.is_available,
            start_time: o.start_time,
            end_time: o.end_time,
            break_start: o.break_start ?? null,
            break_end: o.break_end ?? null,
          },
          { onConflict: "provider_id,override_date" },
        );
      if (error) throw error;
    },
    onSuccess: invalidateOverrides,
  });

  const deleteDateOverride = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("provider_date_overrides").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidateOverrides,
  });

  return {
    availability: availabilityQuery.data || [],
    blockedDates: blockedDatesQuery.data || [],
    dateOverrides: dateOverridesQuery.data || [],
    isLoading: availabilityQuery.isLoading,
    error: availabilityQuery.error,
    upsertAvailability,
    blockDate,
    unblockDate,
    upsertDateOverride,
    deleteDateOverride,
  };
}
