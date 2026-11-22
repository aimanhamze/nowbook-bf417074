// Every-2-weeks weekdays (repeat_every_weeks / repeat_anchor_date).
//
// Israel's clock, so the daylight-saving tests really cross a DST change (the
// first test proves it). Set before any Date is built; Node re-reads TZ.
// Restored afterwards: a test worker process can run other files after this one.
const ORIGINAL_TZ = process.env.TZ;
process.env.TZ = "Asia/Jerusalem";

import { describe, it, expect, afterAll } from "vitest";

afterAll(() => {
  if (ORIGINAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = ORIGINAL_TZ;
});
import {
  isOffWeek,
  resolveDayHours,
  type DateOverrideRow,
  type DayWindow,
  type MonthlySettings,
  type WeeklyRow,
} from "./availabilityResolver";
import { getProviderStatus, type AvailabilityRow, type ProviderStatus, type StatusOverrideRow } from "./providerStatus";
import { isNormallyOpen, openingTargets, type OpeningWeeklyRow } from "./dateOpenings";

// ── FROZEN REFERENCES: the three functions exactly as they were before the
// every-2-weeks rule (main d994681). Never edit these; they are what "value 1
// changes nothing" is measured against. ─────────────────────────────────────

function legacyToLocalDateStr(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function legacyResolveDayHours(
  date: Date,
  settings: MonthlySettings,
  weeklyRows: WeeklyRow[],
  blockedDates: string[],
  overrides: DateOverrideRow[],
): DayWindow | null {
  const dateStr = legacyToLocalDateStr(date);
  if (blockedDates.includes(dateStr)) return null;
  const override = overrides.find(o => o.override_date === dateStr);
  if (override) {
    if (!override.is_available) return null;
    return {
      start_time: override.start_time,
      end_time: override.end_time,
      break_start: override.break_start ?? null,
      break_end: override.break_end ?? null,
    };
  }
  if (settings.availability_mode === "monthly") {
    if (!settings.monthly_default_available) return null;
    return {
      start_time: settings.monthly_default_start,
      end_time: settings.monthly_default_end,
      break_start: null,
      break_end: null,
    };
  }
  const dow = date.getDay();
  const slot = weeklyRows.find(a => a.day_of_week === dow);
  if (!slot || !slot.is_available) return null;
  return {
    start_time: slot.start_time,
    end_time: slot.end_time,
    break_start: slot.break_start ?? null,
    break_end: slot.break_end ?? null,
  };
}

function legacyNormalizeTime(value: string | null | undefined): string | null {
  if (!value) return null;
  const sliced = value.slice(0, 5);
  return /^\d{2}:\d{2}$/.test(sliced) ? sliced : null;
}

function legacyToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function legacyGetProviderStatus(
  availability: AvailabilityRow[] | null | undefined,
  blockedDates: string[] | null | undefined,
  now: Date,
  overrides?: StatusOverrideRow[] | null,
): ProviderStatus {
  const today = legacyToLocalDateStr(now);
  const override = overrides?.find(o => o.override_date.slice(0, 10) === today);
  const hasSchedule = (availability?.length ?? 0) > 0 || !!override;
  if (!hasSchedule) return { isOpen: false, todayHours: null, hasSchedule: false };
  if (blockedDates?.includes(today)) return { isOpen: false, todayHours: null, hasSchedule: true };
  const row = override ?? availability!.find(r => r.day_of_week === now.getDay());
  if (!row || !row.is_available) return { isOpen: false, todayHours: null, hasSchedule: true };
  const open = legacyNormalizeTime(row.start_time);
  const close = legacyNormalizeTime(row.end_time);
  if (!open || !close) return { isOpen: false, todayHours: null, hasSchedule: true };
  const nowMins = now.getHours() * 60 + now.getMinutes();
  const isOpen = nowMins >= legacyToMinutes(open) && nowMins < legacyToMinutes(close);
  return { isOpen, todayHours: { open, close }, hasSchedule: true };
}

function legacyIsNormallyOpen(date: Date, rows: readonly OpeningWeeklyRow[]): boolean {
  return rows.some((r) => r.day_of_week === date.getDay() && r.is_available);
}

// ── Fixtures ────────────────────────────────────────────────────────────────

const WEEKLY: MonthlySettings = {
  availability_mode: "weekly",
  monthly_default_available: true,
  monthly_default_start: "10:00",
  monthly_default_end: "18:00",
};
const MONTHLY: MonthlySettings = { ...WEEKLY, availability_mode: "monthly" };

const FRI = 5;

/** Sun–Thu 09:00–17:00 with a break on Monday, Fri 08:00–13:00, Sat closed. */
function week(friday: Partial<WeeklyRow> = {}): WeeklyRow[] {
  return Array.from({ length: 7 }, (_, dow): WeeklyRow => {
    if (dow === FRI) return { day_of_week: FRI, start_time: "08:00", end_time: "13:00", is_available: true, ...friday };
    return {
      day_of_week: dow,
      start_time: "09:00",
      end_time: "17:00",
      is_available: dow !== 6,
      break_start: dow === 1 ? "13:00" : null,
      break_end: dow === 1 ? "14:00" : null,
    };
  });
}

/** Every-2-weeks Friday working Nov 27 2026 (the investigation's example). */
const BIWEEKLY = week({ repeat_every_weeks: 2, repeat_anchor_date: "2026-11-27" });

const local = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min);

const FRI_WINDOW: DayWindow = { start_time: "08:00", end_time: "13:00", break_start: null, break_end: null };

function everyDay(fromY: number, toY: number): Date[] {
  const out: Date[] = [];
  for (let d = new Date(fromY, 0, 1); d.getFullYear() <= toY; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
    out.push(d);
  }
  return out;
}

const DAYS_2026_2027 = everyDay(2026, 2027);

// ── Environment check ───────────────────────────────────────────────────────

describe("test environment", () => {
  it("runs on Israel time, so the DST tests below really cross a clock change", () => {
    // Before vs after Israel's spring change (Fri 2026-03-27 02:00).
    expect(local(2026, 3, 20).getTimezoneOffset()).toBe(-120);
    expect(local(2026, 4, 3).getTimezoneOffset()).toBe(-180);
  });
});

// ── 1. Value 1 / absent: byte-identical to before ─────────────────────────────

describe("every week (absent or 1) resolves exactly as before", () => {
  const blocked = ["2026-03-06", "2026-11-27", "2027-01-01"];
  const overrides: DateOverrideRow[] = [
    { override_date: "2026-03-07", is_available: true, start_time: "11:00", end_time: "15:00", break_start: null, break_end: null },
    { override_date: "2026-11-20", is_available: false, start_time: "08:00", end_time: "13:00", break_start: null, break_end: null },
    { override_date: "2027-05-14", is_available: true, start_time: "07:00", end_time: "12:00", break_start: "09:00", break_end: "09:30" },
  ];
  const setups: Array<[string, WeeklyRow[]]> = [
    ["rows without the new fields", week()],
    ["repeat_every_weeks = 1, no anchor", week({ repeat_every_weeks: 1, repeat_anchor_date: null })],
    ["repeat_every_weeks = 1 with a stray anchor", week({ repeat_every_weeks: 1, repeat_anchor_date: "2026-11-27" })],
    ["repeat_every_weeks = 1 with a wrong-weekday anchor", week({ repeat_every_weeks: 1, repeat_anchor_date: "2026-11-28" })],
    ["every row explicitly 1", week().map(r => ({ ...r, repeat_every_weeks: 1, repeat_anchor_date: null }))],
    ["no rows at all", []],
  ];

  for (const [name, rows] of setups) {
    for (const [mode, settings] of [["weekly", WEEKLY], ["monthly", MONTHLY]] as const) {
      it(`resolveDayHours — ${name} (${mode}), every day of 2026–2027`, () => {
        for (const date of DAYS_2026_2027) {
          expect(resolveDayHours(date, settings, rows, [], [])).toStrictEqual(legacyResolveDayHours(date, settings, rows, [], []));
          expect(resolveDayHours(date, settings, rows, blocked, overrides))
            .toStrictEqual(legacyResolveDayHours(date, settings, rows, blocked, overrides));
        }
      });
    }

    it(`getProviderStatus — ${name}, every day of 2026–2027 at 07:30 / 10:30 / 22:00`, () => {
      const statusOverrides: StatusOverrideRow[] = overrides;
      for (const day of DAYS_2026_2027) {
        for (const [h, m] of [[7, 30], [10, 30], [22, 0]]) {
          const now = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m);
          expect(getProviderStatus(rows, blocked, now, statusOverrides))
            .toStrictEqual(legacyGetProviderStatus(rows, blocked, now, statusOverrides));
          expect(getProviderStatus(rows, null, now)).toStrictEqual(legacyGetProviderStatus(rows, null, now));
        }
      }
    });

    it(`isNormallyOpen — ${name}, every day of 2026–2027`, () => {
      for (const date of DAYS_2026_2027) {
        expect(isNormallyOpen(date, rows)).toBe(legacyIsNormallyOpen(date, rows));
      }
    });
  }
});

