import { describe, it, expect } from "vitest";
import { normalizeBookingTime } from "./bookingTime";

describe("normalizeBookingTime", () => {
  it("zero-pads a single-digit hour", () => {
    expect(normalizeBookingTime("9:30")).toBe("09:30");
    expect(normalizeBookingTime("0:05")).toBe("00:05");
  });

  it("passes an already-padded time through unchanged", () => {
    expect(normalizeBookingTime("09:30")).toBe("09:30");
    expect(normalizeBookingTime("20:00")).toBe("20:00");
    expect(normalizeBookingTime("23:59")).toBe("23:59");
  });

  it("drops a seconds component", () => {
    expect(normalizeBookingTime("09:30:00")).toBe("09:30");
    expect(normalizeBookingTime("9:30:45")).toBe("09:30");
  });

  it("tolerates surrounding whitespace", () => {
    expect(normalizeBookingTime("  20:15  ")).toBe("20:15");
  });

  it("rejects partial or empty input rather than guessing", () => {
    expect(normalizeBookingTime("")).toBeNull();
    expect(normalizeBookingTime("2")).toBeNull();
    expect(normalizeBookingTime("20:")).toBeNull();
    expect(normalizeBookingTime("20:5")).toBeNull();
    expect(normalizeBookingTime(":30")).toBeNull();
  });

  it("rejects out-of-range values", () => {
    expect(normalizeBookingTime("24:00")).toBeNull();
    expect(normalizeBookingTime("25:00")).toBeNull();
    expect(normalizeBookingTime("12:60")).toBeNull();
  });

  it("rejects non-time text", () => {
    expect(normalizeBookingTime("abc")).toBeNull();
    expect(normalizeBookingTime("8pm")).toBeNull();
    expect(normalizeBookingTime("20-00")).toBeNull();
  });

  // The two silent client-side failures this helper exists to prevent.
  it("produces a value that matches the slot grid's own formatting", () => {
    // useAllProviders.ts:604-606 builds slots exactly this way; group capacity
    // counting then compares with ===, so the two must agree byte for byte.
    const gridSlot = `${String(9).padStart(2, "0")}:${String(30).padStart(2, "0")}`;
    expect(normalizeBookingTime("9:30")).toBe(gridSlot);
  });

  it("produces a value new Date(`${date}T${time}`) can parse", () => {
    // CalendarTab.tsx:153 / :992 rely on this for completed-detection.
    const normalized = normalizeBookingTime("9:30")!;
    expect(Number.isNaN(new Date(`2026-08-09T${normalized}`).getTime())).toBe(false);
    // ...and the unpadded form it protects against does NOT parse.
    expect(Number.isNaN(new Date("2026-08-09T9:30").getTime())).toBe(true);
  });
});
