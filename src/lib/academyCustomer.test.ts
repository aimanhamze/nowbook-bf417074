import { describe, it, expect } from "vitest";
import { courseCancelState, courseHasStarted, courseSpan, seatsState, FEW_SEATS_THRESHOLD } from "./academyCustomer";

describe("seatsState (seats-left rendering)", () => {
  it("no counts row -> unknown (course not open or not loaded): show nothing", () => {
    expect(seatsState(undefined)).toEqual({ kind: "unknown" });
    expect(seatsState(null)).toEqual({ kind: "unknown" });
  });

  it("0 free -> full", () => {
    expect(seatsState({ max_seats: 10, taken: 10, free: 0 })).toEqual({ kind: "full" });
  });

  it(`1..${FEW_SEATS_THRESHOLD} free -> few`, () => {
    expect(seatsState({ max_seats: 10, taken: 9, free: 1 })).toEqual({ kind: "few", free: 1 });
    expect(seatsState({ max_seats: 10, taken: 7, free: 3 })).toEqual({ kind: "few", free: 3 });
  });

  it("more than that -> open with the count", () => {
    expect(seatsState({ max_seats: 10, taken: 6, free: 4 })).toEqual({ kind: "open", free: 4 });
    expect(seatsState({ max_seats: 20, taken: 0, free: 20 })).toEqual({ kind: "open", free: 20 });
  });

  it("clamps impossible numbers rather than showing them", () => {
    expect(seatsState({ max_seats: 5, taken: 9, free: -4 })).toEqual({ kind: "full" });
    expect(seatsState({ max_seats: 5, taken: 0, free: 99 })).toEqual({ kind: "open", free: 5 });
  });
});

describe("courseSpan", () => {
  it("first / last / count in chronological order", () => {
    const span = courseSpan([
      { session_date: "2030-02-01", start_time: "18:00:00", end_time: "19:00:00" },
      { session_date: "2030-01-15", start_time: "18:00:00", end_time: "19:00:00" },
      { session_date: "2030-01-15", start_time: "10:00:00", end_time: "11:00:00" },
    ]);
    expect(span.count).toBe(3);
    expect(span.first).toEqual({ session_date: "2030-01-15", start_time: "10:00:00", end_time: "11:00:00" });
    expect(span.last?.session_date).toBe("2030-02-01");
  });

  it("empty course", () => {
    expect(courseSpan([])).toEqual({ count: 0, first: null, last: null });
  });
});

describe("courseCancelState (mirrors cancel_course_registration)", () => {
  const first = { session_date: "2030-01-10", start_time: "18:00:00" };

  it("well before the deadline -> open, deadline = start − hours", () => {
    expect(courseCancelState(first, 24, { date: "2030-01-08", time: "12:00" })).toEqual({
      kind: "open",
      deadline: { date: "2030-01-09", time: "18:00" },
    });
  });

  it("exactly at the deadline is still allowed (the RPC uses >)", () => {
    expect(courseCancelState(first, 24, { date: "2030-01-09", time: "18:00" }).kind).toBe("open");
  });

  it("one minute after the deadline -> window closed", () => {
    expect(courseCancelState(first, 24, { date: "2030-01-09", time: "18:01" })).toEqual({
      kind: "window_closed",
      deadline: { date: "2030-01-09", time: "18:00" },
    });
  });

  it("at or after the first start -> started", () => {
    expect(courseCancelState(first, 24, { date: "2030-01-10", time: "18:00" })).toEqual({ kind: "started" });
    expect(courseCancelState(first, 0, { date: "2030-02-01", time: "09:00" })).toEqual({ kind: "started" });
  });

  it("0 hours: open right up to the start", () => {
    expect(courseCancelState(first, 0, { date: "2030-01-10", time: "17:59" })).toEqual({
      kind: "open",
      deadline: { date: "2030-01-10", time: "18:00" },
    });
  });

  it("deadline crosses month/year boundaries", () => {
    expect(
      courseCancelState({ session_date: "2030-01-01", start_time: "09:00:00" }, 48, { date: "2029-12-01", time: "00:00" }),
    ).toEqual({ kind: "open", deadline: { date: "2029-12-30", time: "09:00" } });
  });

  it("is wall-clock arithmetic: the Israel DST night does not move the deadline", () => {
    // Summer time starts on Friday 2030-03-29. 24h before Saturday 10:00 is
    // Friday 10:00 on the wall clock, exactly as the DB's timestamp math says.
    expect(
      courseCancelState({ session_date: "2030-03-30", start_time: "10:00:00" }, 24, { date: "2030-03-20", time: "10:00" }),
    ).toEqual({ kind: "open", deadline: { date: "2030-03-29", time: "10:00" } });
  });

  it("no sessions -> open with no deadline (nothing has started)", () => {
    expect(courseCancelState(null, 24, { date: "2030-01-01", time: "00:00" })).toEqual({ kind: "open", deadline: null });
  });
});

describe("courseHasStarted", () => {
  const first = { session_date: "2030-01-10", start_time: "18:00:00" };
  it("before / at / after the first start", () => {
    expect(courseHasStarted(first, { date: "2030-01-10", time: "17:59" })).toBe(false);
    expect(courseHasStarted(first, { date: "2030-01-10", time: "18:00" })).toBe(true);
    expect(courseHasStarted(first, { date: "2030-01-11", time: "00:00" })).toBe(true);
    expect(courseHasStarted(null, { date: "2030-01-11", time: "00:00" })).toBe(false);
  });
});
