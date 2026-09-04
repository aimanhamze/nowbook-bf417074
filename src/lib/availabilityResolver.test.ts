import { describe, it, expect } from "vitest";
import {
  narrowToStaff,
  staffDayWindow,
  type DayWindow,
  type StaffWeeklyRow,
} from "./availabilityResolver";

// Scoped DELIBERATELY to the Phase 3 additions. resolveDayHours is untouched by
// this phase and is exercised through its existing call sites; retro-testing it
// here would blur what these tests are actually pinning down.

const SUN = 0, MON = 1, SAT = 6;

const win = (start: string, end: string, breakStart: string | null = null, breakEnd: string | null = null): DayWindow => ({
  start_time: start,
  end_time: end,
  break_start: breakStart,
  break_end: breakEnd,
});

/** A staff member's week, as the hook indexes it: day_of_week → row. */
function staffWeek(entries: Partial<Record<number, Partial<StaffWeeklyRow>>>): Map<number, StaffWeeklyRow> {
  const map = new Map<number, StaffWeeklyRow>();
  for (const [dow, row] of Object.entries(entries)) {
    map.set(Number(dow), {
      day_of_week: Number(dow),
      start_time: "09:00",
      end_time: "17:00",
      is_available: true,
      ...row,
    });
  }
  return map;
}

/** A local date landing on a known weekday. 2026-09-07 is a Monday. */
const monday = new Date(2026, 8, 7);
const sunday = new Date(2026, 8, 6);
const saturday = new Date(2026, 8, 12);

describe("staffDayWindow — the three-state producer", () => {
  describe("state 1: not configured", () => {
    // THE GUARANTEE that protects every existing staff member. The table ships
    // empty, so this is what every member resolves to until an owner configures
    // one, and it is what narrowToStaff turns into the identity path.
    it("returns undefined for a member with NO rows at all", () => {
      expect(staffDayWindow(monday, undefined)).toBeUndefined();
    });

    it("returns undefined for an EMPTY map, not a closed day", () => {
      expect(staffDayWindow(monday, new Map())).toBeUndefined();
    });
  });

  describe("state 3: configured and off", () => {
    // The rule that surprises owners, and the reason a missing weekday cannot
    // be allowed to mean "inherit".
    it("returns null for a weekday with NO row on a configured member", () => {
      // Configured for Monday only → Sunday and Saturday are OFF, not inherited.
      const week = staffWeek({ [MON]: {} });
      expect(staffDayWindow(sunday, week)).toBeNull();
      expect(staffDayWindow(saturday, week)).toBeNull();
    });

    it("returns null for an explicit is_available=false row", () => {
      expect(staffDayWindow(monday, staffWeek({ [MON]: { is_available: false } }))).toBeNull();
    });
  });

  describe("state 2: configured and working", () => {
    it("returns the row's window", () => {
      const week = staffWeek({ [MON]: { start_time: "10:00", end_time: "14:00" } });
      expect(staffDayWindow(monday, week)).toEqual({
        start_time: "10:00",
        end_time: "14:00",
        break_start: null,
        break_end: null,
      });
    });

    it("always reports null breaks — staff rows carry no break columns", () => {
      const window = staffDayWindow(monday, staffWeek({ [MON]: {} }))!;
      expect(window.break_start).toBeNull();
      expect(window.break_end).toBeNull();
    });

    it("looks the weekday up with the LOCAL getDay(), matching resolveDayHours", () => {
      // Saturday's row must be found for a Saturday date and not for a Monday one.
      const week = staffWeek({ [SAT]: {} });
      expect(staffDayWindow(saturday, week)).not.toBeNull();
      expect(staffDayWindow(monday, week)).toBeNull();
    });
  });
});

