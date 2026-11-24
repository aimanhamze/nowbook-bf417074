import { useState } from "react";
import { addDays, format } from "date-fns";
import { he, ar, enUS } from "date-fns/locale";
import { ChevronDown } from "lucide-react";
import {
  resolveDayHours,
  type MonthlySettings,
  type DateOverrideRow,
} from "@/lib/availabilityResolver";
import { getNextOpening, hoursRowParts, summarizeOpening } from "@/lib/openingSummary";
import type { Lang } from "@/lib/translations";
import { HoursDisclosure, HoursRow } from "./HoursDisclosure";

// The customer-facing hours list for MONTHLY-mode providers. Weekly providers
// keep their weekday list (WeeklyHoursTable) — this component is never rendered
// for them. Hours per date come from the SAME resolveDayHours the booking slot
// logic uses, so what the profile shows and what's bookable can't diverge:
// blocked → per-date override → flat monthly default (precedence lives in the
// resolver, not here).

const INITIAL_DAYS = 7;

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + (m || 0);
}

interface Props {
  monthlySettings: MonthlySettings;
  blockedDates: string[];
  overrides: DateOverrideRow[];
  bookingWindowDays: number;
  /**
   * The provider runs per-staff booking, so these SHOP hours may be wider than
   * any individual member's. Required rather than optional: this table has one
   * caller, and a silently-omitted flag is exactly how the note would go missing.
   */
  staffEnabled: boolean;
  lang: Lang;
  t: (key: string) => string;
}

/**
 * Monthly-mode hours: collapsed to today's summary, expanding in place to the
 * coming dates (7 first, "show more days" up to the booking window).
 */
export default function MonthlyHoursTable({
  monthlySettings,
  blockedDates,
  overrides,
  bookingWindowDays,
  staffEnabled,
  lang,
  t,
}: Props) {
  const [showAll, setShowAll] = useState(false);
  const locale = lang === "he" ? he : lang === "ar" ? ar : enUS;

  // Clamp the window to a sane minimum; 7 shown first, "show more" reveals the
  // rest up to booking_window_days (default 14).
  const windowDays = Math.max(1, bookingWindowDays || 14);
  const canShowMore = windowDays > INITIAL_DAYS;
  const visibleCount = showAll ? windowDays : Math.min(INITIAL_DAYS, windowDays);

  const today = new Date();
  const nowMins = today.getHours() * 60 + today.getMinutes();

  const days = Array.from({ length: visibleCount }, (_, i) => {
    const date = addDays(today, i);
    // Weekly rows param is [] — for monthly mode the resolver never reads it.
    const window = resolveDayHours(date, monthlySettings, [], blockedDates, overrides);
    const hours = window
      ? { open: window.start_time.slice(0, 5), close: window.end_time.slice(0, 5) }
      : null;
    return { i, date, hours };
  });

  const dateLabel = (date: Date) => format(date, "d MMMM · EEEE", { locale });
  const rowLabel = (i: number, date: Date) =>
    i === 1 ? `${t("tomorrow")} · ${dateLabel(date)}` : dateLabel(date);

  // Today's summary through the same helpers as the weekly table, fed with
  // today's resolved window (the shared status helper reads weekday rows only).
  const todayHours = days[0]?.hours ?? null;
  const isOpenNow =
    !!todayHours && nowMins >= toMinutes(todayHours.open) && nowMins < toMinutes(todayHours.close);
  const opening = summarizeOpening(
    { isOpen: isOpenNow, todayHours, hasSchedule: true },
    isOpenNow ? null : getNextOpening(today, monthlySettings, [], blockedDates, overrides),
    today,
  );
  const { head, detail } = hoursRowParts(opening, lang, t);

  return (
    <HoursDisclosure
      title={t("today")}
      head={head}
      detail={detail}
      isOpen={opening.kind === "open"}
      // Same note as WeeklyHoursTable, for the same reason: these are the
      // SHOP's hours per date, and a staff member's own hours narrow them.
      // A member's hours are WEEKLY even here — they act as a weekly limit on
      // top of each date's window. ONLY for staff-enabled providers.
      note={staffEnabled ? t("hoursShopWideNote") : null}
    >
      <ul className="divide-y divide-border/40">
        {days.map(({ i, date, hours }) => (
          <HoursRow
            key={i}
            label={rowLabel(i, date)}
            hours={hours}
            isToday={i === 0}
            closedLabel={t("providerStatusClosed")}
          />
        ))}
      </ul>

      {canShowMore && (
        <button
          type="button"
          aria-expanded={showAll}
          onClick={() => setShowAll(v => !v)}
          className="flex min-h-12 w-full items-center justify-center gap-1.5 border-t border-border/40 px-4 text-sm font-semibold text-accent transition-colors active:bg-accent/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
        >
          {t(showAll ? "showLess" : "showMoreDays")}
          <ChevronDown aria-hidden className={`h-4 w-4 ${showAll ? "rotate-180" : ""}`} />
        </button>
      )}
    </HoursDisclosure>
  );
}
