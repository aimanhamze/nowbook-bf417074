import { describe, it, expect } from "vitest";
import { actionColumns, providerActions } from "./ProviderActions";

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

  it("order: message, call, navigate, then the social profiles", () => {
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
      "whatsapp", "call", "navigate", "instagram", "tiktok", "facebook", "website",
    ]);
  });
});

describe("actionColumns", () => {
  it("one row up to three, 2×2 for four, rows of three after", () => {
    expect([1, 2, 3, 4, 5, 6, 7].map(actionColumns)).toEqual([1, 2, 3, 2, 3, 3, 3]);
  });
});
