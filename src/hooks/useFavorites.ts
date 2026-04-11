import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export function useFavorites() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["favorites", user?.id],
    staleTime: 2 * 60 * 1000,
    queryFn: async () => {
      if (!user) return [];
      const { data, error } = await supabase
        .from("favorites")
        .select("provider_id")
        .eq("user_id", user.id);
      if (error) throw error;
      return (data || []).map((f) => f.provider_id);
    },
    enabled: !!user,
  });

  const favoriteIds: string[] = query.data ?? [];
  const isLoading = query.isLoading;

  const toggleFavorite = useMutation({
    mutationFn: async (providerId: string) => {
      if (!user) throw new Error("Not authenticated");
      const isFav = favoriteIds.includes(providerId);
      if (isFav) {
        const { error } = await supabase
          .from("favorites")
          .delete()
          .eq("user_id", user.id)
          .eq("provider_id", providerId);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("favorites")
          .insert({ user_id: user.id, provider_id: providerId });
        if (error) throw error;
      }
    },
    onMutate: async (providerId: string) => {
      await queryClient.cancelQueries({ queryKey: ["favorites", user?.id] });
      const previous = queryClient.getQueryData<string[]>(["favorites", user?.id]);
      queryClient.setQueryData<string[]>(["favorites", user?.id], (old = []) =>
        old.includes(providerId)
          ? old.filter((id) => id !== providerId)
          : [...old, providerId]
      );
      return { previous };
    },
    onError: (_err, _providerId, context) => {
      if (context?.previous !== undefined) {
        queryClient.setQueryData(["favorites", user?.id], context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["favorites", user?.id] });
    },
  });

  const isFavorite = (providerId: string) => favoriteIds.includes(providerId);

  return { favoriteIds, isFavorite, toggleFavorite, isLoading, error: query.error };

}
