import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export function useProviderProfile() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const profileQuery = useQuery({
    queryKey: ["provider-profile", user?.id],
    queryFn: async () => {
      if (!user) return null;
      const { data, error } = await supabase
        .from("provider_profiles")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  const upsertProfile = useMutation({
    mutationFn: async (values: {
      business_name: string;
      category: string;
      address: string;
      about: string;
      phone: string;
    }) => {
      if (!user) throw new Error("Not authenticated");
      
      if (profileQuery.data) {
        const { error } = await supabase
          .from("provider_profiles")
          .update(values)
          .eq("user_id", user.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("provider_profiles")
          .insert({ ...values, user_id: user.id });
        if (error) throw error;

        // Also assign provider role
        const { error: roleError } = await supabase
          .from("user_roles")
          .insert({ user_id: user.id, role: "provider" });
        if (roleError && !roleError.message.includes("duplicate")) throw roleError;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["provider-profile"] });
      queryClient.invalidateQueries({ queryKey: ["user-roles"] });
    },
  });

  return { profile: profileQuery.data, isLoading: profileQuery.isLoading, upsertProfile };
}

export function useIsProvider() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["user-roles", user?.id],
    queryFn: async () => {
      if (!user) return false;
      const { data } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .eq("role", "provider");
      return (data && data.length > 0) || false;
    },
    enabled: !!user,
  });
}