describe("narrowToStaff", () => {
  // ── The guarantee that the whole design rests on ──────────────────────────
  describe("the identity path (no staff hours configured)", () => {
    it("returns the SHOP'S OWN OBJECT, not a copy", () => {
      // toBe, not toEqual: for a provider with no staff hours the result is not
      // merely equal to today's value, it IS today's value. An equality here
      // would let a future refactor start returning a reconstructed window
      // without any test noticing.
      const shop = win("09:00", "17:00", "13:00", "14:00");
      expect(narrowToStaff(shop, undefined)).toBe(shop);
    });

    it("is the identity for a closed shop day too", () => {
      expect(narrowToStaff(null, undefined)).toBeNull();
    });
  });

  describe("shop closed wins, before the staff window is inspected", () => {
    it("returns null when the shop is closed and the member is working", () => {
      expect(narrowToStaff(null, win("09:00", "17:00"))).toBeNull();
    });

    it("returns null when the shop is closed and the member is off", () => {
      expect(narrowToStaff(null, null)).toBeNull();
    });

    it("returns null when the shop is closed and the member is unconfigured", () => {
      expect(narrowToStaff(null, undefined)).toBeNull();
    });
  });

  describe("configured and off", () => {
    it("returns null even though the shop is open", () => {
      expect(narrowToStaff(win("09:00", "17:00"), null)).toBeNull();
    });
  });

  describe("the intersection", () => {
    it("takes the LATER start", () => {
      expect(narrowToStaff(win("09:00", "17:00"), win("11:00", "17:00"))).toEqual(
        win("11:00", "17:00")
      );
    });

    it("takes the EARLIER end", () => {
      expect(narrowToStaff(win("09:00", "17:00"), win("09:00", "14:00"))).toEqual(
        win("09:00", "14:00")
      );
    });

    it("clamps both sides at once", () => {
      expect(narrowToStaff(win("09:00", "17:00"), win("11:00", "14:00"))).toEqual(
        win("11:00", "14:00")
      );
    });

    // THE SUBSET RULE, stated as a test. A staff window wider on both sides
    // cannot widen the result — max-of-starts and min-of-ends make it impossible.
    it("CANNOT widen the shop's window from either side", () => {
      const shop = win("09:00", "17:00");
      expect(narrowToStaff(shop, win("06:00", "23:00"))).toEqual(shop);
    });

    it("cannot widen the start alone", () => {
      expect(narrowToStaff(win("09:00", "17:00"), win("06:00", "12:00"))).toEqual(
        win("09:00", "12:00")
      );
    });

    it("cannot widen the end alone", () => {
      expect(narrowToStaff(win("09:00", "17:00"), win("12:00", "23:00"))).toEqual(
        win("12:00", "17:00")
      );
    });

    it("re-emits the winning ORIGINAL string, so an all-shop window is byte-identical", () => {
      const shop = win("09:00", "17:00");
      const result = narrowToStaff(shop, win("09:00", "17:00"))!;
      expect(result.start_time).toBe("09:00");
      expect(result.end_time).toBe("17:00");
    });

    it("carries the SHOP's break through — staff inherit it", () => {
      const shop = win("09:00", "17:00", "13:00", "14:00");
      const result = narrowToStaff(shop, win("10:00", "16:00"))!;
      expect(result.break_start).toBe("13:00");
      expect(result.break_end).toBe("14:00");
    });
  });

  describe("windows that leave nothing", () => {
    it("returns null for fully disjoint windows", () => {
      expect(narrowToStaff(win("09:00", "12:00"), win("14:00", "18:00"))).toBeNull();
    });

    it("returns null for disjoint windows in the other order", () => {
      expect(narrowToStaff(win("14:00", "18:00"), win("09:00", "12:00"))).toBeNull();
    });

    it("returns null for windows that merely TOUCH (staff starts as shop ends)", () => {
      // A zero-width window is closed, not a bookable instant — the slot loop
      // must never be handed a degenerate range.
      expect(narrowToStaff(win("09:00", "12:00"), win("12:00", "18:00"))).toBeNull();
    });

    it("returns null when the shop closes exactly as the member starts", () => {
      expect(narrowToStaff(win("12:00", "18:00"), win("09:00", "12:00"))).toBeNull();
    });
  });

  describe("malformed input fails OPEN, to today's behaviour", () => {
    // One bad row must not be able to silently unbook a staff member for a day.
    it("returns the shop's window when the staff times are unparseable", () => {
      const shop = win("09:00", "17:00");
      expect(narrowToStaff(shop, win("", ""))).toBe(shop);
    });

    it("returns the shop's window when the SHOP's times are unparseable", () => {
      const shop = win("garbage", "17:00");
      expect(narrowToStaff(shop, win("11:00", "15:00"))).toBe(shop);
    });
  });

  describe("composed with staffDayWindow, end to end", () => {
    const shop = win("09:00", "17:00");

    it("a member with no rows gets the shop's window itself", () => {
      expect(narrowToStaff(shop, staffDayWindow(monday, undefined))).toBe(shop);
    });

    it("a member configured Mon-only is narrowed on Monday", () => {
      const week = staffWeek({ [MON]: { start_time: "10:00", end_time: "14:00" } });
      expect(narrowToStaff(shop, staffDayWindow(monday, week))).toEqual(win("10:00", "14:00"));
    });

    it("...and CLOSED on Sunday, rather than falling back to shop hours", () => {
      const week = staffWeek({ [MON]: { start_time: "10:00", end_time: "14:00" } });
      expect(narrowToStaff(shop, staffDayWindow(sunday, week))).toBeNull();
    });

    it("...and still closed on Monday when the shop itself is shut", () => {
      const week = staffWeek({ [MON]: {} });
      expect(narrowToStaff(null, staffDayWindow(monday, week))).toBeNull();
    });
  });
});
