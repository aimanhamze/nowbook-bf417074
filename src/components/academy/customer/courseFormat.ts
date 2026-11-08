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