// ── 2. The rule ─────────────────────────────────────────────────────────────

describe("every 2 weeks — the rule", () => {
  const fri = (y: number, m: number, d: number) => resolveDayHours(local(y, m, d), WEEKLY, BIWEEKLY, [], []);

  it("works the anchor Friday, every other Friday after it, and is closed in between", () => {
    expect(fri(2026, 11, 27)).toStrictEqual(FRI_WINDOW);
    expect(fri(2026, 12, 4)).toBeNull();
    expect(fri(2026, 12, 11)).toStrictEqual(FRI_WINDOW);
    expect(fri(2026, 12, 18)).toBeNull();
  });

  it("counts backwards from the anchor too", () => {
    expect(fri(2026, 11, 20)).toBeNull();
    expect(fri(2026, 11, 13)).toStrictEqual(FRI_WINDOW);
    expect(fri(2025, 11, 28)).toStrictEqual(FRI_WINDOW); // 52 weeks before
    expect(fri(2025, 12, 5)).toBeNull();                 // 51 weeks before
  });

  it("holds over years: 104 weeks on works, 105 weeks on is off", () => {
    expect(fri(2028, 11, 24)).toStrictEqual(FRI_WINDOW);
    expect(fri(2028, 12, 1)).toBeNull();
  });

  it("alternates on every Friday of 2026–2027 and leaves every other weekday alone", () => {
    for (const date of DAYS_2026_2027) {
      const got = resolveDayHours(date, WEEKLY, BIWEEKLY, [], []);
      const before = legacyResolveDayHours(date, WEEKLY, BIWEEKLY, [], []);
      if (date.getDay() !== FRI) {
        expect(got).toStrictEqual(before);
        continue;
      }
      const days = Math.round((Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) - Date.UTC(2026, 10, 27)) / 86_400_000);
      expect(got).toStrictEqual(Math.abs(days / 7) % 2 === 0 ? FRI_WINDOW : null);
    }
  });

  it("reads the date's local calendar day whatever the time of day", () => {
    expect(resolveDayHours(local(2026, 12, 4, 23, 59), WEEKLY, BIWEEKLY, [], [])).toBeNull();
    expect(resolveDayHours(local(2026, 12, 11, 0, 1), WEEKLY, BIWEEKLY, [], [])).toStrictEqual(FRI_WINDOW);
    expect(resolveDayHours(local(2026, 12, 11, 23, 59), WEEKLY, BIWEEKLY, [], [])).toStrictEqual(FRI_WINDOW);
  });

  it("a CLOSED every-2-weeks Friday stays closed every week", () => {
    const rows = week({ is_available: false, repeat_every_weeks: 2, repeat_anchor_date: "2026-11-27" });
    expect(resolveDayHours(local(2026, 11, 27), WEEKLY, rows, [], [])).toBeNull();
    expect(resolveDayHours(local(2026, 12, 4), WEEKLY, rows, [], [])).toBeNull();
  });

  it("monthly mode never reads the weekday rows, so the rule has no effect there", () => {
    for (const d of [local(2026, 11, 27), local(2026, 12, 4)]) {
      expect(resolveDayHours(d, MONTHLY, BIWEEKLY, [], [])).toStrictEqual(legacyResolveDayHours(d, MONTHLY, BIWEEKLY, [], []));
    }
  });
});

