import { useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useProviderProfile } from "./useProviderProfile";

// Per-staff service assignments (per-staff-services Phase 2). Mirrors
// useProviderStaff: owner-scoped query + one small single-purpose mutation.
//
// INHERITANCE RULE — the whole design rests on it:
//   a staff member with ZERO rows here performs ALL of the provider's services.
//   Assignment only ever RESTRICTS. So "unrestricted" is stored as the ABSENCE
//   of rows, never as a full set of rows — that is what keeps existing staff
//   migration-free and what makes an empty table a genuine no-op.
//
// `enabled` should be `staff.length > 0` so a provider with no staff members
// never fires this query at all.
export function useProviderStaffServices(enabled = true) {
  const { profile } = useProviderProfile();
  const queryClient = useQueryClient();

  // ONE query for the whole provider, not one per staff member: the settings
  // list needs every member's state at once to render its subtitles, and the
  // table is tiny (a handful of rows per provider).
  const assignmentsQuery = useQuery({
    queryKey: ["provider-staff-services", profile?.id],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      if (!profile) return [];
      const { data, error } = await supabase
        .from("provider_staff_services")
        .select("staff_id, service_id")
        .eq("provider_id", profile.id);
      if (error) throw error;
      return data || [];
    },
    enabled: !!profile && enabled,
  });

  const rows = useMemo(() => assignmentsQuery.data || [], [assignmentsQuery.data]);

  // staff_id → Set(service_id). A staff member ABSENT from this map (or mapped
  // to an empty set, which cannot happen since rows create the entry) has no
  // restriction and therefore performs everything. Callers must treat "missing"
  // as "all", never as "none".
  const servicesByStaff = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const row of rows) {
      const set = map.get(row.staff_id) ?? new Set<string>();
      set.add(row.service_id);
      map.set(row.staff_id, set);
    }
    return map;
  }, [rows]);

  // Replace one staff member's entire assignment set.
  //
  // Delete-then-insert rather than a diff: the sets are at most a handful of
  // rows, the composite PK makes a partial re-insert of unchanged rows a
  // conflict rather than a no-op, and a diff would add branching for no
  // measurable gain. Scoped by provider_id AND staff_id — the RLS owner policy
  // already restricts the rows reachable, this just makes the intent explicit.
  //
  // supabase-js has no client-side transaction, so this is two round trips. The
  // failure mode is deliberate and safe: if the DELETE lands and the INSERT
  // fails, the member is left with ZERO rows — i.e. UNRESTRICTED. Under the
  // inheritance rule that fails OPEN (they can still be booked for everything),
  // never closed (silently bookable for nothing). The caller surfaces the error
  // so the owner can retry.
  const setStaffServices = useMutation({
    mutationFn: async ({ staffId, serviceIds }: { staffId: string; serviceIds: string[] }) => {
      if (!profile) throw new Error("No provider profile");

      const { error: deleteError } = await supabase
        .from("provider_staff_services")
        .delete()
        .eq("provider_id", profile.id)
        .eq("staff_id", staffId);
      if (deleteError) throw deleteError;

      // The empty set stays genuinely EMPTY in the DB — we never write an
      // "assign all" row set. Emptiness IS the unrestricted state.
      if (serviceIds.length === 0) return;

      const { error: insertError } = await supabase
        .from("provider_staff_services")
        .insert(
          serviceIds.map((service_id) => ({
            provider_id: profile.id,
            staff_id: staffId,
            service_id,
          }))
        );
      if (insertError) throw insertError;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["provider-staff-services"] });
    },
  });

  return {
    servicesByStaff,
    isLoading: assignmentsQuery.isLoading,
    error: assignmentsQuery.error,
    setStaffServices,
  };
}
