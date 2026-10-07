import { describe, it, expect, beforeEach } from "vitest";
import { saveBookingDraft, consumeBookingDraft, BOOKING_DRAFT_TTL_MS } from "./bookingDraft";

const T0 = 1_700_000_000_000;
const base = { userId: "u1", providerId: "p1", serviceId: "s1", date: "2026-10-08", time: "10:30" };

describe("bookingDraft", () => {
  beforeEach(() => localStorage.clear());

  it("restores a fresh draft for the same user and provider, exactly once", () => {
    saveBookingDraft(base, T0);
    const d = consumeBookingDraft("u1", "p1", T0 + 60_000);
    expect(d).toMatchObject(base);
    expect(consumeBookingDraft("u1", "p1", T0 + 60_000)).toBeNull();
  });

  it("drops a draft older than 30 minutes", () => {
    saveBookingDraft(base, T0);
    expect(consumeBookingDraft("u1", "p1", T0 + BOOKING_DRAFT_TTL_MS + 1)).toBeNull();
    expect(localStorage.getItem("bookingDraft")).toBeNull();
  });

  it("never restores another user's draft, and clears it", () => {
    saveBookingDraft(base, T0);
    expect(consumeBookingDraft("u2", "p1", T0 + 1)).toBeNull();
    expect(localStorage.getItem("bookingDraft")).toBeNull();
  });

  it("leaves a draft for a different provider in place", () => {
    saveBookingDraft(base, T0);
    expect(consumeBookingDraft("u1", "p2", T0 + 1)).toBeNull();
    expect(consumeBookingDraft("u1", "p1", T0 + 2)).toMatchObject(base);
  });

  it("clears a malformed value", () => {
    localStorage.setItem("bookingDraft", "{not json");
    expect(consumeBookingDraft("u1", "p1", T0)).toBeNull();
    expect(localStorage.getItem("bookingDraft")).toBeNull();
  });

  it("rejects a draft from the future (clock change)", () => {
    saveBookingDraft(base, T0);
    expect(consumeBookingDraft("u1", "p1", T0 - 1)).toBeNull();
  });
});
