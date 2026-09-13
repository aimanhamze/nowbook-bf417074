/**
 * Per-staff time off (per-staff-availability Phase 5): the pure date-set
 * handling behind the owner's editor.
 *
 * THE MODEL: individual dates, one row per date, mirroring
 * provider_blocked_dates exactly. A week off is seven rows. No ranges.
 *
 * OPT-IN BY ABSENCE, like the other two per-staff features: no rows means no
 * time off. Unlike weekly hours, though, there is NO three-state subtlety here —
 * an empty set and no rows mean the same thing, so the draft is a plain
 * string[] rather than a nullable one. That simplicity is worth stating, because
 * a reader arriving from lib/staffHours.ts will be looking for the null case and
 * there isn't one.
 *
 * ── THE ONE HAZARD IN THIS FEATURE ──────────────────────────────────────────
 * The editor holds FUTURE dates only, while the table also holds PAST ones.
 * Those two facts are what make the writer's delete need `.gte(blocked_date,
 * today)`; an unscoped delete-then-insert — the shape both sibling writers use —
 * destroys the member's time-off history on every save. Everything in this
 * module that touches "today" exists to keep those two halves consistent, and
 * `futureOnly` is deliberately applied on BOTH sides (building the draft, and
 * again before insert) so a stale draft cannot smuggle a past date back in.
 *
 * Dates are LOCAL calendar strings "YYYY-MM-DD" throughout — the same format
 * blocked_date is stored in and toLocalDateStr produces. Comparison is
 * lexicographic, which is exact for zero-padded ISO dates and avoids dragging
 * Date parsing (and its timezone hazards) into a pure module.
 */

/** Local "YYYY-MM-DD" for a Date — mirrors toLocalDateStr, kept local so this
 *  module stays free of resolver imports. Never toISOString: that yields the UTC
 *  date, which rolls back a day for local-midnight inputs in Israel's timezone. */
export function toDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Parse a "YYYY-MM-DD" key back to a LOCAL midnight Date, for the calendar.
 *  `new Date("2026-09-04")` would parse as UTC and can land on the previous day
 *  locally, which is exactly the class of bug toDateKey exists to avoid. */
export function fromDateKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

/** Normalise whatever the DB returned to a bare "YYYY-MM-DD". */
export function toDateKeyString(value: string): string {
  return value.slice(0, 10);
}

/**
 * Today and later only.
 *
 * Applied when BUILDING the draft (the editor never shows a past day off) and
 * again before INSERT (a sheet left open across midnight must not write a date
 * the range-scoped delete would no longer cover). One function, both call sites,
 * so the two can never drift apart.
 */
export function futureOnly(dates: readonly string[], todayKey: string): string[] {
  return dates.filter((d) => d >= todayKey);
}

/**
 * Rows for ONE member → the editor's draft: future dates, de-duplicated, sorted.
 *
 * `undefined` (member absent from the map) and an empty array both mean "no time
 * off" and both return []. Unlike the hours editor there is nothing to
 * distinguish here — absence and emptiness are the same state.
 */
export function timeOffDraftFromRows(
  dates: readonly string[] | undefined,
  todayKey: string,
): string[] {
  if (!dates || dates.length === 0) return [];
  const normalised = dates.map(toDateKeyString);
  return [...new Set(futureOnly(normalised, todayKey))].sort();
}

/** Add or remove one date, keeping the set sorted and duplicate-free. */
export function toggleDate(dates: readonly string[], key: string): string[] {
  return dates.includes(key)
    ? dates.filter((d) => d !== key)
    : [...dates, key].sort();
}

/**
 * Are two drafts the same set? Lets Save skip the write when the owner opened
 * the sheet and changed nothing — which, combined with the draft being derived
 * from rows, is what makes "open, press Save, walk away" a genuine no-op.
 *
 * Order-insensitive, matching sameSet in ProviderStaffMember: both sides are sorted in
 * practice, but a comparison that depends on that would be a trap for a future
 * caller that builds a draft some other way.
 */
export function sameDates(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const bSet = new Set(b);
  return a.every((d) => bSet.has(d));
}

/**
 * How a member's time off should be summarised in the staff list.
 *
 * Returns the count of FUTURE days off; 0 means none, and the caller renders
 * nothing rather than "0 days off" — an absence is the common case and does not
 * deserve a label. Past days off are history and are deliberately not counted:
 * "3 days off" must mean "3 days off coming up", or an owner will read a long
 * tail of last year's holidays as upcoming absence.
 */
export function timeOffSummary(dates: readonly string[] | undefined, todayKey: string): number {
  if (!dates || dates.length === 0) return 0;
  return futureOnly(dates.map(toDateKeyString), todayKey).length;
}
