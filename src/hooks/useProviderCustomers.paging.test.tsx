// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

/**
 * useProviderCustomers used one unpaged select, so a provider past PostgREST's
 * silent 1000-row cap lost whole customers from "My Customers", the booking
 * customer search and the sell-package sheet, and under-counted the rest.
 */

const SERVER_MAX_ROWS = 1000;
const state: { bookings: Record<string, unknown>[] } = { bookings: [] };

function builder(table: string) {
  let range: [number, number] | null = null;
  let inIds: string[] = [];
  const q = {
    select: () => q,
    eq: () => q,
    order: () => q,
    in: (_col: string, ids: string[]) => {
      inIds = ids;
      return q;
    },
    range: (from: number, to: number) => {
      range = [from, to];
      return q;
    },
    then: (resolve: (r: { data: unknown[]; error: null }) => unknown) => {
      const rows =
        table === "bookings"
          ? range ? state.bookings.slice(range[0], range[1] + 1) : state.bookings
          : inIds.map((id) => ({ user_id: id, display_name: `name-${id}`, phone: null }));
      return Promise.resolve({ data: rows.slice(0, SERVER_MAX_ROWS), error: null }).then(resolve);
    },
  };
  return q;
}

vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: (t: string) => builder(t) } }));
vi.mock("@/hooks/useProviderProfile", () => ({ useProviderProfile: () => ({ profile: { id: "pp" } }) }));

const { useProviderCustomers } = await import("./useProviderCustomers");

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {children}
  </QueryClientProvider>
);

describe("useProviderCustomers — row cap", () => {
  it("counts every customer and every visit past the 1000-row cap", async () => {
    // 300 customers x 4 bookings = 1,200 rows. The LAST customer's bookings
    // all sit past row 1000 and used to vanish entirely.
    state.bookings = Array.from({ length: 1200 }, (_, i) => ({
      id: `b-${String(i).padStart(5, "0")}`,
      user_id: `u-${Math.floor(i / 4)}`,
      linked_user_id: null,
      customer_name: null,
      customer_phone: null,
      booking_date: "2026-10-15",
    }));
    const { result } = renderHook(() => useProviderCustomers(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const customers = result.current.data!;
    expect(customers).toHaveLength(300);
    expect(customers.every((c) => c.bookingCount === 4)).toBe(true);
    expect(customers.find((c) => c.name === "name-u-299")).toBeDefined();
  });
});
