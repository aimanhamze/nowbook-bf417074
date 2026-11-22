import { describe, it, expect } from "vitest";
import {
  getNextOpening,
  nextOpeningText,
  openingStatusText,
  summarizeOpening,
  NEXT_OPENING_HORIZON_DAYS,
} from "./openingSummary";
import { getProviderStatus } from "./providerStatus";
import { translations, type Lang } from "./translations";
import type { DateOverrideRow, MonthlySettings, WeeklyRow } from "./availabilityResolver";

const WEEKLY: MonthlySettings = {
  availability_mode: "weekly",
  monthly_default_available: true,
  monthly_default_start: "09:00",
  monthly_default_end: "17:00",
};

const row = (dow: number, start = "17:00:00", end = "20:00:00", patch: Partial<WeeklyRow> = {}): WeeklyRow => ({
  day_of_week: dow, start_time: start, end_time: end, is_available: true, ...patch,
});
const opening = (date: string, patch: Partial<DateOverrideRow> = {}): DateOverrideRow => ({
  override_date: date, is_available: true, start_time: "10:00", end_time: "14:00",
  break_start: null, break_end: null, ...patch,
});

// November 2026: Sun 22, Mon 23, Tue 24, Wed 25, Thu 26, Fri 27, Sat 28.
const sun = (h: number, m = 0) => new Date(2026, 10, 22, h, m);
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// Sun and Tue 17:00–20:00, nothing else.
const sunTue = [row(0), row(2)];

const t = (lang: Lang) => (key: string) => (translations[lang] as Record<string, string>)[key];

describe("getNextOpening", () => {
  it("later today when today's hours have not started", () => {
    const next = getNextOpening(sun(11), WEEKLY, sunTue, [], []);
    expect(next).toMatchObject({ time: "17:00", daysAhead: 0 });
    expect(ymd(next!.date)).toBe("2026-11-22");
  });

  it("while open, and after closing, it is the next open day", () => {
    for (const now of [sun(17), sun(18, 30), sun(20), sun(23, 59)]) {
      const next = getNextOpening(now, WEEKLY, sunTue, [], []);
      expect(next).toMatchObject({ time: "17:00", daysAhead: 2 });
      expect(ymd(next!.date)).toBe("2026-11-24");
    }
  });

  it("tomorrow is daysAhead 1", () => {
    expect(getNextOpening(sun(21), WEEKLY, [row(0), row(1, "09:00:00", "13:00:00")], [], []))
      .toMatchObject({ time: "09:00", daysAhead: 1 });
  });

  it("skips a blocked date", () => {
    const next = getNextOpening(sun(21), WEEKLY, sunTue, ["2026-11-24"], []);
    expect(ymd(next!.date)).toBe("2026-11-29");
    expect(next!.daysAhead).toBe(7);
  });

  it("a blocked today is skipped even before its hours", () => {
    const next = getNextOpening(sun(11), WEEKLY, sunTue, ["2026-11-22"], []);
    expect(ymd(next!.date)).toBe("2026-11-24");
  });

  it("a date-opening on a normally closed day counts, with its own hours", () => {
    const next = getNextOpening(sun(21), WEEKLY, sunTue, [], [opening("2026-11-23")]);
    expect(next).toMatchObject({ time: "10:00", daysAhead: 1 });
  });

  it("a date override that closes a working day is skipped", () => {
    const next = getNextOpening(sun(21), WEEKLY, sunTue, [], [opening("2026-11-24", { is_available: false })]);
    expect(ymd(next!.date)).toBe("2026-11-29");
  });

  it("skips the off week of an every-2-weeks day", () => {
    // Tuesday works 2026-12-01 and every second week from it: 24 Nov is off.
    const rows = [row(2, "17:00:00", "20:00:00", { repeat_every_weeks: 2, repeat_anchor_date: "2026-12-01" })];
    const next = getNextOpening(sun(11), WEEKLY, rows, [], []);
    expect(ymd(next!.date)).toBe("2026-12-01");
    expect(next!.daysAhead).toBe(9);
  });

  it("finds an opening exactly at the horizon, and nothing past it", () => {
    const at = (daysAhead: number) => {
      const d = new Date(2026, 10, 22 + daysAhead);
      return opening(ymd(d));
    };
    expect(getNextOpening(sun(11), WEEKLY, [], [], [at(NEXT_OPENING_HORIZON_DAYS)]))
      .toMatchObject({ daysAhead: NEXT_OPENING_HORIZON_DAYS });
    expect(getNextOpening(sun(11), WEEKLY, [], [], [at(NEXT_OPENING_HORIZON_DAYS + 1)])).toBeNull();
  });

  it("null when nothing opens: no rows, all closed, or all blocked", () => {
    expect(getNextOpening(sun(11), WEEKLY, [], [], [])).toBeNull();
    expect(getNextOpening(sun(11), WEEKLY, [row(0, "17:00:00", "20:00:00", { is_available: false })], [], [])).toBeNull();
    const everyDay = Array.from({ length: 7 }, (_, d) => row(d));
    const blocked = Array.from({ length: 15 }, (_, i) => ymd(new Date(2026, 10, 22 + i)));
    expect(getNextOpening(sun(11), WEEKLY, everyDay, blocked, [])).toBeNull();
  });
});

