import { describe, it, expect } from "vitest";
import {
  blocksBooking,
  getSetupSteps,
  progressMessage,
  isSectionVisible,
  joinList,
  plural,
  SECTION_IDS,
  setupPercent,
  stepTarget,
  summarizeWeeklyHours,
  toSectionId,
  type WeeklyRow,
} from "./dashboardSetup";

const row = (dow: number, open: boolean, start = "09:00:00", end = "17:00:00"): WeeklyRow => ({
  day_of_week: dow, is_available: open, start_time: start, end_time: end,
});
// What create-provider seeds: Sun–Thu open 09:00–17:00, Fri–Sat closed.
const SEED = [0, 1, 2, 3, 4, 5, 6].map((d) => row(d, d <= 4));

describe("toSectionId", () => {
  it("accepts section ids and maps legacy tab ids", () => {
    expect(toSectionId("services")).toBe("services");
    expect(toSectionId("hours")).toBe("hours");
    expect(toSectionId("availability")).toBe("hours");
    expect(toSectionId("gallery")).toBe("photos");
    expect(toSectionId("booking")).toBe("booking");
  });
  it("returns null for nothing or unknown", () => {
    expect(toSectionId(null)).toBeNull();
    expect(toSectionId("")).toBeNull();
    expect(toSectionId("pending")).toBeNull();
  });
});

describe("isSectionVisible", () => {
  it("hides services for a studio and packages for everyone else", () => {
    expect(isSectionVisible("services", true)).toBe(false);
    expect(isSectionVisible("packages", true)).toBe(true);
    expect(isSectionVisible("services", false)).toBe(true);
    expect(isSectionVisible("packages", false)).toBe(false);
    expect(isSectionVisible("hours", true)).toBe(true);
  });

  it("academy: courses + registrations instead of services, hours and packages", () => {
    const visible = (studio: boolean, academy: boolean) =>
      SECTION_IDS.filter((id) => isSectionVisible(id, studio, academy));
    expect(visible(false, true)).toEqual(["profile", "photos", "booking", "courses", "registrations"]);
    // Nobody else gets the academy sections; the other types are unchanged.
    expect(visible(false, false)).toEqual(["services", "hours", "profile", "photos", "booking"]);
    expect(visible(true, false)).toEqual(["hours", "profile", "photos", "booking", "packages"]);
  });

  it("keeps the old academy tab ids working as deep links", () => {
    expect(toSectionId("courses")).toBe("courses");
    expect(toSectionId("registrations")).toBe("registrations");
  });
});

describe("getSetupSteps / setupPercent", () => {
  const base = { isFitnessStudio: false, activeServiceCount: 0, hasOpenDay: true, classCount: 0, hasAvatar: false, hasAbout: false };

  it("a new provider (seeded hours only) is 25%", () => {
    const steps = getSetupSteps(base);
    expect(steps.map((s) => s.id)).toEqual(["services", "hours", "avatar", "about"]);
    expect(setupPercent(steps)).toBe(25);
  });

  it("complete is 100%", () => {
    const steps = getSetupSteps({ ...base, activeServiceCount: 3, hasAvatar: true, hasAbout: true });
    expect(steps.every((s) => s.done)).toBe(true);
    expect(setupPercent(steps)).toBe(100);
  });

  it("a studio has three steps: classes, photo, description", () => {
    const steps = getSetupSteps({ ...base, isFitnessStudio: true, activeServiceCount: 5, classCount: 0, hasAvatar: true });
    expect(steps.map((s) => s.id)).toEqual(["classes", "avatar", "about"]);
    expect(setupPercent(steps)).toBe(33);
  });

  it("missing steps point at the right place", () => {
    expect(stepTarget("services")).toEqual({ kind: "section", section: "services" });
    expect(stepTarget("about")).toEqual({ kind: "section", section: "profile" });
    expect(stepTarget("classes")).toEqual({ kind: "classSchedule" });
    expect(stepTarget("courses")).toEqual({ kind: "section", section: "courses" });
  });

  it("an academy has three steps: an active course, photo, description", () => {
    const steps = getSetupSteps({ ...base, isAcademy: true, activeServiceCount: 4, activeCourseCount: 0, hasAvatar: true });
    expect(steps.map((s) => s.id)).toEqual(["courses", "avatar", "about"]);
    expect(setupPercent(steps)).toBe(33);
    expect(getSetupSteps({ ...base, isAcademy: true, activeCourseCount: 2 }).find((s) => s.id === "courses")?.done).toBe(true);
  });

  it("an academy with no course is named as the blocking step", () => {
    const steps = getSetupSteps({ ...base, isAcademy: true, activeCourseCount: 0, hasAvatar: true, hasAbout: true });
    expect(progressMessage(steps)).toEqual({ kind: "booking", step: "courses" });
  });
});

