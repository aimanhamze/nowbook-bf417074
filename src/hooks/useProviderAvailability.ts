import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useProviderProfile } from "./useProviderProfile";
import { fetchOwnBlockedDates, fetchOwnDateOverrides } from "@/lib/scheduleFetch";

/** save_date_openings, typed by hand until types.ts includes it. */
type OpeningsRpc = (
  fn: "save_date_openings",
  args: {
    p_provider_id: string;
    p_dates: string[];
    p_start: string;
    p_end: string;
    p_break_start: string | null;
    p_break_end: string | null;
    p_replace_blocks: boolean;
  },
) => PromiseLike<{ data: number | null; error: { message: string } | null }>;

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

  // ALL of the provider's own rows, past included (the calendar's out-of-hours
  // badge reads past days), paged past the 1000-row cap — see lib/scheduleFetch.
  const blockedDatesQuery = useQuery({
    queryKey: ["provider-blocked-dates", profile?.id],
    queryFn: async () => {
      if (!profile) return [];
      return fetchOwnBlockedDates(profile.id);
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

  // ── Per-date overrides (both modes: monthly days + weekly special openings) ─
  // Provider-side list, kept on a DISTINCT key from the customer resolver's
  // ["provider-date-overrides", providerId] query so the two caches never collide
  // (this one selects *). Mutations invalidate BOTH so customer availability
  // updates live the moment a provider edits a day.
  const dateOverridesQuery = useQuery({
    queryKey: ["provider-date-overrides-manage", profile?.id],
    // All rows, past included, paged past the 1000-row cap (lib/scheduleFetch).
    queryFn: async () => {
      if (!profile) return [];
      return fetchOwnDateOverrides(profile.id);
    },
    enabled: !!profile && enabled,
  });

  const invalidateOverrides = () => {
    queryClient.invalidateQueries({ queryKey: ["provider-date-overrides-manage"] });
    // Customer booking view reads overrides via this key (useAllProviders).
    queryClient.invalidateQueries({ queryKey: ["provider-date-overrides"] });
    // Home status pills read today's override too.
    queryClient.invalidateQueries({ queryKey: ["all-provider-date-overrides"] });
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

  // Special opening days (weekly mode): one save_date_openings call writes
  // every date in one transaction, and with replaceBlocks deletes those dates'
  // blocked rows in the same transaction. Invalidates blocked AND overrides.
  const saveDateOpenings = useMutation({
    mutationFn: async (o: {
      dates: string[];
      start: string;
      end: string;
      breakStart: string | null;
      breakEnd: string | null;
      replaceBlocks: boolean;
    }) => {
      if (!profile) throw new Error("No provider profile");
      // Narrow cast: the RPC is DEV-only until it ships; types.ts is generated
      // from PROD and is not regenerated from DEV (see packageTypes.ts).
      const db = supabase as unknown as { rpc: OpeningsRpc };
      const { data, error } = await db.rpc("save_date_openings", {
        p_provider_id: profile.id,
        p_dates: o.dates,
        p_start: o.start,
        p_end: o.end,
        p_break_start: o.breakStart,
        p_break_end: o.breakEnd,
        p_replace_blocks: o.replaceBlocks,
      });
      if (error) throw error;
      return data as number;
    },
    onSettled: () => {
      invalidateOverrides();
      invalidateBlocked();
    },
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
    // Additive: the dashboard setup hub summarises blocked dates (fitness
    // studios) and monthly overrides, so it needs their own load/error state.
    blockedDatesLoading: blockedDatesQuery.isLoading,
    blockedDatesError: blockedDatesQuery.error,
    dateOverridesLoading: dateOverridesQuery.isLoading,
    dateOverridesError: dateOverridesQuery.error,
    upsertAvailability,
    blockDate,
    unblockDate,
    upsertDateOverride,
    deleteDateOverride,
    saveDateOpenings,
  };
}

/**
 * Active (confirmed / pending) bookings on one date for the signed-in
 * provider's active branch. Shown before an opening is removed, so the owner
 * knows who is booked into it. `date` null = disabled.
 */
export function useDayActiveBookingCount(date: string | null) {
  const { profile } = useProviderProfile();
  return useQuery({
    queryKey: ["provider-day-booking-count", profile?.id, date],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("bookings")
        .select("id", { count: "exact", head: true })
        .eq("provider_id", profile!.id)
        .eq("booking_date", date!)
        .in("status", ["confirmed", "pending"]);
      if (error) throw error;
      return count ?? 0;
    },
    enabled: !!profile && !!date,
    staleTime: 0,
  });
}
