import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { useProviderProfile } from "./useProviderProfile";
import {
  academyFrom,
  type AcademyCourseRow,
  type AcademyCourseSessionRow,
  type AcademyCourseWrite,
  type AcademySessionWrite,
} from "@/integrations/supabase/academyTypes";
import { deleteAcademyImage, uploadAcademyImage } from "@/lib/academyImage";
import { sortSessions } from "@/lib/academySessions";

/**
 * Provider-side course and session CRUD for an academy branch.
 *
 * The database enforces every rule (instructor of this branch and active,
 * location consistency, seats/price/hours bounds, no instructor overlap,
 * category = academy); these mutations just write and let errors surface to
 * lib/academyErrors for a friendly message.
 *
 * Sessions are inserted WITHOUT provider_id / instructor_id: a trigger copies
 * both from the course, and anything the client sent would be overwritten.
 * A multi-row insert is one statement, so if any date overlaps the
 * instructor's other sessions the whole batch is refused (23P01) — the
 * provider never ends up with half a schedule.
 */
export const ACADEMY_COURSES_KEY = "academy-courses";
export const ACADEMY_SESSIONS_KEY = "academy-sessions";

export interface SaveCourseInput {
  id?: string;
  values: AcademyCourseWrite;
  imageFile?: File | null;
  removeImage?: boolean;
}

export interface SaveCourseResult {
  id: string;
  /** The row saved but the image step failed; the caller reports it. */
  imageError?: unknown;
}

/** `enabled = false` (the setup hub for non-academy branches) fetches nothing. */
export function useAcademyCourses(enabled = true) {
  const { user } = useAuth();
  const { profile } = useProviderProfile();
  const queryClient = useQueryClient();
  const providerId = profile?.id;

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: [ACADEMY_COURSES_KEY] });
    queryClient.invalidateQueries({ queryKey: [ACADEMY_SESSIONS_KEY] });
  };

  const coursesQuery = useQuery({
    queryKey: [ACADEMY_COURSES_KEY, providerId],
    staleTime: 2 * 60 * 1000,
    enabled: !!providerId && enabled,
    queryFn: async (): Promise<AcademyCourseRow[]> => {
      if (!providerId) return [];
      const { data, error } = await academyFrom("academy_courses")
        .select("*")
        .eq("provider_id", providerId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as AcademyCourseRow[];
    },
  });

  const sessionsQuery = useQuery({
    queryKey: [ACADEMY_SESSIONS_KEY, providerId],
    staleTime: 2 * 60 * 1000,
    enabled: !!providerId && enabled,
    queryFn: async (): Promise<AcademyCourseSessionRow[]> => {
      if (!providerId) return [];
      const { data, error } = await academyFrom("academy_course_sessions")
        .select("*")
        .eq("provider_id", providerId)
        .order("session_date")
        .order("start_time");
      if (error) throw error;
      return (data ?? []) as unknown as AcademyCourseSessionRow[];
    },
  });

  const courses = coursesQuery.data ?? [];
  const sessionRows = sessionsQuery.data;

  const sessionsByCourse = useMemo(() => {
    const map = new Map<string, AcademyCourseSessionRow[]>();
    for (const s of sessionRows ?? []) {
      const list = map.get(s.course_id) ?? [];
      list.push(s);
      map.set(s.course_id, list);
    }
    for (const [k, v] of map) map.set(k, sortSessions(v));
    return map;
  }, [sessionRows]);

  const saveCourse = useMutation({
    mutationFn: async ({ id, values, imageFile, removeImage }: SaveCourseInput): Promise<SaveCourseResult> => {
      if (!providerId) throw new Error("No provider profile");
      let courseId = id;
      const previous = id ? courses.find((c) => c.id === id) : undefined;

      if (courseId) {
        const { error } = await academyFrom("academy_courses").update(values).eq("id", courseId);
        if (error) throw error;
      } else {
        const { data, error } = await academyFrom("academy_courses")
          .insert({ provider_id: providerId, ...values })
          .select("id")
          .single();
        if (error) throw error;
        courseId = (data as unknown as { id: string }).id;
      }

      // Image second, so a failed upload never loses the course itself and a
      // retry never re-inserts it. Reported, not thrown.
      if (!user) return { id: courseId };
      try {
        if (imageFile) {
          const url = await uploadAcademyImage({ userId: user.id, kind: "course", id: courseId, file: imageFile });
          const { error } = await academyFrom("academy_courses").update({ image_url: url }).eq("id", courseId);
          if (error) {
            await deleteAcademyImage(url, user.id, "course");
            throw error;
          }
          if (previous?.image_url && previous.image_url !== url) {
            await deleteAcademyImage(previous.image_url, user.id, "course");
          }
        } else if (removeImage && previous?.image_url) {
          const { error } = await academyFrom("academy_courses").update({ image_url: null }).eq("id", courseId);
          if (error) throw error;
          await deleteAcademyImage(previous.image_url, user.id, "course");
        }
      } catch (imageError) {
        return { id: courseId, imageError };
      }
      return { id: courseId };
    },
    onSettled: invalidate,
  });

  /** Cascades to the course's sessions and registrations (DB FKs). */
  const deleteCourse = useMutation({
    mutationFn: async ({ id }: { id: string }) => {
      const previous = courses.find((c) => c.id === id);
      const { error } = await academyFrom("academy_courses").delete().eq("id", id);
      if (error) throw error;
      if (user && previous?.image_url) await deleteAcademyImage(previous.image_url, user.id, "course");
    },
    onSuccess: invalidate,
  });

  const addSessions = useMutation({
    mutationFn: async ({ courseId, sessions }: { courseId: string; sessions: AcademySessionWrite[] }) => {
      if (sessions.length === 0) return 0;
      const { error } = await academyFrom("academy_course_sessions").insert(
        sessions.map((s) => ({ course_id: courseId, ...s })),
      );
      if (error) throw error;
      return sessions.length;
    },
    onSuccess: invalidate,
  });

  const updateSession = useMutation({
    mutationFn: async ({ id, values }: { id: string; values: AcademySessionWrite }) => {
      const { error } = await academyFrom("academy_course_sessions").update(values).eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const deleteSession = useMutation({
    mutationFn: async ({ id }: { id: string }) => {
      const { error } = await academyFrom("academy_course_sessions").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  return {
    courses,
    sessionsByCourse,
    isLoading: coursesQuery.isLoading || sessionsQuery.isLoading,
    error: coursesQuery.error ?? sessionsQuery.error,
    saveCourse,
    deleteCourse,
    addSessions,
    updateSession,
    deleteSession,
  };
}
