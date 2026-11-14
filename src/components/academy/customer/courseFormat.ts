import { format, parseISO, type Locale } from "date-fns";
import type { WallClock } from "@/lib/academyCustomer";

/** "Mon, 10 Jan" style session date in the user's language. */
export function formatCourseDate(date: string, locale: Locale, pattern = "EEE, d MMM"): string {
  return format(parseISO(date), pattern, { locale });
}

/** A wall-clock deadline ("Thu, 9 Jan, 18:00") in the user's language. */
export function formatDeadline(at: WallClock, locale: Locale): string {
  return `${format(parseISO(at.date), "EEE, d MMM", { locale })}, ${at.time}`;
}

/** A weekday (0 = Sunday) in the user's language. 2023-01-01 was a Sunday. */
function weekdayName(day: number, locale: Locale, pattern: string): string {
  return format(new Date(2023, 0, 1 + day), pattern, { locale });
}

/** The short weekday on a date tile: "א׳" in Hebrew, "Sun" / "أحد" elsewhere (one letter is ambiguous there). */
export function tileWeekday(day: number, locale: Locale): string {
  return weekdayName(day, locale, locale.code === "he" ? "EEEEE" : "EEE");
}

/**
 * The weekdays of a schedule pattern: "ימי א׳, ב׳, ה׳" for several Hebrew
 * days (through `several`, the translated "ימי {days}"), the day itself for a
 * single one ("שבת", "יום ה׳"), and plain lists in Arabic / English.
 */
export function patternWeekdays(days: readonly number[], locale: Locale, several: string): string {
  if (days.length === 1) return weekdayName(days[0], locale, locale.code === "he" ? "EEE" : "EEEE");
  const he = locale.code === "he";
  const list = days.map((d) => weekdayName(d, locale, he ? "EEEEE" : locale.code === "ar" ? "EEEE" : "EEE"));
  return several.replace("{days}", list.join(locale.code === "ar" ? "، " : ", "));
}
