import { useId, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

interface Props {
  /** "Today" */
  title: string;
  /** Today's summary: bold head ("Open now") and its optional detail. */
  head: string;
  detail: string | null;
  isOpen: boolean;
  /** The full list, shown when expanded. */
  children: ReactNode;
  /** Always-visible footnote (the staff-hours note), or null. */
  note?: string | null;
}

/**
 * The provider page's hours surface: one row with today's summary, expanding
 * in place to the full list. Shared by the weekly and the monthly table so the
 * two cannot drift apart.
 */
export function HoursDisclosure({ title, head, detail, isOpen, children, note }: Props) {
  const [expanded, setExpanded] = useState(false);
  const listId = useId();

  return (
    <div className="glass-card overflow-hidden rounded-2xl">
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={listId}
        onClick={() => setExpanded((v) => !v)}
        className="flex min-h-16 w-full items-center gap-3 px-4 py-3 text-start transition-colors active:bg-accent/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
      >
        <span
          aria-hidden
          className={`block h-2 w-2 shrink-0 rounded-full ${isOpen ? "bg-green-600" : "bg-foreground/30"}`}
        />
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-medium leading-snug text-foreground">{title}</span>
          <span className="mt-0.5 block text-[13px] leading-snug text-foreground/70">
            <span className={`font-semibold ${isOpen ? "text-green-700" : "text-foreground"}`}>{head}</span>
            {detail && <> · {detail}</>}
          </span>
        </span>
        <ChevronDown aria-hidden className={`h-4 w-4 shrink-0 text-foreground/50 ${expanded ? "rotate-180" : ""}`} />
      </button>

      <div id={listId} hidden={!expanded} className="border-t border-border/40">
        {children}
      </div>

      {note && (
        <p className="border-t border-border/40 px-4 py-3 text-[13px] leading-relaxed text-foreground/70">{note}</p>
      )}
    </div>
  );
}

/** One day of the expanded list: label (and an optional line under it), hours or "Closed". */
export function HoursRow({
  label,
  sub,
  hours,
  isToday,
  closedLabel,
}: {
  label: string;
  sub?: string | null;
  hours: { open: string; close: string } | null;
  isToday: boolean;
  closedLabel: string;
}) {
  return (
    <li className="flex min-h-12 items-center justify-between gap-3 px-4 py-2.5">
      <span className="flex min-w-0 flex-col">
        <span className={`text-[15px] leading-snug text-foreground ${isToday ? "font-semibold" : ""}`}>{label}</span>
        {sub && <span className="mt-0.5 text-[13px] leading-snug text-foreground/70">{sub}</span>}
      </span>
      {hours ? (
        // Left-to-right island: opening time first in every language.
        <span
          dir="ltr"
          className={`shrink-0 text-[15px] tabular-nums text-foreground ${isToday ? "font-semibold" : ""}`}
        >
          {hours.open} - {hours.close}
        </span>
      ) : (
        <span className="shrink-0 text-[15px] text-foreground/70">{closedLabel}</span>
      )}
    </li>
  );
}
