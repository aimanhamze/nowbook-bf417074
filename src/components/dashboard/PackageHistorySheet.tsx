import { format, parseISO } from "date-fns";
import { ArrowDown, ArrowUp, History, Minus } from "lucide-react";
import { useLang } from "@/contexts/LangContext";
import { usePackageHistory, type EnrichedCustomerPackage } from "@/hooks/useCustomerPackages";
import type { PackageUsageAction } from "@/integrations/supabase/packageTypes";
import { EditSheet } from "./SettingsRows";

/** Ledger action → translation key. Mirrors the DB CHECK constraint exactly. */
const ACTION_LABELS: Record<PackageUsageAction, string> = {
  entry_deducted: "logEntryDeducted",
  entry_returned_cancellation: "logEntryReturnedCancellation",
  entry_returned_manual: "logEntryReturnedManual",
  entry_added_manual: "logEntryAddedManual",
  entry_removed_manual: "logEntryRemovedManual",
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

  // Read-only: the shared shell without a footer or branch suffix.
  return (
    <EditSheet
      open={!!pkg}
      onClose={onClose}
      icon={History}
      title={t("packageHistory")}
      writes={false}
      description={pkg ? (
        <>
          {pkg.customer_name || pkg.customer_phone} · {pkg.template_name} ·{" "}
          <span dir="ltr" className="font-medium tabular-nums text-foreground">
            {pkg.entries_remaining}/{pkg.total_entries}
          </span>
        </>
      ) : undefined}
    >
      {isLoading ? (
        <div className="h-16 animate-pulse rounded-2xl bg-foreground/[0.05]" />
      ) : history.length === 0 ? (
        <p className="py-6 text-center text-sm text-foreground/60">{t("historyEmpty")}</p>
      ) : (
        <ul className="overflow-hidden rounded-2xl border border-foreground/10 bg-white">
          {history.map((row, i) => {
            const delta = row.entries_after - row.entries_before;
            return (
              <li key={row.id} className={`flex items-start gap-3 px-4 py-3 ${i > 0 ? "border-t border-foreground/[0.07]" : ""}`}>
                <span
                  className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
                    delta > 0
                      ? "bg-emerald-50 text-emerald-600"
                      : delta < 0
                        ? "bg-rose-50 text-rose-600"
                        : "bg-foreground/[0.06] text-foreground/50"
                  }`}
                >
                  {delta > 0 ? <ArrowUp className="h-3.5 w-3.5" /> : delta < 0 ? <ArrowDown className="h-3.5 w-3.5" /> : <Minus className="h-3.5 w-3.5" />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{t(ACTION_LABELS[row.action_type] as never)}</p>
                  <p className="mt-0.5 text-xs text-foreground/60">
                    <span dir="ltr" className="tabular-nums">{row.entries_before} → {row.entries_after}</span>
                    {" · "}
                    <span dir="ltr" className="tabular-nums">{format(parseISO(row.created_at), "dd/MM/yyyy HH:mm")}</span>
                  </p>
                  {row.note && <p className="mt-1 break-words text-xs text-foreground/75">{row.note}</p>}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </EditSheet>
  );
}
