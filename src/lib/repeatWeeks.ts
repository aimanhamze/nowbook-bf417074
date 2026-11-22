// Helpers for every-2-weeks weekdays (provider_availability
// repeat_every_weeks / repeat_anchor_date): the customer hours line, the hours
// editor's draft, and the bookings warning. The rule itself is isOffWeek in
// availabilityResolver; nothing here decides bookability.

import {
  isOffWeek,
  resolveDayHours,
  toLocalDateStr,
  type DateOverrideRow,
  type MonthlySettings,
  type WeeklyRow,
} from "@/lib/availabilityResolver";

/** The weekday-row fields these helpers read. */
export interface RepeatRow {
  day_of_week: number;
  is_available: boolean;
  repeat_every_weeks?: number | null;
  repeat_anchor_date?: string | null;
}

/** The first `count` dates on weekday `dow`, starting at `from` (included), local midnight. */
export function upcomingWeekdayDates(dow: number, from: Date, count: number): Date[] {
  const ahead = (dow - from.getDay() + 7) % 7;
  return Array.from(
    { length: count },
    (_, i) => new Date(from.getFullYear(), from.getMonth(), from.getDate() + ahead + 7 * i),
  );
}

/**
 * The next date, on or after `from`, that an every-2-weeks weekday WORKS by its
 * rule. Follows the rule only: one-off blocked dates and date-openings are not
 * consulted (ruling 2026-11-21) — this describes the rule, it is not a slot.
 *
 * null when the row is not an every-2-weeks row, is closed, or its anchor is
 * broken (isOffWeek ignores a broken anchor, so neither of the next two
 * occurrences is off — the day then behaves as every week and gets no line).
 */
export function nextWorkingDate(row: RepeatRow | undefined, from: Date): Date | null {
  if (!row || !row.is_available || row.repeat_every_weeks !== 2) return null;
  const [first, second] = upcomingWeekdayDates(row.day_of_week, from, 2);
  const firstOff = isOffWeek(row, first);
  const secondOff = isOffWeek(row, second);
  if (firstOff === secondOff) return null; // broken anchor: both "on"
  return firstOff ? second : first;
}

// ── The hours editor's repeat setting ───────────────────────────────────────

/** What the day sheet edits. `anchor` is "YYYY-MM-DD", a date the day WORKS. */
export interface RepeatDraft {
  every: 1 | 2;
  anchor: string | null;
}

/**
 * The sheet's starting state for a stored row. An every-2-weeks row opens with
 * its NEXT working date selected (the stored anchor may be long past; any date
 * in the same rhythm means the same thing). A broken anchor opens with nothing
 * selected, so the owner has to choose before saving.
 */
export function repeatFromRow(row: RepeatRow | undefined, today: Date): RepeatDraft {
  if (!row || row.repeat_every_weeks !== 2) return { every: 1, anchor: null };
  const next = nextWorkingDate({ ...row, is_available: true }, today);
  return { every: 2, anchor: next ? toLocalDateStr(next) : null };
}

/** The two dates offered as "next working <day>": the next occurrence and the one after. */
export function anchorChoices(dow: number, today: Date): string[] {
  return upcomingWeekdayDates(dow, today, 2).map(toLocalDateStr);
}

function parseYmd(v: string | null | undefined): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v ?? "");
  if (!m) return null;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const d = new Date(t);
  if (d.getUTCFullYear() !== Number(m[1]) || d.getUTCMonth() !== Number(m[2]) - 1 || d.getUTCDate() !== Number(m[3])) return null;
  return t;
}

/** Two anchors describe the same every-2-weeks rhythm (a whole number of fortnights apart). */
export function sameRhythm(a: string | null | undefined, b: string | null | undefined): boolean {
  const ta = parseYmd(a);
  const tb = parseYmd(b);
  if (ta === null || tb === null) return false;
  return Math.round((ta - tb) / 86_400_000) % 14 === 0;
}

/** Would saving `draft` change the stored repeat rule? Anchors in the same rhythm are no change. */
export function repeatDiffers(row: RepeatRow | undefined, draft: RepeatDraft): boolean {
  const storedEvery = row?.repeat_every_weeks === 2 ? 2 : 1;
  if (storedEvery !== draft.every) return true;
  if (draft.every === 1) return false;
  return !sameRhythm(row?.repeat_anchor_date, draft.anchor);
}

/** The columns written for a draft. Every week clears the anchor. */
export function repeatPayload(draft: RepeatDraft): { repeat_every_weeks: 1 | 2; repeat_anchor_date: string | null } {
  return draft.every === 2
    ? { repeat_every_weeks: 2, repeat_anchor_date: draft.anchor }
    : { repeat_every_weeks: 1, repeat_anchor_date: null };
}

/** Every 2 weeks needs a chosen date before it can be saved. */
export function repeatIncomplete(draft: RepeatDraft): boolean {
  return draft.every === 2 && !draft.anchor;
}

// ── Bookings on days a change would close ───────────────────────────────────

const WEEKLY_SETTINGS: MonthlySettings = {
  availability_mode: "weekly",
  monthly_default_available: true,
  monthly_default_start: "09:00",
  monthly_default_end: "17:00",
};

/** "YYYY-MM-DD" -> local midnight. */
function localDate(ymd: string): Date {
  const [y, m, d] = ymd.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d);
}

/**
 * The bookings that sit on a date which is OPEN with the current rows and
 * CLOSED once `newRow` replaces its weekday's row — decided by resolveDayHours
 * itself, with the provider's real blocked dates and date overrides, so a date
 * already blocked, or kept open by a date-opening, is correctly left out.
 * Weekly mode only (the day sheet exists only there). Sorted by date, time.
 */
export function bookingsOnClosingDays<T extends { booking_date: string; booking_time: string }>(
  bookings: readonly T[],
  rows: readonly WeeklyRow[],
  newRow: WeeklyRow,
  blockedDates: string[],
  overrides: DateOverrideRow[],
): T[] {
  const before = rows as WeeklyRow[];
  const after = [...rows.filter((r) => r.day_of_week !== newRow.day_of_week), newRow];
  return bookings
    .filter((b) => {
      const date = localDate(b.booking_date);
      if (date.getDay() !== newRow.day_of_week) return false;
      return (
        resolveDayHours(date, WEEKLY_SETTINGS, before, blockedDates, overrides) !== null &&
        resolveDayHours(date, WEEKLY_SETTINGS, after, blockedDates, overrides) === null
      );
    })
    .slice()
    .sort((a, b) =>
      a.booking_date.slice(0, 10).localeCompare(b.booking_date.slice(0, 10)) ||
      a.booking_time.localeCompare(b.booking_time),
    );
}

/** Group sorted bookings by "YYYY-MM-DD", keeping order. */
export function groupByDate<T extends { booking_date: string }>(bookings: readonly T[]): Array<[string, T[]]> {
  const groups = new Map<string, T[]>();
  for (const b of bookings) {
    const key = b.booking_date.slice(0, 10);
    const list = groups.get(key);
    if (list) list.push(b);
    else groups.set(key, [b]);
  }
  return [...groups.entries()];
}
