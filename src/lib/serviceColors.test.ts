import { describe, it, expect } from "vitest";
import {
  DEFAULT_SERVICE_COLOR,
  SERVICE_COLOR_PRESETS,
  normalizeColor,
  withAlpha,
  darken,
} from "./serviceColors";

describe("normalizeColor", () => {
  it("keeps a valid 6-digit hex as-is", () => {
    expect(normalizeColor("#3b82f6")).toBe("#3b82f6");
    expect(normalizeColor("#3B82F6")).toBe("#3B82F6");
  });

  it("falls back to the default orange for missing or malformed values", () => {
    for (const bad of [null, undefined, "", "orange", "#fff", "3b82f6", "#3b82f68"]) {
      expect(normalizeColor(bad)).toBe(DEFAULT_SERVICE_COLOR);
    }
  });

  it("accepts every preset", () => {
    for (const preset of SERVICE_COLOR_PRESETS) {
      expect(normalizeColor(preset)).toBe(preset);
    }
  });
});

describe("withAlpha", () => {
  it("converts hex to rgba at the given alpha", () => {
    expect(withAlpha("#3b82f6", 0.18)).toBe("rgba(59, 130, 246, 0.18)");
  });

  it("uses the default color when the input is invalid", () => {
    // #f97316 → 249, 115, 22
    expect(withAlpha("nope", 1)).toBe("rgba(249, 115, 22, 1)");
  });
});

describe("darken", () => {
  it("scales each channel down by the given fraction", () => {
    // 59 * 0.55 = 32.45 → 32, 130 * 0.55 = 71.5 → 72, 246 * 0.55 = 135.3 → 135
    expect(darken("#3b82f6", 0.45)).toBe("rgb(32, 72, 135)");
  });

  it("produces black at full strength and the original at zero", () => {
    expect(darken("#3b82f6", 1)).toBe("rgb(0, 0, 0)");
    expect(darken("#3b82f6", 0)).toBe("rgb(59, 130, 246)");
  });
});
