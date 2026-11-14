import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion, useReducedMotion } from "framer-motion";
import { BookOpen, CalendarDays, FileText, GraduationCap, Plus, Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ForwardArrow } from "@/components/ui/directional-icon";
import { DangerRow, NavRow, SettingsGroup } from "@/components/dashboard/SettingsRows";
import { GROUP_HEADING, LIST, ROW } from "@/components/dashboard/settingsList";
import { useLang } from "@/contexts/LangContext";
import { usePlural } from "@/hooks/usePlural";
import { useAcademyCourses } from "@/hooks/useAcademyCourses";
import { useAcademyInstructors } from "@/hooks/useAcademyInstructors";
import { useAcademyRegistrations } from "@/hooks/useAcademyRegistrations";
import type { AcademyCourseRow, AcademyCourseSessionRow } from "@/integrations/supabase/academyTypes";
import { courseSpan } from "@/lib/academyCustomer";
import { academyErrorMessage } from "@/lib/academyErrors";
import { registrationCounts, seatsTakenByCourse, type RegistrationLike } from "@/lib/academyRegistrations";
import { compactDateRange } from "@/lib/compactDateRange";
import { dateFnsLocaleFor } from "@/lib/dateFnsLocale";
import { cn } from "@/lib/utils";
import { CourseSheet } from "./CourseSheet";
import { SessionsSheet } from "./SessionsSheet";
import { CourseRegistrantsSheet } from "./registrations/CourseRegistrantsSheet";
import { useCourseScreen } from "./courseScreen";
import { sectionTransition } from "@/components/dashboard/sectionTransition";

/**
 * Dashboard "Courses" section for an academy branch.
 *
 * List: one grouped list, a row per course (image, name, one line of
 * instructor · location · dates, a seats bar). Tapping a course opens its
 * screen (?course=<id>, see courseScreen.ts) with three rows — details
 * (CourseSheet), sessions (SessionsSheet), registrants (CourseRegistrantsSheet)
 * — and delete. The sheets live here, above both views, so a brand-new course
 * can open its sessions straight after saving.
 *
 * Creating a course needs at least one active instructor; with none the list
 * points to /instructors.
 */
