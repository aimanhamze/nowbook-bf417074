import { describe, it, expect } from "vitest";
import { providerActions } from "./ProviderActions";

describe("providerActions", () => {
  it("nothing filled in: no actions", () => {
    expect(providerActions(null, null)).toEqual([]);
    expect(providerActions({}, "  ")).toEqual([]);
  });

  it("a single WhatsApp link is one action, opened in a new tab", () => {
    expect(providerActions({ whatsapp: "+972501234567" }, null)).toEqual([
      { key: "whatsapp", href: "https://wa.me/972501234567", external: true },
    ]);
  });

  it("the phone becomes a call action that stays in the tab", () => {
    expect(providerActions(null, " 050-1234567 ")).toEqual([
      { key: "call", href: "tel:050-1234567", external: false },
    ]);
  });

  // Order changed back to the original icon row (Waze after the social
  // profiles), with Call next to WhatsApp.
  it("order: the original icon row, with call next to WhatsApp", () => {
    const all = providerActions(
      {
        website: "https://x.example",
        facebook: "https://facebook.com/x",
        tiktok: "https://tiktok.com/@x",
        instagram: "https://instagram.com/x",
        waze: "https://waze.com/ul?ll=1,2&navigate=yes",
        whatsapp: "+972501234567",
      },
      "0501234567",
    );
    expect(all.map((a) => a.key)).toEqual([
      "whatsapp", "call", "instagram", "tiktok", "facebook", "navigate", "website",
    ]);
  });
});
