import { describe, it, expect } from "vitest";
import {
  courseRegistrants,
  filterRegistrations,
  registrationCounts,
  seatsTakenByCourse,
  type RegistrationLike,
} from "./academyRegistrations";

const r = (id: string, course_id: string, status: RegistrationLike["status"], created_at: string): RegistrationLike => ({
  id,
  course_id,
  status,
  created_at,
});

const rows: RegistrationLike[] = [
  r("a", "c1", "pending", "2030-01-03T10:00:00Z"),
  r("b", "c1", "confirmed", "2030-01-01T10:00:00Z"),
  r("c", "c2", "pending", "2030-01-02T10:00:00Z"),
  r("d", "c1", "rejected", "2030-01-04T10:00:00Z"),
  r("e", "c2", "cancelled", "2030-01-05T10:00:00Z"),
  r("f", "c1", "confirmed", "2030-01-06T10:00:00Z"),
];

describe("registrationCounts (tab badges)", () => {
  it("counts pending, confirmed and all", () => {
    expect(registrationCounts(rows)).toEqual({ pending: 2, confirmed: 2, all: 6 });
  });
  it("empty", () => {
    expect(registrationCounts([])).toEqual({ pending: 0, confirmed: 0, all: 0 });
  });
});

describe("filterRegistrations", () => {
  it("pending: only pending, oldest request first", () => {
    expect(filterRegistrations(rows, "pending").map((x) => x.id)).toEqual(["c", "a"]);
  });
  it("confirmed: only confirmed, newest first", () => {
    expect(filterRegistrations(rows, "confirmed").map((x) => x.id)).toEqual(["f", "b"]);
  });
  it("all: every status, newest first", () => {
    expect(filterRegistrations(rows, "all").map((x) => x.id)).toEqual(["f", "e", "d", "a", "c", "b"]);
  });
  it("does not mutate its input", () => {
    const before = rows.map((x) => x.id);
    filterRegistrations(rows, "all");
    expect(rows.map((x) => x.id)).toEqual(before);
  });
  it("ties on created_at are ordered by id, so the list never jumps", () => {
    const tied = [r("y", "c1", "pending", "2030-01-01T00:00:00Z"), r("x", "c1", "pending", "2030-01-01T00:00:00Z")];
    expect(filterRegistrations(tied, "pending").map((x) => x.id)).toEqual(["x", "y"]);
  });
});

describe("courseRegistrants (per-course view)", () => {
  it("only seat holders of that course, confirmed first then by request time", () => {
    expect(courseRegistrants(rows, "c1").map((x) => x.id)).toEqual(["b", "f", "a"]);
    expect(courseRegistrants(rows, "c2").map((x) => x.id)).toEqual(["c"]);
    expect(courseRegistrants(rows, "nope")).toEqual([]);
  });
});

describe("seatsTakenByCourse", () => {
  it("pending + confirmed hold a seat; rejected / cancelled do not", () => {
    expect(Object.fromEntries(seatsTakenByCourse(rows))).toEqual({ c1: 3, c2: 1 });
  });
});
