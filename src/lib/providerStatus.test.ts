import { describe, it, expect } from "vitest";
import { getProviderStatus, type AvailabilityRow, type StatusOverrideRow } from "./providerStatus";

// The open/closed pill. Precedence matches resolveDayHours:
// blocked -> date override -> weekday row.

// Sun-Thu 09-17, Fri closed by row, Sat no row.
const week: AvailabilityRow[] = [0, 1, 2, 3, 4].map((d) => ({
  day_of_week: d, start_time: "09:00:00", end_time: "17:00:00", is_available: true,
}));
week.push({ day_of_week: 5, start_time: "09:00:00", end_time: "17:00:00", is_available: false });

// Friday 2026-11-13 and Monday 2026-11-16, at 11:00 local.
const fri = new Date(2026, 10, 13, 11, 0);
const mon = new Date(2026, 10, 16, 11, 0);

const ov = (date: string, patch: Partial<StatusOverrideRow> = {}): StatusOverrideRow => ({
  override_date: date, is_available: true, start_time: "10:00", end_time: "14:00", ...patch,
});

describe("getProviderStatus", () => {
  it("without overrides: unchanged (open Monday, closed Friday)", () => {
    expect(getProviderStatus(week, [], mon)).toEqual({ isOpen: true, todayHours: { open: "09:00", close: "17:00" }, hasSchedule: true });
    expect(getProviderStatus(week, [], fri)).toEqual({ isOpen: false, todayHours: null, hasSchedule: true });
    expect(getProviderStatus(week, [], fri, [])).toEqual(getProviderStatus(week, [], fri));
    expect(getProviderStatus(week, [], fri, null)).toEqual(getProviderStatus(week, [], fri));
  });

  it("a special opening on a closed Friday reads open with its own hours", () => {
    expect(getProviderStatus(week, [], fri, [ov("2026-11-13")])).toEqual({
      isOpen: true, todayHours: { open: "10:00", close: "14:00" }, hasSchedule: true,
    });
  });

  it("outside the opening's window it reads closed, with today's hours", () => {
    const at15 = new Date(2026, 10, 13, 15, 0);
    expect(getProviderStatus(week, [], at15, [ov("2026-11-13")])).toEqual({
      isOpen: false, todayHours: { open: "10:00", close: "14:00" }, hasSchedule: true,
    });
  });

  it("an override replaces an open day's hours", () => {
    const at16 = new Date(2026, 10, 16, 16, 0);
    expect(getProviderStatus(week, [], at16, [ov("2026-11-16")]).isOpen).toBe(false);
  });

  it("is_available=false closes the day", () => {
    expect(getProviderStatus(week, [], mon, [ov("2026-11-16", { is_available: false })]).isOpen).toBe(false);
  });

  it("blocked wins over the override", () => {
    expect(getProviderStatus(week, ["2026-11-13"], fri, [ov("2026-11-13")])).toEqual({
      isOpen: false, todayHours: null, hasSchedule: true,
    });
  });

  it("an override for another date is ignored", () => {
    expect(getProviderStatus(week, [], fri, [ov("2026-11-14")]).isOpen).toBe(false);
  });

  it("a provider with no weekday rows but an opening today has a schedule", () => {
    expect(getProviderStatus([], [], fri, [ov("2026-11-13")]).isOpen).toBe(true);
    expect(getProviderStatus([], [], fri, [ov("2026-11-14")]).hasSchedule).toBe(false);
  });

  it("accepts a timestamp-shaped override_date", () => {
    expect(getProviderStatus(week, [], fri, [ov("2026-11-13T00:00:00")]).isOpen).toBe(true);
  });
});
