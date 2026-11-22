import { describe, it, expect } from "vitest";
import {
  anchorChoices, bookingsOnClosingDays, groupByDate, nextWorkingDate, repeatDiffers, repeatFromRow,
  repeatIncomplete, repeatPayload, sameRhythm, upcomingWeekdayDates, type RepeatRow,
} from "./repeatWeeks";
import type { DateOverrideRow, WeeklyRow } from "./availabilityResolver";

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

// ── Editor draft + bookings warning (Phase 4) ───────────────────────────────

describe("repeat draft helpers", () => {
  const today = local(2026, 11, 22); // Sunday

  it("repeatFromRow: every week, or every 2 weeks with its NEXT working date", () => {
    expect(repeatFromRow(undefined, today)).toEqual({ every: 1, anchor: null });
    expect(repeatFromRow(row({ repeat_every_weeks: 1 }), today)).toEqual({ every: 1, anchor: null });
    expect(repeatFromRow(row({ repeat_anchor_date: "2026-11-13" }), today)).toEqual({ every: 2, anchor: "2026-11-27" });
    expect(repeatFromRow(row({ repeat_anchor_date: "2026-11-20" }), today)).toEqual({ every: 2, anchor: "2026-12-04" });
  });

  it("repeatFromRow: a closed day still opens with its rule; a broken anchor opens unselected", () => {
    expect(repeatFromRow(row({ is_available: false }), today)).toEqual({ every: 2, anchor: "2026-11-27" });
    expect(repeatFromRow(row({ repeat_anchor_date: "2026-11-28" }), today)).toEqual({ every: 2, anchor: null });
  });

  it("anchorChoices: the next two occurrences, today included", () => {
    expect(anchorChoices(FRI, today)).toEqual(["2026-11-27", "2026-12-04"]);
    expect(anchorChoices(0, today)).toEqual(["2026-11-22", "2026-11-29"]);
  });

  it("sameRhythm: whole fortnights apart, either direction, across New Year", () => {
    expect(sameRhythm("2026-11-27", "2026-11-13")).toBe(true);
    expect(sameRhythm("2026-11-27", "2027-01-08")).toBe(true);
    expect(sameRhythm("2026-11-27", "2026-12-04")).toBe(false);
    expect(sameRhythm("2026-11-27", null)).toBe(false);
    expect(sameRhythm("2026-02-30", "2026-02-30")).toBe(false);
  });

  it("repeatDiffers: value, then rhythm — never the anchor string itself", () => {
    expect(repeatDiffers(undefined, { every: 1, anchor: null })).toBe(false);
    expect(repeatDiffers(row({ repeat_every_weeks: 1 }), { every: 2, anchor: "2026-11-27" })).toBe(true);
    expect(repeatDiffers(row(), { every: 1, anchor: null })).toBe(true);
    expect(repeatDiffers(row({ repeat_anchor_date: "2026-11-13" }), { every: 2, anchor: "2026-11-27" })).toBe(false);
    expect(repeatDiffers(row(), { every: 2, anchor: "2026-12-04" })).toBe(true);
  });

  it("repeatPayload / repeatIncomplete", () => {
    expect(repeatPayload({ every: 1, anchor: "2026-11-27" })).toEqual({ repeat_every_weeks: 1, repeat_anchor_date: null });
    expect(repeatPayload({ every: 2, anchor: "2026-11-27" })).toEqual({ repeat_every_weeks: 2, repeat_anchor_date: "2026-11-27" });
    expect(repeatIncomplete({ every: 2, anchor: null })).toBe(true);
    expect(repeatIncomplete({ every: 2, anchor: "2026-11-27" })).toBe(false);
    expect(repeatIncomplete({ every: 1, anchor: null })).toBe(false);
  });
});

describe("bookingsOnClosingDays", () => {
  const weekRow = (dow: number, extra: Partial<WeeklyRow> = {}): WeeklyRow => ({
    day_of_week: dow, start_time: "09:00", end_time: "17:00", is_available: dow !== 6, ...extra,
  });
  const week = (fri: Partial<WeeklyRow> = {}) => [0, 1, 2, 3, 4, 5, 6].map((d) => (d === FRI ? weekRow(d, fri) : weekRow(d)));
  const b = (booking_date: string, booking_time = "10:00") => ({ booking_date, booking_time });

  it("every week -> every 2 weeks: only the off Fridays are listed, sorted", () => {
    const out = bookingsOnClosingDays(
      [b("2026-12-18", "09:00"), b("2026-11-27"), b("2026-12-04", "12:00"), b("2026-12-04", "08:00"), b("2026-11-23")],
      week(),
      weekRow(FRI, { repeat_every_weeks: 2, repeat_anchor_date: "2026-11-27" }),
      [],
      [],
    );
    expect(out).toEqual([b("2026-12-04", "08:00"), b("2026-12-04", "12:00"), b("2026-12-18", "09:00")]);
  });

  it("moving the anchor a week lists the newly-off weeks only (already-off ones were closed before)", () => {
    const out = bookingsOnClosingDays(
      [b("2026-11-27"), b("2026-12-04"), b("2026-12-11"), b("2026-12-18")],
      week({ repeat_every_weeks: 2, repeat_anchor_date: "2026-11-27" }),
      weekRow(FRI, { repeat_every_weeks: 2, repeat_anchor_date: "2026-12-04" }),
      [],
      [],
    );
    expect(out).toEqual([b("2026-11-27"), b("2026-12-11")]);
  });

  it("blocked dates and date-openings are respected; every week closes nothing", () => {
    const opening: DateOverrideRow = { override_date: "2026-12-18", is_available: true, start_time: "10:00", end_time: "12:00", break_start: null, break_end: null };
    expect(bookingsOnClosingDays(
      [b("2026-12-04"), b("2026-12-18")],
      week(),
      weekRow(FRI, { repeat_every_weeks: 2, repeat_anchor_date: "2026-11-27" }),
      ["2026-12-04"],
      [opening],
    )).toEqual([]);
    expect(bookingsOnClosingDays(
      [b("2026-12-04")],
      week({ repeat_every_weeks: 2, repeat_anchor_date: "2026-11-27" }),
      weekRow(FRI),
      [],
      [],
    )).toEqual([]);
  });

  it("groupByDate keeps order", () => {
    expect(groupByDate([b("2026-12-04", "08:00"), b("2026-12-04", "12:00"), b("2026-12-18")]).map(([d, l]) => [d, l.length]))
      .toEqual([["2026-12-04", 2], ["2026-12-18", 1]]);
  });
});
