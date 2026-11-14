import { format, parseISO, type Locale } from "date-fns";

/**
 * A short date range for list rows and group headings.
 *   same day          → "12 נוב׳"
 *   same month        → "12–30 נוב׳"
 *   same year         → "28 אוק׳ – 5 נוב׳"
 *   different years   → "28 דצמ׳ 2026 – 5 ינו׳ 2027"
 * The year is also added when the range is not in the current year.
 * Dates are YYYY-MM-DD wall dates (session_date).
 */
export function compactDateRange(first: string, last: string, locale: Locale, today: Date = new Date()): string {
  const a = parseISO(first);
  const b = parseISO(last);
  const thisYear = today.getFullYear();
  const sameYear = a.getFullYear() === b.getFullYear();
  const withYear = !sameYear || a.getFullYear() !== thisYear;
  const tail = withYear ? "d MMM yyyy" : "d MMM";

  if (first === last) return format(a, tail, { locale });
  if (sameYear && a.getMonth() === b.getMonth()) {
    return `${format(a, "d", { locale })}–${format(b, tail, { locale })}`;
  }
  return `${format(a, sameYear ? "d MMM" : tail, { locale })} – ${format(b, tail, { locale })}`;
}
