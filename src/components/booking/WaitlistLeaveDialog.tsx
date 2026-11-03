import type { ReactNode } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useLang } from "@/contexts/LangContext";
import { waitlistDateLabel } from "@/lib/waitlistDay";

/**
 * "Leave the waiting list?" — the one confirmation in front of every leave:
 * the booking page, /bookings and the provider page. The caller owns the
 * mutation; this only gates it.
 */
export function WaitlistLeaveDialog({
  entryDate,
  providerName,
  trigger,
  onConfirm,
}: {
  entryDate: string;
  providerName: string;
  trigger: ReactNode;
  onConfirm: () => void;
}) {
  const { lang, t } = useLang();
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
      <AlertDialogContent className="w-[calc(100%-2rem)] max-w-sm rounded-3xl">
        <AlertDialogHeader>
          <AlertDialogTitle>{t("waitlistLeaveConfirmTitle")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("waitlistLeaveConfirmBody")
              .replace("{date}", waitlistDateLabel(entryDate, lang))
              .replace("{provider}", providerName)}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="gap-2 sm:space-x-0">
          <AlertDialogCancel className="mt-0 h-11 rounded-2xl">{t("waitlistStay")}</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm} className="h-11 rounded-2xl bg-red-600 text-white hover:bg-red-700">
            {t("waitlistLeaveConfirm")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