export function CoursesTab() {
  const { t } = useLang();
  const navigate = useNavigate();
  const { courseId, open, back } = useCourseScreen();
  const reduceMotion = useReducedMotion();
  const { courses, sessionsByCourse, isLoading } = useAcademyCourses();
  const { instructors, activeInstructors, isLoading: instructorsLoading } = useAcademyInstructors();
  const { registrations } = useAcademyRegistrations();
  const takenByCourse = useMemo(() => seatsTakenByCourse(registrations), [registrations]);
  const instructorName = useMemo(() => new Map(instructors.map((i) => [i.id, i.name])), [instructors]);

  const [editing, setEditing] = useState<AcademyCourseRow | null>(null);
  const [courseSheetOpen, setCourseSheetOpen] = useState(false);
  const [sessionsFor, setSessionsFor] = useState<string | null>(null);
  const [registrantsFor, setRegistrantsFor] = useState<string | null>(null);

  // Each view starts at the top (the list may be scrolled far down).
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [courseId]);

  const sessionsCourse = courses.find((c) => c.id === sessionsFor) ?? null;
  const registrantsCourse = courses.find((c) => c.id === registrantsFor) ?? null;
  const openNew = () => {
    setEditing(null);
    setCourseSheetOpen(true);
  };
  const openEdit = (c: AcademyCourseRow) => {
    setEditing(c);
    setCourseSheetOpen(true);
  };

  const loading = isLoading || instructorsLoading;
  const canCreate = activeInstructors.length > 0;
  const current = courseId ? courses.find((c) => c.id === courseId) ?? null : null;

  return (
    <div className="pb-6">
      {/* List <-> course plays the section open/back transition: the key
          changes with the view. The sheets below stay outside it, so they are
          not remounted when a new course opens its sessions straight away. */}
      <motion.div key={courseId ?? "list"} {...sectionTransition(!!reduceMotion)} className="space-y-6">
        {courseId ? (
          loading ? (
            <div className={cn(LIST, "h-64 animate-pulse")} />
          ) : current ? (
            <CourseScreen
              course={current}
              sessions={sessionsByCourse.get(current.id) ?? []}
              instructor={instructorName.get(current.instructor_id) ?? null}
              registrations={registrations.filter((r) => r.course_id === current.id)}
              taken={takenByCourse.get(current.id) ?? 0}
              onDetails={() => openEdit(current)}
              onSessions={() => setSessionsFor(current.id)}
              onRegistrants={() => setRegistrantsFor(current.id)}
              onDeleted={back}
            />
          ) : (
            <section className={cn(LIST, "flex flex-col items-center px-6 py-10 text-center")}>
              <p className="font-semibold">{t("acCourseNotFound")}</p>
              <Button variant="outline" onClick={back} className="mt-5 h-11 rounded-2xl px-5">
                {t("academyCoursesTab")}
              </Button>
            </section>
          )
        ) : (
          <>
            <h2 className="text-lg font-semibold">{t("academyCoursesTab")}</h2>

            {!loading && !canCreate && (
              <SettingsGroup>
                <NavRow
                  icon={GraduationCap}
                  title={t("academyInstructorsTitle")}
                  description={t("academyCoursesNeedInstructor")}
                  lines={2}
                  onClick={() => navigate("/instructors")}
                />
              </SettingsGroup>
            )}

            {loading ? (
              <section className="space-y-2">
                <h3 className={GROUP_HEADING}>{t("acCoursesGroup")}</h3>
                <div className={cn(LIST, "space-y-px")}>
                  {[1, 2, 3].map((i) => <div key={i} className="h-[76px] animate-pulse bg-foreground/[0.04]" />)}
                </div>
              </section>
            ) : courses.length === 0 ? (
              <section className={cn(LIST, "flex flex-col items-center px-6 py-10 text-center")}>
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent/10 text-accent">
                  <BookOpen className="h-6 w-6" />
                </span>
                <p className="mt-3 font-semibold">{t("academyCoursesEmptyTitle")}</p>
                <p className="mt-1 text-sm text-foreground/60">{t("academyCoursesEmptyBody")}</p>
                {canCreate && (
                  <Button onClick={openNew} className="mt-5 h-11 gap-1.5 rounded-2xl px-5">
                    <Plus className="h-4 w-4" />
                    {t("academyCourseAdd")}
                  </Button>
                )}
              </section>
            ) : (
              <SettingsGroup
                title={t("acCoursesGroup")}
                action={
                  canCreate && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={openNew}
                      className="-me-2 h-11 gap-1.5 rounded-2xl px-3 font-semibold text-accent hover:bg-accent/10 hover:text-accent"
                    >
                      <Plus className="h-4 w-4" />
                      {t("academyCourseAdd")}
                    </Button>
                  )
                }
              >
                {courses.map((c) => (
                  <CourseRow
                    key={c.id}
                    course={c}
                    sessions={sessionsByCourse.get(c.id) ?? []}
                    instructor={instructorName.get(c.instructor_id) ?? null}
                    taken={takenByCourse.get(c.id) ?? 0}
                    onClick={() => open(c.id)}
                  />
                ))}
              </SettingsGroup>
            )}
          </>
        )}
      </motion.div>

      <CourseSheet
        open={courseSheetOpen}
        onOpenChange={setCourseSheetOpen}
        course={editing}
        instructors={instructors}
        onSaved={(id, isNew) => {
          // A brand-new course has no sessions yet: open its screen and go
          // straight to adding them.
          if (isNew) {
            open(id);
            setSessionsFor(id);
          }
        }}
      />
      <CourseRegistrantsSheet
        open={registrantsCourse !== null}
        onOpenChange={(o) => {
          if (!o) setRegistrantsFor(null);
        }}
        course={registrantsCourse}
      />
      <SessionsSheet
        open={sessionsFor !== null && sessionsCourse !== null}
        onOpenChange={(o) => {
          if (!o) setSessionsFor(null);
        }}
        course={sessionsCourse}
        sessions={sessionsFor ? sessionsByCourse.get(sessionsFor) ?? [] : []}
      />
    </div>
  );
}

