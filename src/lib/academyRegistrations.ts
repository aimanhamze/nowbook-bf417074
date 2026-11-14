import type { CourseRegistrationStatus } from "@/integrations/supabase/academyTypes";

/**
 * Pure provider-side helpers for the course registrations list: the filter
 * tabs, their counts, and the per-course registrant list. Works on any row
 * shape that carries the registration fields, so the hook can enrich rows with
 * customer and course data without these functions caring.
 */

export type RegistrationFilter = "pending" | "confirmed" | "all";

export interface RegistrationLike {
  id: string;
  course_id: string;
  status: CourseRegistrationStatus;
  created_at: string;
}

export interface RegistrationCounts {
  pending: number;
  confirmed: number;
  all: number;
}

export function registrationCounts(rows: readonly RegistrationLike[]): RegistrationCounts {
  let pending = 0;
  let confirmed = 0;
  for (const r of rows) {
    if (r.status === "pending") pending++;
    else if (r.status === "confirmed") confirmed++;
  }
  return { pending, confirmed, all: rows.length };
}

/**
 * The rows for one filter tab.
 *  - pending:   oldest request first (first come, first served)
 *  - confirmed: newest first
 *  - all:       every status, newest first
 */
export function filterRegistrations<T extends RegistrationLike>(rows: readonly T[], filter: RegistrationFilter): T[] {
  const byNewest = (a: T, b: T) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id);
  const byOldest = (a: T, b: T) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id);
  if (filter === "pending") return rows.filter((r) => r.status === "pending").sort(byOldest);
  if (filter === "confirmed") return rows.filter((r) => r.status === "confirmed").sort(byNewest);
  return [...rows].sort(byNewest);
}

/**
 * Who holds a seat in one course: pending + confirmed (exactly what
 * register_for_course counts), confirmed first, then by request time.
 */
export function courseRegistrants<T extends RegistrationLike>(rows: readonly T[], courseId: string): T[] {
  const rank = (s: CourseRegistrationStatus) => (s === "confirmed" ? 0 : 1);
  return rows
    .filter((r) => r.course_id === courseId && (r.status === "pending" || r.status === "confirmed"))
    .sort((a, b) => rank(a.status) - rank(b.status) || a.created_at.localeCompare(b.created_at));
}

/** Seats held per course (pending + confirmed), for the courses list. */
export function seatsTakenByCourse(rows: readonly RegistrationLike[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const r of rows) {
    if (r.status === "pending" || r.status === "confirmed") map.set(r.course_id, (map.get(r.course_id) ?? 0) + 1);
  }
  return map;
}
