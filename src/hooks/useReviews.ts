import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface Review {
  id: string;
  user_id: string;
  provider_id: string;
  booking_id: string | null;
  rating: number;
  comment: string | null;
  display_name: string | null;
  created_at: string;
}

export function useProviderReviews(providerId: string | undefined) {
  const q = useQuery({
    queryKey: ["reviews", providerId],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      if (!providerId) return [];
      const { data, error } = await supabase
        .from("reviews")
        .select("*")
        .eq("provider_id", providerId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as Review[];
    },
    enabled: !!providerId,
  });
  return { ...q, data: q.data ?? [], error: q.error };
}

export function useBookingReview(bookingId: string | undefined) {
  return useQuery({
    queryKey: ["review-by-booking", bookingId],
    queryFn: async () => {
      if (!bookingId) return null;
      const { data, error } = await supabase
        .from("reviews")
        .select("*")
        .eq("booking_id", bookingId)
        .maybeSingle();
      if (error) throw error;
      return data as Review | null;
    },
    enabled: !!bookingId,
  });
}

export function useSubmitReview() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (review: {
      user_id: string;
      provider_id: string;
      booking_id: string;
      rating: number;
      comment: string;
      display_name: string;
    }) => {
      const { data, error } = await supabase
        .from("reviews")
        .insert(review)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["reviews", data.provider_id] });
      queryClient.invalidateQueries({ queryKey: ["review-by-booking", data.booking_id] });
      queryClient.invalidateQueries({ queryKey: ["bookings"] });
    },
  });
}
