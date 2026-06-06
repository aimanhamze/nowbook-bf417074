import { useMemo } from "react";
import type { StatsPeriod } from "@/pages/Statistics";
import { useProviderProfile } from "./useProviderProfile";
import { useProviderBookings, type EnrichedBooking } from "./useProviderBookings";
import { useProviderServices } from "./useProviderServices";
import { useProviderReviews } from "./useReviews";

// ─────────────────────────────────────────────────────────────────────────────
// Client-side provider statistics aggregation (v1). No RPC, no new tables.
// Aggregates over the rows already cached by useProviderBookings /
// useProviderServices / useProviderReviews.
//
// KEY DECISIONS (flagged for review):
//
// 1. PERIOD WINDOW — trailing/rolling windows ending TODAY (local):
//      week   = last 7 days   (today − 6 … today)
//      month  = last 30 days  (today − 29 … today)
//      3months= last 90 days  (today − 89 … today)
//    Rationale: analytics = past performance; avoids partial-period ambiguity;
//    uniform across the three. Future-dated bookings fall OUTSIDE every window
//    and are surfaced separately as `revenue.upcoming` (period-independent).
//
// 2. LOCAL date comparison — booking_date is a "YYYY-MM-DD" string; we compare
//    against toLocalDateStr() (NOT toISOString), matching how booking_date is
//    stored and dodging the Israel-timezone UTC-rollback bug.
//
// 3. "EARNED" revenue proxy — `completed` is never set in practice (the source
//    query only loads confirmed/pending/cancelled). So earned = CONFIRMED with
//    booking_date ≤ today. Inside a trailing window (which ends today) every
//    confirmed booking is already earned. PENDING and CANCELLED are EXCLUDED
//    from revenue (pending shown separately as `revenue.pending`).
//
// 4. WALK-INS (user_id = null) in new-vs-returning — keyed by customer_phone.
//    A walk-in with no phone can't be de-duplicated, so each such booking
//    counts as a distinct NEW customer.
//
// 5. RATING is ALL-TIME (reputation metric, not period-bound). `periodCount`
//    additionally reports reviews created within the window.
// ─────────────────────────────────────────────────────────────────────────────

const REVENUE_STATUS = "confirmed";

export type BucketUnit = "day" | "month";

export interface RevenueBucket {
  key: string;     // "YYYY-MM-DD" (day) or "YYYY-MM" (month)
  label: string;   // short human label for the axis
  revenue: number;
}

export interface ProviderStats {
  period: StatsPeriod;
  fromStr: string;
  toStr: string;
  revenue: {
    earned: number;        // confirmed & date ≤ today, within window
    pending: number;       // pending total within window (NOT counted as earned)
    upcoming: number;      // confirmed & date > today (period-independent)
    bucketUnit: BucketUnit;
    buckets: RevenueBucket[];
  };
  bookings: {
    total: number;
    byStatus: { confirmed: number; pending: number; cancelled: number; completed: number };
  };
  topServices: { id: string; name: string; count: number; revenue: number }[];
  busiest: {
    byWeekday: { weekday: number; count: number }[]; // weekday 0=Sun … 6=Sat
    byHour: { hour: number; count: number }[];        // only hours with ≥1 booking
  };
  rating: { avg: number; count: number; periodCount: number };
  customers: {
    unique: number;
    new: number;
    returning: number;
    walkins: number;
    avgTicket: number; // earned revenue ÷ earned booking count
  };
}

