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
 */

const SERVER_MAX_ROWS = 1000;
const state: { bookings: Record<string, unknown>[]; inCalls: Record<string, number> } = {
  bookings: [],
  inCalls: {},
};

// Minimal chainable stand-in for the supabase-js query builder: records range
// and .in() calls, then resolves like PostgREST would, capped at max-rows.
function builder(table: string) {
  let range: [number, number] | null = null;
  let inIds: string[] | null = null;
  const q = {
    select: () => q,
    eq: () => q,
    order: () => q,
    in: (col: string, ids: string[]) => {
      if (col !== "status") {
        inIds = ids;
        state.inCalls[table] = (state.inCalls[table] ?? 0) + 1;
      }
      return q;
    },
    range: (from: number, to: number) => {
      range = [from, to];
      return q;
    },
    then: (resolve: (r: { data: unknown[]; error: null }) => unknown) => {
      let rows: unknown[] = [];
      if (table === "bookings") {
        rows = range ? state.bookings.slice(range[0], range[1] + 1) : state.bookings;
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

const { useProviderBookings } = await import("./useProviderBookings");

const row = (i: number) => ({
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
});

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {children}
  </QueryClientProvider>
);

beforeEach(() => {
  state.inCalls = {};
});

describe("useProviderBookings — row cap", () => {
  it("returns every booking past the 1000-row cap, including the newest pending one", async () => {
    state.bookings = Array.from({ length: 1500 }, (_, i) => row(i));
    const { result } = renderHook(() => useProviderBookings(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1500);
    expect(result.current.data!.filter((b) => b.status === "pending")).toHaveLength(1);
  });

  it("stops after one request when the provider has a single short page", async () => {
    state.bookings = Array.from({ length: 3 }, (_, i) => row(i));
    const { result } = renderHook(() => useProviderBookings(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(3);
  });

  it("resolves every customer's name when there are hundreds of customers", async () => {
    state.bookings = Array.from({ length: 1500 }, (_, i) => row(i));
    const { result } = renderHook(() => useProviderBookings(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data!.every((b) => b.customer_name === `name-${b.user_id}`)).toBe(true);
    expect(state.inCalls.profiles).toBeGreaterThan(1);
  });
});
