import { format, isSameDay } from "date-fns";
import { he, ar, enUS } from "date-fns/locale";
import type { ProviderStatus, AvailabilityRow } from "@/lib/providerStatus";
import type { Lang } from "@/lib/translations";
import { nextWorkingDate } from "@/lib/repeatWeeks";
import { hoursRowParts, type OpeningSummary } from "@/lib/openingSummary";
import { HoursDisclosure, HoursRow } from "./HoursDisclosure";

const DOW_KEYS = [
  "sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday",
] as const;

function getRowHours(
  availability: AvailabilityRow[],
  dow: number,
): { open: string; close: string } | null {
  const row = availability.find(r => r.day_of_week === dow);
  if (!row || !row.is_available) return null;
  const open = row.start_time?.slice(0, 5) ?? null;
  const close = row.end_time?.slice(0, 5) ?? null;
  if (!open || !close) return null;
  return { open, close };
}

interface Props {
  availability: AvailabilityRow[];
  blockedDates: string[];
  status: ProviderStatus;
  /** Today's open/closed summary and next opening: the collapsed row's text. */
  opening: OpeningSummary;
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
 * Weekly-mode hours: collapsed to today's summary, expanding in place to the
 * seven days starting today.
 */
export default function WeeklyHoursTable({ availability, status, opening, staffEnabled, lang, t }: Props) {
  if (!status.hasSchedule) return null;

  const now = new Date();
  const todayDow = now.getDay();
  const dateLocale = lang === "he" ? he : lang === "ar" ? ar : enUS;

  // "Every 2 weeks · next: 4 December" under an every-2-weeks day's name, or
  // nothing for every other day (and for a broken anchor). By the rule only:
  // a one-off blocked date does not move "next". No weekday in the date — the
  // row already names it.
  const repeatLine = (dow: number): string | null => {
    const next = nextWorkingDate(availability.find(r => r.day_of_week === dow), now);
    if (!next) return null;
    const when = isSameDay(next, now)
      ? t("today")
      : t("hoursNextDate").replace("{date}", format(next, "d MMMM", { locale: dateLocale }));
    return `${t("hoursEveryTwoWeeks")} · ${when}`;
  };

  // today first, then the remaining 6 days in order starting from tomorrow
  const orderedDows = Array.from({ length: 7 }, (_, i) => (todayDow + i) % 7);
  const { head, detail } = hoursRowParts(opening, lang, t);

  return (
    <HoursDisclosure
      title={`${t("today")} · ${t(DOW_KEYS[todayDow])}`}
      head={head}
      detail={detail}
      isOpen={opening.kind === "open"}
      // Per-staff availability: these are the SHOP's hours, and a member's own
      // hours sit inside them. Without this the customer reads 09:00–20:00
      // here, picks a member, and finds 10:00–14:00 — the support ticket this
      // one line exists to prevent. ONLY for staff-enabled providers.
      note={staffEnabled ? t("hoursShopWideNote") : null}
    >
      <ul className="divide-y divide-border/40">
        {orderedDows.map((dow, i) => (
          <HoursRow
            key={dow}
            label={t(DOW_KEYS[dow])}
            sub={repeatLine(dow)}
            // Today's hours come from the shared status (it knows blocked dates,
            // date-openings and off weeks); the other days from the weekly rule.
            hours={i === 0 ? status.todayHours : getRowHours(availability, dow)}
            isToday={i === 0}
            closedLabel={t("providerStatusClosed")}
          />
        ))}
      </ul>
    </HoursDisclosure>
  );
}
