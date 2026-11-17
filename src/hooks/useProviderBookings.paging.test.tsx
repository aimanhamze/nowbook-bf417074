// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

/**
 * PostgREST silently truncates any response to its max-rows cap (1000 on
 * hosted Supabase). useProviderBookings used one unpaged select, so a provider
 * with more than 1000 bookings only ever saw the oldest 1000 — their upcoming
 * and pending bookings were cut off the calendar and the pending tab.
 *
 * The calendar now loads date RANGES instead of the whole history. The same
 * cap still applies to every one of those reads, and the things that used to
 * lean on the full list (pending, series numbering, the header numbers) each
 * have their own query — all covered below.
 */

const SERVER_MAX_ROWS = 1000;
type Row = Record<string, unknown>;
const state: {
  bookings: Row[];
  inCalls: Record<string, number>;
  requests: { table: string; columns: string }[];
} = { bookings: [], inCalls: {}, requests: [] };

// Minimal chainable stand-in for the supabase-js query builder: applies the
// filters the hooks use, records range and .in() calls, then resolves like
// PostgREST would, capped at max-rows.
function builder(table: string) {
  let range: [number, number] | null = null;
  let inIds: string[] | null = null;
  let columns = "*";
  const filters: ((row: Row) => boolean)[] = [];
  const q = {
    select: (cols: string) => {
      columns = cols;
      return q;
    },
    eq: (col: string, val: unknown) => {
      filters.push((r) => r[col] === val);
      return q;
    },
    gte: (col: string, val: string) => {
      filters.push((r) => (r[col] as string) >= val);
      return q;
    },
    lte: (col: string, val: string) => {
      filters.push((r) => (r[col] as string) <= val);
      return q;
    },
    order: () => q,
    in: (col: string, ids: string[]) => {
      if (table === "bookings") {
        filters.push((r) => ids.includes(r[col] as string));
      } else {
        inIds = ids;
      }
      if (col !== "status") state.inCalls[table] = (state.inCalls[table] ?? 0) + 1;
      return q;
    },
    range: (from: number, to: number) => {
      range = [from, to];
      return q;
    },
    then: (resolve: (r: { data: unknown[]; error: null }) => unknown) => {
      state.requests.push({ table, columns });
      let rows: unknown[] = [];
      if (table === "bookings") {
        const matching = state.bookings.filter((b) => filters.every((f) => f(b)));
        rows = range ? matching.slice(range[0], range[1] + 1) : matching;
      } else if (table === "profiles") {
        rows = (inIds ?? []).map((id) => ({ user_id: id, display_name: `name-${id}`, phone: null, avatar_url: null }));
      }
      return Promise.resolve({ data: rows.slice(0, SERVER_MAX_ROWS), error: null }).then(resolve);
    },
  };
  return q;
}

vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: (t: string) => builder(t) } }));
vi.mock("@/integrations/supabase/packageTypes", () => ({ pkgFrom: (t: string) => builder(t) }));
vi.mock("@/hooks/useProviderProfile", () => ({ useProviderProfile: () => ({ profile: { id: "pp" } }) }));
vi.mock("@/lib/whatsappConfirm", () => ({
  notifyBookingConfirmed: vi.fn(),
  notifyBookingCancelled: vi.fn(),
  notifyBookingsCancelled: vi.fn(),
}));

const {
  useProviderBookingsRange,
  useProviderBookingsAhead,
  useProviderBookingsHistory,
  useProviderPendingBookings,
  usePendingCount,
} = await import("./useProviderBookings");
const { seriesPositions, seriesCancelCounts } = await import("@/lib/recurringSeries");

const row = (i: number, over: Row = {}): Row => ({
  id: `b-${String(i).padStart(5, "0")}`,
  user_id: `u-${i}`,
  provider_id: "pp",
  service_ids: [],
  booking_date: "2026-10-15",
  booking_time: "18:00",
  total_price: 0,
  status: i === 1499 ? "pending" : "confirmed",
  class_schedule_id: null,
  staff_id: null,
  customer_name: null,
  customer_phone: null,
  ...over,
});

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {children}
  </QueryClientProvider>
);

