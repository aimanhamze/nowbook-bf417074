import { describe, it, expect } from "vitest";
import type {
  AcademyCourseRow,
  AcademyCourseSessionRow,
  AcademyInstructorRow,
} from "@/integrations/supabase/academyTypes";
import {
  academyCalendarRange,
  academyCalendarSessionsKey,
  buildAcademyCalendarItems,
  instructorColor,
  itemsByDate,
  seatSummaryByCourse,
} from "./academyCalendar";

const course = (id: string, over: Partial<AcademyCourseRow> = {}): AcademyCourseRow => ({
  id,
  provider_id: "p",
  instructor_id: "i1",
  name: id.toUpperCase(),
  description: null,
  image_url: null,
  location_type: "physical",
  address: "a",
  online_url: null,
  price: null,
  max_seats: 10,
  cancellation_hours: 24,
  is_active: true,
  created_at: "",
  updated_at: "",
  ...over,
});

const session = (id: string, course_id: string, date: string, start: string, instructor_id = "i1"): AcademyCourseSessionRow => ({
  id,
  course_id,
  provider_id: "p",
  instructor_id,
  session_date: date,
  start_time: `${start}:00`,
  end_time: "23:00:00",
  period: null,
  created_at: "",
});

const instructor = (id: string, name: string): AcademyInstructorRow => ({
  id,
  provider_id: "p",
  name,
  bio: null,
  photo_url: null,
  is_active: true,
  display_order: 0,
  created_at: "",
});

describe("academyCalendarRange (what each view fetches)", () => {
  // 2030-01-08 is a Tuesday.
  const day = new Date(2030, 0, 8);

  it("daily: just that day", () => {
    expect(academyCalendarRange("daily", day)).toEqual({ from: "2030-01-08", to: "2030-01-08" });
  });

  it("weekly: Sunday to Saturday around the day", () => {
    expect(academyCalendarRange("weekly", day)).toEqual({ from: "2030-01-06", to: "2030-01-12" });
  });

  it("weekly across a month / year boundary", () => {
    expect(academyCalendarRange("weekly", new Date(2029, 11, 31))).toEqual({ from: "2029-12-30", to: "2030-01-05" });
  });

  it("monthly: the displayed month, which may differ from the selected day", () => {
    expect(academyCalendarRange("monthly", day)).toEqual({ from: "2030-01-01", to: "2030-01-31" });
    expect(academyCalendarRange("monthly", day, new Date(2028, 1, 10))).toEqual({ from: "2028-02-01", to: "2028-02-29" });
  });
});

describe("academyCalendarSessionsKey", () => {
  it("one key per provider and range", () => {
    const r = { from: "2030-01-06", to: "2030-01-12" };
    expect(academyCalendarSessionsKey("p1", r)).toEqual(["academy-calendar-sessions", "p1", "2030-01-06", "2030-01-12"]);
    expect(academyCalendarSessionsKey("p1", r)).not.toEqual(
      academyCalendarSessionsKey("p1", { from: "2030-01-13", to: "2030-01-19" }),
    );
    expect(academyCalendarSessionsKey("p1", r)).not.toEqual(academyCalendarSessionsKey("p2", r));
  });
});

describe("seatSummaryByCourse (one grouped pass)", () => {
  it("counts confirmed and pending per course; ignores rejected / cancelled", () => {
    const m = seatSummaryByCourse([
      { course_id: "a", status: "confirmed" },
      { course_id: "a", status: "pending" },
      { course_id: "a", status: "pending" },
      { course_id: "a", status: "cancelled" },
      { course_id: "b", status: "rejected" },
      { course_id: "c", status: "confirmed" },
    ]);
    expect(Object.fromEntries(m)).toEqual({ a: { confirmed: 1, pending: 2 }, c: { confirmed: 1, pending: 0 } });
  });
});

describe("instructorColor", () => {
  it("is stable per id and an hsl colour", () => {
    expect(instructorColor("i1")).toBe(instructorColor("i1"));
    expect(instructorColor("i1")).toMatch(/^hsl\(\d+ 65% 48%\)$/);
  });
});

describe("buildAcademyCalendarItems", () => {
  const courses = new Map([
    ["a", course("a", { max_seats: 12 })],
    ["b", course("b", { instructor_id: "i2" })],
    ["off", course("off", { is_active: false })],
    ["off2", course("off2", { is_active: false })],
  ]);
  const instructors = new Map([
    ["i1", instructor("i1", "Dana")],
    ["i2", instructor("i2", "Omar")],
  ]);
  const seats = new Map([
    ["a", { confirmed: 3, pending: 2 }],
    ["off", { confirmed: 1, pending: 0 }],
  ]);
  const sessions = [
    session("s3", "a", "2030-01-09", "10:00"),
    session("s1", "b", "2030-01-08", "18:00", "i2"),
    session("s2", "a", "2030-01-08", "09:00"),
    session("s4", "off", "2030-01-08", "12:00"),
    session("s5", "off2", "2030-01-08", "13:00"),
    session("s6", "gone", "2030-01-08", "14:00"),
  ];

  const all = buildAcademyCalendarItems({ sessions, courses, instructors, seats, instructorFilter: "all" });

  it("one block per session, sorted by date then start", () => {
    expect(all.map((i) => i.sessionId)).toEqual(["s2", "s4", "s1", "s3"]);
  });

  it("carries name, times, instructor, colour and seats confirmed/max + pending", () => {
    const s2 = all.find((i) => i.sessionId === "s2")!;
    expect(s2).toMatchObject({
      courseName: "A",
      date: "2030-01-08",
      start: "09:00",
      end: "23:00",
      instructorName: "Dana",
      confirmed: 3,
      pending: 2,
      maxSeats: 12,
      dimmed: false,
      color: instructorColor("i1"),
    });
    expect(all.find((i) => i.sessionId === "s1")).toMatchObject({ confirmed: 0, pending: 0, instructorName: "Omar" });
  });

  it("inactive course: hidden unless someone still holds a seat, then dimmed", () => {
    expect(all.find((i) => i.sessionId === "s4")?.dimmed).toBe(true);
    expect(all.some((i) => i.sessionId === "s5")).toBe(false);
  });

  it("skips sessions whose course is unknown", () => {
    expect(all.some((i) => i.sessionId === "s6")).toBe(false);
  });

  it("instructor filter", () => {
    const omar = buildAcademyCalendarItems({ sessions, courses, instructors, seats, instructorFilter: "i2" });
    expect(omar.map((i) => i.sessionId)).toEqual(["s1"]);
  });

  it("itemsByDate groups in order", () => {
    const g = itemsByDate(all);
    expect([...g.keys()]).toEqual(["2030-01-08", "2030-01-09"]);
    expect(g.get("2030-01-08")!.map((i) => i.sessionId)).toEqual(["s2", "s4", "s1"]);
  });
});
