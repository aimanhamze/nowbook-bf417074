// Pure logic behind "Special opening days" (AvailabilityTab, weekly mode).
//
// An opening is a provider_date_overrides row with is_available = true,
// written by the save_date_openings RPC. resolveDayHours reads it with the
// precedence blocked -> override -> weekly row.

import { addDays, differenceInCalendarDays, startOfDay } from "date-fns";
import { toLocalDateStr } from "@/lib/availabilityResolver";
import type { TranslationKey } from "@/lib/translations";

/** The RPC refuses more than this many dates (the longest booking window). */
export const MAX_OPENING_DATES = 90;

/** The provider_availability fields this module reads. */
export interface OpeningWeeklyRow {
  day_of_week: number;
  is_available: boolean;
}

/** One staff member's configured week: day_of_week -> row. */
export type StaffWeek = ReadonlyMap<number, { is_available: boolean }>;

/** Every day from `from` to `to` inclusive (just `from` when `to` is missing). */
export function datesInRange(from: Date, to?: Date | null): Date[] {
  const start = startOfDay(from);
  const end = to ? startOfDay(to) : start;
  const out: Date[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}

/**
 * The last day a range starting at `from` may reach: a range is at most
 * `windowDays` days long, capped at MAX_OPENING_DATES.
 */
export function maxRangeEnd(from: Date, windowDays: number): Date {
  const len = Math.max(1, Math.min(windowDays, MAX_OPENING_DATES));
  return addDays(startOfDay(from), len - 1);
}

/** Last bookable day for customers: today + windowDays - 1 (as NewBookingSheet). */
export function bookingWindowEnd(today: Date, windowDays: number): Date {
  return addDays(startOfDay(today), Math.max(1, windowDays) - 1);
}

/** Is the date's weekday open in the normal weekly hours? */
export function isNormallyOpen(date: Date, rows: readonly OpeningWeeklyRow[]): boolean {
  return rows.some((r) => r.day_of_week === date.getDay() && r.is_available);
}

/**
 * The dates the RPC will write, as local "YYYY-MM-DD". A single date is
 * always kept (the provider chose it). In a range, days that are already open
 * in the weekly hours are skipped unless `includeOpen`.
 */
export function openingTargets(
  dates: readonly Date[],
  rows: readonly OpeningWeeklyRow[],
  includeOpen: boolean,
): string[] {
  const keep = dates.length === 1 || includeOpen
    ? dates
    : dates.filter((d) => !isNormallyOpen(d, rows));
  return keep.map(toLocalDateStr);
}

/** Targets that are currently blocked (saving replaces those blocks). */
export function blockedTargets(targets: readonly string[], blocked: ReadonlySet<string>): string[] {
  return targets.filter((d) => blocked.has(d));
}

/** Targets customers cannot book yet: past the booking window's last day. */
export function beyondWindowTargets(targets: readonly string[], today: Date, windowDays: number): string[] {
  const last = toLocalDateStr(bookingWindowEnd(today, windowDays));
  return targets.filter((d) => d > last);
}

/**
 * Staff who stay OFF on at least one target date: members with their own
 * weekly hours configured (a non-empty week) whose week has no working row
 * for that weekday. A member with no rows works the shop's hours and is fine.
 * Staff openings that override their own week are not supported, so this is
 * a warning, not a fix.
 */
export function staffOffOnTargets(
  targets: readonly string[],
  staff: readonly { id: string; name: string }[],
  hoursByStaff: ReadonlyMap<string, StaffWeek>,
): string[] {
  const weekdays = new Set(targets.map((d) => parseLocal(d).getDay()));
  return staff
    .filter((s) => {
      const week = hoursByStaff.get(s.id);
      if (!week || week.size === 0) return false;
      for (const dow of weekdays) {
        const row = week.get(dow);
        if (!row || !row.is_available) return true;
      }
      return false;
    })
    .map((s) => s.name);
}

/** "YYYY-MM-DD" -> local midnight Date. */
export function parseLocal(key: string): Date {
  const [y, m, d] = key.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** Days from today, for sorting / past checks. */
export function daysFromToday(key: string, today: Date): number {
  return differenceInCalendarDays(parseLocal(key), startOfDay(today));
}

/** save_date_openings error -> translation key. Never shows raw text. */
export function openingErrorKey(err: unknown): TranslationKey {
  const msg = (err as { message?: string } | null)?.message ?? "";
  if (msg.includes("DATE_IN_PAST")) return "openingsErrPast";
  if (msg.includes("TOO_MANY_DATES")) return "openingsErrTooMany";
  if (msg.includes("DATES_BLOCKED")) return "openingsErrBlocked";
  return "bsSaveError";
}
