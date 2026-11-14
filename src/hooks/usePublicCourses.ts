import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import {
  academyFrom,
  academyRpc,
  type AcademyCourseRow,
  type AcademyCourseSessionRow,
  type AcademyInstructorRow,
  type CourseRegistrationRow,
} from "@/integrations/supabase/academyTypes";
import { sortSessions } from "@/lib/academySessions";
import type { SeatCounts } from "@/lib/academyCustomer";

/**
 * Customer-side academy reads and the two customer RPCs.
 *
 * Everything here is what RLS already lets the caller see: active courses of
 * visible branches (public), their sessions (public), instructors (public),
 * seat COUNTS through get_course_seat_counts (anon-callable, no customer
 * data), and the caller's OWN registrations. Writes go only through
 * register_for_course / cancel_course_registration.
 */
export const PUBLIC_COURSES_KEY = "public-courses";
export const COURSE_SEATS_KEY = "course-seats";
export const MY_COURSE_REGISTRATIONS_KEY = "my-course-registrations";

export interface PublicCourse {
  course: AcademyCourseRow;
  instructor: AcademyInstructorRow | null;
  sessions: AcademyCourseSessionRow[];
}

async function fetchSessions(courseIds: string[]): Promise<AcademyCourseSessionRow[]> {
  if (courseIds.length === 0) return [];
  const { data, error } = await academyFrom("academy_course_sessions")
    .select("*")
    .in("course_id", courseIds)
    .order("session_date")
    .order("start_time");
  if (error) throw error;
  return (data ?? []) as unknown as AcademyCourseSessionRow[];
}

async function fetchInstructors(ids: string[]): Promise<AcademyInstructorRow[]> {
  if (ids.length === 0) return [];
  const { data, error } = await academyFrom("academy_instructors").select("*").in("id", ids);
  if (error) throw error;
  return (data ?? []) as unknown as AcademyInstructorRow[];
}

function groupSessions(rows: AcademyCourseSessionRow[]): Map<string, AcademyCourseSessionRow[]> {
  const map = new Map<string, AcademyCourseSessionRow[]>();
  for (const s of rows) {
    const list = map.get(s.course_id) ?? [];
    list.push(s);
    map.set(s.course_id, list);
  }
  for (const [k, v] of map) map.set(k, sortSessions(v));
  return map;
}

/** A provider page's courses, each with its instructor and sessions. */
export function usePublicCourses(providerId: string | undefined, enabled: boolean) {
  const query = useQuery({
    queryKey: [PUBLIC_COURSES_KEY, providerId],
    staleTime: 60 * 1000,
    enabled: !!providerId && enabled,
    queryFn: async (): Promise<PublicCourse[]> => {
      if (!providerId) return [];
      const { data, error } = await academyFrom("academy_courses")
        .select("*")
        .eq("provider_id", providerId)
        .eq("is_active", true)
        .order("created_at", { ascending: false });
      if (error) throw error;
      const courses = (data ?? []) as unknown as AcademyCourseRow[];
      const [sessions, instructors] = await Promise.all([
        fetchSessions(courses.map((c) => c.id)),
        fetchInstructors([...new Set(courses.map((c) => c.instructor_id))]),
      ]);
      const byCourse = groupSessions(sessions);
      const byId = new Map(instructors.map((i) => [i.id, i]));
      return courses.map((course) => ({
        course,
        instructor: byId.get(course.instructor_id) ?? null,
        sessions: byCourse.get(course.id) ?? [],
      }));
    },
  });
  return { courses: query.data ?? [], isLoading: query.isLoading, error: query.error };
}

/** Live seat counts (pending + confirmed hold a seat). Keyed by course id. */
export function useCourseSeatCounts(courseIds: string[]) {
  const sortedIds = useMemo(() => [...courseIds].sort(), [courseIds]);
  const query = useQuery({
    queryKey: [COURSE_SEATS_KEY, sortedIds],
    staleTime: 30 * 1000,
    enabled: sortedIds.length > 0,
    queryFn: async (): Promise<Map<string, SeatCounts>> => {
      const { data, error } = await academyRpc("get_course_seat_counts", { p_course_ids: sortedIds });
      if (error) throw error;
      const rows = (data ?? []) as Array<SeatCounts & { course_id: string }>;
      return new Map(rows.map((r) => [r.course_id, { max_seats: r.max_seats, taken: r.taken, free: r.free }]));
    },
  });
  return { seats: query.data ?? new Map<string, SeatCounts>(), isLoading: query.isLoading };
}

export interface MyCourseRegistration {
  registration: CourseRegistrationRow;
  /** null when the course is no longer publicly readable (deactivated / hidden branch). */
  course: AcademyCourseRow | null;
  instructor: AcademyInstructorRow | null;
  sessions: AcademyCourseSessionRow[];
}

/** The signed-in customer's own registrations, newest first. */
export function useMyCourseRegistrations() {
  const { user } = useAuth();
  const query = useQuery({
    queryKey: [MY_COURSE_REGISTRATIONS_KEY, user?.id],
    staleTime: 30 * 1000,
    enabled: !!user,
    queryFn: async (): Promise<MyCourseRegistration[]> => {
      if (!user) return [];
      const { data, error } = await academyFrom("course_registrations")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      const regs = (data ?? []) as unknown as CourseRegistrationRow[];
      if (regs.length === 0) return [];

      const courseIds = [...new Set(regs.map((r) => r.course_id))];
      const { data: courseData, error: courseError } = await academyFrom("academy_courses")
        .select("*")
        .in("id", courseIds);
      if (courseError) throw courseError;
      const courses = (courseData ?? []) as unknown as AcademyCourseRow[];
      const [sessions, instructors] = await Promise.all([
        fetchSessions(courseIds),
        fetchInstructors([...new Set(courses.map((c) => c.instructor_id))]),
      ]);
      const courseById = new Map(courses.map((c) => [c.id, c]));
      const instructorById = new Map(instructors.map((i) => [i.id, i]));
      const byCourse = groupSessions(sessions);
      return regs.map((registration) => {
        const course = courseById.get(registration.course_id) ?? null;
        return {
          registration,
          course,
          instructor: course ? instructorById.get(course.instructor_id) ?? null : null,
          sessions: byCourse.get(registration.course_id) ?? [],
        };
      });
    },
  });
  return { registrations: query.data ?? [], isLoading: query.isLoading };
}

function useInvalidateCourses() {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: [COURSE_SEATS_KEY] });
    queryClient.invalidateQueries({ queryKey: [MY_COURSE_REGISTRATIONS_KEY] });
    queryClient.invalidateQueries({ queryKey: [PUBLIC_COURSES_KEY] });
  };
}

/** register_for_course -> the new registration id (status pending). */
export function useRegisterForCourse() {
  const invalidate = useInvalidateCourses();
  return useMutation({
    mutationFn: async (courseId: string): Promise<string> => {
      const { data, error } = await academyRpc("register_for_course", { p_course_id: courseId });
      if (error) throw error;
      return data as string;
    },
    // Seat counts change on failure too (e.g. COURSE_FULL means our numbers were stale).
    onSettled: invalidate,
  });
}

export function useCancelCourseRegistration() {
  const invalidate = useInvalidateCourses();
  return useMutation({
    mutationFn: async (registrationId: string) => {
      const { error } = await academyRpc("cancel_course_registration", { p_registration_id: registrationId });
      if (error) throw error;
    },
    onSettled: invalidate,
  });
}
