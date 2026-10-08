import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { useAuth } from "@/contexts/AuthContext";
import { bookingDateTime } from "@/lib/bookingActions";

/** Today as "YYYY-MM-DD" in the device's zone — the same zone bookingDateTime
 *  reads booking_date/booking_time in, so the two filters agree. */
function todayYmd(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export type UpcomingBooking = Tables<"bookings"> & { staff: { name: string } | null };

/**
 * The signed-in customer's upcoming bookings at ONE provider, soonest first —
 * for the appointment card on the provider page.
 *
 * One query, and none at all for a visitor, a provider or an admin. Includes
 * provider-created walk-ins linked to the customer (linked_user_id), same as
 * /bookings. "Upcoming" is the /bookings Upcoming-tab rule: confirmed or
 * pending AND not yet started — so an appointment earlier today drops off.
 *
 * The staff name rides along in the same request (bookings_staff_id_provider_id_fkey
 * embed; provider_staff is public-read, and inactive staff still resolve).
 *
 * The key lives under ["bookings", ...], so the shared cancel and reschedule
 * code refreshes it with no extra wiring.
 */
export function useMyUpcomingAt(providerId: string | undefined) {
  const { user, isProvider, isAdmin, roleLoading } = useAuth();
  const enabled = !!user && !!providerId && !roleLoading && !isProvider && !isAdmin;

  return useQuery({
    queryKey: ["bookings", "upcoming-at", user?.id, providerId],
    enabled,
    queryFn: async (): Promise<UpcomingBooking[]> => {
      if (!user || !providerId) return [];
      const { data, error } = await supabase
        .from("bookings")
        .select("*, staff:provider_staff(name)")
        .eq("provider_id", providerId)
        .or(`user_id.eq.${user.id},linked_user_id.eq.${user.id}`)
        .in("status", ["confirmed", "pending"])
        .gte("booking_date", todayYmd())
        .order("booking_date", { ascending: true })
        .order("booking_time", { ascending: true })
        .limit(20);
      if (error) throw error;
      const now = Date.now();
      const rows = Array.from(new Map(((data || []) as UpcomingBooking[]).map((b) => [b.id, b])).values());
      return rows.filter((b) => bookingDateTime(b).getTime() >= now);
    },
  });
}
