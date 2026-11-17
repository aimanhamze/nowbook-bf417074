import { useEffect, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { addDays, addMonths, endOfMonth, endOfWeek, format, startOfMonth, startOfWeek } from "date-fns";
import { useProviderProfile } from "./useProviderProfile";
import {
  providerBookingsRangeOptions,
  useProviderBookingsRange,
  type EnrichedBooking,
} from "./useProviderBookings";

// ─────────────────────────────────────────────────────────────────────────────
// Range loading for the provider calendar.
//
// The calendar used to hold the provider's ENTIRE booking history and filter it
// per day. It now loads only what the current view can show:
//
//   monthly        → the month grid on screen (leading/trailing days of the
//                    neighbouring months included, exactly as the grid draws
//                    them), plus the month of the selected day when that day is
//                    not in the grid — the list under the calendar shows the
//                    SELECTED day, which can be in another month.
//   weekly / daily → the Sunday–Saturday week of the selected day. Daily loads
//                    the whole week too, so stepping through days costs nothing.
//
// The ranges either side are prefetched once the visible one has arrived, so
// stepping forward or back is served from cache. Only mounted ranges are
// polled; prefetched ones are refreshed when they come on screen.
//
// NOTHING that needs more than the visible range may be derived from this list:
// the header numbers, the pending badge and series numbering each have their
// own source (see useProviderBookings.ts).
// ─────────────────────────────────────────────────────────────────────────────

export type CalendarViewMode = "daily" | "weekly" | "monthly";

/** Inclusive LOCAL "yyyy-MM-dd" bounds — the format booking_date is stored in. */
export interface DateRange {
  from: string;
  to: string;
}

const dateKey = (d: Date) => format(d, "yyyy-MM-dd");

/** The Sunday–Saturday week containing `date` (the calendar's week). */
export function weekRange(date: Date): DateRange {
  const start = startOfWeek(date, { weekStartsOn: 0 });
  return { from: dateKey(start), to: dateKey(addDays(start, 6)) };
}

/** Every day the month grid draws for `month`, outside days included. */
export function monthGridRange(month: Date): DateRange {
  return {
    from: dateKey(startOfWeek(startOfMonth(month), { weekStartsOn: 0 })),
    to: dateKey(endOfWeek(endOfMonth(month), { weekStartsOn: 0 })),
  };
}

export interface CalendarRanges {
  /** What the view itself draws. */
  visible: DateRange;
  /** Monthly only: the selected day's month, when the grid does not hold it. */
  selected: DateRange | null;
  /** Previous and next — fetched ahead, never awaited. */
  neighbours: DateRange[];
}

export function calendarRanges(
  viewMode: CalendarViewMode,
  selectedDate: Date,
  displayMonth: Date,
): CalendarRanges {
  if (viewMode === "monthly") {
    const visible = monthGridRange(displayMonth);
    const day = dateKey(selectedDate);
    return {
      visible,
      selected: day < visible.from || day > visible.to ? monthGridRange(selectedDate) : null,
      neighbours: [monthGridRange(addMonths(displayMonth, -1)), monthGridRange(addMonths(displayMonth, 1))],
    };
  }
  return {
    visible: weekRange(selectedDate),
    selected: null,
    neighbours: [weekRange(addDays(selectedDate, -7)), weekRange(addDays(selectedDate, 7))],
  };
}

const EMPTY: EnrichedBooking[] = [];

export function useCalendarBookings(
  viewMode: CalendarViewMode,
  selectedDate: Date,
  displayMonth: Date,
): { bookings: EnrichedBooking[]; isLoading: boolean } {
  const { profile } = useProviderProfile();
  const providerId = profile?.id;
  const queryClient = useQueryClient();

  const selectedKey = dateKey(selectedDate);
  const monthKey = dateKey(displayMonth);
  const { visible, selected, neighbours } = useMemo(
    () => calendarRanges(viewMode, selectedDate, displayMonth),
    // The Date objects are re-created by their owners; the keys are the identity.
    [viewMode, selectedKey, monthKey], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const main = useProviderBookingsRange(visible.from, visible.to, { keepPrevious: true });
  const side = useProviderBookingsRange(selected?.from ?? null, selected?.to ?? null);

  // Prefetch only after the visible range is really on screen (not a kept
  // previous one), so the neighbours never compete with it for the connection.
  const visibleReady = main.isSuccess && !main.isPlaceholderData;
  const neighbourKey = neighbours.map((r) => `${r.from}:${r.to}`).join("|");
  useEffect(() => {
    if (!providerId || !visibleReady) return;
    for (const r of neighbours) {
      void queryClient.prefetchQuery(providerBookingsRangeOptions(providerId, r.from, r.to));
    }
  }, [queryClient, providerId, visibleReady, neighbourKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const mainData = main.data ?? EMPTY;
  const sideData = selected ? side.data ?? EMPTY : EMPTY;
  const bookings = useMemo(() => {
    if (sideData.length === 0) return mainData;
    // The two month grids share their edge weeks — keep each booking once.
    const seen = new Set(mainData.map((b) => b.id));
    return [...mainData, ...sideData.filter((b) => !seen.has(b.id))];
  }, [mainData, sideData]);

  return { bookings, isLoading: main.isLoading || (!!selected && side.isLoading) };
}
