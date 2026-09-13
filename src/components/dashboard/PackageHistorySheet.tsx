import { format, parseISO } from "date-fns";
import { ArrowDown, ArrowUp, Minus } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { providerDesktopSheet } from "@/components/layout/providerDesktop";
import { useLang } from "@/contexts/LangContext";
import { usePackageHistory, type EnrichedCustomerPackage } from "@/hooks/useCustomerPackages";
import type { PackageUsageAction } from "@/integrations/supabase/packageTypes";

/** Ledger action → translation key. Mirrors the DB CHECK constraint exactly. */
const ACTION_LABELS: Record<PackageUsageAction, string> = {
  entry_deducted: "logEntryDeducted",
  entry_returned_cancellation: "logEntryReturnedCancellation",
  entry_returned_manual: "logEntryReturnedManual",
  entry_added_manual: "logEntryAddedManual",
  package_activated: "logPackageActivated",
  package_exhausted: "logPackageExhausted",
  package_expired: "logPackageExpired",
  package_extended: "logPackageExtended",
  package_cancelled: "logPackageCancelled",
  package_requested: "logPackageRequested",
};

/**
 * The audit trail for one sold package, oldest first.
 *
 * Every row shows before → after rather than a bare delta, because that is what
 * makes a disputed balance reconstructible: the provider can follow the chain
 * and see exactly where it diverged from what the customer expected.
 */
export function PackageHistorySheet({
  pkg,
  onClose,
}: {
  pkg: EnrichedCustomerPackage | null;
  onClose: () => void;
}) {
  const { t } = useLang();
  const { data: history = [], isLoading } = usePackageHistory(pkg?.id ?? null);

  return (
    <Sheet open={!!pkg} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="bottom"
        className={`max-h-[85vh] overflow-y-auto rounded-t-3xl ${providerDesktopSheet}`}
      >
        <SheetHeader>
          <SheetTitle>{t("packageHistory")}</SheetTitle>
        </SheetHeader>

        {pkg && (
          <p className="pt-1 text-xs text-muted-foreground">
            {pkg.customer_name || pkg.customer_phone} · {pkg.template_name} ·{" "}
            <span className="tabular-nums font-medium text-foreground">
              {pkg.entries_remaining}/{pkg.total_entries}
            </span>
          </p>
        )}

        <div className="space-y-2 py-4">
          {isLoading ? (
            <div className="h-16 animate-pulse rounded-xl bg-secondary/60" />
          ) : history.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">{t("historyEmpty")}</p>
          ) : (
            history.map((row) => {
              const delta = row.entries_after - row.entries_before;
              return (
                <div
                  key={row.id}
                  className="flex items-start gap-3 rounded-xl border border-border bg-card p-3"
                >
                  <div
                    className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
                      delta > 0
                        ? "bg-emerald-50 text-emerald-600"
                        : delta < 0
                          ? "bg-rose-50 text-rose-600"
                          : "bg-secondary text-muted-foreground"
                    }`}
                  >
                    {delta > 0 ? (
                      <ArrowUp className="h-3 w-3" />
                    ) : delta < 0 ? (
                      <ArrowDown className="h-3 w-3" />
                    ) : (
                      <Minus className="h-3 w-3" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium">
                      {t(ACTION_LABELS[row.action_type] as never)}
                    </p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground tabular-nums">
                      {row.entries_before} → {row.entries_after} ·{" "}
                      {format(parseISO(row.created_at), "dd/MM/yyyy HH:mm")}
                    </p>
                    {row.note && (
                      <p className="mt-1 break-words text-[11px] text-foreground/70">{row.note}</p>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
