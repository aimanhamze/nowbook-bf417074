import { describe, expect, it } from "vitest";
import {
  canOfferRepeat,
  seriesCancelCounts,
  summarizeSeriesCancel,
  classifySeriesDate,
  seriesPositions,
  summarizeSeriesCreate,
  weeklySeriesDates,
  type SeriesCreateRow,
} from "./recurringSeries";
import { toLocalDateStr, type DayWindow } from "./availabilityResolver";

const OPEN: DayWindow = { start_time: "09:00", end_time: "17:00", break_start: null, break_end: null };

describe("weeklySeriesDates", () => {
  it("returns count dates, 7 days apart, first included", () => {
    const dates = weeklySeriesDates(new Date(2026, 10, 10), 3).map(toLocalDateStr);
    expect(dates).toEqual(["2026-11-10", "2026-11-17", "2026-11-24"]);
  });

  it("crosses a month and a DST change without drifting", () => {
    // Israel leaves DST on the last Sunday of October.
    const dates = weeklySeriesDates(new Date(2026, 9, 20), 3).map(toLocalDateStr);
    expect(dates).toEqual(["2026-10-20", "2026-10-27", "2026-11-03"]);
  });

  it("12 appointments span 77 days", () => {
    const dates = weeklySeriesDates(new Date(2026, 10, 10), 12);
    expect(dates).toHaveLength(12);
    expect((dates[11].getTime() - dates[0].getTime()) / 86_400_000).toBeCloseTo(77, 0);
  });

  it("clamps the count to 0..12", () => {
    expect(weeklySeriesDates(new Date(2026, 10, 10), 20)).toHaveLength(12);
    expect(weeklySeriesDates(new Date(2026, 10, 10), -1)).toHaveLength(0);
  });
});

describe("classifySeriesDate", () => {
  const base = { time: "10:00", shop: OPEN, narrowed: OPEN };

  it("available when the time is a bookable slot", () => {
    expect(classifySeriesDate({ ...base, slots: ["10:00"], freeSlots: ["10:00"] })).toBe("available");
  });

  it("taken when only bookings stand in the way", () => {
    expect(classifySeriesDate({ ...base, slots: [], freeSlots: ["10:00"] })).toBe("taken");
  });

  it("closed when the shop is closed or blocked", () => {
    expect(classifySeriesDate({ ...base, shop: null, narrowed: null, slots: [], freeSlots: [] })).toBe("closed");
  });

  it("staffOff when the shop is open but the member is not working", () => {
    expect(classifySeriesDate({ ...base, narrowed: null, slots: [], freeSlots: [] })).toBe("staffOff");
  });

  it("closed when open that day but not at that time", () => {
    expect(classifySeriesDate({ ...base, slots: ["09:00"], freeSlots: ["09:00"] })).toBe("closed");
  });
});

describe("canOfferRepeat", () => {
  const ok = {
    serviceType: "private",
    providerCategory: "barber",
    manualTime: false,
    dayOverridden: false,
    timeInSlotList: true,
  };
  it("offers it for a slot-list time on an open day", () => {
    expect(canOfferRepeat(ok)).toBe(true);
  });
  it.each([
    ["group service", { serviceType: "group" }],
    ["fitness studio", { providerCategory: "fitness_studio" }],
    ["manual time", { manualTime: true }],
    ["forced off day", { dayOverridden: true }],
    ["time not in the slot list", { timeInSlotList: false }],
  ])("hides it for a %s", (_label, patch) => {
    expect(canOfferRepeat({ ...ok, ...patch })).toBe(false);
  });
});

describe("summarizeSeriesCreate", () => {
  const row = (p: Partial<SeriesCreateRow>): SeriesCreateRow => ({
    r_code: "OK",
    r_series_id: "s1",
    r_date: null,
    r_booking_id: null,
    r_outcome: null,
    ...p,
  });

  it("splits created and skipped dates, first booking = earliest created", () => {
    const res = summarizeSeriesCreate([
      row({ r_date: "2026-11-24", r_outcome: "created", r_booking_id: "b3" }),
      row({ r_date: "2026-11-10", r_outcome: "taken" }),
      row({ r_date: "2026-11-17", r_outcome: "created", r_booking_id: "b2" }),
    ]);
    expect(res).toEqual({
      code: "OK",
      seriesId: "s1",
      createdDates: ["2026-11-17", "2026-11-24"],
      skippedDates: ["2026-11-10"],
      firstBookingId: "b2",
    });
  });

  it("ALL_TAKEN keeps the skipped dates and nothing else", () => {
    const res = summarizeSeriesCreate([
      row({ r_code: "ALL_TAKEN", r_series_id: null, r_date: "2026-11-10", r_outcome: "taken" }),
    ]);
    expect(res.code).toBe("ALL_TAKEN");
    expect(res.seriesId).toBeNull();
    expect(res.createdDates).toEqual([]);
    expect(res.skippedDates).toEqual(["2026-11-10"]);
  });

  it("refusal codes pass through; unknown or empty becomes UNKNOWN", () => {
    expect(summarizeSeriesCreate([row({ r_code: "NOT_OWNER", r_series_id: null })]).code).toBe("NOT_OWNER");
    expect(summarizeSeriesCreate([row({ r_code: "SOMETHING_NEW" })]).code).toBe("UNKNOWN");
    expect(summarizeSeriesCreate([]).code).toBe("UNKNOWN");
  });
});

