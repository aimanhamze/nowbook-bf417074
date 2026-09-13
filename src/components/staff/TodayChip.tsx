import { useLang } from "@/contexts/LangContext";
import { formatWindow, type MemberDayStatus } from "@/lib/staffToday";
import { cn } from "@/lib/utils";

interface Props {
  /** null = the member is inactive; today's status is irrelevant. */
  status: MemberDayStatus | null;
  className?: string;
}

/**
 * One member's today, in words. Four outcomes, four visuals, so the owner can
 * tell "took the day off" (deliberate, temporary) from "not scheduled" (the
 * weekly pattern) from "the shop is shut" (nobody's fault) at a glance.
 *
 * The time range sits in <bdi>: it is LTR content inside RTL text, and without
 * isolation the bidi algorithm can flip "09:00–15:00" into "15:00–09:00".
 */
export function TodayChip({ status, className }: Props) {
  const { t } = useLang();

  const base = "inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold";

  if (status === null) {
    return <span className={cn(base, "bg-secondary text-muted-foreground", className)}>{t("staffInactive")}</span>;
  }
  if (status.kind === "working") {
    return (
      <span className={cn(base, "bg-green-100 text-green-700", className)}>
        <span>{t("staffChipWorking")}</span>
        <bdi className="font-medium">{formatWindow(status.window)}</bdi>
      </span>
    );
  }
  if (status.kind === "dayOff") {
    return <span className={cn(base, "bg-accent/[0.12] text-accent", className)}>{t("staffChipDayOff")}</span>;
  }
  if (status.kind === "shopClosed") {
    return <span className={cn(base, "bg-secondary text-muted-foreground", className)}>{t("staffChipShopClosed")}</span>;
  }
  return <span className={cn(base, "bg-secondary text-muted-foreground", className)}>{t("staffChipNotScheduled")}</span>;
}