// " · " with no-break spaces, so a separator never ends a truncated segment.
const NBSP = String.fromCharCode(0xa0);
const SEP = NBSP + "·" + NBSP;

/** "12–30 Nov", or null when the course has no sessions yet. */
function useDates(sessions: AcademyCourseSessionRow[]): string | null {
  const { lang } = useLang();
  const span = courseSpan(sessions);
  if (!span.first || !span.last) return null;
  return compactDateRange(span.first.session_date, span.last.session_date, dateFnsLocaleFor(lang));
}

function CourseTile({ course, large }: { course: AcademyCourseRow; large?: boolean }) {
  const size = large ? "h-16 w-16 rounded-2xl" : "h-12 w-12 rounded-xl";
  const dim = !course.is_active && "opacity-60 grayscale";
  return course.image_url ? (
    <img
      src={course.image_url}
      alt=""
      loading="lazy"
      width={large ? 64 : 48}
      height={large ? 64 : 48}
      className={cn(size, "shrink-0 object-cover", dim)}
    />
  ) : (
    <span className={cn(size, "flex shrink-0 items-center justify-center bg-accent/10 text-accent", dim)}>
      <BookOpen className={large ? "h-7 w-7" : "h-5 w-5"} />
    </span>
  );
}

/** Seats held (pending + confirmed) out of max, as a thin bar plus "3/10". */
function SeatsBar({ taken, max }: { taken: number; max: number }) {
  const { t } = useLang();
  const pct = max > 0 ? Math.min(100, Math.round((taken / max) * 100)) : 0;
  return (
    <span
      role="img"
      aria-label={t("academySeatsTaken").replace("{taken}", String(taken)).replace("{max}", String(max))}
      className="mt-2 flex items-center gap-2"
    >
      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-foreground/[0.08]">
        <span
          className={cn("block h-full rounded-full", taken >= max ? "bg-emerald-500" : "bg-accent")}
          style={{ width: `${pct}%` }}
        />
      </span>
      <span dir="ltr" className="shrink-0 text-[11px] font-semibold tabular-nums text-foreground/70">
        {taken}/{max}
      </span>
    </span>
  );
}

function InactiveTag() {
  const { t } = useLang();
  return (
    <span className="shrink-0 rounded-full bg-foreground/[0.06] px-2 py-0.5 text-[11px] font-medium text-foreground/60">
      {t("academyInstructorInactive")}
    </span>
  );
}

function CourseRow({
  course,
  sessions,
  instructor,
  taken,
  onClick,
}: {
  course: AcademyCourseRow;
  sessions: AcademyCourseSessionRow[];
  instructor: string | null;
  taken: number;
  onClick: () => void;
}) {
  const { t } = useLang();
  const dates = useDates(sessions);
  const location = course.location_type === "online" ? t("academyCourseOnline") : course.address;
  // Order: instructor · dates · location (ruling). The dates never shrink.
  // The location takes only the space left over (flex 1 1 0), so a long
  // address is cut first; the instructor shrinks only once that is gone.
  return (
    <button type="button" onClick={onClick} className={cn(ROW, "items-start")}>
      <CourseTile course={course} />
      <span className="min-w-0 flex-1">
        {/* Price sits on the title line so the info line below gets the full width. */}
        <span className="flex items-center gap-2">
          <span dir="auto" className="truncate text-sm font-semibold leading-snug rtl:text-right">{course.name}</span>
          {!course.is_active && <InactiveTag />}
          {course.price != null && (
            <span className="ms-auto shrink-0 text-sm font-medium text-foreground/70">₪{course.price}</span>
          )}
        </span>
        <span className="mt-0.5 flex min-w-0 text-xs leading-snug text-foreground/70">
          {/* Each text carries its own direction (dir="auto") so a Latin name
              in an RTL row truncates at its end, not its start. The
              location's separator lives in the location's clipped box, so
              when there is no room left both go together. */}
          {instructor && (
            <span dir="auto" className="min-w-0 truncate rtl:text-right">
              {instructor}
            </span>
          )}
          <span className="shrink-0 whitespace-pre">
            {instructor ? SEP : ""}
            {dates ?? t("academyCourseNoSessions")}
          </span>
          {location && (
            <span className="flex min-w-0 flex-1 basis-0 overflow-hidden">
              <span className="shrink-0 whitespace-pre">{SEP}</span>
              <span dir="auto" className="min-w-0 truncate rtl:text-right">
                {location}
              </span>
            </span>
          )}
        </span>
        <SeatsBar taken={taken} max={course.max_seats} />
      </span>
      <ForwardArrow className="mt-0.5 h-4 w-4 shrink-0 self-center text-foreground/40" />
    </button>
  );
}

