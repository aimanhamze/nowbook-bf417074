/**
 * Per-staff working hours (per-staff-availability Phase 2): the pure state
 * conversions behind the owner's hours editor.
 *
 * THE INHERITANCE RULE — everything here rests on it, and it is the SAME rule
 * per-staff services uses (see staffServices.ts:5-21):
 *   a staff member with ZERO rows in provider_staff_availability works ALL of
 *   the shop's hours. Configuration only ever RESTRICTS. "Unrestricted" is
 *   stored as the ABSENCE of rows, never as a full set of rows.
 *
 * ONE DIFFERENCE IN GRANULARITY, and it is the whole reason this module exists
 * rather than reusing the services helpers: services are a flat set, hours are
 * a set of SEVEN weekdays, so there are THREE states here, not two:
 *
 *   1. NO ROWS AT ALL       → works every hour the shop is open. The default,
 *                             and what every existing member has today.
 *   2. ROWS, day switched ON → works that weekday, within the stated window
 *                             (narrowed to the shop's window at resolve time).
 *   3. ROWS, day switched OFF or MISSING → does NOT work that weekday, even
 *                             when the shop is open.
 *
 * State 3 is the one that surprises people. A member configured Mon–Fri is OFF
 * at the weekend — they do NOT fall back to shop hours for the days nobody
 * filled in. Collapsing 1 and 3 (treating a missing weekday as "inherit") would
 * make partial configuration silently useless; collapsing them the other way
 * (treating no rows as "works nothing") would strand every existing member at
 * once. So the draft type below models the member-level state as a NULLABLE
 * array — null is state 1, an array is states 2/3 — and the two are never
 * allowed to round-trip into each other.
 *
 * Pure and UI-agnostic on purpose: the editor renders it, the hook writes it,
 * and the round-trip (rows → draft → rows) is what the tests pin down.
 */

/** One provider_staff_availability row, as the owner-side query selects it. */
export interface StaffHoursRow {
  staff_id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  is_available: boolean;
}

/** One weekday's editable state. Mirrors a row minus its keys. */
export interface DayHours {
  is_available: boolean;
  start_time: string;
  end_time: string;
}

/**
 * A member's whole hours state while editing.
 *
 * `null` means UNRESTRICTED (state 1 — zero rows). An array is always exactly
 * 7 entries, indexed by day_of_week (0 = Sunday … 6 = Saturday, matching
 * JS `Date.getDay()`, which is what resolveDayHours looks rows up by).
 *
 * The nullability is load-bearing, not a convenience: it is what keeps
 * "unconfigured" from being representable as some particular array of days, and
 * therefore what keeps the editor from ever inventing one.
 */
export type StaffHoursDraft = DayHours[] | null;

/** Fallbacks matching the table's column defaults. */
const DEFAULT_START = "09:00";
const DEFAULT_END = "17:00";

/** "HH:MM" / "HH:MM:SS" → minutes since midnight; null when unparseable. */
export function hoursToMinutes(time: string): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(time);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** Trim a stored value to the "HH:MM" an <input type="time"> expects. */
export function toTimeInput(value: string | null | undefined): string {
  return (value ?? "").slice(0, 5);
}

/**
 * Rows for ONE member → the editor's draft.
 *
 * `undefined` (member absent from the map) and an EMPTY map both mean state 1
 * and both return null. They are spelled out separately for the same reason
 * eligibleStaffForService does it: the writer deletes rows outright rather than
 * storing an empty set, so an empty map should be unreachable from our own
 * data — but the reading that would silently strand a member is the one worth
 * being explicit about.
 *
 * A weekday with NO row becomes an OFF day, NOT an inherited one (state 3). It
 * still carries the default window so switching it back on has something to
 * show; that window is never persisted while the day is off.
 */
export function draftFromRows(
  rowsByDay: ReadonlyMap<number, StaffHoursRow> | undefined,
): StaffHoursDraft {
  if (rowsByDay === undefined) return null;
  if (rowsByDay.size === 0) return null;

  return Array.from({ length: 7 }, (_, dow) => {
    const row = rowsByDay.get(dow);
    if (!row) {
      return { is_available: false, start_time: DEFAULT_START, end_time: DEFAULT_END };
    }
    return {
      is_available: row.is_available,
      start_time: toTimeInput(row.start_time) || DEFAULT_START,
      end_time: toTimeInput(row.end_time) || DEFAULT_END,
    };
  });
}

/**
 * The starting point when an owner switches a member from "all shop hours" to
 * "their own hours" for the FIRST time: a copy of the shop's own week.
 *
 * Seeding from the shop rather than from a blank form is deliberate — it makes
 * the new state visibly identical to the old one, so the toggle reads as "start
 * from the shop's hours and narrow them" instead of "throw away what you had".
 *
 * This produces LOCAL DRAFT STATE ONLY. It is never written on open; it reaches
 * the database only if the owner presses Save, having explicitly chosen to
 * configure this member. A shop day that is closed (or has no row) seeds as an
 * off day.
 */
