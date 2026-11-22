import { describe, it, expect } from "vitest";
import { nextWorkingDate, upcomingWeekdayDates, type RepeatRow } from "./repeatWeeks";

const FRI = 5;
const local = (y: number, m: number, d: number, h = 0) => new Date(y, m - 1, d, h);
const ymd = (d: Date | null) =>
  d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}` : null;

/** Every-2-weeks Friday working Nov 27 2026. */
const row = (extra: Partial<RepeatRow> = {}): RepeatRow => ({
  day_of_week: FRI, is_available: true, repeat_every_weeks: 2, repeat_anchor_date: "2026-11-27", ...extra,
});

describe("upcomingWeekdayDates", () => {
  it("starts on `from` when it is that weekday", () => {
    expect(upcomingWeekdayDates(FRI, local(2026, 11, 27, 15), 2).map(ymd)).toEqual(["2026-11-27", "2026-12-04"]);
  });
  it("otherwise starts at the next occurrence", () => {
    expect(upcomingWeekdayDates(FRI, local(2026, 11, 22), 2).map(ymd)).toEqual(["2026-11-27", "2026-12-04"]);
    expect(upcomingWeekdayDates(FRI, local(2026, 11, 28), 2).map(ymd)).toEqual(["2026-12-04", "2026-12-11"]);
  });
  it("returns local midnights", () => {
    for (const d of upcomingWeekdayDates(FRI, local(2026, 11, 22, 18), 3)) {
      expect([d.getHours(), d.getMinutes()]).toEqual([0, 0]);
    }
  });
});

describe("nextWorkingDate", () => {
  it("before a working Friday: that Friday", () => {
    expect(ymd(nextWorkingDate(row(), local(2026, 11, 22)))).toBe("2026-11-27");
  });
  it("on a working Friday: today", () => {
    expect(ymd(nextWorkingDate(row(), local(2026, 11, 27, 20)))).toBe("2026-11-27");
  });
  it("the day after a working Friday: two weeks on (skips the off Friday)", () => {
    expect(ymd(nextWorkingDate(row(), local(2026, 11, 28)))).toBe("2026-12-11");
  });
  it("on an off Friday: the next week", () => {
    expect(ymd(nextWorkingDate(row(), local(2026, 12, 4)))).toBe("2026-12-11");
  });
  it("across New Year in a 53-week year", () => {
    expect(ymd(nextWorkingDate(row({ repeat_anchor_date: "2026-12-25" }), local(2026, 12, 26)))).toBe("2027-01-08");
  });
  it("null for every week, closed days, missing rows and broken anchors", () => {
    expect(nextWorkingDate(row({ repeat_every_weeks: 1 }), local(2026, 11, 22))).toBeNull();
    expect(nextWorkingDate(row({ repeat_every_weeks: null }), local(2026, 11, 22))).toBeNull();
    expect(nextWorkingDate(row({ is_available: false }), local(2026, 11, 22))).toBeNull();
    expect(nextWorkingDate(undefined, local(2026, 11, 22))).toBeNull();
    expect(nextWorkingDate(row({ repeat_anchor_date: null }), local(2026, 11, 22))).toBeNull();
    expect(nextWorkingDate(row({ repeat_anchor_date: "2026-11-28" }), local(2026, 11, 22))).toBeNull();
    expect(nextWorkingDate(row({ repeat_anchor_date: "2026-02-30" }), local(2026, 11, 22))).toBeNull();
  });
});
