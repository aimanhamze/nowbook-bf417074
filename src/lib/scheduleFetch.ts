import { supabase } from "@/integrations/supabase/client";
import { fetchAllPages } from "@/lib/fetchAll";
import { toLocalDateStr, type DateOverrideRow } from "@/lib/availabilityResolver";

/**
 * Reads of provider_blocked_dates and provider_date_overrides.
 *
 * WHY THIS MODULE EXISTS — the 1000-row cap. PostgREST silently truncates any
 * response at 1000 rows. These two tables only ever grow (past rows are never
 * deleted), and every reader used to fetch a provider's whole history in one
 * unpaged request: past the cap, the newest dates — the ones that matter — were
 * the ones dropped, so a blocked day could show as open.
 *
 * Two fixes, applied per reader according to which dates it can resolve:
 *
 *  - CUSTOMER / PUBLIC readers (booking flow, provider page, Home pills) only
 *    ever resolve today or later — every calendar they render starts at today.
 *    They fetch from SCHEDULE_FROM (yesterday, see below) onward, so past rows
 *    stop counting at all, and page through the rest.
 *
 *  - The PROVIDER'S OWN reader (useProviderAvailability) also feeds the
 *    calendar's out-of-hours badge on PAST bookings, so it keeps every row and
 *    only gains paging. Its volume is one provider's own rows.
 *
 * There is deliberately NO upper bound: booking windows reach 90 days and a
 * weekly series can reach 11 weeks beyond its first date, and future rows are
 * few. An upper bound would only save rows nobody has, at the risk of dropping
 * one that matters.
 *
 * Each page is ordered on a column set that is UNIQUE within its filter
 * (UNIQUE (provider_id, blocked_date) / (provider_id, override_date)), as
 * fetchAllPages requires, so no row can be skipped or repeated across pages.
 */

/**
 * Lower bound for public reads: YESTERDAY as a local "YYYY-MM-DD".
 *
 * Yesterday, not today, as a one-day margin: a stale page left open across
 * midnight keeps resolving "today" as the date it loaded on, and a device whose
 * clock or zone disagrees with Israel's by a few hours must not lose the row
 * for the day it still calls today. One extra day of rows costs nothing.
 *
 * LOCAL date (toLocalDateStr), matching how blocked_date / override_date are
 * written and compared everywhere — never toISOString(), which yields the UTC
 * date and drifts a day around Israeli midnight.
 */
export function scheduleFromDate(now: Date = new Date()): string {
  const d = new Date(now);
  d.setDate(d.getDate() - 1);
  return toLocalDateStr(d);
}

/** One provider's blocked dates from `fromDate` onward, as plain date strings. */
export async function fetchPublicBlockedDates(providerId: string, fromDate: string): Promise<string[]> {
  const rows = await fetchAllPages<{ blocked_date: string }>((from, to) =>
    supabase
      .from("provider_blocked_dates")
      .select("blocked_date")
      .eq("provider_id", providerId)
      .gte("blocked_date", fromDate)
      .order("blocked_date")
      .range(from, to),
  );
  return rows.map((r) => r.blocked_date);
}

/** One provider's per-date overrides from `fromDate` onward (resolver fields only). */
export async function fetchPublicDateOverrides(providerId: string, fromDate: string): Promise<DateOverrideRow[]> {
  return fetchAllPages<DateOverrideRow>((from, to) =>
    supabase
      .from("provider_date_overrides")
      .select("override_date, is_available, start_time, end_time, break_start, break_end")
      .eq("provider_id", providerId)
      .gte("override_date", fromDate)
      .order("override_date")
      .range(from, to),
  );
}

/** Every provider's blocked dates from `fromDate` onward (Home status pills). */
export async function fetchAllProvidersBlockedDates(
  fromDate: string,
): Promise<{ provider_id: string; blocked_date: string }[]> {
  return fetchAllPages<{ provider_id: string; blocked_date: string }>((from, to) =>
    supabase
      .from("provider_blocked_dates")
      .select("provider_id, blocked_date")
      .gte("blocked_date", fromDate)
      .order("provider_id")
      .order("blocked_date")
      .range(from, to),
  );
}

/**
 * Every provider's date overrides from `fromDate` onward (Home status pills:
 * special opening days and monthly per-date hours). Ordered on
 * (provider_id, override_date), unique per the table's UNIQUE constraint.
 */
export async function fetchAllProvidersDateOverrides(
  fromDate: string,
): Promise<{ provider_id: string; override_date: string; is_available: boolean; start_time: string; end_time: string }[]> {
  return fetchAllPages((from, to) =>
    supabase
      .from("provider_date_overrides")
      .select("provider_id, override_date, is_available, start_time, end_time")
      .gte("override_date", fromDate)
      .order("provider_id")
      .order("override_date")
      .range(from, to),
  );
}

/** The signed-in provider's own blocked dates — ALL of them (past included), paged. */
export async function fetchOwnBlockedDates(providerId: string) {
  return fetchAllPages((from, to) =>
    supabase
      .from("provider_blocked_dates")
      .select("*")
      .eq("provider_id", providerId)
      .order("blocked_date")
      .range(from, to),
  );
}

/** The signed-in provider's own date overrides — ALL of them (past included), paged. */
export async function fetchOwnDateOverrides(providerId: string) {
  return fetchAllPages((from, to) =>
    supabase
      .from("provider_date_overrides")
      .select("*")
      .eq("provider_id", providerId)
      .order("override_date")
      .range(from, to),
  );
}
