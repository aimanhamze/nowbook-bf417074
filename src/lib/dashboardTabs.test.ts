import { describe, it, expect } from "vitest";
import { visibleDashboardTabs } from "./dashboardTabs";

describe("visibleDashboardTabs", () => {
  it("regular provider: everything but packages and courses", () => {
    expect(visibleDashboardTabs("barber")).toEqual(["profile", "booking", "availability", "services", "gallery"]);
  });

  it("fitness studio: packages instead of services, availability kept", () => {
    expect(visibleDashboardTabs("fitness_studio")).toEqual(["profile", "booking", "availability", "gallery", "packages"]);
  });

  it("academy: courses instead of services, availability and packages", () => {
    expect(visibleDashboardTabs("academy")).toEqual(["profile", "booking", "courses", "gallery"]);
  });

  it("unknown / missing category behaves like a regular provider", () => {
    expect(visibleDashboardTabs(undefined)).toEqual(visibleDashboardTabs("barber"));
    expect(visibleDashboardTabs("")).toEqual(visibleDashboardTabs("barber"));
  });
});
