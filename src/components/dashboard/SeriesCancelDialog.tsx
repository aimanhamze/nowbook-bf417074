import { useState } from "react";
import { XCircle } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useLang } from "@/contexts/LangContext";
import { cn } from "@/lib/utils";
import { useProviderBookings, type EnrichedBooking } from "@/hooks/useProviderBookings";
import { useCancelRecurringSeries } from "@/hooks/useRecurringSeries";
import {
  seriesCancelCounts,
  type SeriesBookingRow,
  type SeriesCancelScope,
} from "@/lib/recurringSeries";

/**
 * The three-way cancel for a booking that belongs to a recurring series.
 * Rendered ONLY for series bookings — every other booking keeps its one-tap
 * cancel, untouched.
 *
 *   Only this one        → `onOnlyThis`: the caller's existing single-cancel
 *                          path, byte-for-byte (its own message, its own toasts)
 *   This one and after   → cancel_recurring_series 'from_here'
 *   All upcoming         → cancel_recurring_series 'all_upcoming'
 *
 * The two series scopes send ONE WhatsApp for the whole action (see
 * useCancelRecurringSeries); past appointments are never touched.
 */
export function SeriesCancelDialog({
  booking,
  open,
  onOpenChange,
  onOnlyThis,
}: {
  booking: EnrichedBooking;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOnlyThis: () => void;
}) {
  const { t } = useLang();
  const { data: all } = useProviderBookings();
  const cancelSeries = useCancelRecurringSeries();
  const [busy, setBusy] = useState<SeriesCancelScope | null>(null);

  const counts = seriesCancelCounts(
    (all ?? []) as unknown as SeriesBookingRow[],
    booking as unknown as SeriesBookingRow,
  );

  const countLabel = (n: number) =>
    n === 1 ? t("seriesCancelCountOne") : t("seriesCancelCount").replace("{n}", String(n));

  const runSeries = async (scope: SeriesCancelScope) => {
    setBusy(scope);
    try {
      const res = await cancelSeries.mutateAsync({ bookingId: booking.id, scope });
      if (res.code === "OK") {
        toast.success(
          res.cancelledCount === 1
            ? t("seriesCancelDoneOne")
            : t("seriesCancelDone").replace("{n}", String(res.cancelledCount)),
        );
        onOpenChange(false);
      } else if (res.code === "NOTHING_TO_CANCEL") {
        toast.error(t("seriesCancelNothing"));
        onOpenChange(false);
      } else {
        toast.error(t("seriesCancelFailed"));
      }
    } catch {
      toast.error(t("seriesCancelFailed"));
    } finally {
      setBusy(null);
    }
  };

  const options: {
    key: string;
    label: string;
    hint: string | null;
    disabled: boolean;
    onClick: () => void;
  }[] = [
    {
      key: "only",
      label: t("seriesCancelOnlyThis"),
      hint: null,
      disabled: false,
      onClick: () => {
        onOpenChange(false);
        onOnlyThis();
      },
    },
    {
      key: "from_here",
      label: t("seriesCancelFromHere"),
      hint: countLabel(counts.fromHere),
      disabled: counts.fromHere === 0,
      onClick: () => runSeries("from_here"),
    },
    {
      key: "all_upcoming",
      label: t("seriesCancelAllUpcoming"),
      hint: countLabel(counts.allUpcoming),
      disabled: counts.allUpcoming === 0,
      onClick: () => runSeries("all_upcoming"),
    },
  ];

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="w-[calc(100%-2rem)] max-w-sm gap-5 rounded-2xl p-5">
        {/* Start-aligned on phones too, so no start padding; the end keeps the
            close button's room from DialogHeader. */}
        <DialogHeader className="ps-0 text-start">
          <DialogTitle className="text-base leading-snug">{t("seriesCancelTitle")}</DialogTitle>
          <DialogDescription>{t("seriesCancelDesc")}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          {options.map((o) => (
            <button
              key={o.key}
              type="button"
              onClick={o.onClick}
              disabled={o.disabled || !!busy}
              className={cn(
                "flex min-h-12 w-full items-center justify-between gap-3 rounded-xl border border-amber-200 px-4 py-2 text-start",
                "text-sm font-semibold text-amber-700 transition-colors hover:bg-amber-50 active:scale-[0.99]",
                "disabled:cursor-not-allowed disabled:opacity-50",
              )}
            >
              <span className="flex min-w-0 items-center gap-2">
                {busy === o.key ? (
                  <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-amber-300 border-t-amber-700" />
                ) : (
                  <XCircle className="h-4 w-4 shrink-0" />
                )}
                <span className="min-w-0">{o.label}</span>
              </span>
              {o.hint && (
                <span className="shrink-0 text-xs font-medium text-muted-foreground tabular-nums">{o.hint}</span>
              )}
            </button>
          ))}
        </div>

        <p className="text-xs leading-relaxed text-muted-foreground">{t("seriesCancelPastNote")}</p>
      </DialogContent>
    </Dialog>
  );
}
