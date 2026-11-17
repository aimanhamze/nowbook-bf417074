import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { useProviderProfile } from "./useProviderProfile";
import { pkgFrom, type CustomerPackageRow } from "@/integrations/supabase/packageTypes";
import type { ClassScheduleEntry } from "./useProviderClassSchedule";
import { fetchAllPages, inBatches } from "@/lib/fetchAll";
import { BOOKINGS_KEY, BOOKINGS_STALE_MS, HISTORY_STALE_MS } from "@/lib/providerBookingsKey";
import {
  notifyBookingConfirmed,
  notifyBookingCancelled,
  notifyBookingsCancelled,
} from "@/lib/whatsappConfirm";

export interface EnrichedBooking {
  id: string;
  user_id: string | null;
  provider_id: string;
  service_ids: string[];
  booking_date: string;
  booking_time: string;
  total_price: number;
  status: string;
  treatment_notes: string | null;
  customer_notes: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  customer_avatar: string | null;
  service_names: string[];
  is_group_service: boolean;
  service_capacity: number;
  class_schedule_id: string | null;
  class_name: string | null;
  /**
   * The full schedule row this class booking points at, read WITHOUT the
   * is_active filter. The calendar uses it to still draw a class card for a
   * booking whose class was since deactivated or moved to another weekday —
   * without it such bookings matched no active slot and vanished.
   */
  class_entry: ClassScheduleEntry | null;
  // Multi-staff (Phase 6): which staff member serves this booking. NULL for
  // non-staff providers, group/class bookings, and everything pre-staff.
  staff_id: string | null;
  staff_name: string | null;
  /**
   * Per-booking length in minutes, overriding the sum of the booked services'
   * `duration`. NULL = use the service default. Never read this directly —
   * go through `lib/bookingDuration`, which applies the same precedence the
   * conflict trigger does.
   *
   * Provider-writable only: `enforce_duration_override_permission()` rejects a
   * write from anyone who is not this booking's provider.
   */
  duration_override: number | null;
  /**
   * Arrival timestamp. NULL until the provider (or the customer) checks in.
   *
   * Deliberately separate from `status` — see the migration comment on the
   * column. Its one behavioural effect is on refunds: once set,
   * handle_package_cancellation() stops returning the entry automatically, so
   * a later cancellation needs the provider's explicit "return entry".
   */
  check_in_at: string | null;
  /** The package paying for this booking. NULL = booked and paid normally. */
  customer_package_id: string | null;
  /** Resolved from customer_packages — null when no package is attached. */
  package_name: string | null;
  package_entries_remaining: number | null;
  package_total_entries: number | null;
  /** The recurring series this booking belongs to. NULL = a one-off booking. */
  series_id: string | null;
  /**
   * EVERY booking of this booking's series — cancelled ones and ones far
   * outside the loaded date range included — or null for a one-off booking.
   * Fetched by series_id, not taken from the loaded range: "3 מתוך 5" and the
   * cancel dialog's counts need the whole series, which a month never holds.
   * One array instance is shared by all of a series' bookings in a fetch.
   */
  series_members: SeriesMemberRow[] | null;
}

/** The fields the series helpers (lib/recurringSeries) read. */
export interface SeriesMemberRow {
  id: string;
  series_id: string;
  booking_date: string;
  booking_time: string;
  status: string;
}

const BOOKING_STATUSES = ["confirmed", "pending", "cancelled"];

/**
 * The bookings columns the calendar and the pending tab read — and no others.
 *
 * select("*") also shipped provider_id (the same value on every row),
 * created_at, updated_at, linked_user_id, guest_notes and whatsapp_consent,
 * which no card reads; that was about a third of every row. EnrichedBooking
 * declares exactly what is listed here, so a card that starts reading another
 * column fails to compile instead of silently getting undefined: ADD THE
 * COLUMN HERE AND TO BookingRow / EnrichedBooking TOGETHER.
 *
 * linked_user_id and created_at are still read by the statistics — from
 * useProviderBookingsHistory, which has its own list.
 */
const BOOKING_COLUMNS =
  "id, user_id, service_ids, booking_date, booking_time, total_price, status, " +
  "treatment_notes, customer_notes, customer_name, customer_phone, class_schedule_id, " +
  "staff_id, duration_override, check_in_at, customer_package_id, series_id";

