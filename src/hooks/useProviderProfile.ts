import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import type { SocialLinks } from "@/lib/socialLinks";

export function useProviderProfile() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const profileQuery = useQuery({
    queryKey: ["provider-profile", user?.id],
    staleTime: 5 * 60 * 1000,
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
      social_links: SocialLinks | null;
      latitude?: number | null;
      longitude?: number | null;
    }) => {
      if (!user) throw new Error("Not authenticated");

      const { error } = await supabase
        .from("provider_profiles")
        .update(values)
        .eq("user_id", user.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["provider-profile", user?.id] });
      queryClient.invalidateQueries({ queryKey: ["all-providers"] });
    },
  });

  const updateBookingApproval = useMutation({
    mutationFn: async (value: boolean) => {
      if (!user) throw new Error("Not authenticated");
      const { error } = await supabase
        .from("provider_profiles")
        .update({ requires_booking_approval: value })
        .eq("user_id", user.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["provider-profile", user?.id] });
      queryClient.invalidateQueries({ queryKey: ["all-providers"] });
    },
  });

  const updateTreatmentNotesEnabled = useMutation({
    mutationFn: async (value: boolean) => {
      if (!user) throw new Error("Not authenticated");
      const { error } = await supabase
        .from("provider_profiles")
        .update({ treatment_notes_enabled: value })
        .eq("user_id", user.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["provider-profile", user?.id] });
    },
  });

  const updateShowPrices = useMutation({
    mutationFn: async (value: boolean) => {
      if (!user) throw new Error("Not authenticated");
      const { error } = await supabase
        .from("provider_profiles")
        .update({ show_prices: value })
        .eq("user_id", user.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["provider-profile", user?.id] });
      queryClient.invalidateQueries({ queryKey: ["all-providers"] });
    },
  });

  const updateMinLeadTime = useMutation({
    mutationFn: async (value: number) => {
      if (!user) throw new Error("Not authenticated");
      const { error } = await supabase
        .from("provider_profiles")
        .update({ min_lead_time_minutes: value })
        .eq("user_id", user.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["provider-profile", user?.id] });
    },
  });

  const updateBookingWindow = useMutation({
    mutationFn: async (value: number) => {
      if (!user) throw new Error("Not authenticated");
      const { error } = await supabase
        .from("provider_profiles")
        .update({ booking_window_days: value })
        .eq("user_id", user.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["provider-profile", user?.id] });
    },
  });

  const updateWhatsAppTemplates = useMutation({
    mutationFn: async (values: { deposit_message_template?: string; reminder_message_template?: string }) => {
      if (!user) throw new Error("Not authenticated");
      const { error } = await supabase
        .from("provider_profiles")
        .update(values)
        .eq("user_id", user.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["provider-profile", user?.id] });
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
      queryClient.invalidateQueries({ queryKey: ["provider-profile", user?.id] });
      queryClient.invalidateQueries({ queryKey: ["all-providers"] });
    },
  });

  const uploadAvatarImage = useMutation({
    mutationFn: async (file: File) => {
      if (!user) throw new Error("Not authenticated");

      const extension = file.name.split(".").pop() || "jpg";
      const filePath = `${user.id}/avatar-${Date.now()}.${extension}`;

      const { error: uploadError } = await supabase.storage
        .from("provider-images")
        .upload(filePath, file, { upsert: true, cacheControl: "3600" });
      if (uploadError) throw uploadError;

      const { data: publicUrlData } = supabase.storage
        .from("provider-images")
        .getPublicUrl(filePath);

      const { error: updateError } = await supabase
        .from("provider_profiles")
        .upsert({ user_id: user.id, avatar_image: publicUrlData.publicUrl }, { onConflict: "user_id" });
      if (updateError) throw updateError;

      return publicUrlData.publicUrl;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["provider-profile", user?.id] });
      queryClient.invalidateQueries({ queryKey: ["all-providers"] });
    },
  });

  return {
    profile: profileQuery.data,
    isLoading: profileQuery.isLoading,
    error: profileQuery.error,
    upsertProfile,
    updateBookingApproval,
    updateTreatmentNotesEnabled,
    updateShowPrices,
    updateMinLeadTime,
    updateBookingWindow,
    updateWhatsAppTemplates,
    uploadCoverImage,
    uploadAvatarImage,
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
