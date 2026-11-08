import { useMemo, useState } from "react";
import { format, parseISO } from "date-fns";
import { motion } from "framer-motion";
import { BookOpen, CalendarDays, CheckCircle2, ClipboardList, Clock, XCircle } from "lucide-react";
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
import { useLang } from "@/contexts/LangContext";
import { useAcademyCourses } from "@/hooks/useAcademyCourses";
import { useAcademyRegistrations, type ProviderRegistration } from "@/hooks/useAcademyRegistrations";
import { filterRegistrations, type RegistrationFilter } from "@/lib/academyRegistrations";
import { courseSpan } from "@/lib/academyCustomer";
import { academyErrorMessage } from "@/lib/academyErrors";
import { dateFnsLocaleFor } from "@/lib/dateFnsLocale";
import { RegistrationStatusBadge } from "@/components/academy/customer/RegistrationStatusBadge";
import { formatCourseDate } from "@/components/academy/customer/courseFormat";
import { CustomerContact } from "./CustomerContact";

const FILTERS: { id: RegistrationFilter; key: "academyFilterPending" | "academyFilterConfirmed" | "academyFilterAll" }[] = [
  { id: "pending", key: "academyFilterPending" },
  { id: "confirmed", key: "academyFilterConfirmed" },
  { id: "all", key: "academyFilterAll" },
];

/**
 * Dashboard "Registrations" tab (academy): every course registration of the
 * branch, filtered Pending / Confirmed / All with counts. Pending rows can be
 * approved, or rejected after a confirm. Both go through
 * decide_course_registration and update the list optimistically.
 */
export function RegistrationsTab() {
  const { t, lang } = useLang();
  const locale = dateFnsLocaleFor(lang);
  const { registrations, counts, isLoading, decide } = useAcademyRegistrations();
  const { courses, sessionsByCourse } = useAcademyCourses();
  const [filter, setFilter] = useState<RegistrationFilter>("pending");
  const [rejecting, setRejecting] = useState<ProviderRegistration | null>(null);

  const courseById = useMemo(() => new Map(courses.map((c) => [c.id, c])), [courses]);
  const rows = filterRegistrations(registrations, filter);

  const courseDates = (courseId: string) => {
    const span = courseSpan(sessionsByCourse.get(courseId) ?? []);
    if (!span.first || !span.last) return null;
    return span.first.session_date === span.last.session_date
      ? formatCourseDate(span.first.session_date, locale)
      : `${formatCourseDate(span.first.session_date, locale)} – ${formatCourseDate(span.last.session_date, locale)}`;
  };

  const run = async (registration: ProviderRegistration, decision: "confirmed" | "rejected") => {
    try {
      await decide.mutateAsync({
        registration,
        decision,
        courseName: courseById.get(registration.course_id)?.name ?? "",
      });
      toast.success(decision === "confirmed" ? t("academyApprovedToast") : t("academyRejectedToast"));
    } catch (err) {
      toast.error(academyErrorMessage(err, t));
    }
  };

  const busyId = decide.isPending ? decide.variables?.registration.id : null;

  return (
    <div className="flex flex-col gap-3 pb-6">
      <div className="flex gap-1 rounded-2xl border border-border/40 bg-secondary/80 p-1" role="tablist">
        {FILTERS.map((f) => {
          const on = filter === f.id;
          const n = counts[f.id];
          return (
            <button
              key={f.id}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => setFilter(f.id)}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-semibold transition-colors ${
                on ? "bg-card text-accent shadow-sm" : "text-muted-foreground"
              }`}
            >
              {t(f.key)}
              {n > 0 && (
                <span
                  className={`inline-flex min-w-[18px] items-center justify-center rounded-full px-1 text-[11px] font-bold ${
                    f.id === "pending" ? "bg-amber-500 text-white" : "bg-muted-foreground/15 text-muted-foreground"
                  }`}
                >
                  {n}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {isLoading ? (
        [0, 1].map((i) => <div key={i} className="h-36 rounded-2xl bg-secondary animate-pulse" />)
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border py-14 text-center">
          <ClipboardList className="mx-auto mb-2 h-10 w-10 text-muted-foreground/30" />
          <p className="text-sm text-muted-foreground">{t("academyRegistrationsEmpty")}</p>
        </div>
      ) : (
        rows.map((r, i) => {
          const course = courseById.get(r.course_id);
          const dates = courseDates(r.course_id);
          const busy = busyId === r.id;
          return (
            <motion.article
              key={r.id}
              layout
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(i, 8) * 0.03 }}
              className={`space-y-3 rounded-2xl border p-4 ${
                r.status === "pending" ? "border-amber-200 bg-amber-50/60" : "border-border bg-card"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <CustomerContact name={r.customer_name} phone={r.customer_phone} />
                <RegistrationStatusBadge status={r.status} className="shrink-0" />
              </div>

              <div className="space-y-1 text-xs text-muted-foreground">
                <p className="flex items-center gap-1.5 font-medium text-foreground">
                  <BookOpen className="h-3.5 w-3.5 shrink-0 text-accent" />
                  <span className="truncate">{course?.name ?? "—"}</span>
                </p>
                {dates && (
                  <p className="flex items-center gap-1.5">
                    <CalendarDays className="h-3.5 w-3.5 shrink-0" />
                    {dates}
                  </p>
                )}
                <p className="flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5 shrink-0" />
                  {t("academyRegisteredAt").replace("{d}", format(parseISO(r.created_at), "d MMM, HH:mm", { locale }))}
                </p>
              </div>

              {r.status === "pending" && (
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-9 flex-1 gap-1 border-emerald-300 bg-white text-xs text-emerald-700 hover:bg-emerald-50"
                    onClick={() => void run(r, "confirmed")}
                    disabled={busy}
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    {t("academyApprove")}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-9 flex-1 gap-1 border-red-200 bg-white text-xs text-red-600 hover:bg-red-50"
                    onClick={() => setRejecting(r)}
                    disabled={busy}
                  >
                    <XCircle className="h-3.5 w-3.5" />
                    {t("academyReject")}
                  </Button>
                </div>
              )}
            </motion.article>
          );
        })
      )}

      <AlertDialog open={rejecting !== null} onOpenChange={(open) => !open && setRejecting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("academyRejectConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("academyRejectConfirmBody")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(e) => {
                e.preventDefault();
                const target = rejecting;
                setRejecting(null);
                if (target) void run(target, "rejected");
              }}
            >
              {t("academyReject")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
