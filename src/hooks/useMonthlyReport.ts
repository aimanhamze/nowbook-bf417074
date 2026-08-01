import { useMemo } from "react";
import { useProviderProfile } from "./useProviderProfile";
import { useProviderBookings, type EnrichedBooking } from "./useProviderBookings";
import { useProviderServices } from "./useProviderServices";
import { useProviderReviews } from "./useReviews";
import {
  computeProviderStats,
  toLocalDateStr,
  type ProviderStats,
} from "@/lib/providerStats";
import {
  availableMonths,
  groupByDay,
  monthRange,
  previousMonth,
  type DayLogGroup,
  type MonthRef,
} from "@/lib/monthlyReport";

// ─────────────────────────────────────────────────────────────────────────────
// Data binding for the monthly report.
//
// Mirrors useProviderStats: it resolves the same four cached queries and
// delegates every number to the PURE lib/providerStats aggregation. Nothing is
// aggregated here, so the report and the Statistics page can never drift.
//
// CRITICAL — the FULL booking history is passed to computeProviderStats, not the
// selected month's slice. Two of the metrics are history-dependent:
//   • classifyCohort (inside computeProviderStats) decides NEW vs RETURNING from
//     each customer's FIRST-EVER booking. Hand it a pre-filtered month and every
//     customer's first-seen date collapses into that month — so all of them look
//     new, silently and with no error.
//   • revenue.upcoming counts confirmed bookings dated after today, which are by
//     definition outside a past month's range.
// The range is applied INSIDE the function; filtering before the call is the bug.
//
// computeProviderStats is called TWICE — the selected month and the one before
// it — which is what makes month-over-month deltas possible without a second
// implementation of any metric.
// ─────────────────────────────────────────────────────────────────────────────

export interface MonthlyReportData {
  /** The provider's business identity for the masthead. */
  profile: ReturnType<typeof useProviderProfile>["profile"];
  /** Stats for the selected month. */
  stats: ProviderStats;
  /** Stats for the month before it — the delta baseline. */
  prevStats: ProviderStats;
  /** Non-cancelled bookings of the month, grouped by day, empty days omitted. */
  days: (DayLogGroup & { bookings: EnrichedBooking[] })[];
  /** Months the provider has history for, newest first. */
  months: MonthRef[];
  /** Local "YYYY-MM-DD" the report was generated on. */
  generatedOn: string;
  isLoading: boolean;
}

export function useMonthlyReport(selected: MonthRef): MonthlyReportData {
  const { profile } = useProviderProfile();
  const { data: bookings = [], isLoading: bookingsLoading } = useProviderBookings();
  const { services, isLoading: servicesLoading } = useProviderServices();
  const { data: reviews = [], isLoading: reviewsLoading } = useProviderReviews(profile?.id);

  const value = useMemo(() => {
    const todayStr = toLocalDateStr(new Date());
    const durations = new Map(services.map((s) => [s.id, s.duration]));

    const range = monthRange(selected);
    const prevRange = monthRange(previousMonth(selected));

    // Full history both times — the range is a parameter, not a pre-filter.
    const stats = computeProviderStats(
      bookings, services, reviews, range.start, range.end, { todayStr, durations }
    );
    const prevStats = computeProviderStats(
      bookings, services, reviews, prevRange.start, prevRange.end, { todayStr, durations }
    );

    return {
      stats,
      prevStats,
      days: groupByDay(bookings, range.start, range.end),
      months: availableMonths(bookings),
      generatedOn: todayStr,
    };
  }, [bookings, services, reviews, selected]);

  return {
    profile,
    ...value,
    isLoading: bookingsLoading || servicesLoading || reviewsLoading,
  };
}
