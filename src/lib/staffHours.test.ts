import { describe, it, expect } from "vitest";
import {
  draftFromRows,
  seedDraftFromShop,
  rowsFromDraft,
  sameDraft,
  isInvalidRange,
  isOutsideShopDay,
  hoursSummary,
  type DayHours,
  type StaffHoursRow,
} from "./staffHours";

const SUN = 0, MON = 1, TUE = 2, SAT = 6;

const on = (start = "09:00", end = "17:00"): DayHours => ({
  is_available: true,
  start_time: start,
  end_time: end,
});
const off = (start = "09:00", end = "17:00"): DayHours => ({
  is_available: false,
  start_time: start,
  end_time: end,
});

/** Builds the day_of_week → row map the hook produces for one member. */
function rows(entries: Partial<Record<number, Partial<StaffHoursRow>>>): Map<number, StaffHoursRow> {
  const map = new Map<number, StaffHoursRow>();
  for (const [dow, row] of Object.entries(entries)) {
    map.set(Number(dow), {
      staff_id: "staff-ana",
      day_of_week: Number(dow),
      start_time: "09:00",
      end_time: "17:00",
      is_available: true,
      ...row,
    });
  }
  return map;
}

/** A full shop week, open 09:00–17:00 Sunday–Friday, closed Saturday. */
const shopWeek: (DayHours | null)[] = [
  on(), on(), on(), on(), on(), on(), null,
];

describe("draftFromRows", () => {
  // THE GUARANTEE that protects every existing staff member. The table ships
  // empty, so this is the state of everyone who was never configured, and the
  // editor must open on "works all shop hours" rather than on a form.
  describe("state 1 — no rows at all", () => {
    it("returns null for a member ABSENT from the map", () => {
      expect(draftFromRows(undefined)).toBeNull();
    });

    it("returns null for an EMPTY map, not a week of off days", () => {
      // The writer deletes rows rather than storing an empty set, so this should
      // be unreachable from our own data — but the alternative reading ("present
      // but empty means works nothing") is the one that would silently strand a
      // working member, so it is pinned separately.
      expect(draftFromRows(new Map())).toBeNull();
    });
  });

  describe("states 2 and 3 — a configured member", () => {
    it("returns a full 7-day array from a partial row set", () => {
      const draft = draftFromRows(rows({ [MON]: {}, [TUE]: {} }));
      expect(draft).not.toBeNull();
      expect(draft).toHaveLength(7);
    });

    it("treats a MISSING weekday as OFF, not as inheriting shop hours", () => {
      // The rule that surprises owners: Mon–Tue configured means Wed–Sun off.
      const draft = draftFromRows(rows({ [MON]: {}, [TUE]: {} }))!;
      expect(draft[MON].is_available).toBe(true);
      expect(draft[TUE].is_available).toBe(true);
      expect(draft[SUN].is_available).toBe(false);
      expect(draft[SAT].is_available).toBe(false);
    });

    it("keeps an explicit is_available=false row off", () => {
      const draft = draftFromRows(rows({ [MON]: { is_available: false } }))!;
      expect(draft[MON].is_available).toBe(false);
    });

    it("carries a default window on off days so toggling one on has hours to show", () => {
      const draft = draftFromRows(rows({ [MON]: {} }))!;
      expect(draft[SAT]).toEqual({ is_available: false, start_time: "09:00", end_time: "17:00" });
    });

    it("trims stored times to the HH:MM an <input type='time'> expects", () => {
      const draft = draftFromRows(rows({ [MON]: { start_time: "08:30:00", end_time: "13:45:00" } }))!;
      expect(draft[MON].start_time).toBe("08:30");
      expect(draft[MON].end_time).toBe("13:45");
    });
  });
});

describe("seedDraftFromShop", () => {
  it("mirrors the shop's open days", () => {
    const draft = seedDraftFromShop(shopWeek);
    expect(draft[MON]).toEqual({ is_available: true, start_time: "09:00", end_time: "17:00" });
  });

  it("seeds a shop-closed day as OFF", () => {
    expect(seedDraftFromShop(shopWeek)[SAT].is_available).toBe(false);
  });

  it("seeds a shop day that exists but is unavailable as OFF", () => {
    const week = [...shopWeek];
    week[MON] = off("10:00", "20:00");
    expect(seedDraftFromShop(week)[MON].is_available).toBe(false);
  });

  it("copies the shop's actual times, not the column defaults", () => {
    const week = [...shopWeek];
    week[MON] = on("10:30", "20:15");
    expect(seedDraftFromShop(week)[MON]).toEqual({
      is_available: true,
      start_time: "10:30",
      end_time: "20:15",
    });
  });

  it("produces a full week even from a short/empty shop array", () => {
    expect(seedDraftFromShop([])).toHaveLength(7);
    expect(seedDraftFromShop([]).every((d) => !d.is_available)).toBe(true);
  });
});

