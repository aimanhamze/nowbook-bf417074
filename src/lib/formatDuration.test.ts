import { describe, expect, it } from "vitest";
import { formatDuration } from "./formatDuration";

describe("formatDuration", () => {
  it("Hebrew", () => {
    expect(formatDuration(60, "he")).toBe("שעה");
    expect(formatDuration(120, "he")).toBe("שעתיים");
    expect(formatDuration(180, "he")).toBe("3 שעות");
    expect(formatDuration(50, "he")).toBe("50 דקות");
    expect(formatDuration(90, "he")).toBe("שעה ו-30 דקות");
  });

  it("Arabic, with number agreement", () => {
    expect(formatDuration(60, "ar")).toBe("ساعة");
    expect(formatDuration(120, "ar")).toBe("ساعتان");
    expect(formatDuration(180, "ar")).toBe("3 ساعات");
    expect(formatDuration(50, "ar")).toBe("50 دقيقة");
    expect(formatDuration(5, "ar")).toBe("5 دقائق");
    expect(formatDuration(90, "ar")).toBe("ساعة و30 دقيقة");
  });

  it("English", () => {
    expect(formatDuration(60, "en")).toBe("1 hour");
    expect(formatDuration(150, "en")).toBe("2 hours 30 minutes");
    expect(formatDuration(45, "en")).toBe("45 minutes");
  });

  it("never looks like a clock time", () => {
    for (const lang of ["he", "ar", "en"] as const) {
      expect(formatDuration(60, lang)).not.toMatch(/\d{1,2}:\d{2}/);
    }
  });
});
