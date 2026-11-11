import { describe, it, expect, vi } from "vitest";
import type { DashboardSetup } from "@/hooks/useDashboardSetup";

// buildRows is pure; keep the data hook (and its Supabase imports) out of the test.
vi.mock("@/hooks/useDashboardSetup", () => ({ useDashboardSetup: () => null }));

const { buildRows } = await import("./SetupHub");

const ok = <T,>(value: T) => ({ state: "ok" as const, value });

function setup(overrides: Partial<DashboardSetup>): DashboardSetup {
  return {
    isFitnessStudio: false,
    isAcademy: false,
    courses: ok(0),
    instructors: ok(0),
    pendingRegistrations: ok(0),
    services: ok(2),
    hours: ok({ mode: "weekly" as const, summary: { kind: "none" as const } }),
    profile: { hasAvatar: true, hasCover: false, hasAbout: true },
    photos: ok(0),
    booking: { requiresApproval: false, windowDays: 14 },
    classes: ok(3),
    closedDays: ok(0),
    packages: ok(1),
    steps: null,
    ...overrides,
  };
}

const keys = (s: DashboardSetup) =>
  buildRows(s, (k) => k, (base, n) => `${base}:${n}`, "he").map((r) => r.key);

describe("SetupHub rows per category", () => {
  it("academy: courses, registrations, instructors, profile, photos — no booking settings", () => {
    const rows = keys(setup({ isAcademy: true, courses: ok(2), instructors: ok(1), pendingRegistrations: ok(3) }));
    expect(rows).toEqual(["courses", "registrations", "instructors", "profile", "photos"]);
    expect(rows).not.toContain("booking");
  });

  it("regular provider keeps main's rows, booking settings included", () => {
    expect(keys(setup({}))).toEqual(["services", "hours", "profile", "photos", "booking"]);
  });

  it("fitness studio keeps main's rows, booking settings included", () => {
    expect(keys(setup({ isFitnessStudio: true }))).toEqual(
      ["classes", "profile", "closedDays", "photos", "packages", "booking"],
    );
  });
});