/** One row of BOOKING_COLUMNS. */
type BookingRow = Pick<
  Tables<"bookings">,
  | "id" | "user_id" | "service_ids" | "booking_date" | "booking_time" | "total_price" | "status"
  | "treatment_notes" | "customer_notes" | "customer_name" | "customer_phone" | "class_schedule_id"
  | "staff_id" | "duration_override" | "check_in_at" | "customer_package_id"
> & {
  // Not in the generated types until they are regenerated.
  series_id: string | null;
};

// series_id makes the typed builder reject the column list, so the two
// card-feeding reads below go through an untyped one; BookingRow is their type.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const untyped = supabase as any;

// Every read below is paged (see lib/fetchAll): a single unpaged select
// returned only a busy provider's OLDEST 1000 bookings, so their current and
// upcoming bookings — every pending one included — never reached the calendar
// or the pending tab.

/** One date range of the branch's bookings, inclusive "yyyy-MM-dd" bounds. */
function fetchProviderBookingsInRange(
  providerId: string,
  from: string,
  to: string,
): Promise<BookingRow[]> {
  return fetchAllPages<BookingRow>((pageFrom, pageTo) =>
    untyped
      .from("bookings")
      .select(BOOKING_COLUMNS)
      .eq("provider_id", providerId)
      .in("status", BOOKING_STATUSES)
      .gte("booking_date", from)
      .lte("booking_date", to)
      .order("booking_date", { ascending: true })
      .order("id", { ascending: true })
      .range(pageFrom, pageTo),
  );
}

/**
 * Series per request. A series holds at most 12 bookings (weeklySeriesDates
 * clamps it), so 50 series stay well under PostgREST's silent 1000-row cap.
 */
const SERIES_BATCH = 50;

/**
 * All bookings of the given series. bookings.series_id is not in the generated
 * types until they are regenerated, hence the untyped builder — scoped to this
 * one read.
 */
function fetchSeriesMembers(providerId: string, seriesIds: string[]): Promise<SeriesMemberRow[]> {
  return inBatches<SeriesMemberRow>(
    seriesIds,
    (batch) =>
      untyped
        .from("bookings")
        .select("id, series_id, booking_date, booking_time, status")
        .eq("provider_id", providerId)
        .in("status", BOOKING_STATUSES)
        .in("series_id", batch),
    SERIES_BATCH,
  );
}

/** Every pending booking of the branch, whatever its date. A handful of rows. */
function fetchPendingProviderBookings(providerId: string): Promise<BookingRow[]> {
  return fetchAllPages<BookingRow>((from, to) =>
    untyped
      .from("bookings")
      .select(BOOKING_COLUMNS)
      .eq("provider_id", providerId)
      .eq("status", "pending")
      .order("booking_date", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to),
  );
}

/**
 * Resolve everything a booking card shows that is not on the row itself:
 * customer, service, class, staff and package. The lookups are independent of
 * each other, so they are sent TOGETHER — in sequence they were most of the
 * calendar's load time.
 */
