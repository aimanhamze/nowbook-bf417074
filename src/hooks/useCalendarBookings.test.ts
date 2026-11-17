import { describe, expect, it } from "vitest";
import { calendarRanges, monthGridRange, weekRange } from "./useCalendarBookings";

/**
 * The calendar loads only the dates its current view can show. These bounds
 * decide what is on screen, so they must match what each view draws: the month
 * grid with its outside days, and the Sunday–Saturday week.
 */

describe("weekRange", () => {
  it("is the Sunday–Saturday week of the date", () => {
    // 17 Nov 2026 is a Tuesday.
    expect(weekRange(new Date(2026, 10, 17))).toEqual({ from: "2026-11-15", to: "2026-11-21" });
    expect(weekRange(new Date(2026, 10, 15))).toEqual({ from: "2026-11-15", to: "2026-11-21" });
    expect(weekRange(new Date(2026, 10, 21))).toEqual({ from: "2026-11-15", to: "2026-11-21" });
  });

  it("crosses a month and a year boundary", () => {
    expect(weekRange(new Date(2026, 11, 31))).toEqual({ from: "2026-12-27", to: "2027-01-02" });
  });
});

describe("monthGridRange", () => {
  it("covers the leading and trailing days the grid draws", () => {
    // November 2026 starts on a Sunday and ends on a Monday.
    expect(monthGridRange(new Date(2026, 10, 1))).toEqual({ from: "2026-11-01", to: "2026-12-05" });
    // October 2026 starts on a Thursday and ends on a Saturday.
    expect(monthGridRange(new Date(2026, 9, 20))).toEqual({ from: "2026-09-27", to: "2026-10-31" });
  });
});

describe("calendarRanges", () => {
  const november = new Date(2026, 10, 1);

  it("monthly: the displayed grid, with the months either side as neighbours", () => {
    const r = calendarRanges("monthly", new Date(2026, 10, 17), november);
    expect(r.visible).toEqual({ from: "2026-11-01", to: "2026-12-05" });
    expect(r.selected).toBeNull();
    expect(r.neighbours).toEqual([monthGridRange(new Date(2026, 9, 1)), monthGridRange(new Date(2026, 11, 1))]);
  });

  it("monthly: an outside day drawn in the grid needs no extra range", () => {
    expect(calendarRanges("monthly", new Date(2026, 11, 3), november).selected).toBeNull();
  });

  it("monthly: a selected day the grid does not draw loads its own month", () => {
    // The list under the grid shows the SELECTED day even after the grid moved on.
    const r = calendarRanges("monthly", new Date(2026, 8, 10), november);
    expect(r.visible).toEqual({ from: "2026-11-01", to: "2026-12-05" });
    expect(r.selected).toEqual(monthGridRange(new Date(2026, 8, 1)));
  });

  it("weekly and daily: the selected day's week, with the weeks either side as neighbours", () => {
    for (const mode of ["weekly", "daily"] as const) {
      const r = calendarRanges(mode, new Date(2026, 10, 17), november);
      expect(r.visible).toEqual({ from: "2026-11-15", to: "2026-11-21" });
      expect(r.selected).toBeNull();
      expect(r.neighbours).toEqual([
        { from: "2026-11-08", to: "2026-11-14" },
        { from: "2026-11-22", to: "2026-11-28" },
      ]);
    }
  });

  it("weekly and daily ignore the monthly grid's month", () => {
    const r = calendarRanges("daily", new Date(2026, 10, 17), new Date(2025, 0, 1));
    expect(r.visible).toEqual({ from: "2026-11-15", to: "2026-11-21" });
  });
});
