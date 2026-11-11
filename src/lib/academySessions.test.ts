import { describe, it, expect } from "vitest";
import {
  expandDateRange,
  isHttpsUrl,
  isSessionPast,
  isValidTimeRange,
  jerusalemNow,
  MAX_SESSIONS_PER_BATCH,
  sessionWritesForDates,
  sortSessions,
  toDbTime,
  toTimeInput,
} from "./academySessions";

describe("expandDateRange", () => {
  it("is inclusive of both ends", () => {
    expect(expandDateRange("2030-01-07", "2030-01-09")).toEqual({
      ok: true,
      dates: ["2030-01-07", "2030-01-08", "2030-01-09"],
    });
  });

  it("a single day is one session", () => {
    expect(expandDateRange("2030-01-07", "2030-01-07")).toEqual({ ok: true, dates: ["2030-01-07"] });
  });

  it("filters by weekday (0 = Sunday)", () => {
    // 2030-01-06 is a Sunday.
    const r = expandDateRange("2030-01-06", "2030-01-20", [1, 3]);
    expect(r).toEqual({
      ok: true,
      dates: ["2030-01-07", "2030-01-09", "2030-01-14", "2030-01-16"],
    });
  });

  it("an empty weekday list means every day", () => {
    const r = expandDateRange("2030-01-06", "2030-01-08", []);
    expect(r.ok && r.dates.length).toBe(3);
  });

  it("crosses month and year ends", () => {
    expect(expandDateRange("2029-12-30", "2030-01-02")).toEqual({
      ok: true,
      dates: ["2029-12-30", "2029-12-31", "2030-01-01", "2030-01-02"],
    });
  });

  it("handles leap days", () => {
    expect(expandDateRange("2028-02-28", "2028-03-01")).toEqual({
      ok: true,
      dates: ["2028-02-28", "2028-02-29", "2028-03-01"],
    });
  });

  it("does not drop or repeat a day across the Israel DST switches", () => {
    // Israel moves to summer time on the Friday before the last Sunday of
    // March and back on the last Sunday of October.
    const spring = expandDateRange("2030-03-27", "2030-03-31");
    const autumn = expandDateRange("2030-10-25", "2030-10-29");
    expect(spring.ok && spring.dates).toEqual(["2030-03-27", "2030-03-28", "2030-03-29", "2030-03-30", "2030-03-31"]);
    expect(autumn.ok && autumn.dates).toEqual(["2030-10-25", "2030-10-26", "2030-10-27", "2030-10-28", "2030-10-29"]);
  });

  it("refuses a reversed range", () => {
    expect(expandDateRange("2030-01-09", "2030-01-07")).toEqual({ ok: false, reason: "reversed" });
  });

  it("refuses malformed or impossible dates", () => {
    expect(expandDateRange("2030-02-30", "2030-03-02")).toEqual({ ok: false, reason: "invalid" });
    expect(expandDateRange("", "2030-03-02")).toEqual({ ok: false, reason: "invalid" });
    expect(expandDateRange("2030-1-7", "2030-01-09")).toEqual({ ok: false, reason: "invalid" });
  });

  it("reports empty when no weekday in the range matches", () => {
    // Mon..Wed, asking only for Saturdays.
    expect(expandDateRange("2030-01-07", "2030-01-09", [6])).toEqual({ ok: false, reason: "empty" });
  });

  it("refuses (never truncates) a range over the limit, and says how many", () => {
    const r = expandDateRange("2030-01-01", "2030-12-31");
    expect(r).toEqual({ ok: false, reason: "too_many", count: 365 });
    const exactly = expandDateRange("2030-01-01", "2030-03-01", undefined, MAX_SESSIONS_PER_BATCH);
    expect(exactly.ok && exactly.dates.length).toBe(60);
  });

  it("counts the over-limit total with the weekday filter applied", () => {
    // Mondays of 2030: 52.
    expect(expandDateRange("2030-01-01", "2030-12-31", [1], 10)).toEqual({ ok: false, reason: "too_many", count: 52 });
  });
});

describe("session writes", () => {
  it("one row per date with the same hours, in DB time format", () => {
    expect(sessionWritesForDates(["2030-01-07", "2030-01-14"], "18:00", "19:30")).toEqual([
      { session_date: "2030-01-07", start_time: "18:00:00", end_time: "19:30:00" },
      { session_date: "2030-01-14", start_time: "18:00:00", end_time: "19:30:00" },
    ]);
  });

  it("time format round trip", () => {
    expect(toDbTime("09:05")).toBe("09:05:00");
    expect(toDbTime("09:05:00")).toBe("09:05:00");
    expect(toTimeInput("09:05:00")).toBe("09:05");
  });

  it("time range matches the DB rule (end strictly after start)", () => {
    expect(isValidTimeRange("10:00", "11:00")).toBe(true);
    expect(isValidTimeRange("10:00", "10:00")).toBe(false);
    expect(isValidTimeRange("23:00", "01:00")).toBe(false);
    expect(isValidTimeRange("", "10:00")).toBe(false);
  });

  it("sorts by date then start time", () => {
    const rows = [
      { session_date: "2030-01-08", start_time: "09:00:00" },
      { session_date: "2030-01-07", start_time: "18:00:00" },
      { session_date: "2030-01-07", start_time: "10:00:00" },
    ];
    expect(sortSessions(rows).map((r) => `${r.session_date} ${r.start_time}`)).toEqual([
      "2030-01-07 10:00:00",
      "2030-01-07 18:00:00",
      "2030-01-08 09:00:00",
    ]);
  });
});

describe("Asia/Jerusalem clock", () => {
  it("reads the Jerusalem wall clock, not the machine's", () => {
    // 2030-01-07T22:30Z is 00:30 on the 8th in Jerusalem (UTC+2 in winter).
    expect(jerusalemNow(new Date("2030-01-07T22:30:00Z"))).toEqual({ date: "2030-01-08", time: "00:30" });
    // Summer time, UTC+3.
    expect(jerusalemNow(new Date("2030-07-01T09:15:00Z"))).toEqual({ date: "2030-07-01", time: "12:15" });
  });

  it("a session is past once it has ended", () => {
    const now = { date: "2030-01-07", time: "11:00" };
    expect(isSessionPast({ session_date: "2030-01-06", end_time: "23:00:00" }, now)).toBe(true);
    expect(isSessionPast({ session_date: "2030-01-07", end_time: "11:00:00" }, now)).toBe(true);
    expect(isSessionPast({ session_date: "2030-01-07", end_time: "11:30:00" }, now)).toBe(false);
    expect(isSessionPast({ session_date: "2030-01-08", end_time: "08:00:00" }, now)).toBe(false);
  });
});

describe("isHttpsUrl", () => {
  it("matches the DB CHECK", () => {
    expect(isHttpsUrl("https://meet.example.com/abc")).toBe(true);
    expect(isHttpsUrl("  https://x.example  ")).toBe(true);
    expect(isHttpsUrl("http://x.example")).toBe(false);
    expect(isHttpsUrl("javascript:alert(1)")).toBe(false);
    expect(isHttpsUrl("https://")).toBe(false);
    expect(isHttpsUrl("https://a b")).toBe(false);
  });
});
