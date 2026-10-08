// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { Tables } from "@/integrations/supabase/types";

/**
 * Guards the cancel fix (fbca75c / 0f2a2b7) through the move into a shared
 * hook: the session is checked BEFORE any write, and a zero-row UPDATE (what
 * an anon-fallback request gets from RLS) is a failure, never "cancelled".
 */

const writes: Array<{ table: string; op: string }> = [];
let updateResult: { data: unknown; error: unknown; status: number } = { data: [{ id: "b1" }], error: null, status: 200 };

function builder(table: string) {
  let op = "select";
  const b: Record<string, unknown> = {};
  for (const name of ["select", "eq", "update", "insert", "single", "maybeSingle"]) {
    b[name] = () => {
      if (name === "update" || name === "insert") {
        op = name;
        writes.push({ table, op: name });
      }
      return b;
    };
  }
  b.then = (resolve: (v: unknown) => unknown) =>
    resolve(
      op === "update"
        ? updateResult
        : table === "provider_profiles"
          ? { data: { user_id: "owner" }, error: null }
          : { data: null, error: null },
    );
  return b;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => builder(table),
    auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) },
    functions: { invoke: async () => ({ error: null }) },
  },
}));

const ensureLiveSession = vi.fn(async () => true);
vi.mock("@/hooks/useLiveSessionGuard", () => ({
  useLiveSessionGuard: () => ({ ensureLiveSession, endDeadSession: vi.fn() }),
}));

vi.mock("@/contexts/LangContext", () => ({ useLang: () => ({ t: (k: string) => k }) }));

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

import { useCancelBooking } from "./useCancelBooking";

const booking = {
  id: "b1",
  provider_id: "p1",
  booking_date: "2030-01-01",
  booking_time: "10:00",
  service_ids: ["s1"],
} as unknown as Tables<"bookings">;

function setup() {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return renderHook(() => useCancelBooking(), { wrapper });
}

beforeEach(() => {
  writes.length = 0;
  updateResult = { data: [{ id: "b1" }], error: null, status: 200 };
  ensureLiveSession.mockClear();
  ensureLiveSession.mockResolvedValue(true);
  toast.success.mockClear();
  toast.error.mockClear();
});

describe("useCancelBooking", () => {
  it("sends nothing when the session check fails", async () => {
    ensureLiveSession.mockResolvedValue(false);
    const { result } = setup();
    act(() => result.current.mutate({ booking, serviceName: "x" }));
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(writes).toEqual([]);
    expect(toast.success).not.toHaveBeenCalled();
    // The guard already told the customer; no second, generic error.
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("a zero-row update is an error, never 'cancelled'", async () => {
    updateResult = { data: [], error: null, status: 200 };
    const { result } = setup();
    act(() => result.current.mutate({ booking, serviceName: "x" }));
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith("errorCancelBooking");
    // No notification rows for a cancel that did not happen.
    expect(writes.filter((w) => w.table === "notifications")).toEqual([]);
  });

  it("a real update reports success and notifies both sides", async () => {
    const { result } = setup();
    act(() => result.current.mutate({ booking, serviceName: "x" }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(ensureLiveSession).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledWith("bookingCancelled");
    expect(writes.filter((w) => w.table === "notifications")).toHaveLength(2);
  });
});
