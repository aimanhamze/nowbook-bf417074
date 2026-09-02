import { describe, it, expect } from "vitest";
import { bookingDuration } from "./bookingDuration";

const SERVICES = [
  { id: "a", duration: 30 },
  { id: "b", duration: 45 },
  { id: "c", duration: 15 },
];

describe("bookingDuration", () => {
  it("sums the booked services when there is no override", () => {
    expect(bookingDuration({ service_ids: ["a"] }, SERVICES)).toBe(30);
    expect(bookingDuration({ service_ids: ["a", "b"] }, SERVICES)).toBe(75);
    expect(bookingDuration({ service_ids: ["a", "b", "c"] }, SERVICES)).toBe(90);
  });

  it("prefers the override over the service sum", () => {
    expect(bookingDuration({ service_ids: ["a", "b"], duration_override: 20 }, SERVICES)).toBe(20);
    expect(bookingDuration({ service_ids: ["a"], duration_override: 60 }, SERVICES)).toBe(60);
  });

  it("treats null/undefined override as absent", () => {
    expect(bookingDuration({ service_ids: ["a"], duration_override: null }, SERVICES)).toBe(30);
    expect(bookingDuration({ service_ids: ["a"], duration_override: undefined }, SERVICES)).toBe(30);
  });

  // The CHECK constraint forbids 0, so this only documents the falsy-guard.
  it("falls through to the service sum on a 0 override", () => {
    expect(bookingDuration({ service_ids: ["a"], duration_override: 0 }, SERVICES)).toBe(30);
  });

  // Mirrors the trigger's `ps.id = ANY(service_ids)` join: an unknown service
  // contributes nothing rather than a guessed default.
  it("ignores services missing from the list", () => {
    expect(bookingDuration({ service_ids: ["a", "gone"] }, SERVICES)).toBe(30);
  });

  // ...but a booking that resolves to nothing at all still occupies a slot,
  // matching the trigger's COALESCE(NULLIF(SUM(...), 0), 30) floor.
  it("falls back to 30 when nothing resolves", () => {
    expect(bookingDuration({ service_ids: [] }, SERVICES)).toBe(30);
    expect(bookingDuration({ service_ids: ["gone"] }, SERVICES)).toBe(30);
    expect(bookingDuration({}, SERVICES)).toBe(30);
    expect(bookingDuration({ service_ids: ["a"] }, [])).toBe(30);
  });

  it("still honours an override when the services cannot be resolved", () => {
    expect(bookingDuration({ service_ids: ["gone"], duration_override: 25 }, SERVICES)).toBe(25);
  });
});