describe("seriesPositions", () => {
  it("numbers each series by date then time, cancelled ones included", () => {
    const rows = [
      { id: "c", series_id: "s", booking_date: "2026-11-24", booking_time: "10:00" },
      { id: "a", series_id: "s", booking_date: "2026-11-10", booking_time: "10:00" },
      { id: "b", series_id: "s", booking_date: "2026-11-17", booking_time: "10:00" },
      { id: "x", series_id: "t", booking_date: "2026-11-11", booking_time: "09:00" },
      { id: "n", series_id: null, booking_date: "2026-11-10", booking_time: "11:00" },
    ];
    const pos = seriesPositions(rows);
    expect(pos.get("a")).toEqual({ index: 1, total: 3 });
    expect(pos.get("b")).toEqual({ index: 2, total: 3 });
    expect(pos.get("c")).toEqual({ index: 3, total: 3 });
    expect(pos.get("x")).toEqual({ index: 1, total: 1 });
    expect(pos.has("n")).toBe(false);
  });

  it("is computed once per array", () => {
    const rows = [{ id: "a", series_id: "s", booking_date: "2026-11-10", booking_time: "10:00" }];
    expect(seriesPositions(rows)).toBe(seriesPositions(rows));
  });
});

describe("summarizeSeriesCancel", () => {
  it("OK carries the cancellation id and count", () => {
    expect(
      summarizeSeriesCancel([
        { r_code: "OK", r_cancellation_id: "c1", r_cancelled_count: 4, r_first_booking_id: "b", r_first_date: "2026-11-17" },
      ]),
    ).toEqual({ code: "OK", cancellationId: "c1", cancelledCount: 4 });
  });
  it("other codes carry nothing; unknown or empty is UNKNOWN", () => {
    const none = { r_cancellation_id: null, r_cancelled_count: 0, r_first_booking_id: null, r_first_date: null };
    expect(summarizeSeriesCancel([{ r_code: "NOTHING_TO_CANCEL", ...none }])).toEqual({
      code: "NOTHING_TO_CANCEL",
      cancellationId: null,
      cancelledCount: 0,
    });
    expect(summarizeSeriesCancel([{ r_code: "WHAT", ...none }]).code).toBe("UNKNOWN");
    expect(summarizeSeriesCancel([]).code).toBe("UNKNOWN");
  });
});

describe("seriesCancelCounts", () => {
  const now = new Date(2026, 10, 11, 12, 0);
  const rows = [
    { id: "past", series_id: "s", booking_date: "2026-11-04", booking_time: "10:00", status: "confirmed" },
    { id: "today-earlier", series_id: "s", booking_date: "2026-11-11", booking_time: "10:00", status: "confirmed" },
    { id: "w1", series_id: "s", booking_date: "2026-11-18", booking_time: "10:00", status: "confirmed" },
    { id: "w2", series_id: "s", booking_date: "2026-11-25", booking_time: "10:00", status: "cancelled" },
    { id: "w3", series_id: "s", booking_date: "2026-12-02", booking_time: "10:00", status: "confirmed" },
    { id: "other", series_id: "t", booking_date: "2026-11-18", booking_time: "10:00", status: "confirmed" },
  ];
  it("counts only upcoming, active bookings of the same series", () => {
    expect(seriesCancelCounts(rows, rows[2], now)).toEqual({ fromHere: 2, allUpcoming: 2 });
    expect(seriesCancelCounts(rows, rows[4], now)).toEqual({ fromHere: 1, allUpcoming: 2 });
  });
  it("from a past booking, 'from here' still means everything after it", () => {
    expect(seriesCancelCounts(rows, rows[0], now)).toEqual({ fromHere: 2, allUpcoming: 2 });
  });
  it("is zero for a booking without a series", () => {
    expect(seriesCancelCounts(rows, { ...rows[2], series_id: null }, now)).toEqual({ fromHere: 0, allUpcoming: 0 });
  });
});
