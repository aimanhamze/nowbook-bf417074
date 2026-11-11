import { addDays, endOfMonth, format, startOfMonth, startOfWeek } from "date-fns";
import type {
  AcademyCourseRow,
  AcademyCourseSessionRow,
  AcademyInstructorRow,
  CourseRegistrationStatus,
} from "@/integrations/supabase/academyTypes";
import { toTimeInput } from "@/lib/academySessions";

/**
 * Pure logic for the academy calendar (/calendar for an academy branch):
 * which dates a view needs, the React Query keys per range, seat summaries
 * grouped per course, instructor colours and the calendar items themselves.
 */

export type AcademyCalendarView = "daily" | "weekly" | "monthly";

export interface DateRange {
  /** Inclusive, YYYY-MM-DD. */
  from: string;
  /** Inclusive, YYYY-MM-DD. */
  to: string;
}

const key = (d: Date) => format(d, "yyyy-MM-dd");

/**
 * The only dates a view fetches. Weeks start on Sunday, like the booking
 * calendar. `monthAnchor` is the month the month grid is showing, which can
 * differ from the selected day while the provider pages through months.
 */
export function academyCalendarRange(view: AcademyCalendarView, selected: Date, monthAnchor: Date = selected): DateRange {
  if (view === "daily") return { from: key(selected), to: key(selected) };
  if (view === "weekly") {
    const start = startOfWeek(selected, { weekStartsOn: 0 });
    return { from: key(start), to: key(addDays(start, 6)) };
  }
  return { from: key(startOfMonth(monthAnchor)), to: key(endOfMonth(monthAnchor)) };
}

export const ACADEMY_CALENDAR_SESSIONS_KEY = "academy-calendar-sessions";

/** One cache entry per provider and visible range, never "all sessions". */
export function academyCalendarSessionsKey(providerId: string | undefined, range: DateRange) {
  return [ACADEMY_CALENDAR_SESSIONS_KEY, providerId, range.from, range.to] as const;
}

export interface SeatSummary {
  confirmed: number;
  pending: number;
}

/** Confirmed / pending per course, from ONE registrations query for the range. */
export function seatSummaryByCourse(
  rows: readonly { course_id: string; status: CourseRegistrationStatus }[],
): Map<string, SeatSummary> {
  const map = new Map<string, SeatSummary>();
  for (const r of rows) {
    if (r.status !== "confirmed" && r.status !== "pending") continue;
    const s = map.get(r.course_id) ?? { confirmed: 0, pending: 0 };
    if (r.status === "confirmed") s.confirmed++;
    else s.pending++;
    map.set(r.course_id, s);
  }
  return map;
}

// Same four hues as the staff avatars: they sit on the warm provider gradient
// without fighting the accent.
const HUES = [24, 265, 150, 200, 340, 45];

/** A stable colour per instructor (same id, same colour, nothing stored). */
export function instructorColor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return `hsl(${HUES[h % HUES.length]} 65% 48%)`;
}

export interface AcademyCalendarItem {
  sessionId: string;
  courseId: string;
  courseName: string;
  date: string;
  start: string; // HH:MM
  end: string; // HH:MM
  instructorId: string;
  instructorName: string;
  color: string;
  confirmed: number;
  pending: number;
  maxSeats: number;
  /** The course is inactive (shown only because people still hold seats). */
  dimmed: boolean;
}

/**
 * Sessions -> calendar blocks.
 *
 * Inactive courses follow inactive classes: hidden, EXCEPT while someone
 * still holds a seat (pending / confirmed), so the provider can still reach
 * those people — then the block is dimmed. Sessions whose course is unknown
 * (deleted mid-refresh) are skipped. Filtered by instructor ("all" = no
 * filter) and sorted by date, start, then course name.
 */
export function buildAcademyCalendarItems(input: {
  sessions: readonly AcademyCourseSessionRow[];
  courses: ReadonlyMap<string, AcademyCourseRow>;
  instructors: ReadonlyMap<string, AcademyInstructorRow>;
  seats: ReadonlyMap<string, SeatSummary>;
  instructorFilter: string;
}): AcademyCalendarItem[] {
  const items: AcademyCalendarItem[] = [];
  for (const s of input.sessions) {
    const course = input.courses.get(s.course_id);
    if (!course) continue;
    if (input.instructorFilter !== "all" && s.instructor_id !== input.instructorFilter) continue;
    const seat = input.seats.get(course.id) ?? { confirmed: 0, pending: 0 };
    if (!course.is_active && seat.confirmed + seat.pending === 0) continue;
    items.push({
      sessionId: s.id,
      courseId: course.id,
      courseName: course.name,
      date: s.session_date,
      start: toTimeInput(s.start_time),
      end: toTimeInput(s.end_time),
      instructorId: s.instructor_id,
      instructorName: input.instructors.get(s.instructor_id)?.name ?? "—",
      color: instructorColor(s.instructor_id),
      confirmed: seat.confirmed,
      pending: seat.pending,
      maxSeats: course.max_seats,
      dimmed: !course.is_active,
    });
  }
  return items.sort(
    (a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start) || a.courseName.localeCompare(b.courseName),
  );
}

/** Items grouped by date (keeps the input order within a day). */
export function itemsByDate(items: readonly AcademyCalendarItem[]): Map<string, AcademyCalendarItem[]> {
  const map = new Map<string, AcademyCalendarItem[]>();
  for (const it of items) {
    const list = map.get(it.date) ?? [];
    list.push(it);
    map.set(it.date, list);
  }
  return map;
}