async function enrichBookings(
  providerId: string,
  bookings: BookingRow[],
): Promise<EnrichedBooking[]> {
  if (bookings.length === 0) return [];

  // Walk-in bookings have user_id IS NULL — exclude those from the profiles lookup.
  const userIds = [...new Set(bookings.map((b) => b.user_id).filter(Boolean))] as string[];
  // Deliberately NOT filtered to is_active: a booking keeps its class after the
  // class is deactivated or edited, and must stay visible on the calendar.
  const classIds = [...new Set(bookings.map((b) => b.class_schedule_id).filter(Boolean))] as string[];
  // Deliberately NOT filtered to is_active: a deactivated staff member must
  // still be named on their past/existing bookings. Non-staff providers have
  // staff_id NULL on every row → no query fired.
  const staffIds = [...new Set(bookings.map((b) => b.staff_id).filter(Boolean))] as string[];
  const packageIds = [
    ...new Set(bookings.map((b) => b.customer_package_id).filter(Boolean)),
  ] as string[];
  const seriesIds = [...new Set(bookings.map((b) => b.series_id).filter(Boolean))] as string[];

  // Package balances for the badge on each booking card. The template names
  // depend on the packages, so those two stay in sequence with each other.
  const loadPackages = async () => {
    const packages = await inBatches<Pick<
      CustomerPackageRow, "id" | "entries_remaining" | "total_entries" | "template_id"
    >>(packageIds, (batch) =>
      pkgFrom("customer_packages")
        .select("id, entries_remaining, total_entries, template_id")
        .in("id", batch),
    );
    const { data: pkgTemplateRows } = packages.length > 0
      ? await pkgFrom("package_templates")
          .select("id, name")
          .in("id", [...new Set(packages.map((p) => p.template_id))])
      : { data: [] };
    return { packages, pkgTemplateRows };
  };

  const [profiles, { data: services }, classRows, { data: staffRows }, { packages, pkgTemplateRows }, seriesRows] =
    await Promise.all([
      inBatches<{
        user_id: string; display_name: string | null; phone: string | null; avatar_url: string | null;
      }>(userIds, (batch) =>
        supabase.from("profiles").select("user_id, display_name, phone, avatar_url").in("user_id", batch),
      ),
      supabase
        .from("provider_services")
        .select("id, name, service_type, max_capacity")
        .eq("provider_id", providerId),
      inBatches<ClassScheduleEntry>(classIds, (batch) =>
        supabase.from("provider_class_schedule").select("*").in("id", batch),
      ),
      staffIds.length > 0
        ? supabase.from("provider_staff").select("id, name").in("id", staffIds)
        : Promise.resolve({ data: [] as { id: string; name: string }[] }),
      loadPackages(),
      fetchSeriesMembers(providerId, seriesIds),
    ]);

  const profileMap = new Map(profiles.map((p) => [p.user_id, p]));
  const serviceMap = new Map((services || []).map((s) => [s.id, s]));
  const classMap = new Map(classRows.map((c) => [c.id, c]));
  const staffMap = new Map((staffRows || []).map((s) => [s.id, s.name as string]));
  const pkgTemplateMap = new Map(
    ((pkgTemplateRows ?? []) as unknown as { id: string; name: string }[])
      .map((tpl) => [tpl.id, tpl.name]),
  );
  const packageMap = new Map(packages.map((p) => [p.id, p]));
  const seriesMap = new Map<string, SeriesMemberRow[]>();
  for (const row of seriesRows) {
    const list = seriesMap.get(row.series_id);
    if (list) list.push(row);
    else seriesMap.set(row.series_id, [row]);
  }

  return bookings.map((b): EnrichedBooking => {
    // Walk-in: user_id is null → profileMap lookup is skipped (no account).
    const customer = b.user_id ? profileMap.get(b.user_id) : undefined;
    const primaryService = serviceMap.get(b.service_ids?.[0]);
    // Walk-in bookings store the customer's details on the row; app bookings
    // leave these NULL and resolve via the profiles join above.
    return {
      ...b,
      // Not selected — it is the branch the query was filtered to.
      provider_id: providerId,
      treatment_notes: b.treatment_notes ?? null,
      customer_notes: b.customer_notes ?? null,
      customer_name: b.customer_name || customer?.display_name || null,
      customer_phone: b.customer_phone || customer?.phone || null,
      customer_avatar: customer?.avatar_url || null,
      service_names: (b.service_ids || []).map((id) => serviceMap.get(id)?.name || id),
      is_group_service: primaryService?.service_type === 'group',
      service_capacity: primaryService?.max_capacity ?? 1,
      class_schedule_id: b.class_schedule_id ?? null,
      class_name: b.class_schedule_id ? (classMap.get(b.class_schedule_id)?.class_name ?? null) : null,
      class_entry: b.class_schedule_id ? (classMap.get(b.class_schedule_id) ?? null) : null,
      staff_id: b.staff_id ?? null,
      staff_name: b.staff_id ? (staffMap.get(b.staff_id) ?? null) : null,
      duration_override: b.duration_override ?? null,
      check_in_at: b.check_in_at ?? null,
      customer_package_id: b.customer_package_id ?? null,
      package_name: b.customer_package_id
        ? (pkgTemplateMap.get(
            packageMap.get(b.customer_package_id)?.template_id ?? "",
          ) ?? null)
        : null,
      package_entries_remaining: b.customer_package_id
        ? (packageMap.get(b.customer_package_id)?.entries_remaining ?? null)
        : null,
      package_total_entries: b.customer_package_id
        ? (packageMap.get(b.customer_package_id)?.total_entries ?? null)
        : null,
      series_id: b.series_id ?? null,
      series_members: b.series_id ? (seriesMap.get(b.series_id) ?? null) : null,
    };
  });
}

