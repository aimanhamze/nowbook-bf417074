import { useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useProviderProfile } from "./useProviderProfile";
import type { StaffHoursRow } from "@/lib/staffHours";

// Per-staff working hours (per-staff-availability Phase 2). Mirrors
// useProviderStaffServices deliberately, down to the mutation shape: the two
// features share one inheritance rule and should be read side by side.
//
// INHERITANCE RULE — the whole design rests on it:
//   a staff member with ZERO rows here works ALL of the shop's hours.
//   Configuration only ever RESTRICTS. So "unrestricted" is stored as the
//   ABSENCE of rows, never as a full week of rows — that is what keeps existing
//   staff migration-free and what makes an empty table a genuine no-op.
//
// See lib/staffHours.ts for the three states this implies (no rows / day on /
// day off), and why a MISSING weekday on a configured member means "not
// working" rather than "inherit the shop's hours".
//
// `enabled` should be `staff.length > 0` so a provider with no staff members
// never fires this query at all.
export function useProviderStaffHours(enabled = true) {
  const { profile } = useProviderProfile();
  const queryClient = useQueryClient();

  // ONE query for the whole provider, not one per staff member: the settings
  // list needs every member's state at once to render its subtitles, and the
  // table is tiny (at most 7 rows per configured member). Phase 3's
  // customer-side read will follow the same shape for the same reason — the
  // booking calendar asks about availability once per rendered day, so a
  // per-member or per-day query there would fan out across the whole month.
  const hoursQuery = useQuery({
    queryKey: ["provider-staff-availability", profile?.id],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      if (!profile) return [];
      const { data, error } = await supabase
        .from("provider_staff_availability")
        .select("staff_id, day_of_week, start_time, end_time, is_available")
        .eq("provider_id", profile.id);
      if (error) throw error;
      return (data || []) as StaffHoursRow[];
    },
    enabled: !!profile && enabled,
  });

  const rows = useMemo(() => hoursQuery.data || [], [hoursQuery.data]);

  // staff_id → (day_of_week → row). A staff member ABSENT from this map has no
  // configuration and therefore works all of the shop's hours. Callers must
  // treat "missing" as "all", never as "none" — draftFromRows is the one place
  // that conversion is written, and it is what the editor opens on.
  const hoursByStaff = useMemo(() => {
    const map = new Map<string, Map<number, StaffHoursRow>>();
    for (const row of rows) {
      const days = map.get(row.staff_id) ?? new Map<number, StaffHoursRow>();
      days.set(row.day_of_week, row);
      map.set(row.staff_id, days);
    }
    return map;
  }, [rows]);

  // Replace one staff member's entire week.
  //
  // Delete-then-insert rather than a diff, for the same reasons as
  // setStaffServices: the sets are at most seven rows, the composite PK makes a
  // partial re-insert of unchanged rows a conflict rather than a no-op, and a
  // diff would add branching for no measurable gain.
  //
  // An EMPTY `days` array is the ONLY route back to "works all shop hours", and
  // it must stay a genuine delete-and-write-nothing. Writing a week that happens
  // to match the shop instead would look identical today and silently stop
  // tracking the shop's hours tomorrow.
  //
  // supabase-js has no client-side transaction, so this is two round trips. The
  // failure mode is deliberate and safe: if the DELETE lands and the INSERT
  // fails, the member is left with ZERO rows — i.e. UNRESTRICTED. Under the
  // inheritance rule that fails OPEN (they stay bookable across the shop's whole
  // week), never closed (silently bookable at no time at all). The caller
  // surfaces the error so the owner can retry.
  const setStaffHours = useMutation({
    mutationFn: async ({
      staffId,
      days,
    }: {
      staffId: string;
      days: { day_of_week: number; start_time: string; end_time: string; is_available: boolean }[];
    }) => {
      if (!profile) throw new Error("No provider profile");

      // Scoped by provider_id AND staff_id — the RLS owner policy already
      // restricts which rows are reachable, this just makes the intent explicit.
      const { error: deleteError } = await supabase
        .from("provider_staff_availability")
        .delete()
        .eq("provider_id", profile.id)
        .eq("staff_id", staffId);
      if (deleteError) throw deleteError;

      if (days.length === 0) return;

      const { error: insertError } = await supabase
        .from("provider_staff_availability")
        .insert(
          days.map((d) => ({
            provider_id: profile.id,
            staff_id: staffId,
            day_of_week: d.day_of_week,
            start_time: d.start_time,
            end_time: d.end_time,
            is_available: d.is_available,
          }))
        );
      if (insertError) throw insertError;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["provider-staff-availability"] });
      // Phase 3's booking-side read will live under a SEPARATE key
      // ("provider-staff-availability-public"), which the line above does not
      // reach — React Query matches key prefixes element-wise, so a different
      // first element is a different tree, not a child. Invalidating it here
      // already (harmless while no such query is mounted) is the same discipline
      // setStaffServices needed, and it means the owner's own walk-in sheet
      // cannot show stale hours for up to the 5-minute staleTime once Phase 3
      // lands.
      queryClient.invalidateQueries({ queryKey: ["provider-staff-availability-public"] });
    },
  });

  return {
    hoursByStaff,
    isLoading: hoursQuery.isLoading,
    error: hoursQuery.error,
    setStaffHours,
  };
}
