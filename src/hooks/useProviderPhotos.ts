import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useProviderProfile } from "@/hooks/useProviderProfile";

export interface ProviderPhoto {
  id: string;
  provider_id: string;
  url: string;
  caption: string | null;
  sort_order: number;
  created_at: string;
}

const MAX_PHOTOS = 20;

export function useProviderPhotos() {
  const { user } = useAuth();
  const { profile } = useProviderProfile();
  const queryClient = useQueryClient();
  const providerId = profile?.id;

  const photosQuery = useQuery({
    queryKey: ["provider-photos", providerId],
    queryFn: async () => {
      if (!providerId) return [];
      const { data, error } = await supabase
        .from("provider_photos" as any)
        .select("*")
        .eq("provider_id", providerId)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true });
      if (error) throw error;
      console.log("[photos] fetched:", data);
      return (data ?? []) as ProviderPhoto[];
    },
    enabled: !!providerId,
  });

  const uploadPhoto = useMutation({
    mutationFn: async ({ file, caption }: { file: File; caption?: string }) => {
      if (!user || !providerId) throw new Error("Not authenticated");
      const currentCount = photosQuery.data?.length ?? 0;
      if (currentCount >= MAX_PHOTOS) throw new Error("MAX_PHOTOS");

      const ext = file.name.split(".").pop() || "jpg";
      const filePath = `${user.id}/${Date.now()}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from("provider-photos")
        .upload(filePath, file, { cacheControl: "3600", contentType: file.type });
      if (uploadError) throw uploadError;

      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
      const publicUrl = `${supabaseUrl}/storage/v1/object/public/provider-photos/${filePath}`;

      console.log("[upload] filePath:", filePath);
      console.log("[upload] publicUrl:", publicUrl);

      const nextOrder = currentCount;
      const { error: insertError } = await supabase
        .from("provider_photos" as any)
        .insert({
          provider_id: providerId,
          url: publicUrl,
          caption: caption?.trim() || null,
          sort_order: nextOrder,
        });
      if (insertError) throw insertError;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["provider-photos", providerId] });
    },
  });

  const deletePhoto = useMutation({
    mutationFn: async (photoId: string) => {
      const { error } = await supabase
        .from("provider_photos" as any)
        .delete()
        .eq("id", photoId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["provider-photos", providerId] });
    },
  });

  const reorderPhotos = useMutation({
    mutationFn: async (orderedIds: string[]) => {
      const updates = orderedIds.map((id, index) => ({ id, sort_order: index }));
      for (const update of updates) {
        const { error } = await supabase
          .from("provider_photos" as any)
          .update({ sort_order: update.sort_order })
          .eq("id", update.id);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["provider-photos", providerId] });
    },
  });

  return {
    photos: photosQuery.data ?? [],
    isLoading: photosQuery.isLoading,
    uploadPhoto,
    deletePhoto,
    reorderPhotos,
    maxPhotos: MAX_PHOTOS,
  };
}

export function usePublicProviderPhotos(providerId: string | undefined) {
  return useQuery({
    queryKey: ["provider-photos", providerId],
    queryFn: async () => {
      if (!providerId) return [];
      const { data, error } = await supabase
        .from("provider_photos" as any)
        .select("*")
        .eq("provider_id", providerId)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as ProviderPhoto[];
    },
    enabled: !!providerId,
  });
}
