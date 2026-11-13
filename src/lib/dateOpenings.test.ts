import { describe, it, expect } from "vitest";
import {
  beyondWindowTargets, blockedTargets, bookingWindowEnd, datesInRange, isNormallyOpen,
  maxRangeEnd, openingErrorKey, openingTargets, parseLocal, staffOffOnTargets,
} from "./dateOpenings";
import { toLocalDateStr } from "./availabilityResolver";

// Sun-Thu open, Fri closed by row, Sat no row.
const rows = [0, 1, 2, 3, 4].map((d) => ({ day_of_week: d, is_available: true }));
rows.push({ day_of_week: 5, is_available: false });

// Thu 2026-11-12 .. Mon 2026-11-16
const thu = new Date(2026, 10, 12);
const mon = new Date(2026, 10, 16);
const keys = (ds: Date[]) => ds.map(toLocalDateStr);

describe("datesInRange", () => {
  it("inclusive, local days", () => {
    expect(keys(datesInRange(thu, mon))).toEqual([
      "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15", "2026-11-16",
    ]);
  });
  it("single day without an end", () => {
    expect(keys(datesInRange(thu))).toEqual(["2026-11-12"]);
  });
  it("crosses a month boundary", () => {
    expect(keys(datesInRange(new Date(2026, 10, 30), new Date(2026, 11, 2)))).toEqual([
      "2026-11-30", "2026-12-01", "2026-12-02",
    ]);
  });
});

describe("window caps", () => {
  it("a range is at most windowDays long", () => {
    expect(toLocalDateStr(maxRangeEnd(thu, 14))).toBe("2026-11-25");
    expect(datesInRange(thu, maxRangeEnd(thu, 14))).toHaveLength(14);
  });
  it("never more than 90 days, never less than 1", () => {
    expect(datesInRange(thu, maxRangeEnd(thu, 365))).toHaveLength(90);
    expect(datesInRange(thu, maxRangeEnd(thu, 0))).toHaveLength(1);
  });
  it("booking window end = today + days - 1", () => {
    expect(toLocalDateStr(bookingWindowEnd(thu, 14))).toBe("2026-11-25");
  });
});

describe("openingTargets", () => {
  const range = datesInRange(thu, mon);
  it("range: skips days already open by default (keeps Fri and Sat)", () => {
    expect(openingTargets(range, rows, false)).toEqual(["2026-11-13", "2026-11-14"]);
  });
  it("range: include open days keeps every day", () => {
    expect(openingTargets(range, rows, true)).toHaveLength(5);
  });
  it("a single date is always kept, even if normally open", () => {
    expect(openingTargets([thu], rows, false)).toEqual(["2026-11-12"]);
  });
  it("isNormallyOpen reads the weekday row", () => {
    expect(isNormallyOpen(thu, rows)).toBe(true);
    expect(isNormallyOpen(new Date(2026, 10, 13), rows)).toBe(false);
    expect(isNormallyOpen(new Date(2026, 10, 14), rows)).toBe(false);
  });
});

describe("warnings", () => {
  it("blocked targets", () => {
    expect(blockedTargets(["2026-11-13", "2026-11-14"], new Set(["2026-11-14", "2026-12-01"]))).toEqual(["2026-11-14"]);
  });
  it("beyond the booking window", () => {
    expect(beyondWindowTargets(["2026-11-25", "2026-11-26"], thu, 14)).toEqual(["2026-11-26"]);
  });
  it("staff with their own week who are off on a target weekday", () => {
    const staff = [
      { id: "a", name: "Dana" },   // not configured -> works shop hours
      { id: "b", name: "Rami" },   // Sun-Thu only -> off Fri
      { id: "c", name: "Noa" },    // Fri row, available -> fine
      { id: "d", name: "Lior" },   // Fri row, not available -> off
    ];
    const week = (days: [number, boolean][]) => new Map(days.map(([d, a]) => [d, { is_available: a }]));
    const hours = new Map([
      ["b", week([[0, true], [1, true], [2, true], [3, true], [4, true]])],
      ["c", week([[5, true]])],
      ["d", week([[5, false]])],
    ]);
    expect(staffOffOnTargets(["2026-11-13"], staff, hours)).toEqual(["Rami", "Lior"]);
    // Thursday: Rami works; Noa and Lior have no Thursday row -> off.
    expect(staffOffOnTargets(["2026-11-12"], staff, hours)).toEqual(["Noa", "Lior"]);
    expect(staffOffOnTargets([], staff, hours)).toEqual([]);
  });
  it("an empty week counts as not configured", () => {
    expect(staffOffOnTargets(["2026-11-13"], [{ id: "a", name: "A" }], new Map([["a", new Map()]]))).toEqual([]);
  });
});

describe("misc", () => {
  it("parseLocal is local midnight", () => {
    const d = parseLocal("2026-11-13");
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()]).toEqual([2026, 10, 13, 0]);
  });
  it("error codes map to translation keys, anything else to the generic one", () => {
    expect(openingErrorKey({ message: "DATE_IN_PAST" })).toBe("openingsErrPast");
    expect(openingErrorKey({ message: "TOO_MANY_DATES" })).toBe("openingsErrTooMany");
    expect(openingErrorKey({ message: "DATES_BLOCKED" })).toBe("openingsErrBlocked");
    expect(openingErrorKey({ message: "permission denied" })).toBe("bsSaveError");
    expect(openingErrorKey(null)).toBe("bsSaveError");
  });
});
