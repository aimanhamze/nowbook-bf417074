import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { addDays, format, parseISO } from "date-fns";
import { BookOpen, CalendarDays, ChevronLeft, ChevronRight, GraduationCap, Users } from "lucide-react";
import { Calendar } from "@/components/ui/calendar";
import { useLang } from "@/contexts/LangContext";
import { useAcademyCourses } from "@/hooks/useAcademyCourses";
import { useAcademyInstructors } from "@/hooks/useAcademyInstructors";
import { useAcademyRegistrations } from "@/hooks/useAcademyRegistrations";
import { useAcademyCalendarSessions } from "@/hooks/useAcademyCalendarSessions";
import {
  academyCalendarRange,
  buildAcademyCalendarItems,
  itemsByDate,
  seatSummaryByCourse,
  instructorColor,
  type AcademyCalendarItem,
  type AcademyCalendarView,
} from "@/lib/academyCalendar";
import { dateFnsLocaleFor } from "@/lib/dateFnsLocale";
import { cn } from "@/lib/utils";
import { CourseRegistrantsSheet } from "@/components/academy/registrations/CourseRegistrantsSheet";

// Same key as the booking calendar, so the provider's preferred view carries over.
const VIEW_MODE_KEY = "provider-calendar-view-mode";

function readView(): AcademyCalendarView {
  try {
    const saved = localStorage.getItem(VIEW_MODE_KEY);
    return saved === "daily" || saved === "weekly" || saved === "monthly" ? saved : "monthly";
  } catch {
    return "monthly";
  }
}

/**
 * /calendar for an academy branch: its course sessions as blocks in daily,
 * weekly and monthly views, filterable by instructor. A block shows the course,
 * time, instructor, confirmed/max seats and a "+N pending" badge; tapping it
 * opens the course's registrants with Approve / Reject / Cancel.
 *
 * Only the visible range is fetched (sessions per range; registrations only for
 * the courses in that range, pending + confirmed), so paging never pulls the
 * whole history.
 */
