import { describe, it, expect, vi, beforeEach } from "vitest";
import { addDays } from "date-fns";

// A fake PostgREST builder: records every chained call, and resolves `.range()`
// with the next queued page. Enough to check filters, ordering and paging.
type Call = [string, ...unknown[]];
const calls: Call[][] = [];
let pages: unknown[][] = [];

function builder() {
  const mine: Call[] = [];
  calls.push(mine);
  const b: Record<string, (...a: unknown[]) => unknown> = {};
  for (const m of ["select", "eq", "gte", "order"]) {
    b[m] = (...a: unknown[]) => {
      mine.push([m, ...a]);
      return b;
    };
  }
  b.range = (from: unknown, to: unknown) => {
    mine.push(["range", from, to]);
    return Promise.resolve({ data: pages.shift() ?? [], error: null });
  };
  return b;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      const b = builder();
      calls[calls.length - 1].unshift(["from", table]);
      return b;
    },
  },
}));

import {
  fetchAllProvidersBlockedDates,
  fetchAllProvidersDateOverrides,
  fetchOwnBlockedDates,
  fetchOwnDateOverrides,
  fetchPublicBlockedDates,
  fetchPublicDateOverrides,
  scheduleFromDate,
} from "./scheduleFetch";
import { PAGE_SIZE } from "./fetchAll";
import {
  resolveDayHours,
  toLocalDateStr,
  type DateOverrideRow,
  type MonthlySettings,
  type WeeklyRow,
} from "./availabilityResolver";
import { getProviderStatus } from "./providerStatus";

beforeEach(() => {
  calls.length = 0;
  pages = [];
});

const has = (c: Call[], ...expected: unknown[]) =>
  c.some((call) => JSON.stringify(call) === JSON.stringify(expected));

describe("scheduleFromDate", () => {
  it("is yesterday as a LOCAL date string", () => {
    expect(scheduleFromDate(new Date(2026, 10, 11, 15, 0))).toBe("2026-11-10");
  });

  it("crosses month and year boundaries", () => {
    expect(scheduleFromDate(new Date(2026, 11, 1, 9, 0))).toBe("2026-11-30");
    expect(scheduleFromDate(new Date(2027, 0, 1, 9, 0))).toBe("2026-12-31");
  });

  it("uses the local date just after local midnight (never the UTC date)", () => {
    // 00:30 local on Nov 11 — in Israel the UTC date is still Nov 10.
    expect(scheduleFromDate(new Date(2026, 10, 11, 0, 30))).toBe("2026-11-10");
  });
});

describe("public fetchers: from yesterday onward, ordered on a unique key, paged", () => {
  it("blocked dates: provider filter, lower bound, order, plain strings", async () => {
    pages = [[{ blocked_date: "2026-11-12" }, { blocked_date: "2026-11-20" }]];
    const out = await fetchPublicBlockedDates("p1", "2026-11-10");
    expect(out).toEqual(["2026-11-12", "2026-11-20"]);
    const c = calls[0];
    expect(has(c, "from", "provider_blocked_dates")).toBe(true);
    expect(has(c, "eq", "provider_id", "p1")).toBe(true);
    expect(has(c, "gte", "blocked_date", "2026-11-10")).toBe(true);
    expect(has(c, "order", "blocked_date")).toBe(true);
    expect(has(c, "range", 0, PAGE_SIZE - 1)).toBe(true);
  });

  it("date overrides: same shape, resolver columns only", async () => {
    const row = { override_date: "2026-11-13", is_available: true, start_time: "10:00", end_time: "14:00", break_start: null, break_end: null };
    pages = [[row]];
    expect(await fetchPublicDateOverrides("p1", "2026-11-10")).toEqual([row]);
    const c = calls[0];
    expect(has(c, "from", "provider_date_overrides")).toBe(true);
    expect(has(c, "select", "override_date, is_available, start_time, end_time, break_start, break_end")).toBe(true);
    expect(has(c, "gte", "override_date", "2026-11-10")).toBe(true);
    expect(has(c, "order", "override_date")).toBe(true);
  });

  it("pages past the cap: a full page triggers the next one", async () => {
    const full = Array.from({ length: PAGE_SIZE }, (_, i) => ({ blocked_date: `d${i}` }));
    pages = [full, [{ blocked_date: "last" }]];
    const out = await fetchPublicBlockedDates("p1", "2026-11-10");
    expect(out).toHaveLength(PAGE_SIZE + 1);
    expect(out.at(-1)).toBe("last");
    expect(has(calls[1], "range", PAGE_SIZE, 2 * PAGE_SIZE - 1)).toBe(true);
  });

  it("all providers' overrides (Home): no provider filter, lower bound, ordered on (provider_id, override_date)", async () => {
    const row = { provider_id: "a", override_date: "2026-11-13", is_available: true, start_time: "10:00", end_time: "14:00" };
    pages = [[row]];
    expect(await fetchAllProvidersDateOverrides("2026-11-10")).toEqual([row]);
    const c = calls[0];
    expect(has(c, "from", "provider_date_overrides")).toBe(true);
    expect(c.some((x) => x[0] === "eq")).toBe(false);
    expect(has(c, "gte", "override_date", "2026-11-10")).toBe(true);
    const orders = c.filter((x) => x[0] === "order").map((x) => x[1]);
    expect(orders).toEqual(["provider_id", "override_date"]);
    expect(has(c, "range", 0, PAGE_SIZE - 1)).toBe(true);
  });

  it("all providers (Home): no provider filter, ordered on (provider_id, blocked_date)", async () => {
    pages = [[{ provider_id: "a", blocked_date: "2026-11-12" }]];
    await fetchAllProvidersBlockedDates("2026-11-10");
    const c = calls[0];
    expect(c.some((x) => x[0] === "eq")).toBe(false);
    expect(has(c, "order", "provider_id")).toBe(true);
    expect(has(c, "order", "blocked_date")).toBe(true);
    expect(has(c, "gte", "blocked_date", "2026-11-10")).toBe(true);
  });
});

