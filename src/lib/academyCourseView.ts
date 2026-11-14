import type { AcademyCourseSessionRow } from "@/integrations/supabase/academyTypes";
import type { CourseCta, SeatCounts, WallClock } from "@/lib/academyCustomer";
import { isSessionPast } from "@/lib/academySessions";

/**
 * Display-only derivations for the customer's course card and course page.
 * Nothing here decides what a customer MAY do — that stays in academyCustomer
 * (courseCta / courseCancelState) and, finally, in the RPCs.
 */

type SessionTimes = Pick<AcademyCourseSessionRow, "session_date" | "start_time" | "end_time">;

/** The first session that has not ended yet (sessions sorted chronologically); null when all are over. */
export function nextSession<T extends SessionTimes>(sessions: readonly T[], now: WallClock): T | null {
  return sessions.find((s) => !isSessionPast(s, now)) ?? null;
}

/** How many sessions have ended. Schedule progress — attendance is not tracked. */
export function endedSessionCount(sessions: readonly SessionTimes[], now: WallClock): number {
  return sessions.filter((s) => isSessionPast(s, now)).length;
}

export type CourseBadge = "registered" | "pending" | "last_seat" | "full" | "closed" | null;

/**
 * The one badge on a course image. The customer's own status wins; then why
 * registration is not possible (started / no sessions → closed, full); then
 * the last free seat. An open course with room shows no badge.
 */
export function courseBadge(cta: CourseCta, counts: SeatCounts | null | undefined): CourseBadge {
  if (cta.kind === "registered") return cta.status === "confirmed" ? "registered" : "pending";
  if (cta.kind === "started" || cta.kind === "no_sessions") return "closed";
  if (cta.kind === "full") return "full";
  if (counts && clampFree(counts) === 1) return "last_seat";
  return null;
}

export type SeatsTone = "ok" | "low" | "full";

export interface SeatsMeter {
  taken: number;
  max: number;
  free: number;
  /** 0–100, how much of the bar is filled. */
  percent: number;
  /** ok = green, low (1–2 left) = amber, full = neutral. */
  tone: SeatsTone;
}

function clampFree(counts: SeatCounts): number {
  return Math.max(0, Math.min(counts.free, counts.max_seats));
}

/** The seats bar. null when counts are missing or the course has no seats: show no bar. */
export function seatsMeter(counts: SeatCounts | null | undefined): SeatsMeter | null {
  if (!counts || counts.max_seats <= 0) return null;
  const max = counts.max_seats;
  const free = clampFree(counts);
  const taken = max - free;
  return {
    taken,
    max,
    free,
    percent: Math.round((taken / max) * 100),
    tone: free === 0 ? "full" : free <= 2 ? "low" : "ok",
  };
}
