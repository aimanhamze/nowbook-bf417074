import { describe, it, expect } from "vitest";
import { enUS, he } from "date-fns/locale";
import { compactDateRange } from "./compactDateRange";

const today = new Date(2026, 10, 14);

describe("compactDateRange", () => {
  it("one day", () => {
    expect(compactDateRange("2026-11-12", "2026-11-12", enUS, today)).toBe("12 Nov");
  });
  it("same month collapses to one month name", () => {
    expect(compactDateRange("2026-11-12", "2026-11-30", enUS, today)).toBe("12–30 Nov");
    expect(compactDateRange("2026-11-12", "2026-11-30", he, today)).toBe("12–30 נוב׳");
  });
  it("across months", () => {
    expect(compactDateRange("2026-10-28", "2026-11-05", enUS, today)).toBe("28 Oct – 5 Nov");
  });
  it("across years shows both years", () => {
    expect(compactDateRange("2026-12-28", "2027-01-05", enUS, today)).toBe("28 Dec 2026 – 5 Jan 2027");
  });
  it("a range in another year shows the year once", () => {
    expect(compactDateRange("2027-02-01", "2027-02-20", enUS, today)).toBe("1–20 Feb 2027");
    expect(compactDateRange("2027-02-01", "2027-03-20", enUS, today)).toBe("1 Feb – 20 Mar 2027");
  });
});