// ── 3. Daylight saving and New Year ─────────────────────────────────────────

describe("every 2 weeks — across DST and New Year", () => {
  it("spring: anchor before the clock change (Fri 2026-03-27 02:00) keeps its rhythm", () => {
    const rows = week({ repeat_every_weeks: 2, repeat_anchor_date: "2026-03-20" });
    expect(resolveDayHours(local(2026, 3, 20), WEEKLY, rows, [], [])).toStrictEqual(FRI_WINDOW);
    expect(resolveDayHours(local(2026, 3, 27), WEEKLY, rows, [], [])).toBeNull();       // the change day itself
    expect(resolveDayHours(local(2026, 3, 27, 12), WEEKLY, rows, [], [])).toBeNull();
    expect(resolveDayHours(local(2026, 4, 3), WEEKLY, rows, [], [])).toStrictEqual(FRI_WINDOW);
    expect(resolveDayHours(local(2026, 4, 10), WEEKLY, rows, [], [])).toBeNull();
  });

  it("spring: anchor AFTER the change counts back across it", () => {
    const rows = week({ repeat_every_weeks: 2, repeat_anchor_date: "2026-04-03" });
    expect(resolveDayHours(local(2026, 3, 27), WEEKLY, rows, [], [])).toBeNull();
    expect(resolveDayHours(local(2026, 3, 20), WEEKLY, rows, [], [])).toStrictEqual(FRI_WINDOW);
  });

  it("autumn: anchor before the change back (Sun 2026-10-25) keeps its rhythm", () => {
    const rows = week({ repeat_every_weeks: 2, repeat_anchor_date: "2026-10-16" });
    expect(resolveDayHours(local(2026, 10, 23), WEEKLY, rows, [], [])).toBeNull();
    expect(resolveDayHours(local(2026, 10, 30), WEEKLY, rows, [], [])).toStrictEqual(FRI_WINDOW);
    expect(resolveDayHours(local(2026, 11, 6), WEEKLY, rows, [], [])).toBeNull();
  });

  it("a Sunday rule straddling the autumn change day itself", () => {
    const rows = week().map(r => (r.day_of_week === 0 ? { ...r, repeat_every_weeks: 2, repeat_anchor_date: "2026-10-18" } : r));
    expect(resolveDayHours(local(2026, 10, 18), WEEKLY, rows, [], [])).not.toBeNull();
    expect(resolveDayHours(local(2026, 10, 25), WEEKLY, rows, [], [])).toBeNull();      // change day
    expect(resolveDayHours(local(2026, 11, 1), WEEKLY, rows, [], [])).not.toBeNull();
  });

  it("New Year in a 53-ISO-week year: odd/even week numbers would get Jan 8 2027 wrong", () => {
    // Dec 25 2026 = ISO 2026-W52 (works). Jan 1 2027 = ISO 2026-W53. Jan 8 2027
    // = ISO 2027-W01 — odd, like W53, so a week-parity rule would close it two
    // weeks running. Counting from the anchor works it.
    const rows = week({ repeat_every_weeks: 2, repeat_anchor_date: "2026-12-25" });
    expect(resolveDayHours(local(2026, 12, 25), WEEKLY, rows, [], [])).toStrictEqual(FRI_WINDOW);
    expect(resolveDayHours(local(2027, 1, 1), WEEKLY, rows, [], [])).toBeNull();
    expect(resolveDayHours(local(2027, 1, 8), WEEKLY, rows, [], [])).toStrictEqual(FRI_WINDOW);
    expect(resolveDayHours(local(2027, 1, 15), WEEKLY, rows, [], [])).toBeNull();
  });

  it("New Year counted back from an anchor in the new year", () => {
    const rows = week({ repeat_every_weeks: 2, repeat_anchor_date: "2027-01-08" });
    expect(resolveDayHours(local(2027, 1, 1), WEEKLY, rows, [], [])).toBeNull();
    expect(resolveDayHours(local(2026, 12, 25), WEEKLY, rows, [], [])).toStrictEqual(FRI_WINDOW);
  });
});

