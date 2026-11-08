import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { format, parseISO } from "date-fns";
import { motion } from "framer-motion";
import { BookOpen, CalendarDays, GraduationCap, MapPin, Plus, Users, Video } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLang } from "@/contexts/LangContext";
import { useAcademyCourses } from "@/hooks/useAcademyCourses";
import { useAcademyInstructors } from "@/hooks/useAcademyInstructors";
import type { AcademyCourseRow } from "@/integrations/supabase/academyTypes";
import { dateFnsLocaleFor } from "@/lib/dateFnsLocale";
import { CourseSheet } from "./CourseSheet";
import { SessionsSheet } from "./SessionsSheet";
import { CourseRegistrantsSheet } from "./registrations/CourseRegistrantsSheet";
import { useAcademyRegistrations } from "@/hooks/useAcademyRegistrations";
import { seatsTakenByCourse } from "@/lib/academyRegistrations";

/**
 * Dashboard "Courses" tab for an academy branch: the course list, with a
 * course editor (CourseSheet) and a per-course sessions editor
 * (SessionsSheet). Creating a course needs at least one active instructor,
 * so with none the tab points to /instructors instead.
 */
export function CoursesTab() {
  const { t, lang } = useLang();
  const navigate = useNavigate();
  const locale = dateFnsLocaleFor(lang);
  const { courses, sessionsByCourse, isLoading } = useAcademyCourses();
  const { instructors, activeInstructors, isLoading: instructorsLoading } = useAcademyInstructors();

  const [editing, setEditing] = useState<AcademyCourseRow | null>(null);
  const [courseSheetOpen, setCourseSheetOpen] = useState(false);
  const [sessionsFor, setSessionsFor] = useState<string | null>(null);
  const [registrantsFor, setRegistrantsFor] = useState<string | null>(null);
  const { registrations } = useAcademyRegistrations();
  const takenByCourse = useMemo(() => seatsTakenByCourse(registrations), [registrations]);

  const instructorName = useMemo(() => new Map(instructors.map((i) => [i.id, i.name])), [instructors]);
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

  if (isLoading || instructorsLoading) {
    return (
      <div className="flex flex-col gap-3">
        {[0, 1].map((i) => (
          <div key={i} className="h-32 rounded-2xl bg-secondary animate-pulse" />
        ))}
      </div>
    );
  }

  const canCreate = activeInstructors.length > 0;

  return (
    <div className="flex flex-col gap-3 pb-6">
      {canCreate ? (
        <Button onClick={openNew} className="h-11 w-full gap-1.5">
          <Plus className="h-4 w-4" />
          {t("academyCourseAdd")}
        </Button>
      ) : (
        <div className="rounded-2xl border border-dashed border-border p-4 text-center">
          <p className="text-sm text-muted-foreground">{t("academyCoursesNeedInstructor")}</p>
          <Button variant="outline" className="mt-3 gap-1.5" onClick={() => navigate("/instructors")}>
            <GraduationCap className="h-4 w-4" />
            {t("academyInstructorsTitle")}
          </Button>
        </div>
      )}

      {courses.length === 0 ? (
        <div className="rounded-2xl bg-card p-8 text-center">
          <BookOpen className="mx-auto mb-3 h-10 w-10 text-muted-foreground" strokeWidth={1.5} />
          <p className="font-medium">{t("academyCoursesEmptyTitle")}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t("academyCoursesEmptyBody")}</p>
        </div>
      ) : (
        courses.map((c, index) => {
          const sessions = sessionsByCourse.get(c.id) ?? [];
          const first = sessions[0];
          return (
            <motion.article
              key={c.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.04 }}
              className={`overflow-hidden rounded-2xl border border-border bg-card ${c.is_active ? "" : "opacity-70"}`}
            >
              <button type="button" onClick={() => openEdit(c)} className="flex w-full gap-3 p-3 text-start">
                {c.image_url ? (
                  <img
                    src={c.image_url}
                    alt=""
                    loading="lazy"
                    width={80}
                    height={80}
                    className="h-20 w-20 shrink-0 rounded-xl object-cover"
                  />
                ) : (
                  <span className="flex h-20 w-20 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent">
                    <BookOpen className="h-7 w-7" />
                  </span>
                )}
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-[15px] font-semibold">{c.name}</span>
                    {!c.is_active && (
                      <span className="shrink-0 rounded-full bg-secondary px-2 py-0.5 text-[11px] text-muted-foreground">
                        {t("academyInstructorInactive")}
                      </span>
                    )}
                  </span>
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <GraduationCap className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{instructorName.get(c.instructor_id) ?? "—"}</span>
                  </span>
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    {c.location_type === "online" ? (
                      <Video className="h-3.5 w-3.5 shrink-0" />
                    ) : (
                      <MapPin className="h-3.5 w-3.5 shrink-0" />
                    )}
                    <span className="truncate">
                      {c.location_type === "online" ? t("academyCourseOnline") : c.address}
                    </span>
                  </span>
                  <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Users className="h-3.5 w-3.5" />
                      {t("academyCourseSeatsSummary").replace("{n}", String(c.max_seats))}
                    </span>
                    {c.price != null && <span>₪{c.price}</span>}
                  </span>
                </span>
              </button>

              <button
                type="button"
                onClick={() => setSessionsFor(c.id)}
                className="flex w-full items-center gap-2 border-t border-border/60 px-3 py-2.5 text-start text-xs font-medium text-accent hover:bg-secondary/40"
              >
                <CalendarDays className="h-4 w-4" />
                <span className="flex-1">
                  {sessions.length === 0
                    ? t("academyCourseNoSessions")
                    : `${t("academyCourseSessionsCount").replace("{n}", String(sessions.length))} · ${t(
                        "academyCourseFirstSession",
                      ).replace("{d}", format(parseISO(first.session_date), "d MMM", { locale }))}`}
                </span>
                <span>{t("academySessionsManage")}</span>
              </button>

              <button
                type="button"
                onClick={() => setRegistrantsFor(c.id)}
                className="flex w-full items-center gap-2 border-t border-border/60 px-3 py-2.5 text-start text-xs font-medium text-accent hover:bg-secondary/40"
              >
                <Users className="h-4 w-4" />
                <span className="flex-1">
                  {t("academySeatsTaken")
                    .replace("{taken}", String(takenByCourse.get(c.id) ?? 0))
                    .replace("{max}", String(c.max_seats))}
                </span>
                <span>{t("academyRegistrants")}</span>
              </button>
            </motion.article>
          );
        })
      )}

      <CourseSheet
        open={courseSheetOpen}
        onOpenChange={setCourseSheetOpen}
        course={editing}
        instructors={instructors}
        onSaved={(id, isNew) => {
          // A brand-new course has no sessions yet: go straight to adding them.
          if (isNew) setSessionsFor(id);
        }}
      />
      <CourseRegistrantsSheet
        open={registrantsCourse !== null}
        onOpenChange={(open) => {
          if (!open) setRegistrantsFor(null);
        }}
        course={registrantsCourse}
      />
      <SessionsSheet
        open={sessionsFor !== null && sessionsCourse !== null}
        onOpenChange={(open) => {
          if (!open) setSessionsFor(null);
        }}
        course={sessionsCourse}
        sessions={sessionsFor ? sessionsByCourse.get(sessionsFor) ?? [] : []}
      />
    </div>
  );
}
