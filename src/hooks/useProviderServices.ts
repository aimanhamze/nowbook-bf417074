import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useProviderProfile } from "./useProviderProfile";
import { normalizeColor } from "@/lib/serviceColors";

// Local YYYY-MM-DD — mirrors toLocalDateStr in useAllProviders. Kept local to
// avoid a cross-module import; booking_date comparisons must use local dates.
function toLocalDateStr(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function useProviderServices() {
  const { profile } = useProviderProfile();
  const queryClient = useQueryClient();

  // A service write (incl. max_capacity) must refresh every cache that carries
  // service data, not just the provider's own list:
  //   • ["provider-services"]        → this dashboard list / openEdit
  //   • ["provider-services-public"] → useRealAvailability (customer slot logic)
  //   • ["all-providers"]            → provider.services[] used by the booking
  //                                    flow, ProviderDetail and Home
  // Without the latter two, the new capacity saves but the UI keeps showing the
  // stale value (e.g. 1) because those queries are never re-fetched.
  const invalidateServiceCaches = () => {
    queryClient.invalidateQueries({ queryKey: ["provider-services"] });
    queryClient.invalidateQueries({ queryKey: ["provider-services-public"] });
    queryClient.invalidateQueries({ queryKey: ["all-providers"] });
  };

  const servicesQuery = useQuery({
    queryKey: ["provider-services", profile?.id],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      if (!profile) return [];
      const { data, error } = await supabase
        .from("provider_services")
        .select("*")
        .eq("provider_id", profile.id)
        .eq("is_active", true)
        .order("sort_order");
      if (error) throw error;
      return data || [];
    },
    enabled: !!profile,
  });

  const upsertService = useMutation({
    mutationFn: async (service: {
      id?: string;
      name: string;
      duration: number;
      price: number;
      service_type: 'private' | 'group';
      max_capacity: number;
      scheduled_time?: string | null;
      latest_start_time?: string | null;
      customer_notes_enabled?: boolean;
      customer_notes_placeholder?: string | null;
      color?: string;
    }) => {
      if (!profile) throw new Error("No provider profile");
      const isFitness = profile.category === 'fitness_studio';
      // Group remains fitness-only. Private services (any provider) may now
      // carry a per-slot capacity (>= 1, default 1) without becoming a group:
      // 1 = ordinary single-customer service, higher = multiple customers can
      // book the same time. Capacity enforcement lives in the booking trigger.
      const resolvedType = isFitness ? service.service_type : 'private';
      const payload = {
        name: service.name,
        duration: service.duration,
        price: service.price,
        service_type: resolvedType,
        max_capacity: resolvedType === 'group'
          ? service.max_capacity
          : Math.max(1, service.max_capacity || 1),
        scheduled_time: service.scheduled_time || null,
        latest_start_time: service.latest_start_time || null,
        customer_notes_enabled: service.customer_notes_enabled ?? false,
        // Only persist placeholder text when notes are enabled; otherwise clear
        // it so a disabled service never carries a stale guidance string.
        customer_notes_placeholder: service.customer_notes_enabled
          ? (service.customer_notes_placeholder?.trim() || null)
          : null,
        // Calendar display color. Always normalised to a valid hex so the DB
        // CHECK can't reject a save, and kept even while the provider's master
        // colors switch is off (it only hides the picker, never wipes values).
        color: normalizeColor(service.color),
      };
      if (service.id) {
        const { error } = await supabase
          .from("provider_services")
          .update(payload)
          .eq("id", service.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("provider_services")
          .insert({ provider_id: profile.id, ...payload });
        if (error) throw error;
      }
    },
    onSuccess: invalidateServiceCaches,
  });

  // Lightweight single-column update for the "parallel services" toggle. Kept
  // separate from upsertService (which rewrites the whole row and doesn't carry
  // is_parallel) so checking a box never clobbers name/price/capacity. Same
  // table + provider-owns-own-service RLS path as upsertService/deleteService.
  const updateServiceParallel = useMutation({
    mutationFn: async ({ id, is_parallel }: { id: string; is_parallel: boolean }) => {
      if (!profile) throw new Error("No provider profile");
      const { error } = await supabase
        .from("provider_services")
        .update({ is_parallel })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidateServiceCaches,
  });

  // Soft-delete: never hard DELETE a service that may be referenced by past
  // bookings (orphans their service_names). First refuse the delete if any
  // FUTURE booking still references it; otherwise flip is_active=false so the
  // row survives for name resolution (useProviderBookings reads all services,
  // unfiltered) but disappears from every bookable list.
  const deleteService = useMutation({
    mutationFn: async (id: string) => {
      if (!profile) throw new Error("No provider profile");
      // Local YYYY-MM-DD, NOT toISOString — booking_date is stored as a local
      // calendar date and a UTC shift would mis-bucket the boundary day.
      const todayStr = toLocalDateStr(new Date());
      const { data: future, error: checkErr } = await supabase
        .from("bookings")
        .select("id")
        .eq("provider_id", profile.id)
        .contains("service_ids", [id])
        .gte("booking_date", todayStr)
        .in("status", ["confirmed", "pending"])
        .limit(1);
      if (checkErr) throw checkErr;
      if (future && future.length > 0) throw new Error("HAS_FUTURE_BOOKINGS");

      const { error } = await supabase
        .from("provider_services")
        .update({ is_active: false })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidateServiceCaches,
  });

  return { services: servicesQuery.data || [], isLoading: servicesQuery.isLoading, error: servicesQuery.error, upsertService, updateServiceParallel, deleteService };
}
