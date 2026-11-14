import { describe, it, expect } from "vitest";
import { courseBadge, endedSessionCount, nextSession, seatsMeter } from "./academyCourseView";

const s = (date: string, start = "13:00:00", end = "15:00:00") => ({ session_date: date, start_time: start, end_time: end });
const sessions = [s("2030-01-10"), s("2030-01-12"), s("2030-01-14")];

describe("nextSession / endedSessionCount", () => {
  it("before the course: the first session, none ended", () => {
    const now = { date: "2030-01-01", time: "09:00" };
    expect(nextSession(sessions, now)).toBe(sessions[0]);
    expect(endedSessionCount(sessions, now)).toBe(0);
  });

  it("a session in progress is still the next one", () => {
    const now = { date: "2030-01-10", time: "14:00" };
    expect(nextSession(sessions, now)).toBe(sessions[0]);
    expect(endedSessionCount(sessions, now)).toBe(0);
  });

  it("a session is over exactly at its end time", () => {
    const now = { date: "2030-01-10", time: "15:00" };
    expect(nextSession(sessions, now)).toBe(sessions[1]);
    expect(endedSessionCount(sessions, now)).toBe(1);
  });

  it("after the last session: nothing next", () => {
    const now = { date: "2030-02-01", time: "09:00" };
    expect(nextSession(sessions, now)).toBeNull();
    expect(endedSessionCount(sessions, now)).toBe(3);
  });
});

describe("courseBadge", () => {
  const counts = (free: number, max = 10) => ({ max_seats: max, taken: max - free, free });

  it("the customer's own status wins, even on a full course", () => {
    expect(courseBadge({ kind: "registered", status: "confirmed" }, counts(0))).toBe("registered");
    expect(courseBadge({ kind: "registered", status: "pending" }, counts(1))).toBe("pending");
  });

  it("started or without sessions reads as closed; full as full", () => {
    expect(courseBadge({ kind: "started" }, counts(5))).toBe("closed");
    expect(courseBadge({ kind: "no_sessions" }, counts(5))).toBe("closed");
    expect(courseBadge({ kind: "full" }, counts(0))).toBe("full");
  });

  it("last seat only at exactly one free seat", () => {
    expect(courseBadge({ kind: "register" }, counts(1))).toBe("last_seat");
    expect(courseBadge({ kind: "register" }, counts(2))).toBeNull();
    expect(courseBadge({ kind: "register" }, undefined)).toBeNull();
  });
});

describe("seatsMeter", () => {
  it("no counts or no seats: no bar", () => {
    expect(seatsMeter(undefined)).toBeNull();
    expect(seatsMeter({ max_seats: 0, taken: 0, free: 0 })).toBeNull();
  });

  it("green with room, amber at 1–2 left, neutral when full", () => {
    expect(seatsMeter({ max_seats: 10, taken: 3, free: 7 })).toEqual({ taken: 3, max: 10, free: 7, percent: 30, tone: "ok" });
    expect(seatsMeter({ max_seats: 4, taken: 2, free: 2 })?.tone).toBe("low");
    expect(seatsMeter({ max_seats: 4, taken: 3, free: 1 })?.tone).toBe("low");
    expect(seatsMeter({ max_seats: 4, taken: 4, free: 0 })).toMatchObject({ percent: 100, tone: "full" });
  });

  it("clamps out-of-range counts", () => {
    expect(seatsMeter({ max_seats: 4, taken: 6, free: -2 })).toMatchObject({ taken: 4, free: 0, percent: 100 });
    expect(seatsMeter({ max_seats: 4, taken: 0, free: 9 })).toMatchObject({ taken: 0, free: 4, percent: 0 });
  });
});