export function AcademyCalendar() {
  const { t, lang, isRtl } = useLang();
  const locale = dateFnsLocaleFor(lang);
  const navigate = useNavigate();

  const [view, setView] = useState<AcademyCalendarView>(readView);
  useEffect(() => {
    try {
      localStorage.setItem(VIEW_MODE_KEY, view);
    } catch {
      /* storage unavailable: the choice just won't persist */
    }
  }, [view]);

  const [selected, setSelected] = useState<Date>(() => new Date());
  const [month, setMonth] = useState<Date>(() => new Date());
  // Entering the month view shows the selected day's month.
  useEffect(() => {
    if (view === "monthly") setMonth(selected);
    // Only on entering the view; paging months afterwards is the grid's job.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);
  const [instructorFilter, setInstructorFilter] = useState("all");
  const [open, setOpen] = useState<AcademyCalendarItem | null>(null);

  const range = useMemo(() => academyCalendarRange(view, selected, month), [view, selected, month]);
  const { sessions, isLoading: sessionsLoading } = useAcademyCalendarSessions(range);
  const { courses, isLoading: coursesLoading } = useAcademyCourses();
  const { instructors, activeInstructors } = useAcademyInstructors();

  const courseIds = useMemo(() => [...new Set(sessions.map((s) => s.course_id))].sort(), [sessions]);
  const scope = useMemo(() => ({ courseIds, activeOnly: true }), [courseIds]);
  const { registrations } = useAcademyRegistrations(scope);

  const effectiveFilter =
    instructorFilter !== "all" && !activeInstructors.some((i) => i.id === instructorFilter) ? "all" : instructorFilter;

  const items = useMemo(
    () =>
      buildAcademyCalendarItems({
        sessions,
        courses: new Map(courses.map((c) => [c.id, c])),
        instructors: new Map(instructors.map((i) => [i.id, i])),
        seats: seatSummaryByCourse(registrations),
        instructorFilter: effectiveFilter,
      }),
    [sessions, courses, instructors, registrations, effectiveFilter],
  );
  const byDate = useMemo(() => itemsByDate(items), [items]);
  const selectedKey = format(selected, "yyyy-MM-dd");
  const dayItems = byDate.get(selectedKey) ?? [];
  const openCourse = open ? courses.find((c) => c.id === open.courseId) ?? null : null;
  const loading = sessionsLoading || coursesLoading;

  const step = (dir: 1 | -1) => setSelected((d) => addDays(d, view === "weekly" ? 7 * dir : dir));

  const navTitle =
    view === "daily"
      ? format(selected, "EEEE, d MMMM", { locale })
      : `${format(parseISO(range.from), "d MMM", { locale })} – ${format(parseISO(range.to), "d MMM", { locale })}`;

  const PrevIcon = isRtl ? ChevronRight : ChevronLeft;
  const NextIcon = isRtl ? ChevronLeft : ChevronRight;

  const emptyRange = (
    <div className="rounded-2xl border border-dashed border-border px-5 py-10 text-center">
      <CalendarDays className="mx-auto mb-2 h-10 w-10 text-muted-foreground/30" />
      <p className="text-sm font-medium">{t("academyCalendarEmpty")}</p>
      <p className="mt-1 text-xs text-muted-foreground">{t("academyCalendarEmptyBody")}</p>
      <button
        type="button"
        onClick={() => navigate("/dashboard", { state: { tab: "courses" } })}
        className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-accent px-4 py-2 text-xs font-semibold text-accent-foreground active:scale-95"
      >
        <BookOpen className="h-4 w-4" />
        {t("academyCalendarEmptyCta")}
      </button>
    </div>
  );

  const block = (it: AcademyCalendarItem) => (
    <button
      key={it.sessionId}
      type="button"
      onClick={() => setOpen(it)}
      className={cn(
        "flex w-full items-stretch gap-3 overflow-hidden rounded-2xl border border-border bg-card text-start transition-transform active:scale-[0.99]",
        it.dimmed && "opacity-60",
      )}
    >
      <span aria-hidden className="w-1.5 shrink-0" style={{ backgroundColor: it.color }} />
      <span className="flex min-w-0 flex-1 flex-col gap-1 py-3 pe-3">
        <span className="flex items-center gap-2">
          <span className="truncate text-sm font-semibold">{it.courseName}</span>
          {it.dimmed && (
            <span className="shrink-0 rounded-full bg-secondary px-2 py-0.5 text-[10px] text-muted-foreground">
              {t("academyInstructorInactive")}
            </span>
          )}
        </span>
        <span dir="ltr" className="self-start text-xs font-medium tabular-nums text-muted-foreground">
          {it.start}–{it.end}
        </span>
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <GraduationCap className="h-3.5 w-3.5 shrink-0" style={{ color: it.color }} />
            {it.instructorName}
          </span>
          <span className="flex items-center gap-1">
            <Users className="h-3.5 w-3.5 shrink-0" />
            <bdi dir="ltr">
              {it.confirmed}/{it.maxSeats}
            </bdi>
          </span>
          {it.pending > 0 && (
            <span className="rounded-full bg-amber-500 px-2 py-0.5 text-[10px] font-bold text-white">
              {t("academyPendingPlus").replace("{n}", String(it.pending))}
            </span>
          )}
        </span>
      </span>
    </button>
  );

  const dayList = (list: AcademyCalendarItem[]) =>
    list.length === 0 ? (
      <p className="rounded-2xl border border-dashed border-border py-8 text-center text-sm text-muted-foreground">
        {t("academyCalendarEmpty")}
      </p>
    ) : (
      <div className="flex flex-col gap-2">{list.map(block)}</div>
    );

  return (
    <div className="space-y-4">
      {/* Instructor filter — like the staff filter: "All" + one chip per active instructor. */}
      {activeInstructors.length > 1 && (
        <div className="-mb-1 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <button
            type="button"
            onClick={() => setInstructorFilter("all")}
            className={cn(
              "flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-2 text-xs font-semibold transition-all active:scale-95",
              effectiveFilter === "all"
                ? "border-transparent bg-accent text-accent-foreground shadow-sm"
                : "border-border bg-card text-muted-foreground hover:border-accent/40",
            )}
          >
            <Users className="h-3.5 w-3.5" />
            {t("academyAllInstructors")}
          </button>
          {activeInstructors.map((ins) => {
            const on = effectiveFilter === ins.id;
            return (
              <button
                key={ins.id}
                type="button"
                onClick={() => setInstructorFilter(ins.id)}
                className={cn(
                  "flex shrink-0 items-center gap-1.5 rounded-full border py-1.5 pe-3.5 ps-1.5 text-xs font-semibold transition-all active:scale-95",
                  on
                    ? "border-transparent bg-accent text-accent-foreground shadow-sm"
                    : "border-border bg-card text-muted-foreground hover:border-accent/40",
                )}
              >
                <span
                  className="flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-black text-white"
                  style={{ backgroundColor: instructorColor(ins.id) }}
                >
                  {Array.from(ins.name.trim())[0] ?? "?"}
                </span>
                {ins.name}
              </button>
            );
          })}
        </div>
      )}

      {/* View toggle — same control as the booking calendar. */}
      <div className="grid grid-cols-3 gap-1 rounded-2xl border border-border bg-card p-1">
        {(["daily", "weekly", "monthly"] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            onClick={() => setView(mode)}
            className={cn(
              "rounded-xl py-2 text-sm font-medium transition-colors",
              view === mode ? "bg-accent text-accent-foreground shadow-sm" : "text-muted-foreground hover:bg-secondary",
            )}
          >
            {t(mode === "daily" ? "dailyView" : mode === "weekly" ? "weeklyView" : "monthlyView")}
          </button>
        ))}
      </div>

      {view !== "monthly" && (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => step(-1)}
            aria-label={t("academyPrev")}
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-card active:scale-95"
          >
            <PrevIcon className="h-4 w-4" />
          </button>
          <p className="min-w-0 flex-1 truncate text-center text-sm font-semibold">{navTitle}</p>
          <button
            type="button"
            onClick={() => setSelected(new Date())}
            className="rounded-xl border border-border bg-card px-3 py-2 text-xs font-semibold active:scale-95"
          >
            {t("academyToday")}
          </button>
          <button
            type="button"
            onClick={() => step(1)}
            aria-label={t("academyNext")}
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-card active:scale-95"
          >
            <NextIcon className="h-4 w-4" />
          </button>
        </div>
      )}

      {loading ? (
        <div className="space-y-3">
          {[0, 1].map((i) => (
            <div key={i} className="h-24 rounded-2xl bg-secondary animate-pulse" />
          ))}
        </div>
      ) : view === "daily" ? (
        items.length === 0 ? emptyRange : dayList(dayItems)
      ) : view === "weekly" ? (
        items.length === 0 ? (
          emptyRange
        ) : (
          <div className="space-y-4">
            {[...byDate.entries()].map(([date, list]) => (
              <section key={date}>
                <h3 className="mb-2 text-xs font-semibold text-muted-foreground">
                  {format(parseISO(date), "EEEE, d MMM", { locale })}
                </h3>
                <div className="flex flex-col gap-2">{list.map(block)}</div>
              </section>
            ))}
          </div>
        )
      ) : (
        <>
          <div className="rounded-2xl border border-border bg-card p-2">
            <Calendar
              mode="single"
              selected={selected}
              onSelect={(d) => d && setSelected(d)}
              month={month}
              onMonthChange={setMonth}
              locale={locale}
              weekStartsOn={0}
              className="pointer-events-auto"
              modifiers={{ hasSessions: [...byDate.keys()].map((k) => parseISO(k)) }}
              modifiersStyles={{
                hasSessions: {
                  fontWeight: 700,
                  textDecoration: "underline",
                  textDecorationColor: "hsl(var(--accent))",
                  textUnderlineOffset: "3px",
                },
              }}
            />
          </div>
          {items.length === 0 ? (
            emptyRange
          ) : (
            <div>
              <h3 className="mb-3 text-sm font-semibold">{format(selected, "EEEE, d MMM", { locale })}</h3>
              {dayList(dayItems)}
            </div>
          )}
        </>
      )}

      <CourseRegistrantsSheet
        open={open !== null && openCourse !== null}
        onOpenChange={(o) => !o && setOpen(null)}
        course={openCourse}
        scope={scope}
        subtitle={
          open ? (
            <>
              {format(parseISO(open.date), "EEEE, d MMM", { locale })} ·{" "}
              {/* Isolated LTR run, or RTL text reorders it to "13:00–10:00". */}
              <bdi dir="ltr">
                {open.start}–{open.end}
              </bdi>
            </>
          ) : undefined
        }
      />
    </div>
  );
}