describe("progressMessage", () => {
  const base = { isFitnessStudio: false, activeServiceCount: 0, hasOpenDay: true, classCount: 0, hasAvatar: false, hasAbout: false };

  it("names the missing booking step even when profile steps are also missing", () => {
    expect(progressMessage(getSetupSteps(base))).toEqual({ kind: "booking", step: "services" });
  });

  it("missing hours blocks booking too", () => {
    const steps = getSetupSteps({ ...base, activeServiceCount: 2, hasOpenDay: false, hasAvatar: true, hasAbout: true });
    expect(progressMessage(steps)).toEqual({ kind: "booking", step: "hours" });
  });

  it("with only photo/description missing the business is bookable: profile wording, counted", () => {
    expect(progressMessage(getSetupSteps({ ...base, activeServiceCount: 2 }))).toEqual({ kind: "profile", remaining: 2, step: "avatar" });
    expect(progressMessage(getSetupSteps({ ...base, activeServiceCount: 2, hasAvatar: true }))).toEqual({ kind: "profile", remaining: 1, step: "about" });
  });

  it("a studio without classes is blocked on the class schedule", () => {
    const steps = getSetupSteps({ ...base, isFitnessStudio: true, hasAvatar: true });
    expect(progressMessage(steps)).toEqual({ kind: "booking", step: "classes" });
    expect(blocksBooking("classes")).toBe(true);
    expect(blocksBooking("avatar")).toBe(false);
  });

  it("is null when complete", () => {
    expect(progressMessage(getSetupSteps({ ...base, activeServiceCount: 1, hasAvatar: true, hasAbout: true }))).toBeNull();
  });
});

describe("summarizeWeeklyHours", () => {
  it("summarises the seed as one Sun–Thu run", () => {
    expect(summarizeWeeklyHours(SEED)).toEqual({ kind: "uniform", runs: [[0, 4]], start: "09:00", end: "17:00" });
  });

  it("splits non-consecutive days into runs", () => {
    const rows = [row(0, true), row(1, true), row(2, false), row(3, true), row(6, true)];
    expect(summarizeWeeklyHours(rows)).toEqual({
      kind: "uniform", runs: [[0, 1], [3, 3], [6, 6]], start: "09:00", end: "17:00",
    });
  });

  it("falls back to a count when windows differ", () => {
    const rows = [row(0, true), row(1, true, "10:00:00"), row(5, false)];
    expect(summarizeWeeklyHours(rows)).toEqual({ kind: "mixed", openDays: 2 });
  });

  it("reports none when every day is closed", () => {
    expect(summarizeWeeklyHours(SEED.map((r) => ({ ...r, is_available: false })))).toEqual({ kind: "none" });
    expect(summarizeWeeklyHours([])).toEqual({ kind: "none" });
  });
});

describe("plural", () => {
  const ar = { one: "خدمة واحدة", two: "خدمتان", few: "{n} خدمات", many: "{n} خدمة", other: "{n} خدمة" };
  it("uses the Arabic forms", () => {
    expect(plural("ar", 1, ar)).toBe("خدمة واحدة");
    expect(plural("ar", 2, ar)).toBe("خدمتان");
    expect(plural("ar", 4, ar)).toBe("4 خدمات");
    expect(plural("ar", 14, ar)).toBe("14 خدمة");
  });
  it("falls back to other for a form a language does not define", () => {
    const he = { one: "שירות אחד", other: "{n} שירותים" };
    expect(plural("he", 1, he)).toBe("שירות אחד");
    expect(plural("he", 2, he)).toBe("2 שירותים");
  });
});

describe("joinList", () => {
  it("joins with the language's conjunction", () => {
    expect(joinList("en", ["a", "b", "c"])).toBe("a, b, and c");
    expect(joinList("he", ["תמונת פרופיל", "תיאור"])).toBe("תמונת פרופיל ותיאור");
  });
});
