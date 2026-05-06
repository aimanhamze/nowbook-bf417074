import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export function useUserReviewEligibility(providerId: string | undefined) {
  const { user } = useAuth();
  const userId = user?.id;

  const bookingsQuery = useQuery({
    queryKey: ["user-bookings-for-provider", userId, providerId],
    enabled: !!userId && !!providerId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bookings")
        .select("id, booking_date, booking_time")
        .eq("user_id", userId!)
        .eq("provider_id", providerId!)
        .eq("status", "confirmed")
        .order("booking_date", { ascending: false })
        .order("booking_time", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  const reviewsQuery = useQuery({
    queryKey: ["user-reviews-for-provider", userId, providerId],
    enabled: !!userId && !!providerId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("reviews")
        .select("booking_id")
        .eq("user_id", userId!)
        .eq("provider_id", providerId!);
      if (error) throw error;
      return new Set((data || []).map(r => r.booking_id).filter(Boolean) as string[]);
    },
  });

  const isLoading = bookingsQuery.isLoading || reviewsQuery.isLoading;

  if (!userId || !providerId || isLoading) {
    return { eligibleBookingId: null, isLoading };
  }

  const reviewedIds = reviewsQuery.data ?? new Set<string>();
  const now = new Date();

  const eligible = (bookingsQuery.data ?? []).find(b => {
    const bookingDateTime = new Date(`${b.booking_date}T${b.booking_time}:00`);
    return bookingDateTime < now && !reviewedIds.has(b.id);
  });

  return { eligibleBookingId: eligible?.id ?? null, isLoading: false };
}
