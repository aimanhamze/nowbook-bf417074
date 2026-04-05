import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useProviderProfile } from "./useProviderProfile";

export interface EnrichedBooking {
  id: string;
  user_id: string;
  provider_id: string;
  service_ids: string[];
  booking_date: string;
  booking_time: string;
  total_price: number;
  status: string;
  created_at: string;
  updated_at: string;
  customer_name: string | null;
  customer_phone: string | null;
  customer_avatar: string | null;
  service_names: string[];
}

export function useProviderBookings() {
  const { profile } = useProviderProfile();

  return useQuery({
    queryKey: ["provider-bookings-enriched", profile?.id],
    queryFn: async () => {
      if (!profile) return [];

      const { data: bookings, error } = await supabase
        .from("bookings")
        .select("*")
        .eq("provider_id", profile.id)
        .in("status", ["confirmed", "pending"])
        .order("booking_date", { ascending: true });
      if (error) throw error;
      if (!bookings || bookings.length === 0) return [];

      const userIds = [...new Set(bookings.map((b) => b.user_id))];
      const { data: profiles } = await supabase
        .from("profiles")
        .select("user_id, display_name, phone, avatar_url")
        .in("user_id", userIds);

      const { data: services } = await supabase
        .from("provider_services")
        .select("id, name")
        .eq("provider_id", profile.id);

      const profileMap = new Map(
        (profiles || []).map((p) => [p.user_id, p])
      );
      const serviceMap = new Map(
        (services || []).map((s) => [s.id, s.name])
      );

      return bookings.map((b): EnrichedBooking => {
        const customer = profileMap.get(b.user_id);
        return {
          ...b,
          customer_name: customer?.display_name || null,
          customer_phone: customer?.phone || null,
          customer_avatar: customer?.avatar_url || null,
          service_names: b.service_ids.map((id) => serviceMap.get(id) || id),
        };
      });
    },
    enabled: !!profile,
  });
}

export function useCancelBooking() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (bookingId: string) => {
      // Get booking details before cancelling to notify the customer
      const { data: booking } = await supabase
        .from("bookings")
        .select("user_id, booking_date, booking_time, provider_id")
        .eq("id", bookingId)
        .single();

      const { error } = await supabase
        .from("bookings")
        .update({ status: "cancelled" })
        .eq("id", bookingId);
      if (error) throw error;

      // Notify customer about cancellation
      if (booking) {
        // Get provider name
        const { data: provider } = await supabase
          .from("provider_profiles")
          .select("business_name")
          .eq("id", booking.provider_id)
          .single();

        supabase.functions.invoke("notify-user", {
          body: {
            user_id: booking.user_id,
            title: "התור בוטל ❌",
            body: `התור ב-${provider?.business_name || "העסק"} בתאריך ${booking.booking_date} בשעה ${booking.booking_time} בוטל על ידי הספק`,
            url: "/bookings",
          },
        }).catch((err) => console.error("Push to customer failed:", err));
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["provider-bookings-enriched"] });
    },
  });
}

export function useDeleteBooking() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (bookingId: string) => {
      const { error } = await supabase
        .from("bookings")
        .delete()
        .eq("id", bookingId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["provider-bookings-enriched"] });
    },
  });
}
