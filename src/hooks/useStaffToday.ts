import { useCallback, useMemo } from "react";
import { startOfToday } from "date-fns";
import { useProviderProfile } from "./useProviderProfile";
import { useProviderAvailability } from "./useProviderAvailability";
import { useProviderStaffHours } from "./useProviderStaffHours";
import { useProviderStaffTimeOff } from "./useProviderStaffTimeOff";
import {
  resolveDayHours,
  NO_BLOCKED_DATES,
  type DateOverrideRow,
  type MonthlySettings,
  type WeeklyRow,
} from "@/lib/availabilityResolver";
import { memberWeek, weekDates, type MemberDayStatus } from "@/lib/staffToday";

/**
 * Per-member status for today and the coming week, for the Staff page.
 *
 * NO NEW QUERIES. Everything here is composed from hooks the page already
 * mounts (staff hours, staff time off, the shop's own availability), and React
 * Query dedupes the keys, so the roster's chips cost no extra round trip over
 * the old settings list. The derivation itself is lib/staffToday.ts, which in
 * turn only calls the resolver — this hook is glue.
 *
 * `enabled` should be `staff.length > 0`, same gating discipline as the hooks it
 * wraps: a provider with no staff fires nothing.
 */
export function useStaffToday(enabled: boolean) {
  const { profile } = useProviderProfile();
  const { availability, blockedDates, dateOverrides, isLoading: shopLoading } = useProviderAvailability(enabled);
  const { hoursByStaff, isLoading: hoursLoading } = useProviderStaffHours(enabled);
  const { timeOffByStaff, isLoading: timeOffLoading } = useProviderStaffTimeOff(enabled);

  // Anchored on local midnight so the key is stable for the whole day and
  // matches how booking_date and blocked_date are written everywhere.
  const today = startOfToday();
  const todayKey = today.getTime();
  const dates = useMemo(() => weekDates(today, 7), [todayKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Same weekly-by-default resolution the slot pipeline and the walk-in sheet
  // apply (NewBookingSheet.tsx), so this page can never disagree with them
  // about which branch a provider is on.
  const monthlySettings = useMemo<MonthlySettings>(
    () => ({
      availability_mode: profile?.availability_mode === "monthly" ? "monthly" : "weekly",
      monthly_default_available: profile?.monthly_default_available ?? true,
      monthly_default_start: profile?.monthly_default_start ?? "09:00",
      monthly_default_end: profile?.monthly_default_end ?? "17:00",
    }),
    [profile?.availability_mode, profile?.monthly_default_available, profile?.monthly_default_start, profile?.monthly_default_end],
  );

  // The SHOP's window for each of the seven days, resolved ONCE and shared by
  // every member — the shop does not change per member, only the narrowing does.
  const shopWindows = useMemo(() => {
    const blockedStrs = blockedDates.map((b) => b.blocked_date);
    return dates.map((d) =>
      resolveDayHours(d, monthlySettings, availability as WeeklyRow[], blockedStrs, dateOverrides as DateOverrideRow[]),
    );
  }, [dates, monthlySettings, availability, blockedDates, dateOverrides]);

  const blockedSets = useMemo(() => {
    const map = new Map<string, ReadonlySet<string>>();
    for (const [staffId, list] of timeOffByStaff) map.set(staffId, new Set(list));
    return map;
  }, [timeOffByStaff]);

  const weekFor = useCallback(
    (staffId: string): MemberDayStatus[] =>
      memberWeek(dates, shopWindows, hoursByStaff.get(staffId), blockedSets.get(staffId) ?? NO_BLOCKED_DATES),
    [dates, shopWindows, hoursByStaff, blockedSets],
  );

  const todayFor = useCallback((staffId: string): MemberDayStatus => weekFor(staffId)[0], [weekFor]);

  return {
    /** Today first, then the next six days. */
    dates,
    today,
    /** The shop's own window for today, un-narrowed. null = closed. */
    shopToday: shopWindows[0] ?? null,
    weekFor,
    todayFor,
    isLoading: shopLoading || hoursLoading || timeOffLoading,
  };
}
