// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

/**
 * useProviderCustomers used to page through every booking of the provider and
 * group them in the browser (and before that, one unpaged select silently lost
 * whole customers past PostgREST's 1000-row cap).
 *
 * The grouping now runs in provider_customers(), which returns the whole list
 * as ONE jsonb value — a single request, and no row cap to page around. These
 * tests pin the client half: one request, nothing dropped, same shape and
 * order as before. The SQL half is checked by the migration's VERIFY file.
 */

type RpcRow = {
  key: string;
  name: string | null;
  phone: string | null;
  booking_count: number;
  last_visit: string | null;
};
const state: { rows: RpcRow[] | null; error: { message: string } | null } = { rows: [], error: null };
const calls: { fn: string; args: unknown }[] = [];

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (fn: string, args: unknown) => {
      calls.push({ fn, args });
      return Promise.resolve({ data: state.rows, error: state.error });
    },
    from: (table: string) => {
      throw new Error(`useProviderCustomers must not query ${table} directly`);
    },
  },
}));
vi.mock("@/hooks/useProviderProfile", () => ({ useProviderProfile: () => ({ profile: { id: "pp" } }) }));

const { useProviderCustomers } = await import("./useProviderCustomers");

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {children}
  </QueryClientProvider>
);

beforeEach(() => {
  calls.length = 0;
  state.rows = [];
  state.error = null;
});

describe("useProviderCustomers", () => {
  it("one request for the active branch, and every customer past 1000 comes back", async () => {
    state.rows = Array.from({ length: 1200 }, (_, i) => ({
      key: `u:u-${i}`,
      name: `name-u-${i}`,
      phone: null,
      booking_count: 4,
      last_visit: "2026-10-15",
    }));
    const { result } = renderHook(() => useProviderCustomers(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(calls).toEqual([{ fn: "provider_customers", args: { p_provider_id: "pp" } }]);
    const customers = result.current.data!;
    expect(customers).toHaveLength(1200);
    expect(customers.every((c) => c.bookingCount === 4)).toBe(true);
    expect(customers.find((c) => c.name === "name-u-1199")).toBeDefined();
  });

  it("maps a row to the customer shape; registered comes from the key", async () => {
    state.rows = [
      { key: "u:acc-1", name: "Dana", phone: "0501234567", booking_count: 3, last_visit: "2026-11-02" },
      { key: "p:501234568", name: "Walk In", phone: "050-1234568", booking_count: 2, last_visit: "2026-10-01" },
      { key: "w:b-9", name: null, phone: null, booking_count: 1, last_visit: "2026-09-09" },
    ];
    const { result } = renderHook(() => useProviderCustomers(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([
      { key: "u:acc-1", name: "Dana", phone: "0501234567", bookingCount: 3, lastVisit: "2026-11-02", registered: true },
      { key: "p:501234568", name: "Walk In", phone: "050-1234568", bookingCount: 2, lastVisit: "2026-10-01", registered: false },
      { key: "w:b-9", name: null, phone: null, bookingCount: 1, lastVisit: "2026-09-09", registered: false },
    ]);
  });

  it("sorts most bookings first, then by name, falling back to phone", async () => {
    state.rows = [
      { key: "u:1", name: "Zed", phone: null, booking_count: 2, last_visit: null },
      { key: "u:2", name: "Adam", phone: null, booking_count: 2, last_visit: null },
      { key: "p:3", name: null, phone: "0500000000", booking_count: 2, last_visit: null },
      { key: "u:4", name: "Top", phone: null, booking_count: 9, last_visit: null },
    ];
    const { result } = renderHook(() => useProviderCustomers(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data!.map((c) => c.key)).toEqual(["u:4", "p:3", "u:2", "u:1"]);
  });

  it("no customers yet → an empty list", async () => {
    state.rows = null;
    const { result } = renderHook(() => useProviderCustomers(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });

  it("a failed request is an error, not an empty customer list", async () => {
    state.error = { message: "function public.provider_customers(uuid) does not exist" };
    const { result } = renderHook(() => useProviderCustomers(), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
