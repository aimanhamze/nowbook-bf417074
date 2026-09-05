import { useLang } from "@/contexts/LangContext";
import { dateFnsLocaleFor } from "@/lib/dateFnsLocale";
import { narrowWeekdayLabels, type MemberDayStatus } from "@/lib/staffToday";
import { cn } from "@/lib/utils";

/**
 * Seven dots for the coming week, today first.
 *
 *   filled accent  → working
 *   hollow         → not scheduled (configured week has this day off)
 *   dashed hollow  → the shop itself is closed
 *   tinted + bar   → the member's own day off
 *
 * The first dot carries a dark ring: it is today. There are no labels inside
 * the row — the letters live once, in <WeekDotsHeader>, above the whole roster.
 *
 * DIRECTION: a plain flex row. Under dir="rtl" the browser lays the first dot
 * (today) at the inline start, so Hebrew and Arabic read today→next week right
 * to left, exactly as their calendars do. No per-direction code.
 */
export function WeekDots({ week, className }: { week: readonly MemberDayStatus[]; className?: string }) {
  return (
    <span className={cn("flex items-center gap-1.5", className)} aria-hidden>
      {week.map((s, i) => (
        <span
          key={i}
          className={cn(
            "relative h-2.5 w-2.5 rounded-full border-[1.5px]",
            s.kind === "working" && "border-accent bg-accent",
            s.kind === "notScheduled" && "border-border",
            s.kind === "shopClosed" && "border-dashed border-border",
            s.kind === "dayOff" &&
              "border-accent/60 bg-accent/[0.12] after:absolute after:inset-x-px after:top-[3px] after:h-[1.5px] after:bg-accent after:content-['']",
            i === 0 && "ring-[3px] ring-foreground/30 ring-offset-1 ring-offset-white",
          )}
        />
      ))}
    </span>
  );
}

/**
 * The single row of weekday letters the dots line up under. Same 10px cells and
 * 6px gap as the dots, so the columns align across every row below. Labels come
 * from date-fns in the active language and size to the glyph — nothing here
 * assumes a fixed width.
 */
export function WeekDotsHeader({ dates, className }: { dates: readonly Date[]; className?: string }) {
  const { lang } = useLang();
  const labels = narrowWeekdayLabels(dates, dateFnsLocaleFor(lang));
  return (
    <span className={cn("flex items-center gap-1.5", className)} aria-hidden>
      {labels.map((l, i) => (
        <span
          key={i}
          className={cn(
            "w-2.5 text-center text-[10px] font-semibold leading-none",
            i === 0 ? "text-foreground" : "text-muted-foreground",
          )}
        >
          {l}
        </span>
      ))}
    </span>
  );
}
