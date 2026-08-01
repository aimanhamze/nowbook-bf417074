import { customerKey, isRegisteredKey } from "./customerKey";

// ─────────────────────────────────────────────────────────────────────────────
// PURE provider statistics aggregation over an ARBITRARY inclusive date range.
//
// Extracted from useProviderStats so the same numbers can be computed for:
//   • the Statistics page's trailing windows (last 7 / 30 / 90 days), and
//   • an arbitrary calendar month — and the month before it, for
//     month-over-month — without a second implementation.
//
// No hooks, no `new Date()` on the range path, no I/O: every input is passed in,
// so a given (bookings, range) always yields the same output. That is what makes
// a past month's report reproducible.
//
// KEY DECISIONS:
//
// 1. RANGE is inclusive on both ends, compared as "YYYY-MM-DD" STRINGS.
//    booking_date is a Postgres `date` and arrives as "YYYY-MM-DD"; lexical
//    compare is chronological for that format. Callers must build the bounds
//    from LOCAL date parts (toLocalDateStr / date-fns format), never
//    toISOString(), which rolls back a day in Israel's timezone.
//
// 2. REVENUE (unchanged definition): earned = status 'confirmed', in range, and
//    booking_date <= todayStr. For the trailing windows Statistics uses, the
//    window always ENDS today, so the `<= todayStr` clause removes nothing and
//    this is bit-for-bit identical to the previous behaviour. It only starts to
//    matter for a range that extends into the future (e.g. the current, partial
//    month), where a not-yet-happened appointment must not be counted as earned.
//    PENDING and CANCELLED are excluded from revenue; pending is reported alone.
//
// 3. `completed` / `no_show` are NEVER written in this product (verified against
//    live data: confirmed / cancelled / pending only). 'confirmed' is the only
//    revenue signal available. Because no_show does not exist, revenue is the
//    QUOTED price of appointments that were booked — expected, not collected.
//
// 4. NEW vs RETURNING is a COHORT test, not a lifetime-count test:
//    a customer is NEW when their FIRST-EVER non-cancelled booking with this
//    provider falls inside the range; anyone else active in the range is
//    RETURNING. See classifyCohort. The previous implementation compared a
//    LIFETIME booking count >= 2, which made a past month's answer change every
//    time the customer booked again — a June report re-run in August silently
//    reclassified June's new customers as returning. This version is stable.
//
// 5. REVENUE-BY-SERVICE IS DELIBERATELY ABSENT. It could only be derived from
//    the CURRENT catalog price x occurrences, so (a) a price change retroactively
//    rewrote history and (b) the parts never summed to headline revenue. Service
//    breakdown is by COUNT only, which is exact — service_ids is on the row.
//
// 6. CUSTOMER IDENTITY comes from lib/customerKey (account -> normalized phone
//    -> row id). Never re-derive it here.
// ─────────────────────────────────────────────────────────────────────────────

/** Booking fields the aggregation reads. Structural — EnrichedBooking satisfies it. */
export interface StatsBooking {
  id: string;
  user_id?: string | null;
  linked_user_id?: string | null;
  customer_phone?: string | null;
  booking_date: string; // "YYYY-MM-DD"
  booking_time?: string | null; // "HH:MM" / "HH:MM:SS"
  total_price?: number | null;
  status: string;
  service_ids?: string[] | null;
  created_at?: string | null; // tie-breaks the first-ever booking lookup
}

/** Only the catalog name is needed — prices are not used (decision #5). */
export interface StatsService {
  id: string;
  name: string;
}

export interface StatsReview {
  rating: number;
  created_at: string;
}

export type BucketUnit = "day" | "month";

export interface RevenueBucket {
  key: string; // "YYYY-MM-DD" (day) or "YYYY-MM" (month)
  label: string; // short human label for the axis
  revenue: number;
}

