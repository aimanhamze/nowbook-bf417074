import { describe, it, expect } from "vitest";
import { academyWhatsAppUrl, courseDirectionsUrl } from "./academyCourseLinks";

describe("courseDirectionsUrl", () => {
  it("searches maps for the course's own address", () => {
    expect(courseDirectionsUrl({ location_type: "physical", address: "הרצל 12, חיפה" }, { waze: "https://waze.com/ul?q=x" })).toBe(
      `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent("הרצל 12, חיפה")}`,
    );
  });

  it("falls back to the academy's Waze link without an address", () => {
    expect(courseDirectionsUrl({ location_type: "physical", address: "  " }, { waze: "https://waze.com/ul?q=x" })).toBe(
      "https://waze.com/ul?q=x",
    );
    expect(courseDirectionsUrl({ location_type: "physical", address: null }, null)).toBeNull();
  });

  it("an online course has nowhere to navigate to", () => {
    expect(courseDirectionsUrl({ location_type: "online", address: null }, { waze: "https://waze.com/ul?q=x" })).toBeNull();
  });
});

describe("academyWhatsAppUrl", () => {
  it("prefers the WhatsApp social link", () => {
    expect(academyWhatsAppUrl({ whatsapp: "+972501234567" }, "0529999999")).toBe("https://wa.me/972501234567");
  });

  it("falls back to the phone, formatted for Israel", () => {
    expect(academyWhatsAppUrl(null, "050-123 4567")).toBe("https://wa.me/972501234567");
    expect(academyWhatsAppUrl({}, "972501234567")).toBe("https://wa.me/972501234567");
  });

  it("neither: no link", () => {
    expect(academyWhatsAppUrl(null, null)).toBeNull();
    expect(academyWhatsAppUrl({ whatsapp: " " }, "")).toBeNull();
  });
});
