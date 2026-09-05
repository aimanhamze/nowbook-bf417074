import { describe, it, expect } from "vitest";
import { he, ar, enUS } from "date-fns/locale";
import {
  memberDayStatus,
  memberWeek,
  weekDates,
  todayCounts,
  formatWindow,
  narrowWeekdayLabels,
  uniformRange,
} from "./staffToday";
import {
  resolveDayHours,
  NO_BLOCKED_DATES,
  type DayWindow,
  type MonthlySettings,
  type StaffWeeklyRow,
  type WeeklyRow,
} from "./availabilityResolver";

// Sunday 6 Sep 2026 — a weekday the sample shop is open.
const SUNDAY = new Date(2026, 8, 6);
const SATURDAY = new Date(2026, 8, 5);

const SHOP_OPEN: DayWindow = { start_time: "09:00:00", end_time: "20:00:00", break_start: null, break_end: null };

const weekly: MonthlySettings = {
  availability_mode: "weekly",
  monthly_default_available: true,
  monthly_default_start: "09:00",
  monthly_default_end: "17:00",
};

// Shop open Sun–Fri, closed Saturday.
const shopRows: WeeklyRow[] = [0, 1, 2, 3, 4, 5].map((dow) => ({
  day_of_week: dow,
  start_time: "09:00:00",
  end_time: "20:00:00",
  is_available: true,
}));

const rows = (entries: [number, string, string, boolean][]): Map<number, StaffWeeklyRow> =>
  new Map(entries.map(([dow, s, e, on]) => [dow, { day_of_week: dow, start_time: s, end_time: e, is_available: on }]));

describe("memberDayStatus", () => {
  it("reports shopClosed whenever the shop window is null, whatever the member has", () => {
    const configured = rows([[6, "09:00", "15:00", true]]);
    expect(memberDayStatus(SATURDAY, null, configured, NO_BLOCKED_DATES)).toEqual({ kind: "shopClosed" });
    expect(memberDayStatus(SATURDAY, null, undefined, new Set(["2026-09-05"]))).toEqual({ kind: "shopClosed" });
  });

  it("an unconfigured member works the shop's window BY REFERENCE", () => {
    const s = memberDayStatus(SUNDAY, SHOP_OPEN, undefined, NO_BLOCKED_DATES);
    expect(s.kind).toBe("working");
    if (s.kind === "working") expect(s.window).toBe(SHOP_OPEN);
  });

  it("a configured member gets the narrowed window", () => {
    const s = memberDayStatus(SUNDAY, SHOP_OPEN, rows([[0, "10:00", "15:00", true]]), NO_BLOCKED_DATES);
    expect(s).toEqual({ kind: "working", window: { start_time: "10:00", end_time: "15:00", break_start: null, break_end: null } });
  });

  it("a day off beats both configuration and the unconfigured default", () => {
    const off = new Set(["2026-09-06"]);
    expect(memberDayStatus(SUNDAY, SHOP_OPEN, undefined, off)).toEqual({ kind: "dayOff" });
    expect(memberDayStatus(SUNDAY, SHOP_OPEN, rows([[0, "09:00", "15:00", true]]), off)).toEqual({ kind: "dayOff" });
  });

  it("a configured week with this weekday off or missing is notScheduled, not a day off", () => {
    expect(memberDayStatus(SUNDAY, SHOP_OPEN, rows([[0, "09:00", "15:00", false]]), NO_BLOCKED_DATES)).toEqual({ kind: "notScheduled" });
    expect(memberDayStatus(SUNDAY, SHOP_OPEN, rows([[1, "09:00", "15:00", true]]), NO_BLOCKED_DATES)).toEqual({ kind: "notScheduled" });
  });

  it("a window disjoint from the shop's reads as notScheduled", () => {
    expect(memberDayStatus(SUNDAY, SHOP_OPEN, rows([[0, "21:00", "23:00", true]]), NO_BLOCKED_DATES)).toEqual({ kind: "notScheduled" });
  });
});

describe("memberWeek over resolveDayHours", () => {
  it("composes the real shop resolver: Saturday closed, Sunday working, Monday day off", () => {
    const dates = weekDates(SATURDAY, 3);
    const shop = dates.map((d) => resolveDayHours(d, weekly, shopRows, [], []));
    const week = memberWeek(dates, shop, undefined, new Set(["2026-09-07"]));
    expect(week.map((s) => s.kind)).toEqual(["shopClosed", "working", "dayOff"]);
  });

  it("a shop blocked date closes the day for everyone, ahead of the member's own state", () => {
    const shop = [resolveDayHours(SUNDAY, weekly, shopRows, ["2026-09-06"], [])];
    expect(memberWeek([SUNDAY], shop, undefined, new Set(["2026-09-06"]))[0]).toEqual({ kind: "shopClosed" });
  });
});

describe("weekDates", () => {
  it("returns consecutive LOCAL dates starting today, crossing a month boundary", () => {
    const d = weekDates(new Date(2026, 8, 29), 4).map((x) => `${x.getMonth() + 1}-${x.getDate()}`);
    expect(d).toEqual(["9-29", "9-30", "10-1", "10-2"]);
  });
});

describe("todayCounts", () => {
  it("counts working vs everyone else", () => {
    expect(
      todayCounts([
        { kind: "working", window: SHOP_OPEN },
        { kind: "dayOff" },
        { kind: "notScheduled" },
        { kind: "working", window: SHOP_OPEN },
      ]),
    ).toEqual({ working: 2, off: 2 });
  });
});

describe("formatWindow", () => {
  it("drops seconds and joins with an en dash", () => {
    expect(formatWindow(SHOP_OPEN)).toBe("09:00–20:00");
  });
});

describe("narrowWeekdayLabels", () => {
  const dates = weekDates(SUNDAY, 7);
  it("yields one glyph group per date in each language, Sunday first", () => {
    expect(narrowWeekdayLabels(dates, enUS)).toEqual(["S", "M", "T", "W", "T", "F", "S"]);
    expect(narrowWeekdayLabels(dates, he)).toHaveLength(7);
    expect(narrowWeekdayLabels(dates, ar)).toHaveLength(7);
    // Hebrew and Arabic labels are single letters (Hebrew carries a geresh).
    expect(narrowWeekdayLabels(dates, he)[6].startsWith("ש")).toBe(true);
    expect(narrowWeekdayLabels(dates, ar)[0].length).toBeLessThanOrEqual(2);
  });
});

describe("uniformRange", () => {
  it("returns the shared range, or null when days differ or none are on", () => {
    expect(uniformRange(null)).toBeNull();
    expect(uniformRange([{ is_available: false, start_time: "09:00", end_time: "15:00" }])).toBeNull();
    expect(
      uniformRange([
        { is_available: true, start_time: "09:00:00", end_time: "15:00:00" },
        { is_available: false, start_time: "08:00", end_time: "12:00" },
        { is_available: true, start_time: "09:00", end_time: "15:00" },
      ]),
    ).toBe("09:00–15:00");
    expect(
      uniformRange([
        { is_available: true, start_time: "09:00", end_time: "15:00" },
        { is_available: true, start_time: "10:00", end_time: "15:00" },
      ]),
    ).toBeNull();
  });
});
