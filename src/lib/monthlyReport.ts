import { toLocalDateStr, parseLocalDate, type StatsBooking } from "./providerStats";

// ─────────────────────────────────────────────────────────────────────────────
// Pure helpers for the provider MONTHLY REPORT.
//
// Scope discipline: this module contains NO metric. Every number in the report
// comes from lib/providerStats (computeProviderStats / classifyCohort). What
// lives here is only:
//   • calendar-month arithmetic on LOCAL dates,
//   • Hebrew month/weekday labels,
//   • month-over-month delta shaping (presentation, not aggregation),
//   • grouping the month's bookings into days for the appointment log.
//
// The day grouping is a LAYOUT concern — it re-lists rows the provider already
// sees in their dashboard. It deliberately does not total anything: a per-day
// sum would include pending bookings and therefore would NOT reconcile with the
// headline earned-revenue figure (see footnote 4 in the document).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Gregorian month names in Hebrew, hardcoded rather than derived from
 * toLocaleDateString("he-IL").
 *
 * A printed report must render identically on every device. Intl output depends
 * on the browser's ICU build, and a trimmed ICU (or a locale the engine does not
 * carry) silently falls back to English — which would put "July 2026" inside an
 * otherwise Hebrew RTL document. Twelve strings buy full determinism.
 */
export const HEBREW_MONTHS = [
  "ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני",
  "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר",
] as const;

/** Index 0 = Sunday, matching Date#getDay(). */
export const HEBREW_WEEKDAYS = [
  "ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת",
] as const;

/** Short forms for the busiest-weekday chart. */
export const HEBREW_WEEKDAYS_SHORT = ["א", "ב", "ג", "ד", "ה", "ו", "ש"] as const;

/** A calendar month identified by year + 0-based month, as the pickers use it. */
export interface MonthRef {
  year: number;
  /** 0-based, matching Date#getMonth(). */
  month: number;
}

/** "2026-07" — stable identity for a month, used as a select value / React key. */
export function monthKey({ year, month }: MonthRef): string {
  return `${year}-${String(month + 1).padStart(2, "0")}`;
}

export function parseMonthKey(key: string): MonthRef {
  const [y, m] = key.split("-").map(Number);
  return { year: y, month: m - 1 };
}

/** "יולי 2026" */
export function formatMonthLabel({ year, month }: MonthRef): string {
  return `${HEBREW_MONTHS[month]} ${year}`;
}

/**
 * The month's inclusive bounds as LOCAL "YYYY-MM-DD" strings.
 *
 * `new Date(y, m + 1, 0)` is the last day of month m — the Date constructor
 * normalises day 0 to "the day before the 1st of the next month", which is
 * correct for 28/29/30/31-day months without a leap-year branch. Both bounds go
 * through toLocalDateStr (never toISOString) so Israel's UTC+2/+3 offset cannot
 * roll a boundary back a day. This matches Phase 1's range convention exactly.
 */
export function monthRange({ year, month }: MonthRef): { start: string; end: string } {
  return {
    start: toLocalDateStr(new Date(year, month, 1)),
    end: toLocalDateStr(new Date(year, month + 1, 0)),
  };
}

export function previousMonth({ year, month }: MonthRef): MonthRef {
  return month === 0 ? { year: year - 1, month: 11 } : { year, month: month - 1 };
}

/** The last month that has fully elapsed — the report's default selection. */
export function lastCompleteMonth(today: Date = new Date()): MonthRef {
  return previousMonth({ year: today.getFullYear(), month: today.getMonth() });
}

/**
 * Selectable months, newest first: every month from the provider's earliest
 * booking through the last complete month.
 *
 * The CURRENT month is deliberately excluded. It is partial, and earned revenue
 * is gated on `booking_date <= today`, so a mid-month report would quote a
 * figure that changes every day — not something to hand an accountant. Providers
 * who want today's numbers have the Statistics page.
 *
 * Returns [] when the provider has no bookings at all, or when their history
 * starts after the last complete month (a brand-new provider).
 */