beforeEach(() => {
  state.inCalls = {};
  state.requests = [];
});

describe("useProviderBookingsRange — row cap", () => {
  it("returns every booking of a range past the 1000-row cap, including the newest pending one", async () => {
    state.bookings = Array.from({ length: 1500 }, (_, i) => row(i));
    const { result } = renderHook(() => useProviderBookingsRange("2026-10-01", "2026-10-31"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1500);
    expect(result.current.data!.filter((b) => b.status === "pending")).toHaveLength(1);
  });

  it("stops after one request when the range holds a single short page", async () => {
    state.bookings = Array.from({ length: 3 }, (_, i) => row(i));
    const { result } = renderHook(() => useProviderBookingsRange("2026-10-01", "2026-10-31"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(3);
    expect(state.requests.filter((r) => r.table === "bookings")).toHaveLength(1);
  });

  it("resolves every customer's name when there are hundreds of customers", async () => {
    state.bookings = Array.from({ length: 1500 }, (_, i) => row(i));
    const { result } = renderHook(() => useProviderBookingsRange("2026-10-01", "2026-10-31"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data!.every((b) => b.customer_name === `name-${b.user_id}`)).toBe(true);
    expect(state.inCalls.profiles).toBeGreaterThan(1);
  });
});

describe("useProviderBookingsRange — only the range", () => {
  it("loads the inclusive range and nothing outside it, cancelled bookings included", async () => {
    state.bookings = [
      row(1, { booking_date: "2026-09-30" }),
      row(2, { booking_date: "2026-10-01" }),
      row(3, { booking_date: "2026-10-17", status: "cancelled" }),
      row(4, { booking_date: "2026-10-31" }),
      row(5, { booking_date: "2026-11-01" }),
    ];
    const { result } = renderHook(() => useProviderBookingsRange("2026-10-01", "2026-10-31"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data!.map((b) => b.id)).toEqual(["b-00002", "b-00003", "b-00004"]);
    // Only the three customers in range are looked up.
    expect(state.inCalls.profiles).toBe(1);
  });

  it("fetches nothing while a bound is missing", async () => {
    state.bookings = [row(1)];
    const { result } = renderHook(() => useProviderBookingsRange(null, null), { wrapper });
    await new Promise((r) => setTimeout(r, 20));
    expect(result.current.fetchStatus).toBe("idle");
    expect(state.requests).toHaveLength(0);
  });
});

describe("series — the whole series, whatever range is loaded", () => {
  // A 5-week series from 20 Oct; the 2nd was cancelled. Only November is loaded.
  const series = [
    row(10, { series_id: "s1", booking_date: "2026-10-20", booking_time: "10:00" }),
    row(11, { series_id: "s1", booking_date: "2026-10-27", booking_time: "10:00", status: "cancelled" }),
    row(12, { series_id: "s1", booking_date: "2026-11-03", booking_time: "10:00" }),
    row(13, { series_id: "s1", booking_date: "2026-11-10", booking_time: "10:00" }),
    row(14, { series_id: "s1", booking_date: "2026-12-01", booking_time: "10:00" }),
  ];

  it("numbers a booking against its full series — earlier, later and cancelled members counted", async () => {
    state.bookings = [...series, row(20, { booking_date: "2026-11-05" })];
    const { result } = renderHook(() => useProviderBookingsRange("2026-11-01", "2026-11-30"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const loaded = result.current.data!;
    expect(loaded.map((b) => b.id)).toEqual(["b-00012", "b-00020", "b-00013"].sort());

    const third = loaded.find((b) => b.id === "b-00012")!;
    expect(third.series_members).toHaveLength(5);
    expect(seriesPositions(third.series_members!).get(third.id)).toEqual({ index: 3, total: 5 });
    const fourth = loaded.find((b) => b.id === "b-00013")!;
    expect(seriesPositions(fourth.series_members!).get(fourth.id)).toEqual({ index: 4, total: 5 });
    // One shared array per series, so the positions map is built once.
    expect(fourth.series_members).toBe(third.series_members);

    const oneOff = loaded.find((b) => b.id === "b-00020")!;
    expect(oneOff.series_id).toBeNull();
    expect(oneOff.series_members).toBeNull();
  });

  it("the cancel dialog counts upcoming members beyond the loaded range", async () => {
    state.bookings = series;
    const { result } = renderHook(() => useProviderBookingsRange("2026-11-01", "2026-11-30"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const third = result.current.data!.find((b) => b.id === "b-00012")!;
    // "Now" is 1 Nov: 3 Nov, 10 Nov and 1 Dec are upcoming; 27 Oct is cancelled.
    expect(seriesCancelCounts(third.series_members!, third, new Date(2026, 10, 1, 9, 0))).toEqual({
      fromHere: 3,
      allUpcoming: 3,
    });
    const fourth = result.current.data!.find((b) => b.id === "b-00013")!;
    expect(seriesCancelCounts(fourth.series_members!, fourth, new Date(2026, 10, 1, 9, 0))).toEqual({
      fromHere: 2,
      allUpcoming: 3,
    });
  });

  it("issues no series request when the range has no series booking", async () => {
    state.bookings = [row(1)];
    const { result } = renderHook(() => useProviderBookingsRange("2026-10-01", "2026-10-31"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(state.requests.filter((r) => r.table === "bookings")).toHaveLength(1);
  });
});

describe("useProviderBookingsAhead — the header numbers", () => {
  it("returns confirmed and pending bookings from today onward, past the row cap, cancelled excluded", async () => {
    state.bookings = [
      row(1, { booking_date: "2026-11-16" }),
      row(2, { booking_date: "2026-11-17" }),
      row(3, { booking_date: "2026-11-17", status: "pending" }),
      row(4, { booking_date: "2026-11-17", status: "cancelled" }),
      ...Array.from({ length: 1200 }, (_, i) => row(100 + i, { booking_date: "2027-03-01" })),
    ];
    const { result } = renderHook(() => useProviderBookingsAhead("2026-11-17"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const ahead = result.current.data!;
    expect(ahead.filter((b) => b.booking_date === "2026-11-17")).toHaveLength(2);
    expect(ahead.filter((b) => b.booking_date > "2026-11-17")).toHaveLength(1200);
    // Narrow columns, and no enrichment lookups at all.
    expect(state.requests.every((r) => r.table === "bookings" && r.columns !== "*")).toBe(true);
  });
});

describe("pending bookings — their own query", () => {
  it("returns only the pending bookings, enriched, without the rest of the history", async () => {
    state.bookings = Array.from({ length: 1500 }, (_, i) => row(i));
    const { result } = renderHook(() => useProviderPendingBookings(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data!.map((b) => b.id)).toEqual(["b-01499"]);
    expect(result.current.data![0].customer_name).toBe("name-u-1499");
    // One customer to name → one profiles request, not one per 100 of 1,500.
    expect(state.inCalls.profiles).toBe(1);
  });

  it("usePendingCount is the length of that list", async () => {
    state.bookings = Array.from({ length: 1500 }, (_, i) => row(i));
    const { result } = renderHook(() => usePendingCount(), { wrapper });
    await waitFor(() => expect(result.current).toBe(1));
  });
});

describe("useProviderBookingsHistory — statistics and the monthly report", () => {
  it("returns the whole history past the row cap, narrow columns, no lookups", async () => {
    state.bookings = Array.from({ length: 1500 }, (_, i) =>
      row(i, { booking_date: i < 750 ? "2025-03-01" : "2026-10-15", status: i % 3 === 0 ? "cancelled" : "confirmed" }),
    );
    const { result } = renderHook(() => useProviderBookingsHistory(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1500);
    expect(result.current.data!.filter((b) => b.status === "cancelled")).toHaveLength(500);
    expect(state.requests.every((r) => r.table === "bookings" && r.columns !== "*")).toBe(true);
    // Every field lib/providerStats reads is requested.
    for (const col of ["id", "user_id", "linked_user_id", "customer_phone", "booking_date", "booking_time", "total_price", "status", "service_ids", "created_at"]) {
      expect(state.requests[0].columns.split(", ")).toContain(col);
    }
  });
});
