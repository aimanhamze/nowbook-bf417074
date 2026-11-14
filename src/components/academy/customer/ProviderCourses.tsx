import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { motion, useReducedMotion } from "framer-motion";
import { BookOpen } from "lucide-react";
import { useLang } from "@/contexts/LangContext";
import { sectionTransition } from "@/components/dashboard/sectionTransition";
import { SectionLabel } from "@/components/ui/SectionLabel";
import {
  useCourseSeatCounts,
  useMyCourseRegistrations,
  usePublicCourses,
  type PublicCourse,
} from "@/hooks/usePublicCourses";
import { courseCta, seatsState, type CourseCta as CourseCtaState } from "@/lib/academyCustomer";
import { jerusalemNow } from "@/lib/academySessions";
import { CourseCard } from "./CourseCard";
import { CourseDetailSheet } from "./CourseDetailSheet";
import { useCourseRegisterAction } from "./useCourseRegisterAction";

/**
 * The academy provider page's main section: the courses open to customers,
 * one large card each (see CourseCard). The selected course lives in the URL
 * (?course=<id>) so the detail sheet survives a reload and the post-login
 * redirect lands on it.
 */
export function ProviderCourses({ providerId }: { providerId: string }) {
  const { t } = useLang();
  const reduceMotion = useReducedMotion();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedId = searchParams.get("course");

  const { courses, isLoading } = usePublicCourses(providerId, true);
  const courseIds = useMemo(() => courses.map((c) => c.course.id), [courses]);
  const { seats } = useCourseSeatCounts(courseIds);
  const { registrations } = useMyCourseRegistrations();
  const { register, pendingCourseId, signedIn } = useCourseRegisterAction(providerId);
  const now = jerusalemNow();

  // The customer's latest registration per course (rows come newest first).
  const myStatusByCourse = useMemo(() => {
    const map = new Map<string, PublicCourseStatus>();
    for (const r of registrations) {
      if (!map.has(r.registration.course_id)) map.set(r.registration.course_id, r.registration.status);
    }
    return map;
  }, [registrations]);

  const ctaFor = (item: PublicCourse): CourseCtaState =>
    courseCta({
      myStatus: myStatusByCourse.get(item.course.id) ?? null,
      firstSession: item.sessions[0] ?? null,
      seats: seatsState(seats.get(item.course.id)),
      now,
    });

  const select = (id: string | null) => {
    const next = new URLSearchParams(searchParams);
    if (id) next.set("course", id);
    else next.delete("course");
    setSearchParams(next, { replace: true });
  };

  const selected = courses.find((c) => c.course.id === selectedId) ?? null;

  return (
    <section className="mt-8 px-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <SectionLabel>{t("academyOurCourses")}</SectionLabel>
        {courses.length > 0 && (
          <span className="text-xs text-muted-foreground">
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
              onOpen={() => select(item.course.id)}
            />
          ))}
        </motion.div>
      )}

      <CourseDetailSheet
        open={!!selected}
        onOpenChange={(open) => {
          if (!open) select(null);
        }}
        item={selected}
        seats={selected ? seatsState(seats.get(selected.course.id)) : { kind: "unknown" }}
        cta={selected ? ctaFor(selected) : null}
        signedIn={signedIn}
        pending={!!selected && pendingCourseId === selected.course.id}
        onRegister={() => {
          if (selected) void register(selected.course);
        }}
      />
    </section>
  );
}

type PublicCourseStatus = "pending" | "confirmed" | "rejected" | "cancelled";
