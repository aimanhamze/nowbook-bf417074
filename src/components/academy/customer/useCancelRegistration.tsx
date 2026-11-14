import { useState } from "react";
import { toast } from "sonner";
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
import { useCancelCourseRegistration } from "@/hooks/usePublicCourses";
import { academyErrorMessage } from "@/lib/academyErrors";
import { deliverCoursePush } from "@/lib/academyPushDelivery";

/**
 * The customer's "cancel my registration" flow: ask first, then
 * cancel_course_registration, a toast, and the provider's push. Render
 * `dialog` once; call `requestCancel(registrationId)` from the button.
 */
export function useCancelRegistration() {
  const { t } = useLang();
  const cancel = useCancelCourseRegistration();
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const onConfirm = async () => {
    if (!confirmId) return;
    try {
      await cancel.mutateAsync(confirmId);
      toast.success(t("academyCancelledToast"));
      // The RPC wrote the provider's in-app row; this only delivers it.
      deliverCoursePush("cancelled_by_customer", confirmId);
    } catch (err) {
      toast.error(academyErrorMessage(err, t));
    } finally {
      setConfirmId(null);
    }
  };

  const dialog = (
    <AlertDialog open={confirmId !== null} onOpenChange={(open) => !open && setConfirmId(null)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("academyCancelConfirmTitle")}</AlertDialogTitle>
          <AlertDialogDescription>{t("academyCancelConfirmBody")}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            disabled={cancel.isPending}
            onClick={(e) => {
              e.preventDefault();
              void onConfirm();
            }}
          >
            {t("academyCancelRegistration")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return {
    requestCancel: setConfirmId,
    dialog,
    cancellingId: cancel.isPending ? (cancel.variables ?? null) : null,
  };
}
