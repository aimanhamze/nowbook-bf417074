import { useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useProviderProfile } from "./useProviderProfile";
import { toDateKey, toDateKeyString, futureOnly } from "@/lib/staffTimeOff";

// Per-staff time off (per-staff-availability Phase 5b). Mirrors
// useProviderStaffHours: owner-scoped query + one small single-purpose mutation.
//
// OPT-IN BY ABSENCE, like its two siblings: no rows means no time off. The table
// ships empty, so every existing staff member is unaffected. Unlike weekly
// hours there is no "configured vs unconfigured" distinction to preserve — an
// empty set and no rows are the same state.
//
// `enabled` should be `staff.length > 0` so a provider with no staff members
// never fires this query at all.
export function useProviderStaffTimeOff(enabled = true) {
  const { profile } = useProviderProfile();
  const queryClient = useQueryClient();

  // Recomputed per render, which is what we want: a sheet left open across
  // midnight should start treating the new today as the boundary, on both the
  // read and the write side.
  const todayKey = toDateKey(new Date());

  // ONE query for the whole provider, not one per staff member: the settings
  // list needs every member's count at once for its subtitle.
  //
  // FUTURE DATES ONLY, filtered server-side. Past days off stay in the table as
  // history — nothing in the app reads them, and nothing here rewrites them.
  // todayKey is in the query key (not just the filter) so the boundary moving at
  // midnight actually refetches, the same reason the bookings query keys on its
  // date window.
  const timeOffQuery = useQuery({
    queryKey: ["provider-staff-blocked-dates", profile?.id, todayKey],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      if (!profile) return [];
      const { data, error } = await supabase
        .from("provider_staff_blocked_dates")
        .select("staff_id, blocked_date")
        .eq("provider_id", profile.id)
        .gte("blocked_date", todayKey)
        .order("blocked_date");
      if (error) throw error;
      return data || [];
    },
    enabled: !!profile && enabled,
  });

  // staff_id → sorted "YYYY-MM-DD"[]. A member ABSENT from this map simply has
  // no time off; there is no third state to preserve, so callers may treat
  // missing and empty identically (timeOffDraftFromRows does exactly that).
  const timeOffByStaff = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const row of timeOffQuery.data || []) {
      const list = map.get(row.staff_id) ?? [];
      list.push(toDateKeyString(row.blocked_date));
      map.set(row.staff_id, list);
    }
    return map;
  }, [timeOffQuery.data]);

  // Replace one staff member's UPCOMING time off.
  //
  // ┌─ THE RANGE-SCOPED DELETE ─────────────────────────────────────────────┐
  // │ `.gte("blocked_date", todayKey)` on the delete below is LOAD-BEARING,  │
  // │ and it is the one line in this feature that must not be lost.          │
  // │                                                                        │
  // │ setStaffHours and setStaffServices replace a member's ENTIRE           │
  // │ configuration, so their deletes are correctly unscoped. This table is  │
  // │ different: it also holds PAST dates, while the editor only ever shows  │
  // │ and holds FUTURE ones. An unscoped `DELETE WHERE staff_id = ...` —     │
  // │ which is exactly what copying either sibling writer produces — would   │
  // │ therefore wipe the member's entire time-off history on every save,     │
  // │ silently, with the UI showing nothing wrong.                           │
  // │                                                                        │
  // │ The hours writer has no equivalent hazard. That asymmetry is why this  │
  // │ is called out here, at the call site, as well as in the migration      │
  // │ header (20260904000002).                                               │
  // └────────────────────────────────────────────────────────────────────────┘
  //
  // Delete-then-insert rather than a diff, for the same reasons as the two
  // sibling writers: the sets are small, the composite PK makes a partial
  // re-insert of unchanged rows a conflict rather than a no-op, and a diff would
  // add branching for no measurable gain.
  //
  // supabase-js has no client-side transaction, so this is two round trips. The
  // failure mode is deliberate and safe: if the DELETE lands and the INSERT
  // fails, the member is left with NO upcoming time off — i.e. bookable, the
  // state they were in before any of this existed. That fails OPEN, never
  // closed. The caller surfaces the error so the owner can retry.
  const setStaffTimeOff = useMutation({
    mutationFn: async ({ staffId, dates }: { staffId: string; dates: string[] }) => {
      if (!profile) throw new Error("No provider profile");

      const { error: deleteError } = await supabase
        .from("provider_staff_blocked_dates")
        .delete()
        .eq("provider_id", profile.id)
        .eq("staff_id", staffId)
        // ↓↓ SEE THE BOXED NOTE ABOVE — do not remove this line. ↓↓
        .gte("blocked_date", todayKey);
      if (deleteError) throw deleteError;

      // futureOnly again, on the way IN. The draft was already built from future
      // rows, but a sheet left open across midnight can hold a date that has
      // since become "yesterday" — and inserting one would create a row the
      // delete above can no longer reach, stranding it forever.
      const upcoming = futureOnly(dates, todayKey);
      if (upcoming.length === 0) return;

      const { error: insertError } = await supabase
        .from("provider_staff_blocked_dates")
        .insert(
          upcoming.map((blocked_date) => ({
            provider_id: profile.id,
            staff_id: staffId,
            blocked_date,
          }))
        );
      if (insertError) throw insertError;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["provider-staff-blocked-dates"] });
      // The booking-side read (Phase 5c) will live under a SEPARATE key, which
      // the line above does not reach — React Query matches key prefixes
      // element-wise, so a different first element is a different tree, not a
      // child. Invalidating it here already (harmless while no such query is
      // mounted) is the same discipline setStaffHours needed, and it means the
      // owner's own walk-in sheet cannot show stale time off once 5c lands.
      queryClient.invalidateQueries({ queryKey: ["provider-staff-blocked-dates-public"] });
    },
  });

  return {
    timeOffByStaff,
    todayKey,
    isLoading: timeOffQuery.isLoading,
    error: timeOffQuery.error,
    setStaffTimeOff,
  };
}
