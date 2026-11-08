import type { AcademyCourseSessionRow } from "@/integrations/supabase/academyTypes";
import { sortSessions, toTimeInput } from "@/lib/academySessions";

/**
 * Pure customer-side academy logic: seats left, the course's date span, and
 * the cancellation window. The database is the authority (register / cancel
 * RPCs re-check everything under a lock); these only decide what to SHOW, and
 * they use the same arithmetic so the UI never offers a button the RPC would
 * refuse.
 */

/** At or below this many free seats the card says "only N left". */
export const FEW_SEATS_THRESHOLD = 3;

export interface SeatCounts {
  max_seats: number;
  taken: number;
  free: number;
}

export type SeatsState =
  | { kind: "unknown" }
  | { kind: "full" }
  | { kind: "few"; free: number }
  | { kind: "open"; free: number };

/** How to present seats. No counts row = the course isn't open (or not loaded). */
export function seatsState(counts: SeatCounts | null | undefined): SeatsState {
  if (!counts) return { kind: "unknown" };
  const free = Math.max(0, Math.min(counts.free, counts.max_seats));
  if (free === 0) return { kind: "full" };
  if (free <= FEW_SEATS_THRESHOLD) return { kind: "few", free };
  return { kind: "open", free };
}

export interface CourseSpan {
  count: number;
  first: Pick<AcademyCourseSessionRow, "session_date" | "start_time" | "end_time"> | null;
  last: Pick<AcademyCourseSessionRow, "session_date" | "start_time" | "end_time"> | null;
}

export function courseSpan(
  sessions: readonly Pick<AcademyCourseSessionRow, "session_date" | "start_time" | "end_time">[],
): CourseSpan {
  const sorted = sortSessions(sessions);
  return {
    count: sorted.length,
    first: sorted[0] ?? null,
    last: sorted[sorted.length - 1] ?? null,
  };
}

/** A wall-clock date/time with no timezone, compared exactly like the DB does. */
export interface WallClock {
  date: string; // YYYY-MM-DD
  time: string; // HH:MM
}

function toNaiveMs({ date, time }: WallClock): number {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = time.slice(0, 5).split(":").map(Number);
  return Date.UTC(y, mo - 1, d, h, mi);
}

function fromNaiveMs(ms: number): WallClock {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return {
    date: `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`,
    time: `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`,
  };
}

export type CancelState =
  /** Customer may cancel; `deadline` is the last moment (inclusive). */
  | { kind: "open"; deadline: WallClock | null }
  /** Past first start − cancellation_hours, before the start: contact the provider. */
  | { kind: "window_closed"; deadline: WallClock }
  /** The first session has started: contact the provider. */
  | { kind: "started" };

/**
 * Mirrors cancel_course_registration for the customer:
 *   now >= first start                          -> started
 *   now >  first start − cancellation_hours     -> window closed
 *   otherwise (incl. exactly at the deadline)   -> open
 * A course with no sessions has no start, so it stays open (the RPC agrees).
 * All values are Asia/Jerusalem wall-clock; `now` comes from jerusalemNow().
 */
export function courseCancelState(
  firstSession: Pick<AcademyCourseSessionRow, "session_date" | "start_time"> | null,
  cancellationHours: number,
  now: WallClock,
): CancelState {
  if (!firstSession) return { kind: "open", deadline: null };
  const start = toNaiveMs({ date: firstSession.session_date, time: toTimeInput(firstSession.start_time) });
  const nowMs = toNaiveMs(now);
  if (nowMs >= start) return { kind: "started" };
  const deadlineMs = start - Math.max(0, cancellationHours) * 60 * 60 * 1000;
  const deadline = fromNaiveMs(deadlineMs);
  if (nowMs > deadlineMs) return { kind: "window_closed", deadline };
  return { kind: "open", deadline };
}

export type CourseCta =
  /** The customer already holds a seat (pending or confirmed): show the status, not a button. */
  | { kind: "registered"; status: "pending" | "confirmed" }
  | { kind: "started" }
  | { kind: "no_sessions" }
  | { kind: "full" }
  | { kind: "register" };

/**
 * What a course card offers, in the same order register_for_course checks:
 * an existing active registration first, then started, no sessions, full.
 * Unknown seat counts do not block the button — the RPC is the authority.
 */
export function courseCta(input: {
  myStatus: "pending" | "confirmed" | "rejected" | "cancelled" | null;
  firstSession: Pick<AcademyCourseSessionRow, "session_date" | "start_time"> | null;
  seats: SeatsState;
  now: WallClock;
}): CourseCta {
  if (input.myStatus === "pending" || input.myStatus === "confirmed") {
    return { kind: "registered", status: input.myStatus };
  }
  if (!input.firstSession) return { kind: "no_sessions" };
  if (courseHasStarted(input.firstSession, input.now)) return { kind: "started" };
  if (input.seats.kind === "full") return { kind: "full" };
  return { kind: "register" };
}

/** Registration is offered only before the first session starts (the RPC agrees). */
export function courseHasStarted(
  firstSession: Pick<AcademyCourseSessionRow, "session_date" | "start_time"> | null,
  now: WallClock,
): boolean {
  if (!firstSession) return false;
  return toNaiveMs(now) >= toNaiveMs({ date: firstSession.session_date, time: toTimeInput(firstSession.start_time) });
}
