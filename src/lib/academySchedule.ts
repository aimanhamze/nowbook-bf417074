import type { AcademyCourseSessionRow } from "@/integrations/supabase/academyTypes";
import { toTimeInput } from "@/lib/academySessions";

/**
 * Pure summaries of a course's sessions for the customer's course page: the
 * usual hours, the weekday/time patterns, and the sessions grouped by week.
 * Everything works on the stored YYYY-MM-DD / HH:MM wall-clock strings (see
 * academySessions) — no timezone maths.
 */

type SessionTimes = Pick<AcademyCourseSessionRow, "session_date" | "start_time" | "end_time">;

const DAY_MS = 24 * 60 * 60 * 1000;

function dayStamp(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

/** 0 = Sunday … 6 = Saturday, for a YYYY-MM-DD wall date. */
export function weekdayOf(date: string): number {
  return new Date(dayStamp(date)).getUTCDay();
}

export interface TimeRange {
  start: string; // HH:MM
  end: string; // HH:MM
}

/**
 * The hours most sessions share. Ties go to the range that appears first in
 * the schedule. null for a course without sessions.
 */
export function mostCommonTimeRange(sessions: readonly SessionTimes[]): TimeRange | null {
  const tally = new Map<string, { range: TimeRange; count: number }>();
  for (const s of sessions) {
    const range = { start: toTimeInput(s.start_time), end: toTimeInput(s.end_time) };
    const key = `${range.start}-${range.end}`;
    const entry = tally.get(key);
    if (entry) entry.count++;
    else tally.set(key, { range, count: 1 });
  }
  let best: { range: TimeRange; count: number } | null = null;
  // Map keeps insertion order, so a strict ">" leaves ties with the earliest.
  for (const entry of tally.values()) if (!best || entry.count > best.count) best = entry;
  return best?.range ?? null;
}

export interface SchedulePattern {
  /** Weekdays (0 = Sunday) that meet at this time, ascending. */
  weekdays: number[];
  /** Start time, HH:MM. */
  time: string;
  /** How many sessions follow this pattern. */
  count: number;
}

/**
 * "Sun, Mon, Thu at 13:00" / "Sat at 14:00": sessions grouped by start time,
 * each with the weekdays it falls on. Most frequent first, then by time.
 */
export function schedulePatterns(sessions: readonly SessionTimes[]): SchedulePattern[] {
  const byTime = new Map<string, { days: Set<number>; count: number }>();
  for (const s of sessions) {
    const time = toTimeInput(s.start_time);
    const entry = byTime.get(time) ?? { days: new Set<number>(), count: 0 };
    entry.days.add(weekdayOf(s.session_date));
    entry.count++;
    byTime.set(time, entry);
  }
  return [...byTime.entries()]
    .map(([time, { days, count }]) => ({ weekdays: [...days].sort((a, b) => a - b), time, count }))
    .sort((a, b) => b.count - a.count || a.time.localeCompare(b.time));
}

export interface SessionWeek<T> {
  /**
   * 1 for the week of the first session, counting calendar weeks from there
   * (Sunday to Saturday) — a week without sessions is skipped, not renumbered.
   */
  number: number;
  sessions: T[];
}

/** Sessions (already chronological) grouped into Sunday-to-Saturday weeks. */
export function groupSessionsByWeek<T extends SessionTimes>(sessions: readonly T[]): SessionWeek<T>[] {
  if (sessions.length === 0) return [];
  const weekStart = (date: string) => dayStamp(date) - weekdayOf(date) * DAY_MS;
  const firstWeek = weekStart(sessions[0].session_date);
  const weeks: SessionWeek<T>[] = [];
  for (const s of sessions) {
    const number = Math.round((weekStart(s.session_date) - firstWeek) / (7 * DAY_MS)) + 1;
    const last = weeks[weeks.length - 1];
    if (last && last.number === number) last.sessions.push(s);
    else weeks.push({ number, sessions: [s] });
  }
  return weeks;
}
