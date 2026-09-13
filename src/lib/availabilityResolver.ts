// ── Monthly-availability types + the shared date→hours resolver ───────────────
//
// SINGLE source of truth for "what are this provider's hours for date X".
// Extracted verbatim from useAllProviders.ts (Phase 1) so BOTH the customer
// slot logic (getAvailableSlots / getGroupSlotsWithCapacity) AND the profile
// hours display call the exact same resolution. The logic below is unchanged
// from its original inline form — moving it must not alter any output.

/** Provider-level monthly settings, resolved with weekly defaults in the hook. */
export interface MonthlySettings {
  availability_mode: "weekly" | "monthly";
  monthly_default_available: boolean;
  monthly_default_start: string;
  monthly_default_end: string;
}

/** One row of provider_date_overrides (monthly per-date exception). */
export interface DateOverrideRow {
  override_date: string;
  is_available: boolean;
  start_time: string;
  end_time: string;
  break_start: string | null;
  break_end: string | null;
}

/** A single provider_availability weekday row (fields the resolver reads). */
export interface WeeklyRow {
  day_of_week: number;
  start_time: string;
  end_time: string;
  is_available: boolean;
  break_start?: string | null;
  break_end?: string | null;
}

/** The resolved open window for a date, or null when the day is closed. */
export interface DayWindow {
  start_time: string;
  end_time: string;
  break_start: string | null;
  break_end: string | null;
}