/**
 * A booking as the statistics need it — lib/providerStats' StatsBooking and
 * nothing more. No customer names, notes or enrichment.
 */
export interface HistoryBooking {
  id: string;
  user_id: string | null;
  linked_user_id: string | null;
  customer_phone: string | null;
  booking_date: string;
  booking_time: string;
  total_price: number;
  status: string;
  service_ids: string[];
  created_at: string;
}

/**
 * The active branch's FULL booking history, narrow columns only — for the
 * Statistics page and the monthly report, whose numbers genuinely need all of
 * it (new vs returning is decided by each customer's first-ever booking;
 * "upcoming" revenue is every future booking). Feeds the same
 * computeProviderStats as before, so the numbers are computed by the same code
 * from the same rows.
 *
 * NOT polled and not mounted anywhere else: it refetches when a booking
 * mutation invalidates it, or when a screen that needs it opens after the
 * data has gone stale.
 */
export function useProviderBookingsHistory() {
  const { profile } = useProviderProfile();

  return useQuery({
    queryKey: [BOOKINGS_KEY, profile?.id, "history"],
    queryFn: async (): Promise<HistoryBooking[]> => {
      if (!profile) return [];
      return fetchAllPages((from, to) =>
        supabase
          .from("bookings")
          .select(
            "id, user_id, linked_user_id, customer_phone, booking_date, booking_time, total_price, status, service_ids, created_at",
          )
          .eq("provider_id", profile.id)
          .in("status", BOOKING_STATUSES)
          .order("booking_date", { ascending: true })
          .order("id", { ascending: true })
          .range(from, to),
      );
    },
    enabled: !!profile,
    staleTime: HISTORY_STALE_MS,
  });
}

/** Query options for one date range — shared by the hook and by prefetching. */
export function providerBookingsRangeOptions(providerId: string, from: string, to: string) {
  return {
    queryKey: [BOOKINGS_KEY, providerId, "range", from, to] as const,
    queryFn: async () =>
      enrichBookings(providerId, await fetchProviderBookingsInRange(providerId, from, to)),
    staleTime: BOOKINGS_STALE_MS,
  };
}

/**
 * The active branch's bookings between two inclusive "yyyy-MM-dd" dates,
 * every status (cancelled included — the calendar shows them).
 *
 * `poll` keeps the range fresh every 30s while it is on screen. `enabled:
 * false` (or a null bound) fetches nothing.
 */
export function useProviderBookingsRange(
  from: string | null,
  to: string | null,
  {
    poll = true,
    enabled = true,
    keepPrevious = false,
  }: { poll?: boolean; enabled?: boolean; keepPrevious?: boolean } = {},
) {
  const { profile } = useProviderProfile();
  const providerId = profile?.id ?? "";
  const on = !!profile && !!from && !!to && enabled;

  return useQuery({
    ...providerBookingsRangeOptions(providerId, from ?? "", to ?? ""),
    enabled: on,
    refetchInterval: poll ? 30000 : false,
    // keepPrevious: while a range that is not cached yet loads, keep showing
    // the previous one so the screen stays mounted mid-navigation. Never
    // across branches — another branch's bookings must not appear, even for
    // a moment.
    placeholderData: keepPrevious
      ? (previous: EnrichedBooking[] | undefined, previousQuery: { queryKey: readonly unknown[] } | undefined) =>
          previousQuery?.queryKey[1] === providerId ? previous : undefined
      : undefined,
  });
}

/** What the calendar's header numbers need from a booking — nothing else. */
export interface AheadBooking {
  id: string;
  booking_date: string;
  status: string;
  total_price: number;
  staff_id: string | null;
}

/**
 * Every confirmed / pending booking from `todayStr` onward, a few narrow
 * columns each. Feeds the calendar header ("today", "upcoming", today's
 * revenue), which counts ALL future bookings — more than any one visible
 * range holds. `todayStr` is a LOCAL "yyyy-MM-dd".
 */
export function useProviderBookingsAhead(todayStr: string) {
  const { profile } = useProviderProfile();

  return useQuery({
    queryKey: [BOOKINGS_KEY, profile?.id, "ahead", todayStr],
    queryFn: async (): Promise<AheadBooking[]> => {
      if (!profile) return [];
      return fetchAllPages((from, to) =>
        supabase
          .from("bookings")
          .select("id, booking_date, status, total_price, staff_id")
          .eq("provider_id", profile.id)
          .in("status", ["confirmed", "pending"])
          .gte("booking_date", todayStr)
          .order("booking_date", { ascending: true })
          .order("id", { ascending: true })
          .range(from, to),
      );
    },
    enabled: !!profile,
    staleTime: BOOKINGS_STALE_MS,
    refetchInterval: 30000,
  });
}

