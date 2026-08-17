import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useProviderProfile } from "./useProviderProfile";
import {
  notifyBookingConfirmed,
  notifyBookingCancelled,
  notifyBookingsCancelled,
} from "@/lib/whatsappConfirm";

export interface EnrichedBooking {
  id: string;
  user_id: string | null;
  /**
   * Set by the link_walkin_to_account trigger when a provider-created walk-in's
   * phone unambiguously matches one registered profile. Carried through so
   * lib/customerKey can fold a linked walk-in into that account's identity
   * instead of counting the same person twice.
   */
  linked_user_id: string | null;
  provider_id: string;
  service_ids: string[];
  booking_date: string;
  booking_time: string;
  total_price: number;
  status: string;
  treatment_notes: string | null;
  customer_notes: string | null;
  created_at: string;
  updated_at: string;
  customer_name: string | null;
  customer_phone: string | null;
  customer_avatar: string | null;
  service_names: string[];
  is_group_service: boolean;
  service_capacity: number;
  class_schedule_id: string | null;
  class_name: string | null;
  // Multi-staff (Phase 6): which staff member serves this booking. NULL for
  // non-staff providers, group/class bookings, and everything pre-staff.
  staff_id: string | null;
  staff_name: string | null;
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
        .in("status", ["confirmed", "pending", "cancelled"])
        .order("booking_date", { ascending: true });
      if (error) throw error;
      if (!bookings || bookings.length === 0) return [];

      // Walk-in bookings have user_id IS NULL — exclude those from the profiles lookup.
      const userIds = [...new Set(bookings.map((b) => b.user_id).filter(Boolean))];
      const { data: profiles } = await supabase
        .from("profiles")
        .select("user_id, display_name, phone, avatar_url")
        .in("user_id", userIds);

      const { data: services } = await supabase
        .from("provider_services")
        .select("id, name, service_type, max_capacity")
        .eq("provider_id", profile.id);

      const profileMap = new Map(
        (profiles || []).map((p) => [p.user_id, p])
      );
      const serviceMap = new Map(
        (services || []).map((s) => [s.id, s])
      );

      // Batch-fetch class names for any fitness_studio bookings
      const classIds = [...new Set(bookings.map((b) => b.class_schedule_id).filter(Boolean))] as string[];
      const { data: classRows } = classIds.length > 0
        ? await supabase.from("provider_class_schedule").select("id, class_name").in("id", classIds)
        : { data: [] };
      const classMap = new Map((classRows || []).map((c) => [c.id, c.class_name as string]));

      // Batch-fetch staff names (same pattern as classMap). Deliberately NOT
      // filtered to is_active: a deactivated staff member must still be named
      // on their past/existing bookings. Non-staff providers have staff_id
      // NULL on every row → no query fired.
      const staffIds = [...new Set(bookings.map((b) => b.staff_id).filter(Boolean))] as string[];
      const { data: staffRows } = staffIds.length > 0
        ? await supabase.from("provider_staff").select("id, name").in("id", staffIds)
        : { data: [] };
      const staffMap = new Map((staffRows || []).map((s) => [s.id, s.name as string]));

      return bookings.map((b): EnrichedBooking => {
        // Walk-in: user_id is null → profileMap lookup is skipped (no account).
        const customer = b.user_id ? profileMap.get(b.user_id) : undefined;
        const primaryService = serviceMap.get(b.service_ids?.[0]);
        // Walk-in bookings store the customer's details on the row; app bookings
        // leave these NULL and resolve via the profiles join above.
        return {
          ...b,
          treatment_notes: b.treatment_notes ?? null,
          customer_notes: b.customer_notes ?? null,
          customer_name: b.customer_name || customer?.display_name || null,
          customer_phone: b.customer_phone || customer?.phone || null,
          customer_avatar: customer?.avatar_url || null,
          service_names: (b.service_ids || []).map((id) => serviceMap.get(id)?.name || id),
          is_group_service: primaryService?.service_type === 'group',
          service_capacity: primaryService?.max_capacity ?? 1,
          class_schedule_id: b.class_schedule_id ?? null,
          class_name: b.class_schedule_id ? (classMap.get(b.class_schedule_id) ?? null) : null,
          linked_user_id: b.linked_user_id ?? null,
          staff_id: b.staff_id ?? null,
          staff_name: b.staff_id ? (staffMap.get(b.staff_id) ?? null) : null,
        };
      });
    },
    enabled: !!profile,
    refetchInterval: 30000,
  });
}

export function usePendingCount() {
  const { data: bookings = [] } = useProviderBookings();
  return bookings.filter((b) => b.status === "pending").length;
}

export function useCancelBooking() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (bookingId: string) => {
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

      // PROVIDER-initiated cancellation — the customer does not know yet, so
      // tell them. Fire-and-forget: never awaited, so a messaging failure cannot
      // block or fail the cancellation the provider just performed.
      notifyBookingCancelled(bookingId);

      if (booking) {
        const { data: provider } = await supabase
          .from("provider_profiles")
          .select("business_name")
          .eq("id", booking.provider_id)
          .single();

        await supabase.from("notifications").insert({
          user_id: booking.user_id,
          title: "התור בוטל ❌",
          body: `התור ב-${provider?.business_name || "העסק"} בתאריך ${booking.booking_date} בשעה ${booking.booking_time} בוטל על ידי הספק`,
          url: "/bookings",
          type: "booking_cancelled",
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["provider-bookings-enriched"] });
    },
  });
}

