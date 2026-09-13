import { describe, it, expect } from "vitest";
import {
  toDateKey,
  fromDateKey,
  toDateKeyString,
  futureOnly,
  timeOffDraftFromRows,
  toggleDate,
  sameDates,
  timeOffSummary,
} from "./staffTimeOff";

const TODAY = "2026-09-04";
const YESTERDAY = "2026-09-03";
const TOMORROW = "2026-09-05";
const LAST_YEAR = "2025-12-25";

describe("toDateKey / fromDateKey", () => {
  it("formats a local date without drifting to UTC", () => {
    // Local midnight is the hazard case: toISOString() would report the previous
    // day for a UTC+2/+3 timezone, which is the bug this function exists to avoid.
    expect(toDateKey(new Date(2026, 8, 4, 0, 0))).toBe("2026-09-04");
    expect(toDateKey(new Date(2026, 11, 31, 23, 59))).toBe("2026-12-31");
  });

  it("zero-pads month and day, so string comparison stays chronological", () => {
    expect(toDateKey(new Date(2026, 0, 5))).toBe("2026-01-05");
  });

  it("round-trips through fromDateKey at LOCAL midnight", () => {
    const back = fromDateKey("2026-09-04");
    expect(back.getFullYear()).toBe(2026);
    expect(back.getMonth()).toBe(8);
    expect(back.getDate()).toBe(4);
    expect(back.getHours()).toBe(0);
  });

  it("round-trips any key", () => {
    for (const key of ["2026-01-01", "2026-06-15", "2026-12-31"]) {
      expect(toDateKey(fromDateKey(key))).toBe(key);
    }
  });
});

describe("toDateKeyString", () => {
  it("trims a full timestamp down to the date", () => {
    expect(toDateKeyString("2026-09-04T00:00:00+03:00")).toBe("2026-09-04");
  });

  it("leaves a bare date alone", () => {
    expect(toDateKeyString("2026-09-04")).toBe("2026-09-04");
  });
});

describe("futureOnly", () => {
  // This is the function the whole delete-scoping hazard hangs off: the editor
  // holds future dates only, and the writer deletes future rows only. Both call
  // it, so they cannot disagree about where the boundary is.
  it("keeps today", () => {
    expect(futureOnly([TODAY], TODAY)).toEqual([TODAY]);
  });

  it("keeps the future", () => {
    expect(futureOnly([TOMORROW], TODAY)).toEqual([TOMORROW]);
  });

  it("drops the past", () => {
    expect(futureOnly([YESTERDAY, LAST_YEAR], TODAY)).toEqual([]);
  });

  it("partitions a mixed list", () => {
    expect(futureOnly([LAST_YEAR, YESTERDAY, TODAY, TOMORROW], TODAY)).toEqual([TODAY, TOMORROW]);
  });
});

describe("timeOffDraftFromRows", () => {
  it("returns [] for a member with no rows", () => {
    expect(timeOffDraftFromRows(undefined, TODAY)).toEqual([]);
    expect(timeOffDraftFromRows([], TODAY)).toEqual([]);
  });

  // THE HISTORY GUARANTEE, from the editor's side. A member with past days off
  // must open on a draft that contains none of them — otherwise the editor would
  // show last year's holidays as upcoming, and saving would rewrite them.
  it("EXCLUDES past dates, so history never enters the draft", () => {
    expect(timeOffDraftFromRows([LAST_YEAR, YESTERDAY, TOMORROW], TODAY)).toEqual([TOMORROW]);
  });

  it("includes today", () => {
    expect(timeOffDraftFromRows([TODAY], TODAY)).toEqual([TODAY]);
  });

  it("sorts chronologically", () => {
    expect(timeOffDraftFromRows(["2026-12-01", "2026-09-10", "2026-10-05"], TODAY)).toEqual([
      "2026-09-10",
      "2026-10-05",
      "2026-12-01",
    ]);
  });

  it("de-duplicates", () => {
    expect(timeOffDraftFromRows([TOMORROW, TOMORROW], TODAY)).toEqual([TOMORROW]);
  });

  it("normalises timestamp-shaped values", () => {
    expect(timeOffDraftFromRows(["2026-09-05T00:00:00Z"], TODAY)).toEqual([TOMORROW]);
  });
});

describe("toggleDate", () => {
  it("adds a date that is not present", () => {
    expect(toggleDate([], TOMORROW)).toEqual([TOMORROW]);
  });

  it("removes a date that is present", () => {
    expect(toggleDate([TOMORROW], TOMORROW)).toEqual([]);
  });

  it("keeps the set sorted after an insert", () => {
    expect(toggleDate(["2026-10-05"], "2026-09-10")).toEqual(["2026-09-10", "2026-10-05"]);
  });

  it("does not mutate its input", () => {
    const before = [TOMORROW];
    toggleDate(before, TODAY);
    expect(before).toEqual([TOMORROW]);
  });
});

describe("sameDates", () => {
  it("treats two empty sets as equal", () => {
    expect(sameDates([], [])).toBe(true);
  });

  it("ignores order", () => {
    expect(sameDates([TODAY, TOMORROW], [TOMORROW, TODAY])).toBe(true);
  });

  it("detects an addition", () => {
    expect(sameDates([TODAY], [TODAY, TOMORROW])).toBe(false);
  });

  it("detects a removal", () => {
    expect(sameDates([TODAY, TOMORROW], [TODAY])).toBe(false);
  });

  it("detects a swap of the same size", () => {
    expect(sameDates([TODAY], [TOMORROW])).toBe(false);
  });
});

describe("timeOffSummary", () => {
  it("reports 0 for no rows", () => {
    expect(timeOffSummary(undefined, TODAY)).toBe(0);
    expect(timeOffSummary([], TODAY)).toBe(0);
  });

  it("counts upcoming days off", () => {
    expect(timeOffSummary([TODAY, TOMORROW], TODAY)).toBe(2);
  });

  // "3 days off" must mean three COMING UP. Counting history would make a member
  // with a long tail of past holidays read as heavily absent.
  it("does NOT count past days off", () => {
    expect(timeOffSummary([LAST_YEAR, YESTERDAY, TOMORROW], TODAY)).toBe(1);
  });
});
