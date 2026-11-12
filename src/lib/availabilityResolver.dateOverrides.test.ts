import { describe, it, expect } from "vitest";
import {
  resolveDayHours,
  type DateOverrideRow,
  type MonthlySettings,
  type WeeklyRow,
} from "./availabilityResolver";

// Special opening days: resolveDayHours checks a date override in WEEKLY mode
// too. Precedence in both modes: blocked -> override -> normal hours.

const weekly: MonthlySettings = {
  availability_mode: "weekly",
  monthly_default_available: true,
  monthly_default_start: "08:00",
  monthly_default_end: "16:00",
};
const monthly: MonthlySettings = { ...weekly, availability_mode: "monthly" };

// Sun-Thu open 09-17 with a 13-14 break, Fri closed by row, Sat has no row.
const rows: WeeklyRow[] = [0, 1, 2, 3, 4].map((d) => ({
  day_of_week: d, start_time: "09:00", end_time: "17:00", is_available: true,
  break_start: "13:00", break_end: "14:00",
}));
rows.push({ day_of_week: 5, start_time: "09:00", end_time: "17:00", is_available: false });

// 2026-11-13 is a Friday, 2026-11-14 a Saturday, 2026-11-16 a Monday.
const FRI = new Date(2026, 10, 13);
const SAT = new Date(2026, 10, 14);
const MON = new Date(2026, 10, 16);

const opening = (date: string, patch: Partial<DateOverrideRow> = {}): DateOverrideRow => ({
  override_date: date, is_available: true, start_time: "10:00", end_time: "14:00",
  break_start: null, break_end: null, ...patch,
});

describe("resolveDayHours — weekly mode reads date overrides", () => {
  it("no overrides: unchanged weekday logic (open, closed row, missing row)", () => {
    expect(resolveDayHours(MON, weekly, rows, [], [])).toEqual({
      start_time: "09:00", end_time: "17:00", break_start: "13:00", break_end: "14:00",
    });
    expect(resolveDayHours(FRI, weekly, rows, [], [])).toBeNull();
    expect(resolveDayHours(SAT, weekly, rows, [], [])).toBeNull();
  });

  it("an opening opens a day closed by its row", () => {
    expect(resolveDayHours(FRI, weekly, rows, [], [opening("2026-11-13")])).toEqual({
      start_time: "10:00", end_time: "14:00", break_start: null, break_end: null,
    });
  });

  it("an opening opens a weekday that has no row at all", () => {
    expect(resolveDayHours(SAT, weekly, rows, [], [opening("2026-11-14")])).not.toBeNull();
  });

  it("an opening replaces the hours of a day that is already open, break included", () => {
    const o = opening("2026-11-16", { start_time: "08:00", end_time: "20:00", break_start: "12:00", break_end: "12:30" });
    expect(resolveDayHours(MON, weekly, rows, [], [o])).toEqual({
      start_time: "08:00", end_time: "20:00", break_start: "12:00", break_end: "12:30",
    });
  });

  it("an override with is_available=false closes the day", () => {
    expect(resolveDayHours(MON, weekly, rows, [], [opening("2026-11-16", { is_available: false })])).toBeNull();
  });

  it("blocked wins over an opening on the same date", () => {
    expect(resolveDayHours(FRI, weekly, rows, ["2026-11-13"], [opening("2026-11-13")])).toBeNull();
  });

  it("an override only affects its own date", () => {
    const o = [opening("2026-11-13")];
    expect(resolveDayHours(SAT, weekly, rows, [], o)).toBeNull();
    expect(resolveDayHours(MON, weekly, rows, [], o)?.start_time).toBe("09:00");
  });

  it("a null break on the row comes back as null, not undefined", () => {
    const o = opening("2026-11-13");
    delete (o as Partial<DateOverrideRow>).break_start;
    expect(resolveDayHours(FRI, weekly, rows, [], [o])?.break_start).toBeNull();
  });
});

describe("resolveDayHours — monthly mode is unchanged", () => {
  it("override wins, otherwise the flat default, blocked first", () => {
    expect(resolveDayHours(MON, monthly, rows, [], [])).toEqual({
      start_time: "08:00", end_time: "16:00", break_start: null, break_end: null,
    });
    expect(resolveDayHours(MON, monthly, rows, [], [opening("2026-11-16")])?.start_time).toBe("10:00");
    expect(resolveDayHours(MON, monthly, rows, [], [opening("2026-11-16", { is_available: false })])).toBeNull();
    expect(resolveDayHours(MON, monthly, rows, ["2026-11-16"], [opening("2026-11-16")])).toBeNull();
    expect(resolveDayHours(MON, { ...monthly, monthly_default_available: false }, rows, [], [])).toBeNull();
  });
});
