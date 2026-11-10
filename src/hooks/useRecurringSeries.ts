import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchByDateWindow, PAGE_SIZE } from "@/lib/fetchAll";
import { toDateKeyString } from "@/lib/staffTimeOff";
import type { BusySlotRow, SlotOptions } from "@/hooks/useAllProviders";
import type { DayWindow } from "@/lib/availabilityResolver";
import {
  classifySeriesDate,
  SERIES_MAX_COUNT,
  seriesDateKey,
  summarizeSeriesCreate,
  weeklySeriesDates,
  type SeriesCreateResult,
  type SeriesCreateRow,
  type SeriesDateStatus,
} from "@/lib/recurringSeries";

// create_recurring_series is not in the generated types.ts yet (repo
// convention: cast until types are regenerated after apply).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

/**
 * Bookings and the chosen member's days off for exactly the series' date
 * range. The slot pipeline's own data stops at 60 days; a 12-week series ends
 * on day 77, so the preview reads its own range and hands it to the SAME
 * pipeline through SlotOptions — never a second implementation of the rules.
 *
 * Own query keys (not the pipeline's), so the customer-facing caches are
 * untouched. Not fetched until the provider turns "repeats" on.
 */
export function useSeriesRangeData(
  providerId: string | undefined,
  staffId: string | undefined,
  fromStr: string | undefined,
  toStr: string | undefined,
  enabled: boolean,
) {
  const on = enabled && !!providerId && !!fromStr && !!toStr;

  const bookingsQuery = useQuery({
    queryKey: ["recurring-series-busy", providerId, fromStr, toStr],
    enabled: on,
    staleTime: 30 * 1000,
    queryFn: () =>
      // Same RPC and the same 1000-row-safe paging as the pipeline itself.
      fetchByDateWindow<BusySlotRow>(fromStr!, toStr!, (from, to) =>
        supabase
          .rpc("get_provider_busy_slots", { p_provider_id: providerId!, p_from_date: from, p_to_date: to })
          .range(0, PAGE_SIZE - 1),
      ),
  });

  const timeOffQuery = useQuery({
    queryKey: ["recurring-series-staff-time-off", providerId, staffId, fromStr, toStr],
    enabled: on && !!staffId,
    staleTime: 30 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("provider_staff_blocked_dates")
        .select("blocked_date")
        .eq("provider_id", providerId!)
        .eq("staff_id", staffId!)
        .gte("blocked_date", fromStr!)
        .lte("blocked_date", toStr!);
      if (error) throw error;
      return data || [];
    },
  });

  const staffTimeOff = useMemo(
    () => new Set((timeOffQuery.data || []).map((r) => toDateKeyString(r.blocked_date))),
    [timeOffQuery.data],
  );

  return {
    bookings: bookingsQuery.data,
    staffTimeOff,
    isLoading: on && (bookingsQuery.isLoading || (!!staffId && timeOffQuery.isLoading)),
    isError: bookingsQuery.isError || timeOffQuery.isError,
  };
}

export interface SeriesPreviewDate {
  date: Date;
  /** "YYYY-MM-DD" */
  key: string;
  status: SeriesDateStatus;
}

/**
 * The provider's series preview: every weekly date from `firstDate`, with its
 * status at `time`. `getAvailableSlots` / `resolveDayWindows` MUST be the
 * caller's own useRealAvailability instance (same provider, same staff lane),
 * called with the same arguments the caller's slot grid uses — that is what
 * keeps the preview and the grid from ever disagreeing.
 */
export function useSeriesPreview(input: {
  enabled: boolean;
  providerId: string | undefined;
  staffId: string | undefined;
  serviceId: string | undefined;
  duration: number;
  capacity: number;
  time: string;
  firstDate: Date;
  count: number;
  getAvailableSlots: (
    date: Date,
    duration?: number,
    capacity?: number,
    serviceId?: string,
    latestStartTime?: string | null,
    options?: SlotOptions,
  ) => string[];
  resolveDayWindows: (
    date: Date,
    staffTimeOff?: ReadonlySet<string>,
  ) => { shop: DayWindow | null; narrowed: DayWindow | null };
}) {
  const dates = useMemo(
    () => (input.enabled ? weeklySeriesDates(input.firstDate, input.count) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [input.enabled, input.firstDate.getTime(), input.count],
  );
  // The range is ALWAYS the longest series (12 weeks), not the current count:
  // stepping the count then needs no refetch, and can never show a date judged
  // against a range that does not cover it.
  const fromStr = input.enabled ? seriesDateKey(input.firstDate) : undefined;
  const toStr = input.enabled
    ? seriesDateKey(weeklySeriesDates(input.firstDate, SERIES_MAX_COUNT)[SERIES_MAX_COUNT - 1])
    : undefined;

  const range = useSeriesRangeData(input.providerId, input.staffId, fromStr, toStr, input.enabled);

  const ready = input.enabled && !range.isLoading && !range.isError && !!range.bookings;

  const preview: SeriesPreviewDate[] = ready
    ? dates.map((date) => {
        const options: SlotOptions = { bookings: range.bookings, staffTimeOff: range.staffTimeOff };
        // Same four positional arguments as NewBookingSheet's own grid call.
        const slots = input.getAvailableSlots(date, input.duration, input.capacity, input.serviceId, undefined, options);
        const freeSlots = input.getAvailableSlots(date, input.duration, input.capacity, input.serviceId, undefined, {
          ...options,
          ignoreBookings: true,
        });
        const { shop, narrowed } = input.resolveDayWindows(date, range.staffTimeOff);
        return {
          date,
          key: seriesDateKey(date),
          status: classifySeriesDate({ time: input.time, slots, freeSlots, shop, narrowed }),
        };
      })
    : [];

  return {
    preview,
    availableKeys: preview.filter((p) => p.status === "available").map((p) => p.key),
    isLoading: input.enabled && range.isLoading,
    isError: input.enabled && range.isError,
  };
}

export interface CreateSeriesInput {
  providerId: string;
  serviceId: string;
  staffId: string | null;
  time: string;
  /** The dates the preview found available, "YYYY-MM-DD". */
  dates: string[];
  requestedCount: number;
  customerName: string;
  customerPhone: string;
  guestNotes: string | null;
  whatsappConsent: boolean;
}

/**
 * create_recurring_series. Resolves with a summary for every outcome the RPC
 * reports (OK, ALL_TAKEN and the refusal codes); rejects only on a transport
 * or database error. Callers map codes to translated copy — never raw text.
 */
export function useCreateRecurringSeries() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateSeriesInput): Promise<SeriesCreateResult> => {
      const { data, error } = await db.rpc("create_recurring_series", {
        p_provider_id: input.providerId,
        p_service_id: input.serviceId,
        p_staff_id: input.staffId,
        p_booking_time: input.time,
        p_dates: input.dates,
        p_requested_count: input.requestedCount,
        p_customer_name: input.customerName,
        p_customer_phone: input.customerPhone,
        p_guest_notes: input.guestNotes,
        p_whatsapp_consent: input.whatsappConsent,
      });
      if (error) throw error;
      return summarizeSeriesCreate((data || []) as SeriesCreateRow[]);
    },
    onSettled: (_data, _error, input) => {
      // Whatever happened, the slots on those days may have changed.
      queryClient.invalidateQueries({ queryKey: ["provider-bookings-enriched", input.providerId] });
      queryClient.invalidateQueries({ queryKey: ["provider-bookings-public", input.providerId] });
      queryClient.invalidateQueries({ queryKey: ["recurring-series-busy", input.providerId] });
    },
  });
}
