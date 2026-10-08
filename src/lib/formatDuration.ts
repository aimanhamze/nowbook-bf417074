import type { Lang } from "@/lib/translations";

/**
 * A length of time in words — "שעה", "ساعة و30 دقيقة", "1 hour 30 minutes".
 * Never "01:00": an HH:MM string next to a booking reads as a time of day.
 *
 * Hand-rolled rather than Intl.DurationFormat, which older iOS Safari
 * (common inside the Instagram in-app browser) does not have.
 */
export function formatDuration(totalMinutes: number, lang: Lang): string {
  const minutesTotal = Math.max(0, Math.round(totalMinutes));
  const h = Math.floor(minutesTotal / 60);
  const m = minutesTotal % 60;

  if (lang === "he") {
    const hours = h === 1 ? "שעה" : h === 2 ? "שעתיים" : `${h} שעות`;
    const minutes = m === 1 ? "דקה" : `${m} דקות`;
    if (h === 0) return minutes;
    if (m === 0) return hours;
    return `${hours} ו-${minutes}`;
  }

  if (lang === "ar") {
    // Arabic number agreement: 1 / 2 have their own forms, 3–10 take the
    // plural, 11+ the singular.
    const unit = (n: number, one: string, two: string, few: string, many: string) =>
      n === 1 ? one : n === 2 ? two : n <= 10 ? `${n} ${few}` : `${n} ${many}`;
    const hours = unit(h, "ساعة", "ساعتان", "ساعات", "ساعة");
    const minutes = unit(m, "دقيقة", "دقيقتان", "دقائق", "دقيقة");
    if (h === 0) return minutes;
    if (m === 0) return hours;
    return `${hours} و${minutes}`;
  }

  const hours = `${h} ${h === 1 ? "hour" : "hours"}`;
  const minutes = `${m} ${m === 1 ? "minute" : "minutes"}`;
  if (h === 0) return minutes;
  if (m === 0) return hours;
  return `${hours} ${minutes}`;
}
