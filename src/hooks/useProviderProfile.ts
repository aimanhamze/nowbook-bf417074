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

      const { error } = await supabase
        .from("provider_profiles")
        .upsert({ ...values, user_id: user.id }, { onConflict: "user_id" });
      if (error) throw error;

      const { error: roleError } = await supabase
        .from("user_roles")
        .upsert({ user_id: user.id, role: "provider" }, { onConflict: "user_id,role" });
      if (roleError && !roleError.message.includes("duplicate")) throw roleError;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["provider-profile"] });
      queryClient.invalidateQueries({ queryKey: ["user-roles"] });
      queryClient.invalidateQueries({ queryKey: ["all-db-providers"] });
    },
  });

  const uploadCoverImage = useMutation({
    mutationFn: async (file: File) => {
      if (!user) throw new Error("Not authenticated");

      const extension = file.name.split(".").pop() || "jpg";
      const filePath = `${user.id}/cover-${Date.now()}.${extension}`;

      const { error: uploadError } = await supabase.storage
        .from("provider-images")
        .upload(filePath, file, { upsert: true, cacheControl: "3600" });
      if (uploadError) throw uploadError;

      const { data: publicUrlData } = supabase.storage
        .from("provider-images")
        .getPublicUrl(filePath);

      const { error: updateError } = await supabase
        .from("provider_profiles")
        .upsert({ user_id: user.id, cover_image: publicUrlData.publicUrl }, { onConflict: "user_id" });
      if (updateError) throw updateError;

      return publicUrlData.publicUrl;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["provider-profile"] });
      queryClient.invalidateQueries({ queryKey: ["all-db-providers"] });
    },
  });

  return {
    profile: profileQuery.data,
    isLoading: profileQuery.isLoading,
    upsertProfile,
    uploadCoverImage,
  };
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
