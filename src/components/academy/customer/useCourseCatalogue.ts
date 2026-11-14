import { useMemo } from "react";
import {
  useCourseSeatCounts,
  useMyCourseRegistrations,
  usePublicCourses,
  type MyCourseRegistration,
  type PublicCourse,
} from "@/hooks/usePublicCourses";
import { courseCta, seatsState, type CourseCta } from "@/lib/academyCustomer";
import { jerusalemNow } from "@/lib/academySessions";

/**
 * Everything the customer's academy screens show about a branch's courses:
 * the public courses, their live seat counts, and the visitor's own latest
 * registration per course. One hook for the course list and the course page,
 * so both read the same three cached queries and agree on every state.
 */
export function useCourseCatalogue(providerId: string | undefined) {
  const { courses, isLoading, error } = usePublicCourses(providerId, true);
  const courseIds = useMemo(() => courses.map((c) => c.course.id), [courses]);
  const { seats } = useCourseSeatCounts(courseIds);
  const { registrations } = useMyCourseRegistrations();
  const now = jerusalemNow();

  // The customer's latest registration per course (rows come newest first).
  const myLatestByCourse = useMemo(() => {
    const map = new Map<string, MyCourseRegistration["registration"]>();
    for (const r of registrations) {
      if (!map.has(r.registration.course_id)) map.set(r.registration.course_id, r.registration);
    }
    return map;
  }, [registrations]);

  const ctaFor = (item: PublicCourse): CourseCta =>
    courseCta({
      myStatus: myLatestByCourse.get(item.course.id)?.status ?? null,
      firstSession: item.sessions[0] ?? null,
      seats: seatsState(seats.get(item.course.id)),
      now,
    });

  return { courses, isLoading, error, seats, ctaFor, myLatestByCourse, now };
}