export interface ProviderStats {
  fromStr: string;
  toStr: string;
  revenue: {
    earned: number; // confirmed, in range, date <= today
    pending: number; // pending total in range (NOT counted as earned)
    upcoming: number; // confirmed & date > today (range-independent)
    bucketUnit: BucketUnit;
    buckets: RevenueBucket[];
  };
  bookings: {
    total: number; // every status, incl. cancelled
    active: number; // non-cancelled (confirmed + pending) — "appointments held"
    byStatus: { confirmed: number; pending: number; cancelled: number; completed: number };
    cancellationRate: number; // cancelled / total, 0 when total is 0
  };
  /** Service breakdown by COUNT only — see decision #5. Sorted count desc. */
  topServices: { id: string; name: string; count: number }[];
  busiest: {
    byWeekday: { weekday: number; count: number }[]; // weekday 0=Sun … 6=Sat
    byHour: { hour: number; count: number }[]; // only hours with >= 1 booking
  };
  rating: { avg: number; count: number; periodCount: number };
  customers: {
    unique: number;
    new: number;
    returning: number;
    walkins: number; // unique customers with NO account (p:/w: keys)
    avgTicket: number; // earned revenue / earned booking count
  };
  /** Sum of `duration` over earned bookings' services, in hours. */
  bookedHours: number;
}

export interface ComputeStatsOptions {
  /**
   * Local "YYYY-MM-DD" for today. Gates earned revenue and drives `upcoming`.
   * Defaults to the local current date; pass it explicitly in tests.
   */
  todayStr?: string;
  /** Override the derived bucket granularity. */
  bucketUnit?: BucketUnit;
  /** Service durations in minutes, by service id, for `bookedHours`. */
  durations?: Map<string, number>;
}

