import { useState } from "react";
import { Ban, Users } from "lucide-react";
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
import { useAcademyRegistrations, type ProviderRegistration } from "@/hooks/useAcademyRegistrations";
import { courseRegistrants } from "@/lib/academyRegistrations";
import { academyErrorMessage } from "@/lib/academyErrors";
import { RegistrationStatusBadge } from "@/components/academy/customer/RegistrationStatusBadge";
import { CustomerContact } from "./CustomerContact";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  course: AcademyCourseRow | null;
}

/**
 * Who holds a seat in one course (pending + confirmed), seats taken / max, and
 * a Cancel per registrant. The owner may cancel at any time (the RPC records
 * cancelled_by = 'provider' and notifies the customer); it is confirmed first.
 */
export function CourseRegistrantsSheet({ open, onOpenChange, course }: Props) {
  const { t } = useLang();
  const { registrations, isLoading, cancelAsProvider } = useAcademyRegistrations();
  const [cancelling, setCancelling] = useState<ProviderRegistration | null>(null);

  const list = course ? courseRegistrants(registrations, course.id) : [];

  const onConfirmCancel = async () => {
    const target = cancelling;
    setCancelling(null);
    if (!target || !course) return;
    try {
      await cancelAsProvider.mutateAsync({ registration: target, courseName: course.name });
      toast.success(t("academyCancelledToast"));
    } catch (err) {
      toast.error(academyErrorMessage(err, t));
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className={`max-h-[92vh] overflow-y-auto rounded-t-3xl ${providerDesktopSheet}`}>
        <SheetHeader>
          <SheetTitle>
            {t("academyRegistrants")}
            {course && <span className="font-normal text-muted-foreground"> · {course.name}</span>}
          </SheetTitle>
        </SheetHeader>

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
            [0, 1].map((i) => <div key={i} className="h-20 rounded-2xl bg-secondary animate-pulse" />)
          ) : list.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">{t("academyNoRegistrants")}</p>
          ) : (
            list.map((r) => (
              <div key={r.id} className="flex items-center gap-3 rounded-2xl border border-border p-3">
                <div className="min-w-0 flex-1">
                  <CustomerContact name={r.customer_name} phone={r.customer_phone} />
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1.5">
                  <RegistrationStatusBadge status={r.status} />
                  <button
                    type="button"
                    onClick={() => setCancelling(r)}
                    disabled={cancelAsProvider.isPending}
                    className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold text-destructive hover:bg-destructive/5 disabled:opacity-50"
                  >
                    <Ban className="h-3.5 w-3.5" />
                    {t("academyCancelRegistration")}
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        <AlertDialog open={cancelling !== null} onOpenChange={(o) => !o && setCancelling(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {t("academyProviderCancelTitle").replace(
                  "{name}",
                  cancelling?.customer_name || cancelling?.customer_phone || t("academyUnknownCustomer"),
                )}
              </AlertDialogTitle>
              <AlertDialogDescription>{t("academyProviderCancelBody")}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={(e) => {
                  e.preventDefault();
                  void onConfirmCancel();
                }}
              >
                {t("academyCancelRegistration")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </SheetContent>
    </Sheet>
  );
}