describe("rowsFromDraft", () => {
  // The ONLY route back to "works all shop hours". If this ever returned
  // anything but an empty array for null, the reversibility path is gone.
  it("returns NO rows for the unrestricted state", () => {
    expect(rowsFromDraft(null)).toEqual([]);
  });

  it("writes all seven days, including the off ones", () => {
    const draft = draftFromRows(rows({ [MON]: {} }))!;
    const out = rowsFromDraft(draft);
    expect(out).toHaveLength(7);
    expect(out.filter((r) => r.is_available)).toHaveLength(1);
  });

  it("indexes day_of_week by array position", () => {
    const draft = draftFromRows(rows({ [SAT]: {} }))!;
    const out = rowsFromDraft(draft);
    expect(out[SAT].day_of_week).toBe(SAT);
    expect(out[SAT].is_available).toBe(true);
  });

  it("round-trips a configured member unchanged", () => {
    const original = rows({ [MON]: { start_time: "10:00", end_time: "14:00" }, [TUE]: {} });
    const out = rowsFromDraft(draftFromRows(original)!);
    expect(out[MON]).toEqual({
      day_of_week: MON, start_time: "10:00", end_time: "14:00", is_available: true,
    });
    expect(out[SAT].is_available).toBe(false);
  });
});

describe("sameDraft", () => {
  it("treats null as equal only to null", () => {
    expect(sameDraft(null, null)).toBe(true);
    expect(sameDraft(null, seedDraftFromShop(shopWeek))).toBe(false);
    expect(sameDraft(seedDraftFromShop(shopWeek), null)).toBe(false);
  });

  // The state that must NOT be collapsed: a week that mirrors the shop is still
  // a CONFIGURED member, and it stops tracking future shop changes. Reporting it
  // as "no change" would skip the write and silently discard the owner's intent.
  it("does not equate a shop-shaped week with the unrestricted state", () => {
    expect(sameDraft(seedDraftFromShop(shopWeek), null)).toBe(false);
  });

  it("ignores the inert times on an off day", () => {
    const a = draftFromRows(rows({ [MON]: {} }))!;
    const b = a.map((d, i) => (i === SAT ? { ...d, start_time: "03:00" } : d));
    expect(sameDraft(a, b)).toBe(true);
  });

  it("detects a changed time on a working day", () => {
    const a = draftFromRows(rows({ [MON]: {} }))!;
    const b = a.map((d, i) => (i === MON ? { ...d, end_time: "13:00" } : d));
    expect(sameDraft(a, b)).toBe(false);
  });

  it("detects a day being switched off", () => {
    const a = draftFromRows(rows({ [MON]: {} }))!;
    const b = a.map((d, i) => (i === MON ? { ...d, is_available: false } : d));
    expect(sameDraft(a, b)).toBe(false);
  });
});

describe("isInvalidRange", () => {
  it("accepts a normal window", () => {
    expect(isInvalidRange(on("09:00", "17:00"))).toBe(false);
  });

  it("rejects an inverted window", () => {
    expect(isInvalidRange(on("17:00", "09:00"))).toBe(true);
  });

  it("rejects a zero-length window", () => {
    expect(isInvalidRange(on("09:00", "09:00"))).toBe(true);
  });

  it("ignores an off day, whatever its times", () => {
    expect(isInvalidRange(off("17:00", "09:00"))).toBe(false);
  });

  it("stays quiet on unparseable input rather than blocking the owner", () => {
    expect(isInvalidRange(on("", ""))).toBe(false);
  });
});

describe("isOutsideShopDay", () => {
  it("accepts a window inside the shop's", () => {
    expect(isOutsideShopDay(on("10:00", "16:00"), on("09:00", "17:00"))).toBe(false);
  });

  it("accepts a window exactly equal to the shop's", () => {
    expect(isOutsideShopDay(on("09:00", "17:00"), on("09:00", "17:00"))).toBe(false);
  });

  it("flags an earlier start", () => {
    expect(isOutsideShopDay(on("08:00", "17:00"), on("09:00", "17:00"))).toBe(true);
  });

  it("flags a later end", () => {
    expect(isOutsideShopDay(on("09:00", "18:00"), on("09:00", "17:00"))).toBe(true);
  });

  it("flags any working day when the shop is closed", () => {
    expect(isOutsideShopDay(on(), null)).toBe(true);
    expect(isOutsideShopDay(on(), off())).toBe(true);
  });

  it("never flags an off day", () => {
    expect(isOutsideShopDay(off("00:00", "23:59"), null)).toBe(false);
  });
});

describe("hoursSummary", () => {
  it("reports the unrestricted state as 'all'", () => {
    expect(hoursSummary(null)).toBe("all");
  });

  it("counts the working days of a configured member", () => {
    expect(hoursSummary(draftFromRows(rows({ [MON]: {}, [TUE]: {} }))!)).toBe(2);
  });

  // A configured member with every day off can never be booked. That is a real
  // misconfiguration and it is surfaced, not normalised into "all".
  it("reports an all-off week as 'none', NOT as 'all'", () => {
    const allOff = Array.from({ length: 7 }, () => off());
    expect(hoursSummary(allOff)).toBe("none");
  });
});
