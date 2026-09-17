import { useCallback, useMemo } from "react";
import { useProviderProfile } from "@/hooks/useProviderProfile";
import { useProviderAvailability } from "@/hooks/useProviderAvailability";
import { usePublicStaffHours } from "@/hooks/useProviderStaffHours";
import { usePublicStaffTimeOff } from "@/hooks/useProviderStaffTimeOff";
import {
  resolveDayHours,
  narrowToStaff,
  staffDayWindow,
  NO_BLOCKED_DATES,
  type DateOverrideRow,
  type DayWindow,
  type MonthlySettings,
  type WeeklyRow,
} from "@/lib/availabilityResolver";

/**
 * The CURRENT provider's resolved hours for any date — shop-level and narrowed
 * to one staff member — for provider-side flows that need to know WHY a day has
 * no slots, not merely THAT it has none.
 *
 * The slot pipeline (useRealAvailability) can only answer "are there bookable
 * slots?": resolveDayHours → null (closed / blocked) and "every slot is taken"
 * both arrive at the caller as the same empty array. Callers that let the owner
 * OVERRIDE an off day must distinguish those, so they re-resolve the day from
 * the same shared resolver the pipeline itself uses. Before this hook existed,
 * every such caller hand-copied the three adapters below; NewBookingSheet,
 * CalendarTab and useStaffToday each carry(-ied) their own copy.
 *
 * TWO WINDOWS, DELIBERATELY NOT ONE. `resolveShopWindow` is the shop's own
 * hours; `resolveWindow` is those hours narrowed to the selected member. Their
 * separation is the ONLY thing that can tell "the shop is shut" apart from
 * "this member isn't working" — collapse them into one and both read as
 * "closed". Pass the pair to classifyDay rather than testing either alone.
 *
 * NO EXTRA ROUND TRIPS. Every query mounted here is keyed identically to one
 * the slot pipeline already mounts for the same provider, so React Query dedupes
 * them — and the two can never disagree about a week, which is the more
 * important half of that guarantee.
 *
 * PROVIDER-SIDE ONLY, structurally: the schedule comes from useProviderProfile /
 * useProviderAvailability, which resolve the LOGGED-IN provider. There is no
 * providerId parameter, so this cannot be pointed at someone else's shop, and
 * the customer booking flow has nothing to gain by importing it.
 */
export interface ResolvedDayWindow {
  /** The SHOP's own window for a date, un-narrowed. null = closed or blocked. */
  resolveShopWindow: (date: Date) => DayWindow | null;
  /**
   * What the slot pipeline actually sees: the shop's window narrowed to the
   * selected member. With no member selected — or a member with no hours rows —
   * this is the identity, returning the shop's own window object.
   */
  resolveWindow: (date: Date) => DayWindow | null;
  /**
   * Does the selected member have hours of their own? Only then can a day off
   * mean "not working" rather than closed/blocked/full — a member with no rows
   * works all of the shop's hours, so for them the shop-level reading is still
   * exactly right and saying otherwise would invent a restriction.
   */
  staffHasOwnHours: boolean;
  /**
   * The selected member's hours or time off have not arrived yet. Callers that
   * MARK days (rather than merely describe a chosen one) should hold off while
   * this is true: `resolveWindow` reads an empty week as "not configured" and
   * returns the un-narrowed shop window, which would mark days one way and then
   * change its mind a moment later. Always false when no member is selected.
   */
  isLoading: boolean;
}

export function useResolvedDayWindow(staffId?: string): ResolvedDayWindow {
  const { profile } = useProviderProfile();
  const { availability, blockedDates, dateOverrides } = useProviderAvailability();

  const hasStaff = !!staffId;

  // Gated on a member actually being SELECTED, matching useAllProviders: with no
  // selection there is nothing to narrow, so a provider who does not use staff
  // fires neither request.
  const { hoursByStaff, isLoading: hoursLoading } = usePublicStaffHours(profile?.id, hasStaff);
  const { timeOffByStaff, isLoading: timeOffLoading } = usePublicStaffTimeOff(profile?.id, hasStaff);

  // Adapters onto resolveDayHours' signature. useProviderAvailability returns
  // provider_blocked_dates ROWS (the resolver wants "YYYY-MM-DD" strings) and
  // select("*") override rows (a superset of DateOverrideRow — the extra columns
  // are simply unread). Weekly rows already match WeeklyRow.
  const blockedDateStrs = useMemo(
    () => blockedDates.map((b) => b.blocked_date),
    [blockedDates],
  );

  // Same weekly-by-default resolution useRealAvailability applies
  // (useAllProviders.ts:457-463), so both agree on which branch a provider is on.
  const monthlySettings = useMemo<MonthlySettings>(
    () => ({
      availability_mode: profile?.availability_mode === "monthly" ? "monthly" : "weekly",
      monthly_default_available: profile?.monthly_default_available ?? true,
      monthly_default_start: profile?.monthly_default_start ?? "09:00",
      monthly_default_end: profile?.monthly_default_end ?? "17:00",
    }),
    [
      profile?.availability_mode,
      profile?.monthly_default_available,
      profile?.monthly_default_start,
      profile?.monthly_default_end,
    ],
  );

  const resolveShopWindow = useCallback(
    (date: Date) =>
      resolveDayHours(
        date,
        monthlySettings,
        availability as WeeklyRow[],
        blockedDateStrs,
        dateOverrides as DateOverrideRow[],
      ),
    [monthlySettings, availability, blockedDateStrs, dateOverrides],
  );

  // `undefined` here means "no member selected, or this member has no rows" —
  // both of which staffDayWindow turns into the identity path. Substituting an
  // empty Map would read as "configured and off every day"; the absence must
  // travel all the way to the resolver intact.
  const staffDays = staffId ? hoursByStaff.get(staffId) : undefined;
  const staffTimeOff = (staffId ? timeOffByStaff.get(staffId) : undefined) ?? NO_BLOCKED_DATES;

  const resolveWindow = useCallback(
    (date: Date) =>
      narrowToStaff(resolveShopWindow(date), staffDayWindow(date, staffDays, staffTimeOff)),
    [resolveShopWindow, staffDays, staffTimeOff],
  );

  return {
    resolveShopWindow,
    resolveWindow,
    staffHasOwnHours: !!staffDays && staffDays.size > 0,
    isLoading: hasStaff && (hoursLoading || timeOffLoading),
  };
}