export function useCancelGroupClass() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (bookingIds: string[]) => {
      // Fetch all participant data before cancelling
      const { data: allBookings } = await supabase
        .from("bookings")
        .select("user_id, booking_date, booking_time, provider_id")
        .in("id", bookingIds);

      const { error } = await supabase
        .from("bookings")
        .update({ status: "cancelled" })
        .in("id", bookingIds);
      if (error) throw error;

      // Every participant needs telling. notifyBookingsCancelled paces the sends
      // ONE AT A TIME in a detached chain, so a single tap cancelling a whole
      // class never fires N concurrent SendPulse calls, and never delays this
      // mutation. A plain loop here would not serialise anything.
      notifyBookingsCancelled(bookingIds);

      if (allBookings?.length) {
        const first = allBookings[0];
        const { data: provider } = await supabase
          .from("provider_profiles")
          .select("business_name")
          .eq("id", first.provider_id)
          .single();

        await supabase.from("notifications").insert(
          allBookings.map(b => ({
            user_id: b.user_id,
            title: "השיעור בוטל ❌",
            body: `השיעור ב-${provider?.business_name || "העסק"} בתאריך ${first.booking_date} בשעה ${first.booking_time} בוטל`,
            url: "/bookings",
            type: "booking_cancelled",
          }))
        );
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

export function useApproveBooking() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (bookingId: string) => {
      const { data: booking } = await supabase
        .from("bookings")
        .select("user_id, booking_date, booking_time, provider_id")
        .eq("id", bookingId)
        .single();

      const { error } = await supabase
        .from("bookings")
        .update({ status: "confirmed" })
        .eq("id", bookingId);
      if (error) {
        console.error("Approve booking error:", error);
        throw error;
      }

      // The booking is now confirmed. Fire the WhatsApp confirmation as a side
      // effect — never awaited, so SendPulse being slow or down cannot delay or
      // fail the approval the provider just performed.
      notifyBookingConfirmed(bookingId);

      if (booking) {
        const { data: provider } = await supabase
          .from("provider_profiles")
          .select("business_name")
          .eq("id", booking.provider_id)
          .single();

        await supabase.from("notifications").insert({
          user_id: booking.user_id,
          title: "התור שלך אושר! 📅",
          body: `התור ב-${provider?.business_name || "העסק"} בתאריך ${booking.booking_date} בשעה ${booking.booking_time} אושר`,
          url: "/bookings",
          type: "booking_confirmed",
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["provider-bookings-enriched"] });
    },
  });
}

export function useRejectBooking() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (bookingId: string) => {
      const { data: booking } = await supabase
        .from("bookings")
        .select("user_id, booking_date, booking_time, provider_id")
        .eq("id", bookingId)
        .single();

      const { error } = await supabase
        .from("bookings")
        .update({ status: "cancelled" })
        .eq("id", bookingId);
      if (error) {
        console.error("Reject booking error:", error);
        throw error;
      }

      if (booking) {
        const { data: provider } = await supabase
          .from("provider_profiles")
          .select("business_name")
          .eq("id", booking.provider_id)
          .single();

        await supabase.from("notifications").insert({
          user_id: booking.user_id,
          title: "התור שלך נדחה ❌",
          body: `הבקשה ב-${provider?.business_name || "העסק"} לתאריך ${booking.booking_date} נדחתה. ניתן לקבוע תור חדש`,
          url: "/bookings",
          type: "booking_cancelled",
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["provider-bookings-enriched"] });
    },
  });
}

export function useRescheduleBooking() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ bookingId, newDate, newTime }: { bookingId: string; newDate: string; newTime: string }) => {
      const { data: booking } = await supabase
        .from("bookings")
        .select("user_id, provider_id")
        .eq("id", bookingId)
        .single();

      // Move the booking — only the timing changes. Status is deliberately left
      // untouched: reschedule is offered on confirmed bookings only, so this
      // keeps them confirmed (per spec) and never alters a booking's state. The
      // prevent_booking_conflicts trigger validates the new slot and raises on
      // overlap (surfaced to the caller as a "slot taken" error).
      const { error } = await supabase
        .from("bookings")
        .update({ booking_date: newDate, booking_time: newTime })
        .eq("id", bookingId);
      if (error) throw error;

      // Notify the customer. Walk-in bookings (user_id NULL) have no account to
      // notify — skip, exactly like the walk-in create flow.
      if (booking?.user_id) {
        const { data: provider } = await supabase
          .from("provider_profiles")
          .select("business_name")
          .eq("id", booking.provider_id)
          .single();

        await supabase.from("notifications").insert({
          user_id: booking.user_id,
          title: "התור שלך שונה! 📅",
          body: `התור ב-${provider?.business_name || "העסק"} שונה. התאריך החדש: ${newDate} בשעה ${newTime}`,
          url: "/bookings",
          type: "booking_confirmed",
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["provider-bookings-enriched"] });
      queryClient.invalidateQueries({ queryKey: ["provider-bookings-public"] });
    },
  });
}

export function useSaveTreatmentNote() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ bookingId, note }: { bookingId: string; note: string }) => {
      const { error } = await supabase
        .from("bookings")
        .update({ treatment_notes: note })
        .eq("id", bookingId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["provider-bookings-enriched"] });
    },
  });
}
