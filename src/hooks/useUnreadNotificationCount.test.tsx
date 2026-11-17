// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

/**
 * The bell badge used to run a PostgREST head count on the notifications
 * table every 30 seconds (the most expensive query in the database). It now
 * asks unread_notification_count() for one number, capped at 10. These tests
 * pin the client half: one RPC, no table read, nothing for logged-out users
 * or admins, and one shared request for several bells.
 */

const state: { data: unknown; error: { message: string } | null } = { data: 0, error: null };
const calls: string[] = [];
const auth: { user: { id: string } | null; isAdmin: boolean; roleLoading: boolean } = {
  user: { id: "u1" },
  isAdmin: false,
  roleLoading: false,
};

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (fn: string) => {
      calls.push(fn);
      return Promise.resolve({ data: state.data, error: state.error });
    },
    from: (table: string) => {
      throw new Error(`the badge must not query ${table} directly`);
    },
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => auth }));

const { useUnreadNotificationCount, UNREAD_COUNT_CAP } = await import("./useUnreadNotificationCount");

const makeWrapper = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
};

const settle = () => new Promise((r) => setTimeout(r, 20));

beforeEach(() => {
  calls.length = 0;
  state.data = 0;
  state.error = null;
  auth.user = { id: "u1" };
  auth.isAdmin = false;
  auth.roleLoading = false;
});

describe("useUnreadNotificationCount", () => {
  it("asks the RPC for one number", async () => {
    state.data = 4;
    const { result } = renderHook(() => useUnreadNotificationCount(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current).toBe(4));
    expect(calls).toEqual(["unread_notification_count"]);
  });

  it("passes the capped value through unchanged", async () => {
    state.data = UNREAD_COUNT_CAP;
    const { result } = renderHook(() => useUnreadNotificationCount(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current).toBe(10));
  });

  it("two bells share one request", async () => {
    state.data = 2;
    const { result } = renderHook(
      () => [useUnreadNotificationCount(), useUnreadNotificationCount()],
      { wrapper: makeWrapper() }
    );
    await waitFor(() => expect(result.current).toEqual([2, 2]));
    expect(calls).toHaveLength(1);
  });

  it("an error shows 0, as before", async () => {
    state.error = { message: "boom" };
    const { result } = renderHook(() => useUnreadNotificationCount(), { wrapper: makeWrapper() });
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(result.current).toBe(0);
  });

  it.each([
    ["logged out", () => { auth.user = null; }],
    ["an admin", () => { auth.isAdmin = true; }],
    ["roles still loading", () => { auth.roleLoading = true; }],
  ])("does not fetch: %s", async (_name, arrange) => {
    arrange();
    const { result } = renderHook(() => useUnreadNotificationCount(), { wrapper: makeWrapper() });
    await settle();
    expect(calls).toEqual([]);
    expect(result.current).toBe(0);
  });

  it("does not fetch where no bell is on screen", async () => {
    const { result } = renderHook(() => useUnreadNotificationCount({ enabled: false }), {
      wrapper: makeWrapper(),
    });
    await settle();
    expect(calls).toEqual([]);
    expect(result.current).toBe(0);
  });
});