describe("summarizeOpening agrees with getProviderStatus", () => {
  const summary = (now: Date, rows = sunTue, blocked: string[] = []) => {
    const status = getProviderStatus(rows, blocked, now, []);
    return summarizeOpening(status, status.isOpen ? null : getNextOpening(now, WEEKLY, rows, blocked, []), now);
  };

  it("open: until today's closing time", () => {
    expect(summary(sun(18))).toEqual({ kind: "open", until: "20:00" });
  });

  it("closed before opening: next is today, nothing has closed yet", () => {
    expect(summary(sun(11))).toMatchObject({ kind: "closed", closedAt: null, next: { daysAhead: 0, time: "17:00" } });
  });

  it("closed after hours: says when it closed, next is the coming day", () => {
    expect(summary(sun(21))).toMatchObject({ kind: "closed", closedAt: "20:00", next: { daysAhead: 2 } });
  });

  it("closed all day (Monday): no closing time", () => {
    expect(summary(new Date(2026, 10, 23, 12))).toMatchObject({ kind: "closed", closedAt: null, next: { daysAhead: 1 } });
  });

  it("every minute of a day: open exactly when the next opening is not 'now'", () => {
    for (let mins = 0; mins < 24 * 60; mins += 15) {
      const now = sun(Math.floor(mins / 60), mins % 60);
      const status = getProviderStatus(sunTue, [], now, []);
      const next = getNextOpening(now, WEEKLY, sunTue, [], []);
      // Before 17:00 the next opening is today; from 17:00 on it never is.
      expect(next!.daysAhead === 0).toBe(mins < 17 * 60);
      expect(status.isOpen).toBe(mins >= 17 * 60 && mins < 20 * 60);
    }
  });
});

describe("status wording", () => {
  const closed = (daysAhead: number, time = "17:00") => ({
    kind: "closed" as const,
    closedAt: null,
    next: { date: new Date(2026, 10, 22 + daysAhead), time, daysAhead },
  });

  it("open", () => {
    const s = { kind: "open" as const, until: "20:00" };
    expect(openingStatusText(s, "he", t("he"))).toBe("פתוח עכשיו · עד 20:00");
    expect(openingStatusText(s, "ar", t("ar"))).toBe("مفتوح الآن · حتى 20:00");
    expect(openingStatusText(s, "en", t("en"))).toBe("Open now · until 20:00");
  });

  it("closed, opens later today", () => {
    expect(openingStatusText(closed(0), "he", t("he"))).toBe("סגור עכשיו · נפתח ב-17:00");
    expect(openingStatusText(closed(0), "ar", t("ar"))).toBe("مغلق الآن · يفتح الساعة 17:00");
    expect(openingStatusText(closed(0), "en", t("en"))).toBe("Closed now · opens at 17:00");
  });

  it("closed, opens tomorrow", () => {
    expect(openingStatusText(closed(1, "09:00"), "he", t("he"))).toBe("סגור עכשיו · נפתח מחר 09:00");
    expect(openingStatusText(closed(1, "09:00"), "ar", t("ar"))).toBe("مغلق الآن · يفتح غدًا 09:00");
    expect(openingStatusText(closed(1, "09:00"), "en", t("en"))).toBe("Closed now · opens tomorrow 09:00");
  });

  it("closed, opens within the week: the weekday name", () => {
    expect(openingStatusText(closed(2), "he", t("he"))).toBe("סגור עכשיו · נפתח יום שלישי 17:00");
    expect(openingStatusText(closed(2), "ar", t("ar"))).toBe("مغلق الآن · يفتح الثلاثاء 17:00");
    expect(openingStatusText(closed(2), "en", t("en"))).toBe("Closed now · opens Tuesday 17:00");
    // Six days ahead is still a weekday name (Saturday 28).
    expect(nextOpeningText(closed(6).next, "en", t("en"))).toBe("opens Saturday 17:00");
  });

  it("closed, a week or more ahead: the date, since the weekday is ambiguous", () => {
    expect(nextOpeningText(closed(7).next, "en", t("en"))).toBe("opens 29 November 17:00");
    expect(nextOpeningText(closed(9).next, "he", t("he"))).toBe("נפתח 1 בדצמבר 17:00");
    expect(nextOpeningText(closed(9).next, "ar", t("ar"))).toBe("يفتح 1 ديسمبر 17:00");
  });

  it("closed with nothing in range: the status alone", () => {
    const s = { kind: "closed" as const, closedAt: null, next: null };
    expect(openingStatusText(s, "he", t("he"))).toBe("סגור עכשיו");
    expect(openingStatusText(s, "ar", t("ar"))).toBe("مغلق الآن");
    expect(openingStatusText(s, "en", t("en"))).toBe("Closed now");
  });
});
