import { describe, it, expect } from "vitest";
import { AVAILABILITY_WINDOW_DAYS, availabilityWindow } from "./availabilityWindow";

describe("availabilityWindow", () => {
  it("starts at today, in LOCAL calendar terms", () => {
    expect(availabilityWindow(new Date(2026, 8, 4, 12, 0)).fromStr).toBe("2026-09-04");
  });

  it("ends AVAILABILITY_WINDOW_DAYS later", () => {
    // 2026-09-04 + 60 days = 2026-11-03.
    expect(availabilityWindow(new Date(2026, 8, 4)).toStr).toBe("2026-11-03");
  });

  it("covers any realistic booking window", () => {
    // Both flows cap their calendars at booking_window_days (default 14). If this
    // ever drops below that, days the customer can reach would fall outside the
    // fetched window and resolve as though nothing were scheduled.
    expect(AVAILABILITY_WINDOW_DAYS).toBeGreaterThanOrEqual(14);
  });

  // The hazard this helper exists to avoid: toISOString() on a local-midnight
  // Date reports the PREVIOUS day for a UTC+2/+3 timezone, which would drop today
  // out of the window entirely.
  it("does not roll back a day at local midnight", () => {
    expect(availabilityWindow(new Date(2026, 8, 4, 0, 0)).fromStr).toBe("2026-09-04");
  });

  it("crosses a year boundary correctly", () => {
    const { fromStr, toStr } = availabilityWindow(new Date(2026, 11, 15));
    expect(fromStr).toBe("2026-12-15");
    expect(toStr).toBe("2027-02-13");
  });

  it("does not mutate the Date it is given", () => {
    // It derives the end by mutating a COPY; mutating the caller's Date would
    // corrupt whatever else that render is using it for.
    const now = new Date(2026, 8, 4);
    availabilityWindow(now);
    expect(now.getDate()).toBe(4);
    expect(now.getMonth()).toBe(8);
  });

  it("is deterministic for the same instant, so two callers key identically", () => {
    // The whole reason this module exists: two independent derivations would be
    // free to disagree and split one React Query cache into two.
    const now = new Date(2026, 8, 4, 9, 30);
    expect(availabilityWindow(now)).toEqual(availabilityWindow(now));
  });
});
