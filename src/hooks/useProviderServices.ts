import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useProviderProfile } from "./useProviderProfile";
import { normalizeColor } from "@/lib/serviceColors";
import { deleteServiceImage, uploadServiceImage } from "@/lib/serviceImage";

// Local YYYY-MM-DD — mirrors toLocalDateStr in useAllProviders. Kept local to
// avoid a cross-module import; booking_date comparisons must use local dates.
function toLocalDateStr(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// `enabled` (default true — every existing caller is unchanged) lets a caller
// that only *conditionally* needs the service list avoid firing the query at
// all. Used by the Staff page roster, which needs services only once the
// provider has staff members: a provider with none must not gain a fetch it
// did not make before.
export function useProviderServices(enabled = true) {
  const { user } = useAuth();
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
    enabled: !!profile && enabled,
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
      // Service image (provider_services.image_url). imageFile = upload and
      // replace; removeImage = clear. current_image_url is the stored value the
      // form opened with, so the old file can be deleted once replaced/cleared.
      imageFile?: File | null;
      removeImage?: boolean;
      current_image_url?: string | null;
    }): Promise<{ id: string; imageError: boolean }> => {
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
      let id: string;
      if (service.id) {
        const { error } = await supabase
          .from("provider_services")
          .update(payload)
          .eq("id", service.id);
        if (error) throw error;
        id = service.id;
      } else {
        // The image path embeds the service id, so a new service must exist
        // before its image can be uploaded.
        const { data, error } = await supabase
          .from("provider_services")
          .insert({ provider_id: profile.id, ...payload })
          .select("id")
          .single();
        if (error) throw error;
        id = data.id;
      }

      // Image step runs AFTER the service is saved and never fails the save:
      // the service row is already written, so an image failure is reported
      // back (imageError) instead of thrown — a throw here would leave a new
      // service's sheet open with no id, and a retry would insert a duplicate.
      const oldUrl = service.current_image_url ?? null;
      if (service.imageFile && user) {
        let newUrl: string | null = null;
        try {
          newUrl = await uploadServiceImage({ userId: user.id, serviceId: id, file: service.imageFile });
          // image_url is not in types.ts yet (typed-here-before-regen).
          const { error } = await supabase
            .from("provider_services")
            .update({ image_url: newUrl } as never)
            .eq("id", id);
          if (error) throw error;
        } catch (err) {
          console.error("[service-image] upload failed:", err);
          // Uploaded but not linked: remove the stray file. Old image untouched.
          if (newUrl) await deleteServiceImage(newUrl, user.id);
          return { id, imageError: true };
        }
        // New image is live; only now is it safe to drop the old file.
        if (oldUrl && oldUrl !== newUrl) await deleteServiceImage(oldUrl, user.id);
      } else if (service.removeImage && oldUrl && user) {
        const { error } = await supabase
          .from("provider_services")
          .update({ image_url: null } as never)
          .eq("id", id);
        if (error) {
          console.error("[service-image] remove failed:", error);
          return { id, imageError: true };
        }
        await deleteServiceImage(oldUrl, user.id);
      }
      return { id, imageError: false };
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
