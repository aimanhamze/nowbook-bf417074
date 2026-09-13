/**
 * "Who is working today?" — the derivation behind the Staff page's today chips,
 * today strip and week dots.
 *
 * COMPOSES OVER THE RESOLVER, NEVER REIMPLEMENTS IT. The shop's window comes
 * from resolveDayHours (the caller resolves it; this module only reads the
 * result), the member's own window from staffDayWindow, and the meeting of the
 * two from narrowToStaff — the exact three functions the booking flow uses. So
 * whatever this page says about a member's day is, by construction, what a
 * customer would find bookable. The only thing added here is a NAME for each
 * outcome, because the owner needs to see the difference between "not working
 * because the shop is shut", "took the day off" and "not scheduled that
 * weekday", while the booking flow only needs to know the slot list is empty.
 */
import { format } from "date-fns";
import type { Locale } from "date-fns";
import {
  narrowToStaff,
  staffDayWindow,
  toLocalDateStr,
  type DayWindow,
  type StaffWeeklyRow,
} from "./availabilityResolver";
import { toTimeInput } from "./staffHours";

export type MemberDayStatus =
  /** The shop itself is closed (weekly off day, blocked date, monthly default). Nobody works. */
  | { kind: "shopClosed" }
  /** Bookable, within the narrowed window. */
  | { kind: "working"; window: DayWindow }
  /** One of the member's own days off. Deliberate and temporary. */
  | { kind: "dayOff" }
  /** Configured hours leave this weekday off (or disjoint from the shop's). The routine pattern. */
  | { kind: "notScheduled" };

/**
 * One member's status for one date, given the SHOP's already-resolved window.
 *
 * `shopWindow` is whatever resolveDayHours returned for that date — passing the
 * result rather than the inputs is what keeps this composable over the weekly
 * and monthly branches without knowing which produced it (same posture as
 * narrowToStaff).
 *
 * The status is derived FROM narrowToStaff's verdict, then labelled: a null
 * verdict with the shop open is a day off if the date is in the member's
 * blocked set, otherwise not scheduled. The blocked-set check runs AFTER the
 * narrowing so the ordering the resolver enforces (time off first, then
 * configuration) is inherited rather than repeated.
 */
export function memberDayStatus(
  date: Date,
  shopWindow: DayWindow | null,
  staffRows: ReadonlyMap<number, StaffWeeklyRow> | undefined,
  staffBlockedDates: ReadonlySet<string>,
): MemberDayStatus {
  if (shopWindow === null) return { kind: "shopClosed" };
  const narrowed = narrowToStaff(shopWindow, staffDayWindow(date, staffRows, staffBlockedDates));
  if (narrowed !== null) return { kind: "working", window: narrowed };
  if (staffBlockedDates.has(toLocalDateStr(date))) return { kind: "dayOff" };
  return { kind: "notScheduled" };
}

/** `count` consecutive local dates starting at `start` (inclusive). */
export function weekDates(start: Date, count = 7): Date[] {
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    return d;
  });
}

/** One member's status for each of `dates`, using a caller-supplied shop resolver. */
export function memberWeek(
  dates: readonly Date[],
  shopWindows: readonly (DayWindow | null)[],
  staffRows: ReadonlyMap<number, StaffWeeklyRow> | undefined,
  staffBlockedDates: ReadonlySet<string>,
): MemberDayStatus[] {
  return dates.map((d, i) => memberDayStatus(d, shopWindows[i] ?? null, staffRows, staffBlockedDates));
}

/**
 * The today strip's two numbers. "Off" is every active member who is not
 * working while the shop is open — day off and not scheduled alike, because
 * the strip answers "how many hands do I have today", not why.
 */
export function todayCounts(statuses: readonly MemberDayStatus[]): { working: number; off: number } {
  let working = 0;
  for (const s of statuses) if (s.kind === "working") working++;
  return { working, off: statuses.length - working };
}

/**
 * "HH:MM–HH:MM" for a chip. Callers MUST wrap the result in <bdi>: a time range
 * is LTR content and, unwrapped inside Hebrew or Arabic text, the bidi
 * algorithm can render it as "15:00–09:00".
 */
export function formatWindow(window: DayWindow): string {
  return `${toTimeInput(window.start_time)}–${toTimeInput(window.end_time)}`;
}

/**
 * Narrowest weekday label per date, in the active language, via date-fns so it
 * matches every other date the app prints. Hebrew yields single letters with a
 * geresh (א׳ … ש׳), Arabic single letters (ح ن ث …), English S M T W T F S.
 * Nothing here is fixed-width by design — the cells size to the glyph.
 */
export function narrowWeekdayLabels(dates: readonly Date[], locale: Locale): string[] {
  return dates.map((d) => format(d, "EEEEE", { locale }));
}

/**
 * When every working day of a configured week shares one window, that window
 * as a string, else null. Lets the hours card say "5 working days · 09:00–15:00"
 * instead of forcing the owner to open the sheet to learn the range.
 */
export function uniformRange(
  days: readonly { is_available: boolean; start_time: string; end_time: string }[] | null,
): string | null {
  if (!days) return null;
  const on = days.filter((d) => d.is_available);
  if (on.length === 0) return null;
  const first = `${toTimeInput(on[0].start_time)}–${toTimeInput(on[0].end_time)}`;
  return on.every((d) => `${toTimeInput(d.start_time)}–${toTimeInput(d.end_time)}` === first) ? first : null;
}
