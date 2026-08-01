import { useMemo } from "react";
import type { StatsPeriod } from "@/pages/Statistics";
import { useProviderProfile } from "./useProviderProfile";
import { useProviderBookings } from "./useProviderBookings";
import { useProviderServices } from "./useProviderServices";
import { useProviderReviews } from "./useReviews";
import {
  computeProviderStats,
  toLocalDateStr,
  type ProviderStats,
} from "@/lib/providerStats";

// ─────────────────────────────────────────────────────────────────────────────
// Statistics-page binding for the provider stats aggregation.
//
// All the arithmetic now lives in lib/providerStats.ts as a PURE, range-
// parameterized function, so the monthly report can compute the same numbers
// for an arbitrary month (and the month before it) without a second copy.
// This hook only: resolves the cached data, turns a StatsPeriod into a
// concrete date range, and delegates.
//
// PERIOD WINDOW — trailing/rolling windows ending TODAY (local):
//   week = last 7 days · month = last 30 days · 3months = last 90 days
// Analytics = past performance; this avoids partial-period ambiguity. Future-
// dated bookings fall outside every window and surface as `revenue.upcoming`.
// ─────────────────────────────────────────────────────────────────────────────

export type {
  ProviderStats,
  RevenueBucket,
  BucketUnit,
} from "@/lib/providerStats";

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

    const durations = new Map(services.map((s) => [s.id, s.duration]));

    return computeProviderStats(
      bookings,
      services,
      reviews,
      toLocalDateStr(start),
      todayStr,
      { todayStr, durations }
    );
  }, [bookings, services, reviews, period]);

  return { stats, isLoading: bookingsLoading || servicesLoading || reviewsLoading };
}