/** Local YYYY-MM-DD. Never toISOString() — see decision #1. */
export function toLocalDateStr(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Parse "YYYY-MM-DD" as a LOCAL date (new Date(str) would parse it as UTC). */
export function parseLocalDate(str: string): Date {
  const [y, m, d] = str.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** Inclusive whole-day span of a range, used to derive bucket granularity. */
function rangeDays(fromStr: string, toStr: string): number {
  const ms = parseLocalDate(toStr).getTime() - parseLocalDate(fromStr).getTime();
  return Math.floor(ms / 86_400_000) + 1;
}

// A calendar month (28-31d) and the 7/30-day windows bucket by DAY; the 90-day
// window buckets by MONTH. 62 sits between 31 and 90, so every existing caller
// keeps its previous granularity.
const DAY_BUCKET_MAX_DAYS = 62;

/**
 * Which unique customers active in [rangeStart, rangeEnd] are NEW vs RETURNING.
 *
 * NEW  = their first-ever non-cancelled booking with this provider is in range.
 * RETURNING = they were active in range but first booked before it.
 *
 * `allBookings` must be the provider's FULL non-cancelled history, not just the
 * range — the first-ever date is what makes the answer reproducible. Cancelled
 * rows are ignored on both sides: a cancelled booking is not a visit.
 *
 * Exported for direct unit testing.
 */
export function classifyCohort(
  allBookings: StatsBooking[],
  rangeStart: string,
  rangeEnd: string
): { unique: number; new: number; returning: number; newKeys: string[]; returningKeys: string[] } {
  // First-ever non-cancelled booking per customer, by booking_date and then
  // created_at. The tie-break only decides WHICH row is "first"; both tied rows
  // share a booking_date, so it never changes the new/returning verdict.
  const firstSeen = new Map<string, { date: string; created: string }>();
  const active = new Set<string>();

  for (const b of allBookings) {
    if (b.status === "cancelled") continue;
    const key = customerKey(b);
    const created = b.created_at || "";
    const prev = firstSeen.get(key);
    if (
      !prev ||
      b.booking_date < prev.date ||
      (b.booking_date === prev.date && created < prev.created)
    ) {
      firstSeen.set(key, { date: b.booking_date, created });
    }
    if (b.booking_date >= rangeStart && b.booking_date <= rangeEnd) active.add(key);
  }

  const newKeys: string[] = [];
  const returningKeys: string[] = [];
  for (const key of active) {
    const first = firstSeen.get(key);
    // `active` is built from the same loop that fills firstSeen, so this is
    // always present; the guard keeps the function total.
    const firstDate = first ? first.date : rangeStart;
    if (firstDate >= rangeStart && firstDate <= rangeEnd) newKeys.push(key);
    else returningKeys.push(key);
  }

  return {
    unique: active.size,
    new: newKeys.length,
    returning: returningKeys.length,
    newKeys,
    returningKeys,
  };
}

/**
 * Aggregate a provider's bookings/services/reviews over an inclusive date range.
 *
 * @param bookings   the provider's FULL booking history (not pre-filtered) —
 *                   needed for the cohort test and for `upcoming` revenue
 * @param services   catalog rows, for service names
 * @param reviews    the provider's reviews (all-time)
 * @param rangeStart inclusive "YYYY-MM-DD", built from LOCAL date parts
 * @param rangeEnd   inclusive "YYYY-MM-DD"
 */
export function computeProviderStats(
  bookings: StatsBooking[],
  services: StatsService[],
  reviews: StatsReview[],
  rangeStart: string,
  rangeEnd: string,
  options: ComputeStatsOptions = {}
): ProviderStats {
  const todayStr = options.todayStr ?? toLocalDateStr(new Date());
  const inRange = (b: StatsBooking) =>
    b.booking_date >= rangeStart && b.booking_date <= rangeEnd;

  const rangeBookings = bookings.filter(inRange);
  // Decision #2: confirmed AND already happened. No-op for windows ending today.
  const earned = rangeBookings.filter(
    (b) => b.status === "confirmed" && b.booking_date <= todayStr
  );
  const nonCancelled = rangeBookings.filter((b) => b.status !== "cancelled");

  // ── Revenue ────────────────────────────────────────────────────────────────
  const earnedRevenue = earned.reduce((s, b) => s + (b.total_price || 0), 0);
  const pendingRevenue = rangeBookings
    .filter((b) => b.status === "pending")
    .reduce((s, b) => s + (b.total_price || 0), 0);
  // Range-independent: confirmed bookings dated after today.
  const upcomingRevenue = bookings
    .filter((b) => b.status === "confirmed" && b.booking_date > todayStr)
    .reduce((s, b) => s + (b.total_price || 0), 0);

  // ── Revenue trend buckets ──────────────────────────────────────────────────
  const span = rangeDays(rangeStart, rangeEnd);
  const bucketUnit: BucketUnit =
    options.bucketUnit ?? (span > DAY_BUCKET_MAX_DAYS ? "month" : "day");
  const buckets: RevenueBucket[] = [];
  const bucketIndex = new Map<string, number>();

  if (bucketUnit === "day") {
    const cursor = parseLocalDate(rangeStart);
    for (let i = 0; i < span; i++) {
      const key = toLocalDateStr(cursor);
      bucketIndex.set(key, buckets.length);
      buckets.push({
        key,
        label: `${cursor.getDate()}/${cursor.getMonth() + 1}`,
        revenue: 0,
      });
      cursor.setDate(cursor.getDate() + 1);
    }
    for (const b of earned) {
      const idx = bucketIndex.get(b.booking_date);
      if (idx !== undefined) buckets[idx].revenue += b.total_price || 0;
    }
  } else {
    const start = parseLocalDate(rangeStart);
    const end = parseLocalDate(rangeEnd);
    const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
    const last = new Date(end.getFullYear(), end.getMonth(), 1);
    while (cursor <= last) {
      const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`;
      bucketIndex.set(key, buckets.length);
      buckets.push({
        key,
        label: `${cursor.getMonth() + 1}/${cursor.getFullYear() % 100}`,
        revenue: 0,
      });
      cursor.setMonth(cursor.getMonth() + 1);
    }
    for (const b of earned) {
      const idx = bucketIndex.get(b.booking_date.slice(0, 7));
      if (idx !== undefined) buckets[idx].revenue += b.total_price || 0;
    }
  }

  // ── Bookings count + status breakdown ──────────────────────────────────────
  const byStatus = { confirmed: 0, pending: 0, cancelled: 0, completed: 0 };
  for (const b of rangeBookings) {
    if (b.status in byStatus) byStatus[b.status as keyof typeof byStatus]++;
  }
  const total = rangeBookings.length;
  const cancellationRate = total ? byStatus.cancelled / total : 0;

  // ── Service breakdown by COUNT (decision #5) ───────────────────────────────
  // A booking covering N services counts once per service, so these sum to more
  // than the appointment count — it answers "how many bookings included this
  // service", not "how many appointments".
  const nameMap = new Map(services.map((s) => [s.id, s.name]));
  const svcAgg = new Map<string, { id: string; name: string; count: number }>();
  for (const b of earned) {
    for (const sid of b.service_ids || []) {
      const entry = svcAgg.get(sid) || { id: sid, name: nameMap.get(sid) || sid, count: 0 };
      entry.count += 1;
      svcAgg.set(sid, entry);
    }
  }
  const topServices = [...svcAgg.values()].sort(
    (a, b) => b.count - a.count || a.name.localeCompare(b.name)
  );

  // ── Booked hours (earned bookings' service durations) ──────────────────────
  let bookedMinutes = 0;
  if (options.durations) {
    for (const b of earned) {
      for (const sid of b.service_ids || []) {
        bookedMinutes += options.durations.get(sid) || 0;
      }
    }
  }

  // ── Busiest times (demand: non-cancelled in range) ─────────────────────────
  const weekdayCounts = Array.from({ length: 7 }, (_, weekday) => ({ weekday, count: 0 }));
  const hourMap = new Map<number, number>();
  for (const b of nonCancelled) {
    weekdayCounts[parseLocalDate(b.booking_date).getDay()].count += 1;
    const hour = parseInt((b.booking_time || "").slice(0, 2), 10);
    if (!Number.isNaN(hour)) hourMap.set(hour, (hourMap.get(hour) || 0) + 1);
  }
  const byHour = [...hourMap.entries()]
    .map(([hour, count]) => ({ hour, count }))
    .sort((a, b) => a.hour - b.hour);

  // ── Rating (all-time; periodCount is reviews written in range) ─────────────
  const ratingCount = reviews.length;
  const ratingAvg = ratingCount ? reviews.reduce((s, r) => s + r.rating, 0) / ratingCount : 0;
  // created_at is a timestamptz — convert to a LOCAL date before comparing, so
  // a review written at 23:30 local on the last of the month stays in it.
  const periodReviewCount = reviews.filter((r) => {
    const d = toLocalDateStr(new Date(r.created_at));
    return d >= rangeStart && d <= rangeEnd;
  }).length;

  // ── Customers (cohort new vs returning; avg ticket) ────────────────────────
  const cohort = classifyCohort(bookings, rangeStart, rangeEnd);
  // "Walk-in" describes the CUSTOMER, not the booking: someone whose walk-in
  // was linked to an account resolves to a "u:" key and is not counted here.
  const walkins = [...cohort.newKeys, ...cohort.returningKeys].filter(
    (k) => !isRegisteredKey(k)
  ).length;
  const avgTicket = earned.length ? earnedRevenue / earned.length : 0;

  return {
    fromStr: rangeStart,
    toStr: rangeEnd,
    revenue: {
      earned: earnedRevenue,
      pending: pendingRevenue,
      upcoming: upcomingRevenue,
      bucketUnit,
      buckets,
    },
    bookings: {
      total,
      active: nonCancelled.length,
      byStatus,
      cancellationRate,
    },
    topServices,
    busiest: { byWeekday: weekdayCounts, byHour },
    rating: { avg: ratingAvg, count: ratingCount, periodCount: periodReviewCount },
    customers: {
      unique: cohort.unique,
      new: cohort.new,
      returning: cohort.returning,
      walkins,
      avgTicket,
    },
    bookedHours: bookedMinutes / 60,
  };
}
