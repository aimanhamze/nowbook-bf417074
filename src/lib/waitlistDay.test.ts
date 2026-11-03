import { describe, expect, it } from "vitest";
import type { DayWindow } from "@/lib/availabilityResolver";
import {
  isWaitlistableDay,
  possibleWindows,
  waitlistJoinErrorKey,
  windowOf,
  type WaitlistDayInput,
} from "./waitlistDay";
import { translations } from "./translations";

const OPEN: DayWindow = { start_time: "09:00", end_time: "18:00", break_start: null, break_end: null } as DayWindow;

/** A genuinely full day: open, member working, nothing left, but slots exist without bookings. */
const full = (over: Partial<WaitlistDayInput> = {}): WaitlistDayInput => ({
  eligible: true,
  inWindow: true,
  loading: false,
  shopWindow: OPEN,
  narrowedWindow: OPEN,
  usableSlots: [],
  usableSlotsIgnoringBookings: ["09:00", "09:30"],
  customerHasBooking: false,
  ...over,
});

describe("isWaitlistableDay", () => {
  it("offers a genuinely full day", () => {
    expect(isWaitlistableDay(full())).toBe(true);
  });

  it("never when the provider/service is not eligible (waitlist off, group, sessions)", () => {
    expect(isWaitlistableDay(full({ eligible: false }))).toBe(false);
  });

  it("never outside the booking window", () => {
    expect(isWaitlistableDay(full({ inWindow: false }))).toBe(false);
  });

  it("fails closed while anything is loading", () => {
    expect(isWaitlistableDay(full({ loading: true }))).toBe(false);
  });

  it("never on a closed day (shop window null)", () => {
    expect(isWaitlistableDay(full({ shopWindow: null, narrowedWindow: null }))).toBe(false);
  });

  it("never on a staff-off day (narrowed window null)", () => {
    expect(isWaitlistableDay(full({ narrowedWindow: null }))).toBe(false);
  });

  it("never on a day that still has a slot", () => {
    expect(isWaitlistableDay(full({ usableSlots: ["15:00"] }))).toBe(false);
  });

  it("never when no slot exists even without bookings (lead time, latest start, too-short day)", () => {
    expect(isWaitlistableDay(full({ usableSlotsIgnoringBookings: [] }))).toBe(false);
  });

  it("never when the customer already has a booking there that day", () => {
    expect(isWaitlistableDay(full({ customerHasBooking: true }))).toBe(false);
  });
});

describe("windowOf / possibleWindows", () => {
  it("uses the dispatcher's boundaries: morning < 12:00 <= afternoon < 17:00 <= evening", () => {
    expect(windowOf("00:00")).toBe("morning");
    expect(windowOf("11:59")).toBe("morning");
    expect(windowOf("12:00")).toBe("afternoon");
    expect(windowOf("16:59")).toBe("afternoon");
    expect(windowOf("17:00")).toBe("evening");
    expect(windowOf("23:45")).toBe("evening");
  });

  it("lists only windows that have a possible slot, in fixed order", () => {
    expect(possibleWindows(["18:00", "09:00", "09:15"])).toEqual(["morning", "evening"]);
    expect(possibleWindows(["13:00"])).toEqual(["afternoon"]);
    expect(possibleWindows([])).toEqual([]);
  });
});

describe("waitlistJoinErrorKey", () => {
  const codes = [
    "NOT_CUSTOMER",
    "WAITLIST_OFF",
    "BAD_LANG",
    "NO_WINDOW",
    "DATE_OUT_OF_RANGE",
    "SERVICE_INVALID",
    "STAFF_INVALID",
    "ALREADY_BOOKED",
    "ALREADY_ON_LIST",
    "LIMIT_REACHED",
  ];

  it("maps every RPC refusal code to a key translated in he, ar and en", () => {
    for (const code of codes) {
      const key = waitlistJoinErrorKey(code);
      for (const lang of ["he", "ar", "en"] as const) {
        const text = (translations[lang] as Record<string, string>)[key];
        expect(text, `${code} → ${key} (${lang})`).toBeTruthy();
      }
    }
  });

  it("gives distinct messages for the codes a customer can actually hit", () => {
    const keys = ["NO_WINDOW", "DATE_OUT_OF_RANGE", "ALREADY_BOOKED", "ALREADY_ON_LIST", "LIMIT_REACHED"].map(
      waitlistJoinErrorKey,
    );
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("falls back to the generic message for unknown codes, network errors and null", () => {
    expect(waitlistJoinErrorKey("SOMETHING_NEW")).toBe("waitlistErrGeneric");
    expect(waitlistJoinErrorKey("GENERIC")).toBe("waitlistErrGeneric");
    expect(waitlistJoinErrorKey(null)).toBe("waitlistErrGeneric");
    expect(waitlistJoinErrorKey("toString")).toBe("waitlistErrGeneric");
  });
});

describe("waiting-list strings", () => {
  it("every waitlist* key exists in all three languages", () => {
    const heKeys = Object.keys(translations.he).filter((k) => k.startsWith("waitlist"));
    expect(heKeys.length).toBeGreaterThan(30);
    for (const lang of ["ar", "en"] as const) {
      const keys = new Set(Object.keys(translations[lang]).filter((k) => k.startsWith("waitlist")));
      expect([...keys].sort()).toEqual([...heKeys].sort());
    }
  });
});
