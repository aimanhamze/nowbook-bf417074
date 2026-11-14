import { useLocation, useNavigate, useSearchParams } from "react-router-dom";

/**
 * The course screen lives inside the Courses section at
 * /dashboard?section=courses&course=<id>, so the device back gesture returns to
 * the course list and a reload stays on the course.
 *
 * back(): step back when the list opened the course (keeps history tidy);
 * a course reached any other way (deep link, reload) replaces itself with the
 * list instead of leaving the dashboard.
 */
export const COURSES_LIST_URL = "/dashboard?section=courses";

export function useCourseScreen() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const courseId = params.get("course");

  const open = (id: string) =>
    navigate(`${COURSES_LIST_URL}&course=${encodeURIComponent(id)}`, { state: { fromCourses: true } });

  const back = () => {
    if ((location.state as { fromCourses?: boolean } | null)?.fromCourses) navigate(-1);
    else navigate(COURSES_LIST_URL, { replace: true });
  };

  return { courseId, open, back };
}
