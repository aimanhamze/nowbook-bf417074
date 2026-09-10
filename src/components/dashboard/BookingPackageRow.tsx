import { format, parseISO } from "date-fns";
import { Package, CheckCircle2, Undo2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useLang } from "@/contexts/LangContext";
import { useAssignablePackages } from "@/hooks/useCustomerPackages";
import { usePackageActions, packageErrorKey } from "@/hooks/usePackageActions";
import type { EnrichedBooking } from "@/hooks/useProviderBookings";
import { toast } from "sonner";

/** Sentinel for the "no package" option — Radix Select rejects an empty value. */
const NO_PACKAGE = "__none__";

/**
 * Package controls on a provider's booking card: the balance badge, check-in,
 * and assigning or switching which package pays for this booking.
 *
 * Renders nothing for a walk-in (user_id NULL). customer_packages.customer_id
 * is NOT NULL against auth.users, so a package can only ever belong to a real
 * account — there is nothing to show or assign for a phone-only customer.
 */
export function BookingPackageRow({ booking }: { booking: EnrichedBooking }) {
  const { t } = useLang();
  const { checkIn, undoCheckIn, assignPackage, returnEntry } = usePackageActions();
  const { data: assignable = [] } = useAssignablePackages(booking.user_id);

  const hasPackage = !!booking.customer_package_id;
  const isCancelled = booking.status === "cancelled";
  const isConfirmed = booking.status === "confirmed";

  if (!booking.user_id || isCancelled) return null;
  // SCOPE: an entry may only ever pay for a GROUP CLASS. handle_package_booking
  // raises PACKAGES_FOR_CLASSES_ONLY for a regular appointment, so offering the
  // control on one would only produce a guaranteed error. class_schedule_id is
  // the same signal the booking flow uses to identify a class booking.
  if (!booking.class_schedule_id) return null;
  // Nothing to offer and nothing attached — stay out of the card entirely so
  // providers who never sell packages see no change at all.
  if (!hasPackage && assignable.length === 0) return null;

  const showError = (err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    const key = packageErrorKey(message);
    toast.error(key ? t(key as never) : message);
  };

  // The currently-attached package is not necessarily in `assignable` — that
  // list is filtered to spendable ones, and this booking's package may now be
  // exhausted (its last entry went to this very booking). Add it so the Select
  // can show what is actually attached rather than falling back to blank.
  const options = [...assignable];
  if (hasPackage && !options.some((p) => p.id === booking.customer_package_id)) {
    options.unshift({
      id: booking.customer_package_id!,
      template_name: booking.package_name,
      entries_remaining: booking.package_entries_remaining ?? 0,
      total_entries: booking.package_total_entries ?? 0,
    } as (typeof assignable)[number]);
  }

  return (
    <div className="space-y-2 rounded-lg border border-border/70 bg-secondary/30 p-2.5">
      <div className="flex flex-wrap items-center gap-2">
        {hasPackage && (
          <span className="inline-flex items-center gap-1 rounded-full bg-accent/10 px-2.5 py-1 text-[11px] font-medium text-accent">
            <Package className="h-3 w-3" />
            {booking.package_entries_remaining}/{booking.package_total_entries} {t("entriesShort")}
          </span>
        )}

        {booking.check_in_at ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700">
            <CheckCircle2 className="h-3 w-3" />
            {t("checkedInAt")} {format(parseISO(booking.check_in_at), "HH:mm")}
          </span>
        ) : (
          isConfirmed && hasPackage && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1 border-emerald-300 text-[11px] text-emerald-700 hover:bg-emerald-50"
              disabled={checkIn.isPending}
              onClick={() =>
                checkIn.mutate(booking.id, {
                  onSuccess: () => toast.success(t("checkedInToast")),
                  onError: showError,
                })
              }
            >
              <CheckCircle2 className="h-3 w-3" />
              {t("checkIn")}
            </Button>
          )
        )}

        {booking.check_in_at && (
          <>
            <button
              onClick={() =>
                undoCheckIn.mutate(booking.id, { onError: showError })
              }
              disabled={undoCheckIn.isPending}
              className="inline-flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
            >
              <Undo2 className="h-3 w-3" />
              {t("undoCheckIn")}
            </button>
            {hasPackage && (
              // Only reachable after check-in: the automatic refund in
              // handle_package_cancellation deliberately skips checked-in
              // bookings, so returning the entry is the provider's call.
              <button
                onClick={() =>
                  returnEntry.mutate(
                    { bookingId: booking.id },
                    {
                      onSuccess: () => toast.success(t("entryReturnedToast")),
                      onError: showError,
                    },
                  )
                }
                disabled={returnEntry.isPending}
                className="inline-flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
              >
                <RotateCcw className="h-3 w-3" />
                {t("returnEntry")}
              </button>
            )}
          </>
        )}
      </div>

      <Select
        value={booking.customer_package_id ?? NO_PACKAGE}
        onValueChange={(value) =>
          assignPackage.mutate(
            {
              bookingId: booking.id,
              packageId: value === NO_PACKAGE ? null : value,
            },
            {
              onSuccess: () => toast.success(t("packageAssignedToast")),
              onError: showError,
            },
          )
        }
        disabled={assignPackage.isPending}
      >
        <SelectTrigger className="h-8 text-[11px]">
          <SelectValue placeholder={t("assignPackage")} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NO_PACKAGE} className="text-[11px]">
            {t("noPackageAssigned")}
          </SelectItem>
          {options.map((pkg) => (
            <SelectItem key={pkg.id} value={pkg.id} className="text-[11px]">
              {pkg.template_name} · {pkg.entries_remaining}/{pkg.total_entries}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
