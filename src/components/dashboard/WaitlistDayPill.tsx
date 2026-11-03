import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { BellRing } from "lucide-react";
import { useLang } from "@/contexts/LangContext";
import { useProviderWaitlistCounts } from "@/hooks/useProviderWaitlist";

/**
 * "3 waiting" for one day, next to the calendar's day header. Renders nothing
 * when the provider has the waiting list off or nobody is waiting that day.
 * Counts are the whole branch's: the calendar's staff filter does not apply
 * (v1) — the list shows each entry's staff instead.
 */
export function WaitlistDayPill({ date, className }: { date: Date; className?: string }) {
  const { t } = useLang();
  const { enabled, counts } = useProviderWaitlistCounts();
  const count = enabled ? counts.get(format(date, "yyyy-MM-dd")) ?? 0 : 0;
  if (count === 0) return null;

  return (
    <span className={cn("inline-flex min-h-11 items-center gap-1.5 rounded-full border border-dashed border-accent/50 bg-accent/[0.07] px-3 text-xs font-semibold text-accent", className)}>
      <BellRing className="h-3.5 w-3.5 shrink-0" />
      {count === 1 ? t("waitlistWaitingOne") : t("waitlistWaiting").replace("{count}", String(count))}
    </span>
  );
}