/**
 * The active branch's pending bookings — the pending tab's list and the source
 * of every pending badge. Its own small query, so the badge in the bottom nav
 * (mounted on every provider page) no longer costs the whole booking history.
 */
export function useProviderPendingBookings() {
  const { profile } = useProviderProfile();

  return useQuery({
    queryKey: [BOOKINGS_KEY, profile?.id, "pending"],
    queryFn: async () => {
      if (!profile) return [];
      return enrichBookings(profile.id, await fetchPendingProviderBookings(profile.id));
    },
    enabled: !!profile,
    staleTime: BOOKINGS_STALE_MS,
    refetchInterval: 30000,
  });
}

export function usePendingCount() {
  const { data: pending = [] } = useProviderPendingBookings();
  return pending.length;
}

export function useCancelBooking() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (bookingId: string) => {
      const { data: booking } = await supabase
        .from("bookings")
        .select("user_id, booking_date, booking_time, provider_id")
        .eq("id", bookingId)
        .single();

      const { error } = await supabase
        .from("bookings")
        .update({ status: "cancelled" })
        .eq("id", bookingId);
      if (error) throw error;

      // PROVIDER-initiated cancellation — the customer does not know yet, so
      // tell them. Fire-and-forget: never awaited, so a messaging failure cannot
      // block or fail the cancellation the provider just performed.
      notifyBookingCancelled(bookingId);

      if (booking) {
        const { data: provider } = await supabase
          .from("provider_profiles")
          .select("business_name")
          .eq("id", booking.provider_id)
          .single();

        await supabase.from("notifications").insert({
          user_id: booking.user_id,
          title: "התור בוטל ❌",
          body: `התור ב-${provider?.business_name || "העסק"} בתאריך ${booking.booking_date} בשעה ${booking.booking_time} בוטל על ידי הספק`,
          url: "/bookings",
          type: "booking_cancelled",
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["provider-bookings-enriched"] });
    },
  });
}

export function useCancelGroupClass() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (bookingIds: string[]) => {
      // Fetch all participant data before cancelling
      const { data: allBookings } = await supabase
        .from("bookings")
        .select("user_id, booking_date, booking_time, provider_id")
        .in("id", bookingIds);

      const { error } = await supabase
        .from("bookings")
        .update({ status: "cancelled" })
        .in("id", bookingIds);
      if (error) throw error;

      // Every participant needs telling. notifyBookingsCancelled paces the sends
      // ONE AT A TIME in a detached chain, so a single tap cancelling a whole
      // class never fires N concurrent SendPulse calls, and never delays this
      // mutation. A plain loop here would not serialise anything.
      notifyBookingsCancelled(bookingIds);

      if (allBookings?.length) {
        const first = allBookings[0];
        const { data: provider } = await supabase
          .from("provider_profiles")
          .select("business_name")
          .eq("id", first.provider_id)
          .single();

        await supabase.from("notifications").insert(
          allBookings.map(b => ({
            user_id: b.user_id,
            title: "השיעור בוטל ❌",
            body: `השיעור ב-${provider?.business_name || "העסק"} בתאריך ${first.booking_date} בשעה ${first.booking_time} בוטל`,
            url: "/bookings",
            type: "booking_cancelled",
          }))
        );
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["provider-bookings-enriched"] });
    },
  });
}

export function useDeleteBooking() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (bookingId: string) => {
      const { error } = await supabase
        .from("bookings")
        .delete()
        .eq("id", bookingId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["provider-bookings-enriched"] });
    },
  });
}