export function availableMonths(
  bookings: Pick<StatsBooking, "booking_date">[],
  today: Date = new Date()
): MonthRef[] {
  if (bookings.length === 0) return [];

  let earliest = bookings[0].booking_date;
  for (const b of bookings) if (b.booking_date < earliest) earliest = b.booking_date;

  const first = parseLocalDate(earliest);
  const cursor: MonthRef = { year: first.getFullYear(), month: first.getMonth() };
  const last = lastCompleteMonth(today);

  const months: MonthRef[] = [];
  // Compare as absolute month ordinals so the loop cannot run away on a bad date.
  const ordinal = (m: MonthRef) => m.year * 12 + m.month;
  for (let o = ordinal(cursor); o <= ordinal(last); o++) {
    months.push({ year: Math.floor(o / 12), month: o % 12 });
  }
  return months.reverse();
}

// ── Month-over-month deltas ──────────────────────────────────────────────────

export interface Delta {
  /** current - previous */
  abs: number;
  /** Fractional change vs previous, or null when previous is 0 (see below). */
  pct: number | null;
  direction: "up" | "down" | "flat";
}

/**
 * Shape a month-over-month change for display.
 *
 * `pct` is null when the previous month was 0. A percentage against a zero base
 * is undefined, and rendering "+100%" (or ∞) for "went from nothing to
 * something" would overstate it. The document shows the absolute change instead.
 */
export function delta(current: number, previous: number): Delta {
  const abs = current - previous;
  const direction = abs > 0 ? "up" : abs < 0 ? "down" : "flat";
  return { abs, pct: previous === 0 ? null : abs / previous, direction };
}

// ── The daily appointment log ────────────────────────────────────────────────

/** Booking fields the log renders. EnrichedBooking satisfies this structurally. */
export interface LogBooking {
  id: string;
  booking_date: string;
  booking_time: string | null;
  status: string;
  customer_name: string | null;
  customer_phone: string | null;
  service_names: string[];
}

export interface DayLogGroup {
  /** "YYYY-MM-DD" */
  date: string;
  /** 0 = Sunday */
  weekday: number;
  /** "יום שלישי" */
  weekdayLabel: string;
  /** "14.07.2026" */
  dateLabel: string;
  dayOfMonth: number;
  bookings: LogBooking[];
}

/** "HH:MM" from "HH:MM" or "HH:MM:SS"; "" when absent, which sorts first. */
export function formatTime(time: string | null | undefined): string {
  return (time || "").slice(0, 5);
}

/**
 * Group the month's NON-CANCELLED bookings (confirmed + pending) by day.
 *
 * Cancelled rows are excluded because the log answers "who came in" — they are
 * still counted, and qualified, in the summary's cancellation figures.
 *
 * Days with no appointments are omitted entirely rather than printed empty: a
 * quiet month would otherwise cost several pages of blank sections. Sorted by
 * date ascending, then by time within a day.
 */
export function groupByDay<T extends LogBooking>(
  bookings: T[],
  rangeStart: string,
  rangeEnd: string
): (DayLogGroup & { bookings: T[] })[] {
  const byDate = new Map<string, T[]>();

  for (const b of bookings) {
    if (b.status === "cancelled") continue;
    if (b.booking_date < rangeStart || b.booking_date > rangeEnd) continue;
    const list = byDate.get(b.booking_date);
    if (list) list.push(b);
    else byDate.set(b.booking_date, [b]);
  }

  return [...byDate.keys()]
    .sort()
    .map((date) => {
      const d = parseLocalDate(date);
      const weekday = d.getDay();
      return {
        date,
        weekday,
        weekdayLabel: `יום ${HEBREW_WEEKDAYS[weekday]}`,
        dateLabel: `${String(d.getDate()).padStart(2, "0")}.${String(
          d.getMonth() + 1
        ).padStart(2, "0")}.${d.getFullYear()}`,
        dayOfMonth: d.getDate(),
        bookings: byDate
          .get(date)!
          .sort((a, b) => formatTime(a.booking_time).localeCompare(formatTime(b.booking_time))),
      };
    });
}

/** Total appointments across the grouped days — the log's own row count. */
export function countLogged(groups: { bookings: unknown[] }[]): number {
  return groups.reduce((sum, g) => sum + g.bookings.length, 0);
}
