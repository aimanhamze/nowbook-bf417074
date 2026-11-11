/**
 * Recurring appointments (provider-created weekly series) — pure helpers.
 *
 * A series is a set of NORMAL walk-in bookings sharing bookings.series_id,
 * created in one call by create_recurring_series (migration
 * 20261109000001). Nothing here talks to the network; the hooks in
 * useRecurringSeries do, and NewBookingSheet renders the result.
 */

import { classifyDay, toLocalDateStr, type DayWindow } from "./availabilityResolver";

/** Total appointments in a series, the first one included (ruling 5). */
export const SERIES_MIN_COUNT = 2;
export const SERIES_MAX_COUNT = 12;

/** What the preview says about one date of the series, at the series' time. */
export type SeriesDateStatus =
  /** The time is a bookable slot that day — it will be created. */
  | "available"
  /** The time WOULD be a slot if nothing were booked — someone holds it. */
  | "taken"
  /** The business is closed or blocked that day, or not open at that time. */
  | "closed"
  /** The shop is open but the chosen staff member is not working. */
  | "staffOff";

/**
 * `count` weekly dates starting at `first` (included), as local calendar days.
 * Built from Y/M/D components rather than by adding milliseconds, so a DST
 * change between two weeks can never shift a date.
 */
export function weeklySeriesDates(first: Date, count: number): Date[] {
  const n = Math.max(0, Math.min(SERIES_MAX_COUNT, Math.floor(count)));
  return Array.from(
    { length: n },
    (_, i) => new Date(first.getFullYear(), first.getMonth(), first.getDate() + 7 * i),
  );
}

/**
 * Classify one series date. Every input comes from the SAME slot pipeline the
 * sheet's own grid uses (getAvailableSlots with identical arguments), so the
 * preview can never call a date available that the grid would not offer.
 *
 * - `slots`      getAvailableSlots for the day, with that range's bookings
 * - `freeSlots`  the same call with ignoreBookings — "if nothing were booked"
 * - `shop` / `narrowed`  the two windows classifyDay takes
 *
 * Order matters: a bookable slot wins; then "only bookings stand in the way"
 * is TAKEN; otherwise the day itself is the reason — shop closed, member off,
 * or open but not at this time (latest start, break, end of day), which the
 * provider reads the same as closed.
 */
export function classifySeriesDate(input: {
  time: string;
  slots: readonly string[];
  freeSlots: readonly string[];
  shop: DayWindow | null;
  narrowed: DayWindow | null;
}): SeriesDateStatus {
  if (input.slots.includes(input.time)) return "available";
  if (input.freeSlots.includes(input.time)) return "taken";
  return classifyDay(input.shop, input.narrowed, false) === "staffOff" ? "staffOff" : "closed";
}

/**
 * Ruling 3: the repeat option exists only for a PRIVATE service, at a time the
 * provider picked FROM THE SLOT LIST, on a day that was open — never for a
 * manual time or a forced closed/full day, and never for a fitness studio.
 */
export function canOfferRepeat(input: {
  serviceType: string | null | undefined;
  providerCategory: string | null | undefined;
  manualTime: boolean;
  dayOverridden: boolean;
  timeInSlotList: boolean;
}): boolean {
  return (
    input.serviceType !== "group" &&
    input.providerCategory !== "fitness_studio" &&
    !input.manualTime &&
    !input.dayOverridden &&
    input.timeInSlotList
  );
}

/** One row returned by create_recurring_series. */
export interface SeriesCreateRow {
  r_code: string;
  r_series_id: string | null;
  r_date: string | null;
  r_booking_id: string | null;
  r_outcome: "created" | "taken" | null;
}

export type SeriesCreateCode =
  | "OK"
  | "ALL_TAKEN"
  | "NOT_OWNER"
  | "SERVICE_INVALID"
  | "STAFF_INVALID"
  | "BAD_REQUEST"
  | "UNKNOWN";

export interface SeriesCreateResult {
  code: SeriesCreateCode;
  seriesId: string | null;
  /** "YYYY-MM-DD", ascending. */
  createdDates: string[];
  /** Taken between the preview and the save. "YYYY-MM-DD", ascending. */
  skippedDates: string[];
  /** The earliest booking actually created — the one the WhatsApp confirm is for. */
  firstBookingId: string | null;
}

const KNOWN_CODES: readonly SeriesCreateCode[] = [
  "OK",
  "ALL_TAKEN",
  "NOT_OWNER",
  "SERVICE_INVALID",
  "STAFF_INVALID",
  "BAD_REQUEST",
];

/** Fold the RPC's rows into one result. An unrecognised code is UNKNOWN, never trusted. */
export function summarizeSeriesCreate(rows: readonly SeriesCreateRow[]): SeriesCreateResult {
  const raw = rows[0]?.r_code;
  const code: SeriesCreateCode = KNOWN_CODES.includes(raw as SeriesCreateCode)
    ? (raw as SeriesCreateCode)
    : "UNKNOWN";
  const dated = rows
    .filter((r) => !!r.r_date)
    .slice()
    .sort((a, b) => (a.r_date! < b.r_date! ? -1 : a.r_date! > b.r_date! ? 1 : 0));
  const created = dated.filter((r) => r.r_outcome === "created" && !!r.r_booking_id);
  return {
    code,
    seriesId: code === "OK" ? rows[0]?.r_series_id ?? null : null,
    createdDates: code === "OK" ? created.map((r) => r.r_date!) : [],
    skippedDates: dated.filter((r) => r.r_outcome === "taken").map((r) => r.r_date!),
    firstBookingId: code === "OK" ? created[0]?.r_booking_id ?? null : null,
  };
}