export function useApproveBooking() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (bookingId: string) => {
      const { data: booking } = await supabase
        .from("bookings")
        .select("user_id, booking_date, booking_time, provider_id")
        .eq("id", bookingId)
        .single();

      const { error } = await supabase
        .from("bookings")
        .update({ status: "confirmed" })
        .eq("id", bookingId);
      if (error) {
        console.error("Approve booking error:", error);
        throw error;
      }

      // The booking is now confirmed. Fire the WhatsApp confirmation as a side
      // effect — never awaited, so SendPulse being slow or down cannot delay or
      // fail the approval the provider just performed.
      notifyBookingConfirmed(bookingId);

      if (booking) {
        const { data: provider } = await supabase
          .from("provider_profiles")
          .select("business_name")
          .eq("id", booking.provider_id)
          .single();

        await supabase.from("notifications").insert({
          user_id: booking.user_id,
          title: "התור שלך אושר! 📅",
          body: `התור ב-${provider?.business_name || "העסק"} בתאריך ${booking.booking_date} בשעה ${booking.booking_time} אושר`,
          url: "/bookings",
          type: "booking_confirmed",
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["provider-bookings-enriched"] });
    },
  });
}

export function useRejectBooking() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (bookingId: string) => {
      const { data: booking } = await supabase
        .from("bookings")
        .select("user_id, booking_date, booking_time, provider_id")
        .eq("id", bookingId)
        .single();

      const { error } = await supabase
        .from("bookings")
        .update({ status: "cancelled" })
        .eq("id", bookingId);
      if (error) {
        console.error("Reject booking error:", error);
        throw error;
      }

      if (booking) {
        const { data: provider } = await supabase
          .from("provider_profiles")
          .select("business_name")
          .eq("id", booking.provider_id)
          .single();

        await supabase.from("notifications").insert({
          user_id: booking.user_id,
          title: "התור שלך נדחה ❌",
          body: `הבקשה ב-${provider?.business_name || "העסק"} לתאריך ${booking.booking_date} נדחתה. ניתן לקבוע תור חדש`,
          url: "/bookings",
          type: "booking_cancelled",
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["provider-bookings-enriched"] });
    },
  });
}

export function useRescheduleBooking() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ bookingId, newDate, newTime }: { bookingId: string; newDate: string; newTime: string }) => {
      const { data: booking } = await supabase
        .from("bookings")
        .select("user_id, provider_id")
        .eq("id", bookingId)
        .single();

      // Move the booking — only the timing changes. Status is deliberately left
      // untouched: reschedule is offered on confirmed bookings only, so this
      // keeps them confirmed (per spec) and never alters a booking's state. The
      // prevent_booking_conflicts trigger validates the new slot and raises on
      // overlap (surfaced to the caller as a "slot taken" error).
      const { error } = await supabase
        .from("bookings")
        .update({ booking_date: newDate, booking_time: newTime })
        .eq("id", bookingId);
      if (error) throw error;

      // Notify the customer. Walk-in bookings (user_id NULL) have no account to
      // notify — skip, exactly like the walk-in create flow.
      if (booking?.user_id) {
        const { data: provider } = await supabase
          .from("provider_profiles")
          .select("business_name")
          .eq("id", booking.provider_id)
          .single();

        await supabase.from("notifications").insert({
          user_id: booking.user_id,
          title: "התור שלך שונה! 📅",
          body: `התור ב-${provider?.business_name || "העסק"} שונה. התאריך החדש: ${newDate} בשעה ${newTime}`,
          url: "/bookings",
          type: "booking_confirmed",
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["provider-bookings-enriched"] });
      queryClient.invalidateQueries({ queryKey: ["provider-bookings-public"] });
    },
  });
}

/**
 * Set (or clear, with `null`) a booking's custom length.
 *
 * Writing this column re-runs the conflict trigger — `duration_override` is in
 * trg_prevent_booking_conflicts' UPDATE OF list — so stretching a booking over
 * a neighbour is rejected by the DB with the usual "selected time is no longer
 * available" error rather than silently double-booking. Surface that error to
 * the provider; do not retry.
 *
 * Invalidates the public slot cache too: a changed length moves which slots the
 * CUSTOMER is offered, not just what the provider's timeline draws.
 */
export function useSetDurationOverride() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ bookingId, minutes }: { bookingId: string; minutes: number | null }) => {
      const { error } = await supabase
        .from("bookings")
        .update({ duration_override: minutes })
        .eq("id", bookingId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["provider-bookings-enriched"] });
      queryClient.invalidateQueries({ queryKey: ["provider-bookings-public"] });
    },
  });
}

export function useSaveTreatmentNote() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ bookingId, note }: { bookingId: string; note: string }) => {
      const { error } = await supabase
        .from("bookings")
        .update({ treatment_notes: note })
        .eq("id", bookingId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["provider-bookings-enriched"] });
    },
  });
}