function CourseScreen({
  course,
  sessions,
  instructor,
  registrations,
  taken,
  onDetails,
  onSessions,
  onRegistrants,
  onDeleted,
}: {
  course: AcademyCourseRow;
  sessions: AcademyCourseSessionRow[];
  instructor: string | null;
  registrations: readonly RegistrationLike[];
  taken: number;
  onDetails: () => void;
  onSessions: () => void;
  onRegistrants: () => void;
  onDeleted: () => void;
}) {
  const { t } = useLang();
  const pl = usePlural();
  const { deleteCourse } = useAcademyCourses();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const dates = useDates(sessions);
  const counts = registrationCounts(registrations);

  const location = course.location_type === "online" ? t("academyCourseOnline") : course.address;
  const detailsLine = [instructor, location].filter(Boolean).join(" · ");
  const sessionsLine = sessions.length === 0 ? t("academyCourseNoSessions") : `${pl("acSessions", sessions.length)} · ${dates}`;
  const regParts = [
    counts.pending > 0 ? pl("acRegPending", counts.pending) : null,
    counts.confirmed > 0 ? pl("acRegConfirmed", counts.confirmed) : null,
  ].filter(Boolean);

  const onDelete = async () => {
    try {
      await deleteCourse.mutateAsync({ id: course.id });
      toast.success(t("academyCourseDeleted"));
      setConfirmDelete(false);
      onDeleted();
    } catch (err) {
      toast.error(academyErrorMessage(err, t));
    }
  };

  return (
    <>
      <header className="flex items-center gap-3.5">
        <CourseTile course={course} large />
        <div className="min-w-0 flex-1">
          <h2 dir="auto" className="line-clamp-2 text-lg font-semibold leading-snug rtl:text-right">{course.name}</h2>
          <div className="mt-1 flex items-center gap-2 text-xs text-foreground/70">
            {!course.is_active && <InactiveTag />}
            {course.price != null && <span>₪{course.price}</span>}
          </div>
          <SeatsBar taken={taken} max={course.max_seats} />
        </div>
      </header>

      <SettingsGroup>
        <NavRow icon={FileText} title={t("acCourseDetails")} description={detailsLine} onClick={onDetails} />
        <NavRow
          icon={CalendarDays}
          title={t("academySessionsTitle")}
          description={sessionsLine}
          muted={sessions.length === 0}
          onClick={onSessions}
        />
        <NavRow
          icon={Users}
          title={t("academyRegistrants")}
          description={regParts.length > 0 ? regParts.join(" · ") : t("academyNoRegistrants")}
          muted={regParts.length === 0}
          onClick={onRegistrants}
        />
      </SettingsGroup>

      <SettingsGroup>
        <DangerRow icon={Trash2} label={t("academyCourseDelete")} onClick={() => setConfirmDelete(true)} />
      </SettingsGroup>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("academyCourseDeleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("academyCourseDeleteBody")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteCourse.isPending}
              onClick={(e) => {
                e.preventDefault();
                void onDelete();
              }}
            >
              {t("academyDelete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
