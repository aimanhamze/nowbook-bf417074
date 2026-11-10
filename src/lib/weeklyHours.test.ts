import { describe, it, expect } from "vitest";
import {
  draftDiffers, draftFromRow, draftToRow, formatRanges, openDaysToChange, validateDay,
  type DayDraft, type WeeklyDayRow,
} from "./weeklyHours";

const row = (dow: number, open: boolean, start = "09:00:00", end = "17:00:00", bs: string | null = null, be: string | null = null): WeeklyDayRow => ({
  day_of_week: dow, is_available: open, start_time: start, end_time: end, break_start: bs, break_end: be,
});
const draft = (over: Partial<DayDraft> = {}): DayDraft => ({
  open: true, start: "09:00", end: "17:00", breakStart: null, breakEnd: null, ...over,
});

describe("draftFromRow / draftToRow", () => {
  it("reads a stored row (seconds dropped, break only when both ends exist)", () => {
    expect(draftFromRow(row(1, true, "08:30:00", "16:00:00", "12:00:00", "12:30:00")))
      .toEqual(draft({ start: "08:30", end: "16:00", breakStart: "12:00", breakEnd: "12:30" }));
    expect(draftFromRow(row(1, true, "09:00:00", "17:00:00", "12:00:00", null)).breakStart).toBeNull();
  });

  it("a missing row is closed 09:00–17:00, like the old fallback", () => {
    expect(draftFromRow(undefined)).toEqual(draft({ open: false }));
  });

  it("writes exactly the upsertAvailability fields; closing keeps times and break", () => {
    expect(draftToRow(5, draft({ open: false, breakStart: "13:00", breakEnd: "14:00" }))).toEqual({
      day_of_week: 5, start_time: "09:00", end_time: "17:00", is_available: false, break_start: "13:00", break_end: "14:00",
    });
  });
});

describe("validateDay", () => {
  it("accepts a normal day, a day with a break, and any closed day", () => {
    expect(validateDay(draft())).toBeNull();
    expect(validateDay(draft({ breakStart: "13:00", breakEnd: "14:00" }))).toBeNull();
    expect(validateDay(draft({ open: false, start: "18:00", end: "02:00" }))).toBeNull();
  });
  it("end must be after start (no past-midnight)", () => {
    expect(validateDay(draft({ start: "18:00", end: "02:00" }))).toBe("hrsErrEndAfterStart");
    expect(validateDay(draft({ start: "09:00", end: "09:00" }))).toBe("hrsErrEndAfterStart");
  });
  it("missing times", () => {
    expect(validateDay(draft({ end: "" }))).toBe("hrsErrMissing");
    expect(validateDay(draft({ breakStart: "13:00", breakEnd: "" }))).toBe("hrsErrMissing");
  });
  it("break must be ordered and inside opening hours", () => {
    expect(validateDay(draft({ breakStart: "14:00", breakEnd: "13:00" }))).toBe("hrsErrBreakOrder");
    expect(validateDay(draft({ breakStart: "08:00", breakEnd: "10:00" }))).toBe("hrsErrBreakInside");
    expect(validateDay(draft({ breakStart: "16:30", breakEnd: "17:30" }))).toBe("hrsErrBreakInside");
    expect(validateDay(draft({ breakStart: "09:00", breakEnd: "17:00" }))).toBeNull();
  });
});

describe("openDaysToChange", () => {
  // Seeded week: Sun–Thu open 09–17, Fri–Sat closed.
  const week = [0, 1, 2, 3, 4, 5, 6].map((d) => row(d, d <= 4));

  it("only other OPEN days that differ; closed days are never touched", () => {
    expect(openDaysToChange(week, 1, draft({ end: "19:00" }))).toEqual([0, 2, 3, 4]);
  });
  it("nothing to change when the open days already match", () => {
    expect(openDaysToChange(week, 1, draft())).toEqual([]);
  });
  it("a break difference counts as a change", () => {
    expect(openDaysToChange(week, 0, draft({ breakStart: "13:00", breakEnd: "14:00" }))).toEqual([1, 2, 3, 4]);
  });
  it("source day closed today but opened in the draft still copies only to open days", () => {
    expect(openDaysToChange(week, 6, draft({ start: "10:00" }))).toEqual([0, 1, 2, 3, 4]);
  });
});

describe("draftDiffers", () => {
  it("is false for an unchanged row (seconds ignored)", () => {
    expect(draftDiffers(row(1, true), draft())).toBe(false);
    expect(draftDiffers(row(1, true), draft({ open: false }))).toBe(true);
    expect(draftDiffers(undefined, draft())).toBe(true);
  });
});

describe("formatRanges", () => {
  it("one or two ranges; closed is null", () => {
    expect(formatRanges(draft())).toBe("09:00 – 17:00");
    expect(formatRanges(draft({ breakStart: "13:00", breakEnd: "14:00" }))).toBe("09:00 – 13:00, 14:00 – 17:00");
    expect(formatRanges(draft({ open: false }))).toBeNull();
  });
});