describe("provider's own fetchers: every row (no date bound), paged", () => {
  it("blocked dates and overrides have no lower bound", async () => {
    pages = [[], []];
    await fetchOwnBlockedDates("p1");
    await fetchOwnDateOverrides("p1");
    for (const c of calls) {
      expect(c.some((x) => x[0] === "gte")).toBe(false);
      expect(has(c, "eq", "provider_id", "p1")).toBe(true);
      expect(has(c, "range", 0, PAGE_SIZE - 1)).toBe(true);
    }
    expect(has(calls[0], "order", "blocked_date")).toBe(true);
    expect(has(calls[1], "order", "override_date")).toBe(true);
  });
});

// ── No behaviour change ──────────────────────────────────────────────────────
// Windowing drops only rows before yesterday. For every date a public reader can
// resolve (today onward), the answer with the windowed rows must be IDENTICAL to
// the answer with the full history it used to fetch.
describe("windowed rows resolve every date from today exactly like the full history", () => {
  const now = new Date(2026, 10, 11, 12, 0);
  const from = scheduleFromDate(now);
  const day = (offset: number) => toLocalDateStr(addDays(now, offset));

  const weekly: WeeklyRow[] = [0, 1, 2, 3, 4].map((d) => ({
    day_of_week: d, start_time: "09:00", end_time: "17:00", is_available: true,
    break_start: d === 2 ? "12:00" : null, break_end: d === 2 ? "13:00" : null,
  }));
  // History on both sides of the bound, including yesterday and today.
  const blockedAll = [-400, -30, -2, -1, 0, 3, 45, 89, 150].map(day);
  const overridesAll: DateOverrideRow[] = [-300, -1, 0, 2, 5, 60, 120].map((o, i) => ({
    override_date: day(o), is_available: i % 3 !== 0,
    start_time: "10:00", end_time: "14:00", break_start: null, break_end: null,
  }));
  const blockedWin = blockedAll.filter((d) => d >= from);
  const overridesWin = overridesAll.filter((o) => o.override_date >= from);

  const modes: MonthlySettings[] = [
    { availability_mode: "weekly", monthly_default_available: true, monthly_default_start: "09:00", monthly_default_end: "17:00" },
    { availability_mode: "monthly", monthly_default_available: true, monthly_default_start: "08:00", monthly_default_end: "16:00" },
    { availability_mode: "monthly", monthly_default_available: false, monthly_default_start: "08:00", monthly_default_end: "16:00" },
  ];

  it("drops only rows before yesterday", () => {
    expect(blockedWin).toEqual(blockedAll.filter((d) => d >= day(-1)));
    expect(blockedWin).toContain(day(-1));
    expect(blockedWin).not.toContain(day(-2));
  });

  for (const settings of modes) {
    it(`resolveDayHours, ${settings.availability_mode} (default ${settings.monthly_default_available ? "open" : "closed"}), today..+200`, () => {
      for (let i = 0; i <= 200; i++) {
        const date = addDays(now, i);
        expect(resolveDayHours(date, settings, weekly, blockedWin, overridesWin)).toEqual(
          resolveDayHours(date, settings, weekly, blockedAll, overridesAll),
        );
      }
    });
  }

  it("the open/closed pill (getProviderStatus) for today and the next 30 days", () => {
    for (let i = 0; i <= 30; i++) {
      const at = addDays(now, i);
      expect(getProviderStatus(weekly, blockedWin, at)).toEqual(getProviderStatus(weekly, blockedAll, at));
    }
  });
});
