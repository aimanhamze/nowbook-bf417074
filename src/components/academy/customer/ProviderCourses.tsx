import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import { BookOpen, MapPin, Video } from "lucide-react";
import { useLang } from "@/contexts/LangContext";
import { InstructorAvatar } from "@/components/academy/InstructorAvatar";
import { SectionLabel } from "@/components/ui/SectionLabel";
import {
  useCourseSeatCounts,
  useMyCourseRegistrations,
  usePublicCourses,
  type PublicCourse,
} from "@/hooks/usePublicCourses";
import { courseCta, seatsState, type CourseCta as CourseCtaState } from "@/lib/academyCustomer";
import { jerusalemNow } from "@/lib/academySessions";
import { dateFnsLocaleFor } from "@/lib/dateFnsLocale";
import { CourseCta } from "./CourseCta";
import { CourseDetailSheet } from "./CourseDetailSheet";
import { SeatsBadge } from "./SeatsBadge";
import { formatCourseDate } from "./courseFormat";
import { useCourseRegisterAction } from "./useCourseRegisterAction";

/**
 * The academy provider page's main section: the courses open to customers,
 * each with its instructor, place, dates, display price, live seats and a
 * Register button. The selected course lives in the URL (?course=<id>) so the
 * detail sheet survives a reload and the post-login redirect lands on it.
 */
export function ProviderCourses({ providerId }: { providerId: string }) {
  const { t, lang } = useLang();
  const locale = dateFnsLocaleFor(lang);
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
      <SectionLabel className="mb-3">{t("academyCoursesSection")}</SectionLabel>

      {isLoading ? (
        <div className="flex flex-col gap-3">
          {[0, 1].map((i) => (
            <div key={i} className="h-36 rounded-2xl bg-secondary animate-pulse" />
          ))}
        </div>
      ) : courses.length === 0 ? (
        <div className="surface-soft rounded-2xl p-6 text-center">
          <BookOpen className="mx-auto mb-2 h-8 w-8 text-muted-foreground" strokeWidth={1.5} />
          <p className="text-sm text-muted-foreground">{t("academyNoCoursesYet")}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {courses.map((item, i) => {
            const { course, instructor, sessions } = item;
            const first = sessions[0];
            const seatState = seatsState(seats.get(course.id));
            return (
              <motion.article
                key={course.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.15 + i * 0.06, duration: 0.4 }}
                className="surface-soft overflow-hidden rounded-2xl"
              >
                <button type="button" onClick={() => select(course.id)} className="flex w-full gap-3 p-3 text-start">
                  {course.image_url ? (
                    <img
                      src={course.image_url}
                      alt={course.name}
                      loading="lazy"
                      width={88}
                      height={88}
                      className="h-[88px] w-[88px] shrink-0 rounded-xl object-cover"
                    />
                  ) : (
                    <span className="flex h-[88px] w-[88px] shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent">
                      <BookOpen className="h-8 w-8" />
                    </span>
                  )}
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="line-clamp-2 text-[15px] font-semibold leading-snug">{course.name}</span>
                    {instructor && (
                      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <InstructorAvatar
                          id={instructor.id}
                          name={instructor.name}
                          photoUrl={instructor.photo_url}
                          className="!h-5 !w-5 !text-[10px]"
                        />
                        <span className="truncate">{instructor.name}</span>
                      </span>
                    )}
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      {course.location_type === "online" ? (
                        <Video className="h-3.5 w-3.5 shrink-0" />
                      ) : (
                        <MapPin className="h-3.5 w-3.5 shrink-0" />
                      )}
                      <span className="truncate">
                        {course.location_type === "online" ? t("academyCourseOnline") : course.address}
                      </span>
                    </span>
                    {first && (
                      <span className="text-xs text-muted-foreground">
                        {t("academySessionsSummary")
                          .replace("{n}", String(sessions.length))
                          .replace("{d}", formatCourseDate(first.session_date, locale))}
                      </span>
                    )}
                  </span>
                </button>

                <div className="flex items-center justify-between gap-3 border-t border-border/50 px-3 py-2.5">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    {course.price != null && (
                      <span className="flex items-baseline gap-0.5">
                        <span className="text-xs text-muted-foreground">₪</span>
                        <span className="text-base font-semibold tabular-nums">{course.price}</span>
                      </span>
                    )}
                    <SeatsBadge seats={seatState} />
                  </div>
                  <CourseCta
                    cta={ctaFor(item)}
                    signedIn={signedIn}
                    pending={pendingCourseId === course.id}
                    onRegister={() => void register(course)}
                  />
                </div>
              </motion.article>
            );
          })}
        </div>
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
