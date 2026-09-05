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

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  pending: boolean;
}

/** Deactivate confirmation — explains that booking history survives. */
export function DeactivateDialog({ open, onOpenChange, onConfirm, pending }: Props) {
  const { t } = useLang();
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("deactivateStaffConfirmTitle")}</AlertDialogTitle>
          <AlertDialogDescription>{t("deactivateStaffConfirmBody")}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            disabled={pending}
            onClick={(e) => {
              e.preventDefault();
              onConfirm();
            }}
          >
            {t("deactivateStaff")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