export function seedDraftFromShop(shopDays: readonly (DayHours | null)[]): DayHours[] {
  return Array.from({ length: 7 }, (_, dow) => {
    const shop = shopDays[dow];
    if (!shop || !shop.is_available) {
      return { is_available: false, start_time: DEFAULT_START, end_time: DEFAULT_END };
    }
    return {
      is_available: true,
      start_time: toTimeInput(shop.start_time) || DEFAULT_START,
      end_time: toTimeInput(shop.end_time) || DEFAULT_END,
    };
  });
}

/**
 * Draft → the rows to persist.
 *
 * null → [] → the writer deletes and inserts nothing, which IS state 1. This is
 * the only way back to "works all shop hours", so it must stay a plain empty
 * array and never become "seven rows that happen to match the shop".
 *
 * OFF days ARE written, as explicit is_available=false rows. A configured
 * member is equally off on a missing weekday, but writing the row means the
 * owner's intent is recorded rather than inferred from an absence — and it is
 * what lets the editor show a full week on reopen instead of a half-empty one.
 */
export function rowsFromDraft(
  draft: StaffHoursDraft,
): { day_of_week: number; start_time: string; end_time: string; is_available: boolean }[] {
  if (draft === null) return [];
  return draft.map((day, dow) => ({
    day_of_week: dow,
    start_time: day.start_time,
    end_time: day.end_time,
    is_available: day.is_available,
  }));
}

/**
 * Are two drafts equivalent? Lets Save skip the write when the owner opened the
 * hours editor and changed nothing.
 *
 * null is only ever equal to null — an array that happens to mirror the shop is
 * NOT the same state, because it stops tracking future shop changes.
 */
export function sameDraft(a: StaffHoursDraft, b: StaffHoursDraft): boolean {
  if (a === null || b === null) return a === b;
  if (a.length !== b.length) return false;
  return a.every((day, i) => {
    const other = b[i];
    // An off day's start/end are inert, so comparing them would report a change
    // for an edit that cannot affect anything. Compare them only when the day is on.
    if (day.is_available !== other.is_available) return false;
    if (!day.is_available) return true;
    return day.start_time === other.start_time && day.end_time === other.end_time;
  });
}

/** A day whose window is empty or inverted (end <= start) — nothing bookable. */
export function isInvalidRange(day: DayHours): boolean {
  if (!day.is_available) return false;
  const start = hoursToMinutes(day.start_time);
  const end = hoursToMinutes(day.end_time);
  // Unparseable input is left to the <input type="time"> to prevent; refusing to
  // save on it would block the owner with no way to see what is wrong.
  if (start === null || end === null) return false;
  return end <= start;
}

/**
 * Does this staff day reach OUTSIDE the shop's window for the same weekday?
 *
 * Advisory only. Phase 3's intersection narrows the window at resolve time, so
 * an over-wide staff window can never actually extend the shop's — this exists
 * so the owner is told that the extra time will have no effect, rather than
 * discovering it from a customer. It is NOT a save-blocking validation: shop
 * hours change, and a staff window that pokes out today may sit comfortably
 * inside tomorrow's.
 *
 * A closed shop day makes any working staff day "outside" — which is exactly
 * right, since the member will be unbookable that day whatever their row says.
 */
export function isOutsideShopDay(day: DayHours, shopDay: DayHours | null): boolean {
  if (!day.is_available) return false;
  if (!shopDay || !shopDay.is_available) return true;

  const staffStart = hoursToMinutes(day.start_time);
  const staffEnd = hoursToMinutes(day.end_time);
  const shopStart = hoursToMinutes(shopDay.start_time);
  const shopEnd = hoursToMinutes(shopDay.end_time);
  if (staffStart === null || staffEnd === null || shopStart === null || shopEnd === null) {
    return false;
  }
  return staffStart < shopStart || staffEnd > shopEnd;
}

/**
 * How a member's hours should be summarised in the staff list, WITHOUT the
 * caller having to re-derive the three states from raw rows.
 *
 *   "all"  → state 1, works all shop hours (the common case).
 *   "none" → configured, but every day is off. A real misconfiguration: this
 *            member can never be booked. Reported honestly rather than
 *            normalised away, the same way the services summary reports "0 of N"
 *            instead of hiding an empty assignment set.
 *   number → how many weekdays they work.
 */
export function hoursSummary(draft: StaffHoursDraft): "all" | "none" | number {
  if (draft === null) return "all";
  const working = draft.filter((d) => d.is_available).length;
  return working === 0 ? "none" : working;
}
