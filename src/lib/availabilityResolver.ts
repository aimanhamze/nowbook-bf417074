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
