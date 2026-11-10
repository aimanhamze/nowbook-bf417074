import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { useProviderProfile } from "./useProviderProfile";
import {
  academyFrom,
  type AcademyInstructorRow,
  type AcademyInstructorUpdate,
} from "@/integrations/supabase/academyTypes";
import { deleteAcademyImage, uploadAcademyImage } from "@/lib/academyImage";

/**
 * Provider-side instructor CRUD for an academy branch. Mirrors useProviderStaff:
 * one owner-scoped query plus small single-purpose mutations. Instructors are
 * never hard-deleted from the UI (academy_courses references them with a
 * NO ACTION FK); they are deactivated instead, which only stops them being
 * picked for new courses.
 */
export const ACADEMY_INSTRUCTORS_KEY = "academy-instructors";

/** `enabled = false` (the setup hub for non-academy branches) fetches nothing. */
export function useAcademyInstructors(enabled = true) {
  const { user } = useAuth();
  const { profile } = useProviderProfile();
  const queryClient = useQueryClient();
  const providerId = profile?.id;

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: [ACADEMY_INSTRUCTORS_KEY] });
  };

  const query = useQuery({
    queryKey: [ACADEMY_INSTRUCTORS_KEY, providerId],
    staleTime: 5 * 60 * 1000,
    enabled: !!providerId && enabled,
    queryFn: async (): Promise<AcademyInstructorRow[]> => {
      if (!providerId) return [];
      const { data, error } = await academyFrom("academy_instructors")
        .select("*")
        .eq("provider_id", providerId)
        .order("display_order")
        .order("name");
      if (error) throw error;
      return (data ?? []) as unknown as AcademyInstructorRow[];
    },
  });

  const instructors = query.data ?? [];

  const createInstructor = useMutation({
    mutationFn: async ({ name }: { name: string }): Promise<string> => {
      if (!providerId) throw new Error("No provider profile");
      const nextOrder = instructors.length > 0 ? Math.max(...instructors.map((i) => i.display_order)) + 1 : 0;
      const { data, error } = await academyFrom("academy_instructors")
        .insert({ provider_id: providerId, name, display_order: nextOrder })
        .select("id")
        .single();
      if (error) throw error;
      return (data as unknown as { id: string }).id;
    },
    onSuccess: invalidate,
  });

  const updateInstructor = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: AcademyInstructorUpdate }) => {
      const { error } = await academyFrom("academy_instructors").update(patch).eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  /** Upload first, then link, then (best effort) remove the old file. */
  const setInstructorPhoto = useMutation({
    mutationFn: async ({ id, file }: { id: string; file: File }) => {
      if (!user) throw new Error("Not signed in");
      const old = instructors.find((i) => i.id === id)?.photo_url ?? null;
      const url = await uploadAcademyImage({ userId: user.id, kind: "instructor", id, file });
      const { error } = await academyFrom("academy_instructors").update({ photo_url: url }).eq("id", id);
      if (error) {
        await deleteAcademyImage(url, user.id, "instructor");
        throw error;
      }
      if (old && old !== url) await deleteAcademyImage(old, user.id, "instructor");
    },
    onSuccess: invalidate,
  });

  const removeInstructorPhoto = useMutation({
    mutationFn: async ({ id }: { id: string }) => {
      if (!user) throw new Error("Not signed in");
      const old = instructors.find((i) => i.id === id)?.photo_url ?? null;
      const { error } = await academyFrom("academy_instructors").update({ photo_url: null }).eq("id", id);
      if (error) throw error;
      if (old) await deleteAcademyImage(old, user.id, "instructor");
    },
    onSuccess: invalidate,
  });

  return {
    instructors,
    activeInstructors: instructors.filter((i) => i.is_active),
    isLoading: query.isLoading,
    error: query.error,
    createInstructor,
    updateInstructor,
    setInstructorPhoto,
    removeInstructorPhoto,
  };
}
