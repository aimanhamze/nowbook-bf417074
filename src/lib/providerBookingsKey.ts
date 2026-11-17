/**
 * Every query built from the signed-in provider's bookings lives under this
 * prefix — the calendar's date ranges, the pending list, the header numbers,
 * the statistics history and the customers list. Booking mutations already
 * invalidate `["provider-bookings-enriched"]`, so all of them are refreshed by
 * the invalidation that was there before, with no list to keep in step.
 *
 * Key shape: [BOOKINGS_KEY, <active branch id>, <kind>, ...]. The branch id is
 * always second, so nothing is ever shared between branches.
 */
export const BOOKINGS_KEY = "provider-bookings-enriched";

/**
 * How long a bookings query counts as fresh. The on-screen ones are polled
 * every 30s anyway; without this, every mount and every return to the app
 * refetched them on top of the poll.
 */
export const BOOKINGS_STALE_MS = 30 * 1000;

/**
 * The full history behind the Statistics page and the monthly report. It is
 * not polled; a booking mutation still refreshes it at once.
 */
export const HISTORY_STALE_MS = 5 * 60 * 1000;
