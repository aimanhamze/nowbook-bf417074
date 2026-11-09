import { useState } from "react";
import { format, parseISO } from "date-fns";
import { Ban, CheckCircle2, Clock, Users, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
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
import { providerDesktopSheet } from "@/components/layout/providerDesktop";
import { useLang } from "@/contexts/LangContext";
import type { AcademyCourseRow } from "@/integrations/supabase/academyTypes";
import {
  useAcademyRegistrations,
  type ProviderRegistration,
  type RegistrationsScope,
} from "@/hooks/useAcademyRegistrations";
import { courseRegistrants } from "@/lib/academyRegistrations";
import { academyErrorMessage } from "@/lib/academyErrors";
import { dateFnsLocaleFor } from "@/lib/dateFnsLocale";
import { RegistrationStatusBadge } from "@/components/academy/customer/RegistrationStatusBadge";
import { CustomerContact } from "./CustomerContact";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  course: AcademyCourseRow | null;
  /** Extra line under the title, e.g. the tapped session's date and time. */
  subtitle?: string;
  /**
   * Which registrations query to read. Pass the SAME scope the caller already
   * uses (the calendar passes its range's course ids) so the sheet shares that
   * cache entry. Omitted = the whole branch.
   */
  scope?: RegistrationsScope;
}

/**
 * Who holds a seat in one course (pending + confirmed) with seats taken / max.
 * Pending people can be approved or rejected (decide_course_registration;
 * reject confirms first); confirmed people can be cancelled by the owner
 * (cancel_course_registration, cancelled_by = 'provider'; confirms first).
 * Every action goes through useAcademyRegistrations, so the change shows at
 * once and the tab, badge and calendar refresh together.
 */
export function CourseRegistrantsSheet({ open, onOpenChange, course, subtitle, scope }: Props) {
  const { t, lang } = useLang();
  const locale = dateFnsLocaleFor(lang);
  const { registrations, isLoading, decide, cancelAsProvider } = useAcademyRegistrations(scope);
  const [confirming, setConfirming] = useState<{ kind: "reject" | "cancel"; registration: ProviderRegistration } | null>(
    null,
  );

  const list = course ? courseRegistrants(registrations, course.id) : [];
  const busy = decide.isPending || cancelAsProvider.isPending;

  const runDecide = async (registration: ProviderRegistration, decision: "confirmed" | "rejected") => {
    if (!course) return;
    try {
      await decide.mutateAsync({ registration, decision, courseName: course.name });
      toast.success(decision === "confirmed" ? t("academyApprovedToast") : t("academyRejectedToast"));
    } catch (err) {
      toast.error(academyErrorMessage(err, t));
    }
  };

  const runCancel = async (registration: ProviderRegistration) => {
    if (!course) return;
    try {
      await cancelAsProvider.mutateAsync({ registration, courseName: course.name });
      toast.success(t("academyCancelledToast"));
    } catch (err) {
      toast.error(academyErrorMessage(err, t));
    }
  };

  const onConfirm = () => {
    const c = confirming;
    setConfirming(null);
    if (!c) return;
    if (c.kind === "reject") void runDecide(c.registration, "rejected");
    else void runCancel(c.registration);
  };

  const who = (r: ProviderRegistration | undefined) => r?.customer_name || r?.customer_phone || t("academyUnknownCustomer");

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className={`max-h-[92vh] overflow-y-auto rounded-t-3xl ${providerDesktopSheet}`}>
        <SheetHeader className="text-start">
          <SheetTitle className="text-start">
            {t("academyRegistrants")}
            {course && <span className="font-normal text-muted-foreground"> · {course.name}</span>}
          </SheetTitle>
        </SheetHeader>

        {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
        {course && (
          <p className="mt-2 flex items-center gap-1.5 text-sm text-muted-foreground">
            <Users className="h-4 w-4 text-accent" />
            {t("academySeatsTaken")
              .replace("{taken}", String(list.length))
              .replace("{max}", String(course.max_seats))}
          </p>
        )}

        <div className="mt-4 flex flex-col gap-2 pb-4">
          {isLoading ? (
            [0, 1].map((i) => <div key={i} className="h-24 rounded-2xl bg-secondary animate-pulse" />)
          ) : list.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">{t("academyNoRegistrants")}</p>
          ) : (
            list.map((r) => (
              <div
                key={r.id}
                className={`space-y-2.5 rounded-2xl border p-3 ${
                  r.status === "pending" ? "border-amber-200 bg-amber-50/60" : "border-border"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <CustomerContact name={r.customer_name} phone={r.customer_phone} />
                  <RegistrationStatusBadge status={r.status} className="shrink-0" />
                </div>
                <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <Clock className="h-3 w-3" />
                  {t("academyRegisteredAt").replace("{d}", format(parseISO(r.created_at), "d MMM, HH:mm", { locale }))}
                </p>

                {r.status === "pending" ? (
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => void runDecide(r, "confirmed")}
                      disabled={busy}
                      className="inline-flex h-9 flex-1 items-center justify-center gap-1 rounded-lg border border-emerald-300 bg-white text-xs font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      {t("academyApprove")}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirming({ kind: "reject", registration: r })}
                      disabled={busy}
                      className="inline-flex h-9 flex-1 items-center justify-center gap-1 rounded-lg border border-red-200 bg-white text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50"
                    >
                      <XCircle className="h-3.5 w-3.5" />
                      {t("academyReject")}
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirming({ kind: "cancel", registration: r })}
                    disabled={busy}
                    className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold text-destructive hover:bg-destructive/5 disabled:opacity-50"
                  >
                    <Ban className="h-3.5 w-3.5" />
                    {t("academyCancelRegistration")}
                  </button>
                )}
              </div>
            ))
          )}
        </div>

        <AlertDialog open={confirming !== null} onOpenChange={(o) => !o && setConfirming(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {confirming?.kind === "reject"
                  ? t("academyRejectConfirmTitle")
                  : t("academyProviderCancelTitle").replace("{name}", who(confirming?.registration))}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {confirming?.kind === "reject" ? t("academyRejectConfirmBody") : t("academyProviderCancelBody")}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={(e) => {
                  e.preventDefault();
                  onConfirm();
                }}
              >
                {confirming?.kind === "reject" ? t("academyReject") : t("academyCancelRegistration")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </SheetContent>
    </Sheet>
  );
}