/** The minimum a booking needs for its place in a series to be computed. */
export interface SeriesMember {
  id: string;
  series_id?: string | null;
  booking_date: string;
  booking_time: string;
}

export interface SeriesPosition {
  /** 1-based. */
  index: number;
  total: number;
}

/**
 * Every series booking's place in its series: "3 מתוך 5".
 *
 * Ranks ALL of a series' bookings, cancelled ones included, by date then time
 * (id breaks a tie), so the numbering is stable — cancelling the 2nd does not
 * turn the 3rd into "2 מתוך 4". Total = bookings actually created; dates that
 * were skipped at creation never existed and are not counted.
 *
 * Memoised on the array's identity: every card in the provider calendar asks
 * for its own position, and React Query hands them all the same array, so the
 * map is built once per fetch rather than once per card.
 */
const positionCache = new WeakMap<readonly SeriesMember[], Map<string, SeriesPosition>>();

export function seriesPositions(rows: readonly SeriesMember[]): Map<string, SeriesPosition> {
  const cached = positionCache.get(rows);
  if (cached) return cached;

  const bySeries = new Map<string, SeriesMember[]>();
  for (const row of rows) {
    if (!row.series_id) continue;
    const list = bySeries.get(row.series_id) ?? [];
    list.push(row);
    bySeries.set(row.series_id, list);
  }

  const result = new Map<string, SeriesPosition>();
  for (const list of bySeries.values()) {
    list.sort(
      (a, b) =>
        a.booking_date.localeCompare(b.booking_date) ||
        a.booking_time.localeCompare(b.booking_time) ||
        a.id.localeCompare(b.id),
    );
    list.forEach((row, i) => result.set(row.id, { index: i + 1, total: list.length }));
  }
  positionCache.set(rows, result);
  return result;
}

/** "YYYY-MM-DD" for a local date — re-exported so callers need one import. */
export const seriesDateKey = toLocalDateStr;

// ── Cancelling a series (Phase 5) ───────────────────────────────────────────

export type SeriesCancelScope = "from_here" | "all_upcoming";

/** One row returned by cancel_recurring_series. */
export interface SeriesCancelRow {
  r_code: string;
  r_cancellation_id: string | null;
  r_cancelled_count: number | null;
  r_first_booking_id: string | null;
  r_first_date: string | null;
}

export type SeriesCancelCode = "OK" | "NOTHING_TO_CANCEL" | "NOT_FOUND" | "BAD_SCOPE" | "UNKNOWN";

export interface SeriesCancelResult {
  code: SeriesCancelCode;
  /** The recurring_series_cancellations row — the ONLY input the WhatsApp takes. */
  cancellationId: string | null;
  cancelledCount: number;
}

const CANCEL_CODES: readonly SeriesCancelCode[] = ["OK", "NOTHING_TO_CANCEL", "NOT_FOUND", "BAD_SCOPE"];

export function summarizeSeriesCancel(rows: readonly SeriesCancelRow[]): SeriesCancelResult {
  const row = rows[0];
  const code: SeriesCancelCode = CANCEL_CODES.includes(row?.r_code as SeriesCancelCode)
    ? (row!.r_code as SeriesCancelCode)
    : "UNKNOWN";
  return {
    code,
    cancellationId: code === "OK" ? row?.r_cancellation_id ?? null : null,
    cancelledCount: code === "OK" ? row?.r_cancelled_count ?? 0 : 0,
  };
}

/** A series booking as the provider calendar holds it. */
export interface SeriesBookingRow extends SeriesMember {
  status: string;
}

/**
 * How many bookings each scope would cancel, for the dialog's labels. Mirrors
 * cancel_recurring_series: same series, confirmed/pending, starting after
 * `now`; "from here" also at or after this booking's own start. Display only —
 * the toast reports the server's own count.
 *
 * Start times are compared as local wall-clock strings; the app runs in the
 * business's timezone (Israel), as everywhere else on the provider side.
 */
export function seriesCancelCounts(
  rows: readonly SeriesBookingRow[],
  booking: SeriesMember,
  now: Date = new Date(),
): { fromHere: number; allUpcoming: number } {
  if (!booking.series_id) return { fromHere: 0, allUpcoming: 0 };
  const pad = (n: number) => String(n).padStart(2, "0");
  const nowKey = `${toLocalDateStr(now)}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const keyOf = (r: SeriesMember) => `${r.booking_date}T${r.booking_time.slice(0, 5)}`;
  const thisKey = keyOf(booking);
  const upcoming = rows.filter(
    (r) =>
      r.series_id === booking.series_id &&
      (r.status === "confirmed" || r.status === "pending") &&
      keyOf(r) > nowKey,
  );
  return {
    fromHere: upcoming.filter((r) => keyOf(r) >= thisKey).length,
    allUpcoming: upcoming.length,
  };
}
