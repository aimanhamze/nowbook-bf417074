// Pure logic behind the opening-hours section (AvailabilityTab +
// MonthlyAvailabilityCalendar). Draft editing, validation, the weekly summary
// text and "apply to all open days". It never changes what a row means: a
// draft maps back onto exactly the fields upsertAvailability /
// upsertDateOverride already write.

/** One day being edited in a sheet. Times are "HH:MM". */
export interface DayDraft {
  open: boolean;
  start: string;
  end: string;
  /** Both set = a break; both null = none. */
  breakStart: string | null;
  breakEnd: string | null;
}

/** The provider_availability fields this section reads and writes. */
export interface WeeklyDayRow {
  day_of_week: number;
  is_available: boolean;
  start_time: string;
  end_time: string;
  break_start?: string | null;
  break_end?: string | null;
}

export const DEFAULT_START = "09:00";
export const DEFAULT_END = "17:00";
// Same defaults the old per-day break switch wrote.
export const DEFAULT_BREAK_START = "13:00";
export const DEFAULT_BREAK_END = "14:00";

export const hhmm = (v: string | null | undefined) => (v ? v.slice(0, 5) : "");

/**
 * Draft for a weekday. A missing row opens as closed 09:00–17:00, the same
 * fallbacks the old per-day controls used.
 */
export function draftFromRow(row: WeeklyDayRow | undefined): DayDraft {
  const hasBreak = !!(row?.break_start && row?.break_end);
  return {
    open: row?.is_available ?? false,
    start: hhmm(row?.start_time) || DEFAULT_START,
    end: hhmm(row?.end_time) || DEFAULT_END,
    breakStart: hasBreak ? hhmm(row!.break_start) : null,
    breakEnd: hasBreak ? hhmm(row!.break_end) : null,
  };
}

/**
 * The exact upsertAvailability payload for a draft. A closed day keeps its
 * times and break (is_available=false only), as the old switch did.
 */
export function draftToRow(dow: number, d: DayDraft) {
  return {
    day_of_week: dow,
    start_time: d.start,
    end_time: d.end,
    is_available: d.open,
    break_start: d.breakStart,
    break_end: d.breakEnd,
  };
}

export type HoursError = "hrsErrMissing" | "hrsErrEndAfterStart" | "hrsErrBreakOrder" | "hrsErrBreakInside";

/**
 * Translation key of the first problem, or null. A closed day is always
 * valid. Same-day windows only: an end at or before the start (e.g.
 * 18:00–02:00) is rejected. Past-midnight hours aren't supported downstream
 * (see CLAUDE.md, Known Issues). "HH:MM" strings compare correctly as text.
 */
export function validateDay(d: DayDraft): HoursError | null {
  if (!d.open) return null;
  if (!d.start || !d.end) return "hrsErrMissing";
  if (d.end <= d.start) return "hrsErrEndAfterStart";
  const hasBreak = d.breakStart !== null || d.breakEnd !== null;
  if (!hasBreak) return null;
  if (!d.breakStart || !d.breakEnd) return "hrsErrMissing";
  if (d.breakEnd <= d.breakStart) return "hrsErrBreakOrder";
  if (d.breakStart < d.start || d.breakEnd > d.end) return "hrsErrBreakInside";
  return null;
}

/** Whether saving `d` over `row` would change anything the resolver reads. */
export function draftDiffers(row: WeeklyDayRow | undefined, d: DayDraft): boolean {
  const cur = draftFromRow(row);
  if (!row) return true;
  if (cur.open !== d.open) return true;
  return (
    cur.start !== d.start || cur.end !== d.end ||
    cur.breakStart !== d.breakStart || cur.breakEnd !== d.breakEnd
  );
}

/**
 * "Apply to all open days": the OTHER days that are currently open and whose
 * hours or break differ from the draft. Closed days are never included, so
 * a business closed Fri/Sat stays closed. Sorted Sunday→Saturday.
 */
export function openDaysToChange(rows: WeeklyDayRow[], sourceDow: number, d: DayDraft): number[] {
  return rows
    .filter((r) => r.day_of_week !== sourceDow && r.is_available)
    .filter((r) => draftDiffers(r, { ...d, open: true }))
    .map((r) => r.day_of_week)
    .sort((a, b) => a - b);
}

/** "09:00 – 17:00" or "09:00 – 13:00, 14:00 – 17:00" for an open draft; null when closed. */
export function formatRanges(d: DayDraft): string | null {
  if (!d.open) return null;
  const range = (a: string, b: string) => `${a} – ${b}`;
  if (d.breakStart && d.breakEnd) {
    return `${range(d.start, d.breakStart)}, ${range(d.breakEnd, d.end)}`;
  }
  return range(d.start, d.end);
}
