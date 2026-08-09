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