// Local YYYY-MM-DD — mirrors toLocalDateStr in useAllProviders (kept local to
// avoid widening that module's surface; see decision #2).
function toLocalDateStr(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// Parse "YYYY-MM-DD" as a LOCAL date (new Date(str) would parse as UTC).
function parseLocalDate(str: string): Date {
  const [y, m, d] = str.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function windowDays(period: StatsPeriod): number {
  if (period === "week") return 7;
  if (period === "month") return 30;
  return 90;
}

export function useProviderStats(period: StatsPeriod) {
  const { profile } = useProviderProfile();
  const { data: bookings = [], isLoading: bookingsLoading } = useProviderBookings();
  const { services, isLoading: servicesLoading } = useProviderServices();
  const { data: reviews = [], isLoading: reviewsLoading } = useProviderReviews(profile?.id);

  const stats = useMemo<ProviderStats>(() => {
    const today = new Date();
    const todayStr = toLocalDateStr(today);
    const start = new Date(today);
    start.setDate(start.getDate() - (windowDays(period) - 1));
    const fromStr = toLocalDateStr(start);
    const toStr = todayStr;

    const inWindow = (b: EnrichedBooking) =>
      b.booking_date >= fromStr && b.booking_date <= toStr; // string compare, ISO-safe

    const windowBookings = bookings.filter(inWindow);
    const earned = windowBookings.filter((b) => b.status === REVENUE_STATUS); // ≤ today ⇒ earned

    // ── Revenue ──────────────────────────────────────────────────────────────
    const earnedRevenue = earned.reduce((s, b) => s + (b.total_price || 0), 0);
    const pendingRevenue = windowBookings
      .filter((b) => b.status === "pending")
      .reduce((s, b) => s + (b.total_price || 0), 0);
    // Upcoming is period-independent: confirmed bookings dated after today.
    const upcomingRevenue = bookings
      .filter((b) => b.status === REVENUE_STATUS && b.booking_date > todayStr)
      .reduce((s, b) => s + (b.total_price || 0), 0);

    // Revenue trend buckets — week/month by day, 3-months by month.
    const bucketUnit: BucketUnit = period === "3months" ? "month" : "day";
    const buckets: RevenueBucket[] = [];
    const bucketIndex = new Map<string, number>();
    if (bucketUnit === "day") {
      for (let i = 0; i < windowDays(period); i++) {
        const d = new Date(start);
        d.setDate(start.getDate() + i);
        const key = toLocalDateStr(d);
        bucketIndex.set(key, buckets.length);
        buckets.push({ key, label: `${d.getDate()}/${d.getMonth() + 1}`, revenue: 0 });
      }
      for (const b of earned) {
        const idx = bucketIndex.get(b.booking_date);
        if (idx !== undefined) buckets[idx].revenue += b.total_price || 0;
      }
    } else {
      // Walk month-by-month across the window (current month + previous 2).
      const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
      const last = new Date(today.getFullYear(), today.getMonth(), 1);
      while (cursor <= last) {
        const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`;
        bucketIndex.set(key, buckets.length);
        buckets.push({ key, label: `${cursor.getMonth() + 1}/${cursor.getFullYear() % 100}`, revenue: 0 });
        cursor.setMonth(cursor.getMonth() + 1);
      }
      for (const b of earned) {
        const idx = bucketIndex.get(b.booking_date.slice(0, 7));
        if (idx !== undefined) buckets[idx].revenue += b.total_price || 0;
      }
    }

    // ── Bookings count + status breakdown ─────────────────────────────────────
    const byStatus = { confirmed: 0, pending: 0, cancelled: 0, completed: 0 };
    for (const b of windowBookings) {
      if (b.status in byStatus) byStatus[b.status as keyof typeof byStatus]++;
    }

    // ── Top services (over earned bookings; revenue via catalog price) ────────
    const priceMap = new Map(services.map((s) => [s.id, { name: s.name, price: s.price }]));
    const svcAgg = new Map<string, { id: string; name: string; count: number; revenue: number }>();
    for (const b of earned) {
      for (const sid of b.service_ids || []) {
        const meta = priceMap.get(sid);
        const entry = svcAgg.get(sid) || { id: sid, name: meta?.name || sid, count: 0, revenue: 0 };
        entry.count += 1;
        entry.revenue += meta?.price || 0; // catalog price per occurrence
        svcAgg.set(sid, entry);
      }
    }
    const topServices = [...svcAgg.values()].sort((a, b) => b.revenue - a.revenue);

    // ── Busiest times (demand: non-cancelled bookings in window) ──────────────
    const demand = windowBookings.filter((b) => b.status !== "cancelled");
    const weekdayCounts = Array.from({ length: 7 }, (_, weekday) => ({ weekday, count: 0 }));
    const hourMap = new Map<number, number>();
    for (const b of demand) {
      const wd = parseLocalDate(b.booking_date).getDay();
      weekdayCounts[wd].count += 1;
      const hour = parseInt((b.booking_time || "").slice(0, 2), 10);
      if (!Number.isNaN(hour)) hourMap.set(hour, (hourMap.get(hour) || 0) + 1);
    }
    const byHour = [...hourMap.entries()]
      .map(([hour, count]) => ({ hour, count }))
      .sort((a, b) => a.hour - b.hour);

    // ── Rating (all-time) ─────────────────────────────────────────────────────
    const ratingCount = reviews.length;
    const ratingAvg = ratingCount ? reviews.reduce((s, r) => s + r.rating, 0) / ratingCount : 0;
    const periodReviewCount = reviews.filter((r) => {
      const d = toLocalDateStr(new Date(r.created_at));
      return d >= fromStr && d <= toStr;
    }).length;

    // ── Customers (new vs returning; avg ticket) ──────────────────────────────
    // All-time non-cancelled booking counts per customer key → classify those
    // active in the window.
    const keyOf = (b: EnrichedBooking) =>
      b.user_id ? `u:${b.user_id}` : b.customer_phone ? `p:${b.customer_phone}` : `w:${b.id}`;
    const lifetimeCount = new Map<string, number>();
    for (const b of bookings) {
      if (b.status === "cancelled") continue;
      const k = keyOf(b);
      lifetimeCount.set(k, (lifetimeCount.get(k) || 0) + 1);
    }
    const activeKeys = new Set<string>();
    let walkins = 0;
    for (const b of demand) {
      const k = keyOf(b);
      if (!activeKeys.has(k)) {
        activeKeys.add(k);
        if (!b.user_id) walkins++;
      }
    }
    let newCust = 0;
    let returningCust = 0;
    for (const k of activeKeys) {
      if ((lifetimeCount.get(k) || 0) >= 2) returningCust++;
      else newCust++;
    }
    const avgTicket = earned.length ? earnedRevenue / earned.length : 0;

    return {
      period,
      fromStr,
      toStr,
      revenue: {
        earned: earnedRevenue,
        pending: pendingRevenue,
        upcoming: upcomingRevenue,
        bucketUnit,
        buckets,
      },
      bookings: { total: windowBookings.length, byStatus },
      topServices,
      busiest: { byWeekday: weekdayCounts, byHour },
      rating: { avg: ratingAvg, count: ratingCount, periodCount: periodReviewCount },
      customers: {
        unique: activeKeys.size,
        new: newCust,
        returning: returningCust,
        walkins,
        avgTicket,
      },
    };
  }, [bookings, services, reviews, period]);

  return { stats, isLoading: bookingsLoading || servicesLoading || reviewsLoading };
}
