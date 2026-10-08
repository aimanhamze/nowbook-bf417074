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
import type { Tables } from "@/integrations/supabase/types";
import { bookingDateTime } from "@/lib/bookingActions";

const LOCALES: Record<string, string> = { he: "he-IL", ar: "ar", en: "en-US" };

/**
 * "Cancel this appointment?" — the one confirmation step in front of a
 * customer self-cancel, on the bookings list and the provider-page card alike.
 * The caller owns the mutation; this only gates it.
 */
export function CancelBookingDialog({
  booking,
  trigger,
  onConfirm,
}: {
  booking: Tables<"bookings">;
  trigger: ReactNode;
  onConfirm: () => void;
}) {
  const { lang, t } = useLang();
  const date = bookingDateTime(booking).toLocaleDateString(LOCALES[lang] ?? "he-IL", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
      <AlertDialogContent className="w-[calc(100%-2rem)] max-w-sm rounded-3xl">
        <AlertDialogHeader>
          <AlertDialogTitle>{t("cancelConfirmTitle")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("cancelConfirmBody")
              .replace("{date}", date)
              .replace("{time}", "⁦" + booking.booking_time + "⁩")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="gap-2 sm:space-x-0">
          <AlertDialogCancel className="mt-0 h-11 rounded-2xl">{t("keepBooking")}</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            className="h-11 rounded-2xl bg-red-600 text-white hover:bg-red-700"
          >
            {t("confirmCancelBooking")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