// Local calendar date as "YYYY-MM-DD". Must stay consistent with date.getDay()
// (also local) and with how booking_date is written everywhere (local
// format(date, "yyyy-MM-dd")). Using toISOString() here would yield the UTC
// date, which rolls back a day for local-midnight inputs in Israel's timezone.
export function toLocalDateStr(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * SINGLE source of truth for "what are this provider's hours for date X".
 * Called by BOTH getAvailableSlots (private) and getGroupSlotsWithCapacity
 * (group), and by the customer profile's hours display. Returns the day's open
 * window, or null = closed. Everything after this (slot stepping, overlap,
 * capacity, break, latest-start) is unchanged and lives in the callers.
 *
 * BLOCKED DATES ALWAYS WIN — checked FIRST, in BOTH modes, exactly as before.
 *
 * WEEKLY branch (settings.availability_mode !== 'monthly'; the default for every
 * existing provider) is byte-for-byte the original inline logic: same blocked
 * early-return, same `date.getDay()` weekday-row lookup, same
 * `!slot || !slot.is_available → closed`, same start/end and
 * `break ?? null` handling. When mode is weekly, `overrides`/monthly defaults
 * are never read, so they cannot affect the result.
 *
 * MONTHLY branch is additive: an override for the date wins; otherwise the flat
 * monthly default applies (or closed if the default is unavailable).
 */
export function resolveDayHours(
  date: Date,
  settings: MonthlySettings,
  weeklyRows: WeeklyRow[],
  blockedDates: string[],
  overrides: DateOverrideRow[],
): DayWindow | null {
  const dateStr = toLocalDateStr(date);

  // Blocked dates close the day in BOTH modes, checked first — unchanged.
  if (blockedDates.includes(dateStr)) return null;

  if (settings.availability_mode === "monthly") {
    const override = overrides.find(o => o.override_date === dateStr);
    if (override) {
      if (!override.is_available) return null;
      return {
        start_time: override.start_time,
        end_time: override.end_time,
        break_start: override.break_start ?? null,
        break_end: override.break_end ?? null,
      };
    }
    // No override for this date → flat monthly default.
    if (!settings.monthly_default_available) return null;
    return {
      start_time: settings.monthly_default_start,
      end_time: settings.monthly_default_end,
      break_start: null,
      break_end: null,
    };
  }

  // WEEKLY (default): the original inline logic, unchanged.
  const dow = date.getDay();
  const slot = weeklyRows.find(a => a.day_of_week === dow);
  if (!slot || !slot.is_available) return null;
  return {
    start_time: slot.start_time,
    end_time: slot.end_time,
    break_start: slot.break_start ?? null,
    break_end: slot.break_end ?? null,
  };
}

// ── PER-STAFF AVAILABILITY (Phase 3) ─────────────────────────────────────────
//
// THE SUBSET RULE: a staff member's hours NARROW the shop's window and can never
// EXTEND it. If the shop is closed, nobody is bookable, whatever the staff table
// says.
//
// That guarantee is STRUCTURAL, not a check someone has to remember:
//
//   1. resolveDayHours above is NOT MODIFIED and gains no parameter. The staff
//      layer is a SEPARATE function that composes over its OUTPUT. The four
//      call sites that must stay shop-level (group slots, the provider
//      calendar's out-of-hours badge, and both profile hours tables) do not
//      merely happen to skip it — they never reference it, so scope containment
//      is enforced by the call graph rather than by discipline.
//
//   2. narrowToStaff's only boundary operators are max-of-starts and
//      min-of-ends. A function whose entire arithmetic is max on starts and min
//      on ends is incapable of returning a window wider than either input.
//      There is no branch that returns the staff window unclamped, because the
//      staff window is never returned — only the max/min of the pair is.
//
//   3. "Shop closed wins" is the FIRST statement, before staffWindow is even
//      inspected — the same shape resolveDayHours uses for its blocked-date
//      check.
//
//   4. The no-configuration path returns the shop's window OBJECT ITSELF, not a
//      copy. For a provider with no staff hours configured, the result is not
//      "tested and found equal" to today's — it IS today's value.

/** One provider_staff_availability weekday row (fields the resolver reads). */
export interface StaffWeeklyRow {
  day_of_week: number;
  start_time: string;
  end_time: string;
  is_available: boolean;
}

/** Shared empty set for "this member has no time off" — avoids allocating one
 *  per render at the call sites, and gives the no-staff-selected case a name. */
export const NO_BLOCKED_DATES: ReadonlySet<string> = new Set();

/**
 * A staff member's own window for `date`, BEFORE it meets the shop's.
 *
 * Returns THREE states, and the difference between them is the whole feature:
 *
 *   undefined → NOT CONFIGURED. The member has no rows at all, so they work
 *               every hour the shop is open. This is what every existing member
 *               is, and what makes an empty table a genuine no-op.
 *   null      → CONFIGURED AND OFF. Either the weekday has no row, or its row
 *               says is_available=false, or the date is one of the member's
 *               days off. A MISSING weekday on a configured member means NOT
 *               WORKING — it does NOT fall back to the shop's hours. An owner
 *               who fills in Mon–Fri means weekends off; the other reading would
 *               make partial configuration silently useless.
 *   DayWindow → CONFIGURED AND WORKING, within the stated window.
 *
 * STAFF TIME OFF (`staffBlockedDates`) is checked FIRST, above the
 * not-configured return, and that ordering is load-bearing. Below it, a member
 * with days off but NO weekly hours configured — the single most likely user of
 * time off, since it is the simpler feature — would return `undefined` from the
 * not-configured branch and have their day off silently ignored. Checking it
 * first also mirrors resolveDayHours, where the shop's blocked-date check is the
 * first statement for exactly the same reason.
 *
 * The parameter is REQUIRED rather than optional. There are three call sites,
 * all internal, and a missed one is then a compile error instead of a feature
 * that silently does nothing at whichever site forgot. Pass NO_BLOCKED_DATES
 * when there is no member selected.
 *
 * break_start/break_end are always null: provider_staff_availability carries no
 * break columns (a per-staff break would need TWO holes in a DayWindow, which
 * the type cannot express — see the Phase 1 migration header). Staff inherit
 * the SHOP's break, which narrowToStaff preserves.
 *
 * Weekday lookup is `date.getDay()` — the same LOCAL weekday resolveDayHours
 * uses, so the two sides of the intersection can never disagree about which day
 * it is.
 */
export function staffDayWindow(
  date: Date,
  staffRows: ReadonlyMap<number, StaffWeeklyRow> | undefined,
  staffBlockedDates: ReadonlySet<string>,
): DayWindow | null | undefined {
  // STAFF TIME OFF CLOSES THE DAY — checked FIRST, ABOVE the not-configured
  // return below, so that a member with days off but no weekly hours still gets
  // their day off honoured. See the note above; moving this line down is the one
  // change that would break time off for the members most likely to use it.
  //
  // The shop's own blocked dates are NOT consulted here: they are already
  // handled first inside resolveDayHours, and narrowToStaff returns on a closed
  // shop window before this function's result is even inspected. A staff day off
  // closes the day for THIS member only; the shop and every other member are
  // unaffected.
  if (staffBlockedDates.has(toLocalDateStr(date))) return null;

  // Absent and empty are spelled out separately, not collapsed: the writer
  // deletes rows rather than storing an empty set, so an empty map should be
  // unreachable from our own data — but the reading that would silently strand
  // a working member ("present, therefore configured, therefore off") is the one
  // worth being explicit about.
  if (staffRows === undefined) return undefined;
  if (staffRows.size === 0) return undefined;

  const row = staffRows.get(date.getDay());
  if (!row || !row.is_available) return null;
  return {
    start_time: row.start_time,
    end_time: row.end_time,
    break_start: null,
    break_end: null,
  };
}

/**
 * Intersect a staff member's window with the shop's. See the block comment
 * above for why this cannot widen the shop's window.
 *
 * `shopWindow` is whatever resolveDayHours returned — so this composes over the
 * WEEKLY and the MONTHLY branch identically, without knowing or caring which
 * produced it. That is why monthly-mode shops need no separate staff data model.
 */
export function narrowToStaff(
  shopWindow: DayWindow | null,
  staffWindow: DayWindow | null | undefined,
): DayWindow | null {
  // SHOP CLOSED WINS — checked FIRST, before staffWindow is inspected at all.
  if (shopWindow === null) return null;

  // NOT CONFIGURED → the shop's own window, BY REFERENCE. Returning the same
  // object (never a copy) is what makes "unchanged for providers with no staff
  // hours" an identity rather than an equality that could drift.
  if (staffWindow === undefined) return shopWindow;

  // Configured, but not working this weekday.
  if (staffWindow === null) return null;

  const shopStart = toMinutes(shopWindow.start_time);
  const shopEnd = toMinutes(shopWindow.end_time);
  const staffStart = toMinutes(staffWindow.start_time);
  const staffEnd = toMinutes(staffWindow.end_time);

  // Unparseable input → fall back to the shop's window unchanged, matching
  // isOutsideDayWindow's posture on malformed data. Closing the day instead
  // would make one bad row silently unbook a whole staff member, which is far
  // worse than briefly ignoring a narrowing we cannot compute.
  if (shopStart === null || shopEnd === null || staffStart === null || staffEnd === null) {
    return shopWindow;
  }

  // THE INTERSECTION: latest start, earliest end. The winning ORIGINAL string is
  // re-emitted rather than a reformatted one, so a window that is entirely the
  // shop's comes back byte-identical to what resolveDayHours produced.
  const start = staffStart > shopStart ? staffWindow.start_time : shopWindow.start_time;
  const end = staffEnd < shopEnd ? staffWindow.end_time : shopWindow.end_time;

  // Disjoint or touching windows leave nothing bookable. Note `>=`: a zero-width
  // window is closed, not a window of length zero, so the slot loop is never
  // handed a degenerate range.
  if (Math.max(shopStart, staffStart) >= Math.min(shopEnd, staffEnd)) return null;

  return {
    start_time: start,
    end_time: end,
    // The SHOP's break, carried through. Staff rows have no break columns, so
    // there is nothing here to combine — the member takes the shop's break.
    break_start: shopWindow.break_start,
    break_end: shopWindow.break_end,
  };
}

/** "HH:MM" (or "HH:MM:SS") → minutes since midnight; null when unparseable. */
function toMinutes(time: string): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(time);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/**
 * Is `time` outside the provider's open window for a day? PURELY DERIVED —
 * nothing about "out of hours" is stored on a booking; this is recomputed from
 * the same resolved window the slot pipeline uses.
 *
 * `window` is whatever resolveDayHours returned for that day, so a closed or
 * blocked day (null) makes EVERY time out-of-hours — which is exactly what a
 * manual walk-in on a closed day should read as.
 *
 * Deliberately ignores break_start/break_end: a booking inside the lunch break
 * is still within working hours, and flagging it would cry wolf.
 *
 * resolveDayHours itself is untouched; this only reads its result.
 */
export function isOutsideDayWindow(window: DayWindow | null, time: string): boolean {
  if (!window) return true;
  const t = toMinutes(time);
  const start = toMinutes(window.start_time);
  const end = toMinutes(window.end_time);
  // Unparseable input → don't claim out-of-hours; the badge is advisory and a
  // false positive on malformed data is worse than staying quiet.
  if (t === null || start === null || end === null) return false;
  return t < start || t >= end;
}