// ── 4. Blocked dates and date-openings still override ───────────────────────

describe("every 2 weeks — blocked dates and date-openings still win", () => {
  const opening = (date: string, extra: Partial<DateOverrideRow> = {}): DateOverrideRow => ({
    override_date: date, is_available: true, start_time: "10:00", end_time: "14:00", break_start: null, break_end: null, ...extra,
  });

  it("a blocked date closes a WORKING Friday", () => {
    expect(resolveDayHours(local(2026, 11, 27), WEEKLY, BIWEEKLY, ["2026-11-27"], [])).toBeNull();
  });

  it("a date-opening opens an OFF Friday, with the opening's own hours", () => {
    expect(resolveDayHours(local(2026, 12, 4), WEEKLY, BIWEEKLY, [], [opening("2026-12-04")]))
      .toStrictEqual({ start_time: "10:00", end_time: "14:00", break_start: null, break_end: null });
  });

  it("a date-opening re-times a WORKING Friday", () => {
    expect(resolveDayHours(local(2026, 12, 11), WEEKLY, BIWEEKLY, [], [opening("2026-12-11", { start_time: "07:00" })]))
      .toStrictEqual({ start_time: "07:00", end_time: "14:00", break_start: null, break_end: null });
  });

  it("an is_available=false override closes a WORKING Friday", () => {
    expect(resolveDayHours(local(2026, 12, 11), WEEKLY, BIWEEKLY, [], [opening("2026-12-11", { is_available: false })])).toBeNull();
  });

  it("blocked beats a date-opening on an off Friday, as always", () => {
    expect(resolveDayHours(local(2026, 12, 4), WEEKLY, BIWEEKLY, ["2026-12-04"], [opening("2026-12-04")])).toBeNull();
  });
});

