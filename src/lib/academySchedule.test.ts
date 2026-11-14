import { describe, it, expect } from "vitest";
import { groupSessionsByWeek, mostCommonTimeRange, schedulePatterns, weekdayOf } from "./academySchedule";

const s = (date: string, start = "13:00:00", end = "15:00:00") => ({ session_date: date, start_time: start, end_time: end });

describe("weekdayOf", () => {
  it("reads the wall date, not the viewer's timezone", () => {
    expect(weekdayOf("2026-11-15")).toBe(0); // Sunday
    expect(weekdayOf("2026-11-19")).toBe(4); // Thursday
    expect(weekdayOf("2026-11-21")).toBe(6); // Saturday
  });
});

describe("mostCommonTimeRange", () => {
  it("null without sessions", () => {
    expect(mostCommonTimeRange([])).toBeNull();
  });

  it("the hours most sessions share", () => {
    const sessions = [s("2026-11-15"), s("2026-11-16"), s("2026-11-21", "14:00:00", "16:00:00")];
    expect(mostCommonTimeRange(sessions)).toEqual({ start: "13:00", end: "15:00" });
  });

  it("a tie goes to the range that comes first", () => {
    const sessions = [s("2026-11-15", "09:00:00", "10:00:00"), s("2026-11-16", "18:00:00", "19:00:00")];
    expect(mostCommonTimeRange(sessions)).toEqual({ start: "09:00", end: "10:00" });
  });

  it("same start with a different end is a different range", () => {
    const sessions = [s("2026-11-15", "09:00:00", "10:00:00"), s("2026-11-16", "09:00:00", "11:00:00"), s("2026-11-17", "09:00:00", "11:00:00")];
    expect(mostCommonTimeRange(sessions)).toEqual({ start: "09:00", end: "11:00" });
  });
});

describe("schedulePatterns", () => {
  it("weekdays per start time, most frequent first", () => {
    const sessions = [
      s("2026-11-15"), // Sun
      s("2026-11-16"), // Mon
      s("2026-11-19"), // Thu
      s("2026-11-21", "14:00:00", "16:00:00"), // Sat
      s("2026-11-22"), // Sun again
    ];
    expect(schedulePatterns(sessions)).toEqual([
      { weekdays: [0, 1, 4], time: "13:00", count: 4 },
      { weekdays: [6], time: "14:00", count: 1 },
    ]);
  });

  it("equal counts are ordered by time", () => {
    const sessions = [s("2026-11-16", "18:00:00", "19:00:00"), s("2026-11-15", "09:00:00", "10:00:00")];
    expect(schedulePatterns(sessions).map((p) => p.time)).toEqual(["09:00", "18:00"]);
  });

  it("empty schedule, no patterns", () => {
    expect(schedulePatterns([])).toEqual([]);
  });
});

describe("groupSessionsByWeek", () => {
  it("Sunday starts a week; Saturday closes it", () => {
    const sessions = [s("2026-11-19"), s("2026-11-21"), s("2026-11-22"), s("2026-11-26")];
    const weeks = groupSessionsByWeek(sessions);
    expect(weeks.map((w) => [w.number, w.sessions.map((x) => x.session_date)])).toEqual([
      [1, ["2026-11-19", "2026-11-21"]],
      [2, ["2026-11-22", "2026-11-26"]],
    ]);
  });

  it("a week without sessions is skipped, not renumbered", () => {
    const weeks = groupSessionsByWeek([s("2026-11-15"), s("2026-11-29")]);
    expect(weeks.map((w) => w.number)).toEqual([1, 3]);
  });

  it("crosses a year boundary", () => {
    const weeks = groupSessionsByWeek([s("2026-12-31"), s("2027-01-03")]);
    expect(weeks.map((w) => w.number)).toEqual([1, 2]);
  });

  it("no sessions, no weeks", () => {
    expect(groupSessionsByWeek([])).toEqual([]);
  });
});
