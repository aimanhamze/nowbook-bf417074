import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { ClipboardList } from "lucide-react";
import { SettingsGroup } from "@/components/dashboard/SettingsRows";
import { GROUP_HEADING, LIST } from "@/components/dashboard/settingsList";
import { useLang } from "@/contexts/LangContext";
import { useAcademyCourses } from "@/hooks/useAcademyCourses";
import { useAcademyRegistrations } from "@/hooks/useAcademyRegistrations";
import {
  filterRegistrations,
  groupByCourse,
  initialRegistrationFilter,
  type RegistrationFilter,
} from "@/lib/academyRegistrations";
import { courseSpan } from "@/lib/academyCustomer";
import { compactDateRange } from "@/lib/compactDateRange";
import { dateFnsLocaleFor } from "@/lib/dateFnsLocale";
import { cn } from "@/lib/utils";
import { RegistrantRow } from "./RegistrantRow";
import { RegistrationSheet } from "./RegistrationSheet";

const FILTERS: { id: RegistrationFilter; key: "academyFilterPending" | "academyFilterConfirmed" | "academyFilterAll" }[] = [
  { id: "pending", key: "academyFilterPending" },
  { id: "confirmed", key: "academyFilterConfirmed" },
  { id: "all", key: "academyFilterAll" },
];

/**
 * Dashboard "Registrations" section (academy): every course registration of
 * the branch, filtered Pending / Confirmed / All (each tab shows its count,
 * 0 included). Rows are grouped by course — the course name and dates appear
 * once as the group heading — and tapping a row opens RegistrationSheet with
 * the details and the actions.
 *
 * Opens on Pending when someone is waiting, otherwise on the first tab with
 * rows. Decided once, when the list first loads, so approving the last
 * pending request never moves the provider to another tab.
 */
export function RegistrationsTab() {
  const { t, lang } = useLang();
  const locale = dateFnsLocaleFor(lang);
  const { registrations, counts, isLoading } = useAcademyRegistrations();
  const { courses, sessionsByCourse } = useAcademyCourses();
  const [filter, setFilter] = useState<RegistrationFilter | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoading && filter === null) setFilter(initialRegistrationFilter(counts));
  }, [isLoading, filter, counts]);

  const courseById = useMemo(() => new Map(courses.map((c) => [c.id, c])), [courses]);
  const active = filter ?? "pending";
  const groups = useMemo(() => groupByCourse(filterRegistrations(registrations, active)), [registrations, active]);

  const courseDates = (courseId: string) => {
    const span = courseSpan(sessionsByCourse.get(courseId) ?? []);
    if (!span.first || !span.last) return null;
    return compactDateRange(span.first.session_date, span.last.session_date, locale);
  };

  const openReg = openId ? registrations.find((r) => r.id === openId) : undefined;
  const openCourse = openReg ? courseById.get(openReg.course_id) ?? null : null;

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="space-y-5 pb-6">
      {/* The dashboard's section header is only a back control; each section names itself. */}
      <h2 className="text-lg font-semibold">{t("academyRegistrationsTab")}</h2>

      <div className="flex gap-1 rounded-2xl bg-foreground/[0.05] p-1" role="tablist">
        {FILTERS.map((f) => {
          const on = active === f.id;
          const n = counts[f.id];
          return (
            <button
              key={f.id}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => setFilter(f.id)}
              className={cn(
                "flex h-11 flex-1 items-center justify-center gap-1.5 rounded-xl text-sm font-semibold transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                on ? "bg-white text-accent shadow-sm" : "text-foreground/60",
              )}
            >
              {t(f.key)}
              <span
                className={cn(
                  "inline-flex min-w-[20px] items-center justify-center rounded-full px-1.5 text-[11px] font-bold tabular-nums",
                  f.id === "pending" && n > 0 ? "bg-amber-500 text-white" : "bg-foreground/[0.08] text-foreground/60",
                )}
              >
                {n}
              </span>
            </button>
          );
        })}
      </div>

      {isLoading || filter === null ? (
        <section className="space-y-2">
          <div className="h-4 w-40 animate-pulse rounded bg-foreground/[0.06]" />
          <div className={cn(LIST, "space-y-px")}>
            {[1, 2, 3].map((i) => <div key={i} className="h-16 animate-pulse bg-foreground/[0.04]" />)}
          </div>
        </section>
      ) : groups.length === 0 ? (
        <section className={cn(LIST, "flex flex-col items-center px-6 py-10 text-center")}>
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent/10 text-accent">
            <ClipboardList className="h-6 w-6" />
          </span>
          <p className="mt-3 text-sm text-foreground/60">{t("academyRegistrationsEmpty")}</p>
        </section>
      ) : (
        groups.map((g) => {
          const course = courseById.get(g.courseId);
          const dates = courseDates(g.courseId);
          return (
            <section key={g.courseId} className="space-y-2">
              <h3 className={cn(GROUP_HEADING, "flex min-w-0 items-baseline gap-1.5")}>
                <bdi className="truncate">{course?.name ?? "—"}</bdi>
                {dates && <span className="shrink-0 font-medium text-foreground/50">· {dates}</span>}
              </h3>
              <SettingsGroup>
                {g.rows.map((r) => (
                  <RegistrantRow key={r.id} registration={r} onOpen={() => setOpenId(r.id)} />
                ))}
              </SettingsGroup>
            </section>
          );
        })
      )}

      <RegistrationSheet
        registrationId={openId}
        onClose={() => setOpenId(null)}
        course={openCourse}
        courseDates={openReg ? courseDates(openReg.course_id) : null}
      />
    </motion.div>
  );
}