// ── 5. A broken anchor is ignored (day behaves as every week) ───────────────

describe("every 2 weeks — a broken anchor is ignored", () => {
  const cases: Array<[string, string | null | undefined]> = [
    ["missing (null)", null],
    ["missing (undefined)", undefined],
    ["empty string", ""],
    ["garbage", "next friday"],
    ["not a real date", "2026-02-30"],
    ["on the wrong weekday", "2026-11-28"],
  ];
  for (const [name, anchor] of cases) {
    it(name, () => {
      const rows = week({ repeat_every_weeks: 2, repeat_anchor_date: anchor });
      for (const d of [local(2026, 11, 27), local(2026, 12, 4), local(2026, 12, 11)]) {
        expect(isOffWeek(rows[FRI], d)).toBe(false);
        expect(resolveDayHours(d, WEEKLY, rows, [], [])).toStrictEqual(FRI_WINDOW);
      }
    });
  }

  it("an anchor with a time suffix (timestamp-shaped) still reads its date", () => {
    const rows = week({ repeat_every_weeks: 2, repeat_anchor_date: "2026-11-27T00:00:00" });
    expect(resolveDayHours(local(2026, 12, 4), WEEKLY, rows, [], [])).toBeNull();
  });
});

// ── 6. The other readers follow the same rule ───────────────────────────────

describe("every 2 weeks — getProviderStatus and isNormallyOpen", () => {
  const status = (rows: AvailabilityRow[], now: Date, blocked: string[] = [], overrides: StatusOverrideRow[] = []) =>
    getProviderStatus(rows, blocked, now, overrides);

  it("the pill reads open on a working Friday and closed (no hours) on an off one", () => {
    expect(status(BIWEEKLY, local(2026, 11, 27, 10))).toStrictEqual({ isOpen: true, todayHours: { open: "08:00", close: "13:00" }, hasSchedule: true });
    expect(status(BIWEEKLY, local(2026, 12, 4, 10))).toStrictEqual({ isOpen: false, todayHours: null, hasSchedule: true });
  });

  it("an override for an off Friday drives the pill, as in resolveDayHours", () => {
    const o: StatusOverrideRow = { override_date: "2026-12-04", is_available: true, start_time: "09:00", end_time: "12:00" };
    expect(status(BIWEEKLY, local(2026, 12, 4, 10), [], [o])).toStrictEqual({ isOpen: true, todayHours: { open: "09:00", close: "12:00" }, hasSchedule: true });
  });

  it("a blocked working Friday reads closed", () => {
    expect(status(BIWEEKLY, local(2026, 11, 27, 10), ["2026-11-27"])).toStrictEqual({ isOpen: false, todayHours: null, hasSchedule: true });
  });

  it("pill and resolver agree on every day of 2026–2027 at 10:00", () => {
    for (const day of DAYS_2026_2027) {
      const now = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 10);
      const win = resolveDayHours(now, WEEKLY, BIWEEKLY, [], []);
      expect(status(BIWEEKLY, now).todayHours !== null).toBe(win !== null);
    }
  });

  it("isNormallyOpen: off Fridays are not normally open, working ones are", () => {
    expect(isNormallyOpen(local(2026, 11, 27), BIWEEKLY)).toBe(true);
    expect(isNormallyOpen(local(2026, 12, 4), BIWEEKLY)).toBe(false);
  });

  it("a range of openings includes the off Friday and skips the working one", () => {
    const range = [local(2026, 11, 27), local(2026, 11, 28), local(2026, 12, 4)];
    // Sat Nov 28 is closed every week; Fri Dec 4 is an off week; Fri Nov 27 works.
    expect(openingTargets(range, BIWEEKLY, false)).toEqual(["2026-11-28", "2026-12-04"]);
  });
});
