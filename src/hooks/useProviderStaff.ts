import { useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useProviderProfile } from "./useProviderProfile";

// Provider-side staff CRUD (multi-staff Phase 2). Mirrors useProviderServices:
// owner-scoped query + small single-purpose mutations. Staff are SOFT-DELETED
// via is_active — never hard DELETE: bookings.staff_id references the row with
// a NO ACTION FK, so a hard delete of a staff member with booking history would
// fail, and history must keep resolving to a name anyway.
export function useProviderStaff() {
  const { profile } = useProviderProfile();
  const queryClient = useQueryClient();

  const invalidateStaffCaches = () => {
    queryClient.invalidateQueries({ queryKey: ["provider-staff"] });
  };

  // Management view: ALL staff, including inactive (they can be reactivated).
  const staffQuery = useQuery({
    queryKey: ["provider-staff", profile?.id],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      if (!profile) return [];
      const { data, error } = await supabase
        .from("provider_staff")
        .select("*")
        .eq("provider_id", profile.id)
        .order("display_order")
        .order("name");
      if (error) throw error;
      return data || [];
    },
    enabled: !!profile,
  });

  const staff = staffQuery.data || [];

  // Returns the new staff member's id. Callers that only create a member can
  // ignore it; the per-staff services editor needs it because the composite FK
  // on provider_staff_services requires the staff row to exist before any
  // assignment row can reference it.
  const createStaff = useMutation({
    mutationFn: async ({ name }: { name: string }) => {
      if (!profile) throw new Error("No provider profile");
      // Append to the end of the list. No reorder UI in v1 (the services
      // pattern has none either), so creation order is the display order.
      const nextOrder =
        staff.length > 0 ? Math.max(...staff.map(s => s.display_order)) + 1 : 0;
      const { data, error } = await supabase
        .from("provider_staff")
        .insert({ provider_id: profile.id, name, display_order: nextOrder })
        .select("id")
        .single();
      if (error) throw error;
      return data.id as string;
    },
    onSuccess: invalidateStaffCaches,
  });

  const renameStaff = useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      if (!profile) throw new Error("No provider profile");
      const { error } = await supabase
        .from("provider_staff")
        .update({ name })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidateStaffCaches,
  });

  // Soft delete / restore. is_active=false hides the member from future
  // bookable lists (later phases) while keeping the row for booking history.
  const setStaffActive = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      if (!profile) throw new Error("No provider profile");
      const { error } = await supabase
        .from("provider_staff")
        .update({ is_active })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidateStaffCaches,
  });

  return {
    staff,
    activeStaff: staff.filter(s => s.is_active),
    isLoading: staffQuery.isLoading,
    error: staffQuery.error,
    createStaff,
    renameStaff,
    setStaffActive,
  };
}

// Customer-side read of a provider's ACTIVE staff (Phase 4 booking flow).
// provider_staff has public SELECT RLS, so this works pre-auth like the other
// "-public" queries. `enabled` should be provider.staffEnabled so NON-staff
// providers never fire this query at all.
export function useProviderActiveStaff(providerId: string | undefined, enabled: boolean) {
  const query = useQuery({
    queryKey: ["provider-staff-public", providerId],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      if (!providerId) return [];
      const { data, error } = await supabase
        .from("provider_staff")
        .select("id, name, display_order")
        .eq("provider_id", providerId)
        .eq("is_active", true)
        .order("display_order")
        .order("name");
      if (error) throw error;
      return data || [];
    },
    enabled: !!providerId && enabled,
  });
  return { activeStaff: query.data || [], isLoading: query.isLoading };
}

// Booking-side read of a provider's per-staff service assignments
// (per-staff-services Phase 3). The customer picker and the walk-in sheet both
// mount this; useProviderStaffServices is the OWNER-side twin used by the
// settings editor, and it invalidates this key too so an owner who edits
// assignments sees the change in their own walk-in sheet immediately.
//
// provider_staff_services has public SELECT RLS ("Anyone can view staff
// services"), exactly like provider_staff, so this works pre-auth. `enabled`
// should be provider.staffEnabled — a provider who never turned staff on fires
// no query at all, and one who never opened the assignment UI gets an empty
// array, an empty map, and therefore no filtering (see eligibleStaffForService).
//
// ONE query for the whole provider rather than one per service: the table holds
// a handful of rows per provider, and a per-service key would refetch every time
// the customer changed their mind about the service.
export function useProviderStaffAssignments(providerId: string | undefined, enabled: boolean) {
  const query = useQuery({
    queryKey: ["provider-staff-services-public", providerId],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      if (!providerId) return [];
      const { data, error } = await supabase
        .from("provider_staff_services")
        .select("staff_id, service_id")
        .eq("provider_id", providerId);
      if (error) throw error;
      return data || [];
    },
    enabled: !!providerId && enabled,
  });

  const rows = query.data;

  // staff_id → Set(service_id). Built with useMemo so the identity is stable
  // across renders: both callers derive their staff list from it on every
  // render, and a fresh Map each time would defeat that.
  const servicesByStaff = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const row of rows || []) {
      const set = map.get(row.staff_id) ?? new Set<string>();
      set.add(row.service_id);
      map.set(row.staff_id, set);
    }
    return map;
  }, [rows]);

  return { servicesByStaff, isLoading: query.isLoading };
}
