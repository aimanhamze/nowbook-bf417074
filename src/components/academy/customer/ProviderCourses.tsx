import { Navigate, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { motion, useReducedMotion } from "framer-motion";
import { BookOpen } from "lucide-react";
import { useLang } from "@/contexts/LangContext";
import { sectionTransition } from "@/components/dashboard/sectionTransition";
import { SectionHeading } from "@/components/provider-detail/PageParts";
import { CourseCard } from "./CourseCard";
import { useCourseCatalogue } from "./useCourseCatalogue";
import { coursePageUrl } from "./useCourseRegisterAction";

/**
 * The academy provider page's main section: the courses open to customers,
 * one large card each (see CourseCard). A card opens the course's own page.
 *
 * A course used to open in a sheet on this page, addressed as ?course=<id>;
 * links of that shape (shared earlier, or saved for the post-login return)
 * are sent on to the course page.
 */
export function ProviderCourses({ providerId }: { providerId: string }) {
  const { t } = useLang();
  const navigate = useNavigate();
  const location = useLocation();
  const reduceMotion = useReducedMotion();
  const [searchParams] = useSearchParams();
  const legacyCourseId = searchParams.get("course");
  const { courses, isLoading, seats, ctaFor } = useCourseCatalogue(providerId);

  if (legacyCourseId) {
    return <Navigate to={coursePageUrl(providerId, legacyCourseId)} state={location.state} replace />;
  }

  return (
    <section className="mt-8 px-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <SectionHeading>{t("academyOurCourses")}</SectionHeading>
        {courses.length > 0 && (
          <span className="text-[13px] text-foreground/70">
            {courses.length === 1
              ? t("academyCoursesCount_one")
              : t("academyCoursesCount_other").replace("{n}", String(courses.length))}
          </span>
        )}
      </div>

      {isLoading ? (
        <div className="flex flex-col gap-4">
          {[0, 1].map((i) => (
            <div key={i} className="h-[300px] animate-pulse rounded-3xl bg-secondary motion-reduce:animate-none" />
          ))}
        </div>
      ) : courses.length === 0 ? (
        <div className="surface-soft rounded-2xl p-6 text-center">
          <BookOpen className="mx-auto mb-2 h-8 w-8 text-muted-foreground" strokeWidth={1.5} />
          <p className="text-sm text-muted-foreground">{t("academyNoCoursesYet")}</p>
        </div>
      ) : (
        <motion.div className="flex flex-col gap-4" {...sectionTransition(!!reduceMotion)}>
          {courses.map((item) => (
            <CourseCard
              key={item.course.id}
              item={item}
              counts={seats.get(item.course.id)}
              cta={ctaFor(item)}
              onOpen={() => navigate(coursePageUrl(providerId, item.course.id))}
            />
          ))}
        </motion.div>
      )}
    </section>
  );
}
