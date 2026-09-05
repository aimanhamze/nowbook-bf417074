import { format } from "date-fns";
import { useLang } from "@/contexts/LangContext";
import { dateFnsLocaleFor } from "@/lib/dateFnsLocale";
import type { DayWindow } from "@/lib/availabilityResolver";

interface Props {
  today: Date;
  /** The shop's own window for today. null = closed, and nobody is working. */
  shopToday: DayWindow | null;
  working: number;
  off: number;
  inactive: number;
}

/**
 * The first thing under the header: how many hands do I have today?
 *
 * Three numbers, or one sentence when the shop is shut — a closed shop is not
 * "0 working, 4 off", it is closed, and saying so mirrors the resolver's rule
 * that a closed shop wins before any member is consulted.
 *
 * Counts sit in <bdi> so a digit next to Hebrew or Arabic never picks up the
 * wrong direction.
 */
export function TodayStrip({ today, shopToday, working, off, inactive }: Props) {
  const { t, lang } = useLang();
  const dateLabel = format(today, "EEEE, d MMM", { locale: dateFnsLocaleFor(lang) });

  return (
    <section className="glass-card rounded-2xl px-4 py-3.5">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <p className="text-sm font-bold">{t("staffToday")}</p>
        <p className="text-xs text-muted-foreground">{dateLabel}</p>
      </div>

      {shopToday === null ? (
        <p className="text-[13px] text-muted-foreground">{t("staffShopClosedToday")}</p>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          <Stat value={working} label={t("staffWorkingCount")} tone="text-green-700" />
          <Stat value={off} label={t("staffOffCount")} tone="text-accent" />
          <Stat value={inactive} label={t("staffInactiveCount")} tone="text-muted-foreground" />
        </div>
      )}
    </section>
  );
}

function Stat({ value, label, tone }: { value: number; label: string; tone: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className={`text-[22px] font-bold leading-[1.1] ${tone}`}>
        <bdi>{value}</bdi>
      </span>
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
    </div>
  );
}
