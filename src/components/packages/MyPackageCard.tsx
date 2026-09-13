import { format, parseISO } from "date-fns";
import { Ticket } from "lucide-react";
import { motion } from "framer-motion";
import { useLang } from "@/contexts/LangContext";
import { packageStatusLabel, packageStatusClass } from "@/lib/packageStatus";
import type { CustomerPackageRow } from "@/integrations/supabase/packageTypes";

/**
 * A customer's own package, showing what they have left.
 *
 * Shared by the bookings page (all providers) and a fitness studio's profile
 * (that provider only), so the balance is worded and coloured identically
 * wherever the customer runs into it.
 *
 * `showProvider` is off on the profile page, where naming the studio the
 * customer is already looking at would just be noise.
 */
export function MyPackageCard({
  pkg,
  providerName,
  templateName,
  showProvider = true,
  index = 0,
}: {
  pkg: CustomerPackageRow;
  providerName?: string | null;
  templateName?: string | null;
  showProvider?: boolean;
  index?: number;
}) {
  const { t } = useLang();
  const remaining = pkg.entries_remaining;
  const total = pkg.total_entries;
  // Defensive clamp. package_add_entries raises total_entries alongside the
  // balance, so remaining should never exceed total — but a bar that overflows
  // its track is a worse failure than one that sits at 100%.
  const pct = total > 0 ? Math.min(100, Math.round((remaining / total) * 100)) : 0;
  const isPending = pkg.status === "pending_activation";

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05, duration: 0.35 }}
      className="surface-soft rounded-2xl p-4"
    >
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent">
          <Ticket className="h-4 w-4" />
        </div>

        <div className="min-w-0 flex-1 text-start">
          {showProvider && providerName && (
            <p className="truncate text-sm font-semibold">{providerName}</p>
          )}
          {templateName && (
            <p className="truncate text-xs text-muted-foreground">{templateName}</p>
          )}
          <p className="mt-1 text-[11px] text-muted-foreground">
            {isPending
              ? t("purchasePendingNote")
              : pkg.expires_at
                ? `${t("expiresOn")} ${format(parseISO(pkg.expires_at), "dd/MM/yyyy")}`
                : t("notActivated")}
          </p>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1">
          <span
            className={`rounded-full border px-2 py-0.5 text-[10px] ${packageStatusClass(pkg)}`}
          >
            {t(packageStatusLabel(pkg) as never)}
          </span>
          <span className="text-lg font-bold leading-none tabular-nums">
            {remaining}
            <span className="text-xs font-medium text-muted-foreground">/{total}</span>
          </span>
          <span className="text-[10px] text-muted-foreground">{t("entriesRemaining")}</span>
        </div>
      </div>

      {/* Progress track — a glance-level read of how much is left. Hidden while
          pending, where the balance is not yet spendable and a full bar would
          imply the package is ready to use. */}
      {!isPending && (
        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-secondary">
          <div
            className="h-full rounded-full bg-accent transition-[width] duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </motion.div>
  );
}
