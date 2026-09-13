import { toLocalDateStr } from "./availabilityResolver";

/**
 * The date window the client fetches schedule data for.
 *
 * ONE definition, shared, because two separate consumers derive React Query keys
 * from it: useRealAvailability (the customer slot pipeline) and the walk-in
 * sheet's own reads. If they computed the window independently they could
 * produce different key strings for the same logical query, which would silently
 * split one cache into two and double the round trips — the failure would look
 * like nothing at all, just a slower page.
 *
 * It lives in its own module rather than in useAllProviders because
 * useProviderStaffTimeOff needs it too, and useAllProviders already imports from
 * that file — putting the constant there would create an import cycle. It also
 * does not belong in availabilityResolver, which is pure resolution logic with
 * no query concerns.
 */

/**
 * Must stay >= the booking date range any flow can show. Both booking flows cap
 * their calendars at provider.booking_window_days (default 14, and configurable
 * well below this), so 60 covers every bookable day with room to spare.
 */
export const AVAILABILITY_WINDOW_DAYS = 60;

/**
 * `[today, today + AVAILABILITY_WINDOW_DAYS]` as LOCAL calendar strings.
 *
 * LOCAL, never toISOString(): booking_date and blocked_date are stored as local
 * "YYYY-MM-DD", and a UTC conversion rolls back a day for local-midnight inputs
 * in Israel's timezone — which would drop today from the window entirely.
 *
 * `now` is injectable so this is testable without faking the clock.
 */
export function availabilityWindow(now: Date = new Date()): { fromStr: string; toStr: string } {
  const end = new Date(now);
  end.setDate(end.getDate() + AVAILABILITY_WINDOW_DAYS);
  return { fromStr: toLocalDateStr(now), toStr: toLocalDateStr(end) };
}
