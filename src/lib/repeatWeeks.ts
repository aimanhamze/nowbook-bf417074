// Display helpers for every-2-weeks weekdays (provider_availability
// repeat_every_weeks / repeat_anchor_date). The rule itself is isOffWeek in
// availabilityResolver; nothing here decides bookability.

import { isOffWeek } from "@/lib/availabilityResolver";

/** The weekday-row fields these helpers read. */
export interface RepeatRow {
  day_of_week: number;
  is_available: boolean;
  repeat_every_weeks?: number | null;
  repeat_anchor_date?: string | null;
}

/** The first `count` dates on weekday `dow`, starting at `from` (included), local midnight. */
export function upcomingWeekdayDates(dow: number, from: Date, count: number): Date[] {
  const ahead = (dow - from.getDay() + 7) % 7;
  return Array.from(
    { length: count },
    (_, i) => new Date(from.getFullYear(), from.getMonth(), from.getDate() + ahead + 7 * i),
  );
}

/**
 * The next date, on or after `from`, that an every-2-weeks weekday WORKS by its
 * rule. Follows the rule only: one-off blocked dates and date-openings are not
 * consulted (ruling 2026-11-21) — this describes the rule, it is not a slot.
 *
 * null when the row is not an every-2-weeks row, is closed, or its anchor is
 * broken (isOffWeek ignores a broken anchor, so neither of the next two
 * occurrences is off — the day then behaves as every week and gets no line).
 */
export function nextWorkingDate(row: RepeatRow | undefined, from: Date): Date | null {
  if (!row || !row.is_available || row.repeat_every_weeks !== 2) return null;
  const [first, second] = upcomingWeekdayDates(row.day_of_week, from, 2);
  const firstOff = isOffWeek(row, first);
  const secondOff = isOffWeek(row, second);
  if (firstOff === secondOff) return null; // broken anchor: both "on"
  return firstOff ? second : first;
}
