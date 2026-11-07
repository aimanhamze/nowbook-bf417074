import type { AcademyCourseSessionRow, AcademySessionWrite } from "@/integrations/supabase/academyTypes";

/**
 * Pure helpers for academy course sessions. Everything works on plain
 * YYYY-MM-DD / HH:MM strings: sessions are Asia/Jerusalem wall-clock time
 * (no timezone column), so a Date object would only add a chance to shift a
 * day across DST or the viewer's own offset.
 */

/** The most sessions a single "add range" may create. */
export const MAX_SESSIONS_PER_BATCH = 60;

export type DateRangeResult =
  | { ok: true; dates: string[] }
  | { ok: false; reason: "invalid" | "reversed" | "empty" | "too_many"; count?: number };

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Parses YYYY-MM-DD to a UTC midnight timestamp; null if not a real calendar date. */
function parseDateKey(key: string): number | null {
  const m = DATE_RE.exec(key);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const ts = Date.UTC(y, mo - 1, d);
  const back = new Date(ts);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null;
  return ts;
}

function toDateKey(ts: number): string {
  const d = new Date(ts);
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${d.getUTCFullYear()}-${mm}-${dd}`;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Every date from `from` to `to` inclusive, optionally only on the given
 * weekdays (0 = Sunday … 6 = Saturday; empty or omitted = every day).
 * Refuses (rather than truncates) a range that would exceed `max`, so the
 * provider never gets a silently shortened schedule.
 */
export function expandDateRange(
  from: string,
  to: string,
  weekdays?: readonly number[],
  max: number = MAX_SESSIONS_PER_BATCH,
): DateRangeResult {
  const start = parseDateKey(from);
  const end = parseDateKey(to);
  if (start === null || end === null) return { ok: false, reason: "invalid" };
  if (end < start) return { ok: false, reason: "reversed" };

  const filter = weekdays && weekdays.length > 0 ? new Set(weekdays) : null;
  const dates: string[] = [];
  for (let ts = start; ts <= end; ts += DAY_MS) {
    if (filter && !filter.has(new Date(ts).getUTCDay())) continue;
    dates.push(toDateKey(ts));
    if (dates.length > max) {
      // Count the rest only to report how many it would have been.
      let total = dates.length;
      for (let rest = ts + DAY_MS; rest <= end; rest += DAY_MS) {
        if (!filter || filter.has(new Date(rest).getUTCDay())) total++;
      }
      return { ok: false, reason: "too_many", count: total };
    }
  }
  if (dates.length === 0) return { ok: false, reason: "empty" };
  return { ok: true, dates };
}

/** "09:30" | "09:30:00" -> "09:30:00" (what the time column stores). */
export function toDbTime(value: string): string {
  return value.length === 5 ? `${value}:00` : value;
}

/** "09:30:00" -> "09:30" (what <input type="time"> takes). */
export function toTimeInput(value: string): string {
  return value.slice(0, 5);
}

/** Same rule as the DB CHECK: end strictly after start, both HH:MM. */
export function isValidTimeRange(start: string, end: string): boolean {
  return /^\d{2}:\d{2}/.test(start) && /^\d{2}:\d{2}/.test(end) && toTimeInput(end) > toTimeInput(start);
}

/** One write row per date, all with the same hours. */
export function sessionWritesForDates(dates: readonly string[], start: string, end: string): AcademySessionWrite[] {
  return dates.map((session_date) => ({
    session_date,
    start_time: toDbTime(start),
    end_time: toDbTime(end),
  }));
}

/** Chronological order: by date, then start time. */
export function sortSessions<T extends Pick<AcademyCourseSessionRow, "session_date" | "start_time">>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) =>
    a.session_date === b.session_date
      ? a.start_time.localeCompare(b.start_time)
      : a.session_date.localeCompare(b.session_date),
  );
}

/** Current Asia/Jerusalem wall-clock date and time, as the DB compares them. */
export function jerusalemNow(now: Date = new Date()): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jerusalem",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, time: `${get("hour")}:${get("minute")}` };
}

/** A session is past once it has ended (Asia/Jerusalem). */
export function isSessionPast(
  session: Pick<AcademyCourseSessionRow, "session_date" | "end_time">,
  now: { date: string; time: string },
): boolean {
  if (session.session_date !== now.date) return session.session_date < now.date;
  return toTimeInput(session.end_time) <= now.time;
}

/** https:// with something after it and no whitespace — the DB CHECK's rule. */
export function isHttpsUrl(value: string): boolean {
  return /^https:\/\/\S+$/i.test(value.trim());
}
