// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { __resetActiveBranchMemory, setActiveBranchId } from "@/lib/activeBranch";

/**
 * Multi-branch Phase 1: useProviderProfile must tolerate several
 * provider_profiles rows per owner, and with ONE row behave exactly as the old
 * `.eq("user_id").maybeSingle()` read did. Supabase is replaced by a recorder
 * so each test can assert which filters a read or write actually used.
 */

type Call = { table: string; op: string; args: unknown[]; q: number };
let queryCounter = 0;
const calls: Call[] = [];
let rows: Array<{ id: string; user_id: string; business_name: string; created_at: string }> = [];

// `q` tags every call with the query it belongs to, so a write's filters are
// never confused with the refetch its invalidation triggers.
function builder(table: string) {
  const q = ++queryCounter;
  let isRead = true;
  const b: Record<string, unknown> = {};
  for (const op of ["select", "eq", "order", "update", "upsert", "insert"]) {
    b[op] = (...args: unknown[]) => {
      calls.push({ table, op, args, q });
      if (op === "update" || op === "upsert" || op === "insert") isRead = false;
      return b;
    };
  }
  // Mirrors PostgREST: maybeSingle() yields the row / null, and PGRST116 when
  // more than one row matches — what the pre-multi-branch hook would hit.
  let single = false;
  b.maybeSingle = () => {
    single = true;
    return b;
  };
  b.then = (resolve: (v: unknown) => unknown) => {
    if (!isRead) return resolve({ data: null, error: null });
    if (!single) return resolve({ data: rows, error: null });
    return resolve(
      rows.length > 1
        ? { data: null, error: { code: "PGRST116", message: "multiple rows" } }
        : { data: rows[0] ?? null, error: null },
    );
  };
  return b;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => builder(table),
    storage: {
      from: () => ({
        upload: async () => ({ error: null }),
        getPublicUrl: (path: string) => ({ data: { publicUrl: `https://cdn.test/${path}` } }),
      }),
    },
  },
}));

const USER = { id: "user-1" };
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: USER }) }));

// Imported after the mocks are registered.
const { useProviderProfile } = await import("./useProviderProfile");

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const SAKHNIN = { id: "pp-sakhnin", user_id: USER.id, business_name: "Womed Sakhnin", created_at: "2026-01-01T00:00:00Z" };
const HAIFA = { id: "pp-haifa", user_id: USER.id, business_name: "Womed Haifa", created_at: "2026-06-01T00:00:00Z" };

function writes() {
  return calls.filter((c) => c.table === "provider_profiles" && ["update", "upsert", "insert"].includes(c.op));
}
function filtersOfLastWrite() {
  const last = writes().at(-1);
  if (!last) return [];
  return calls.filter((c) => c.q === last.q && c.op === "eq").map((c) => c.args);
}

beforeEach(() => {
  calls.length = 0;
  localStorage.clear();
  __resetActiveBranchMemory();
});

describe("useProviderProfile — single branch (every provider today)", () => {
  beforeEach(() => {
    rows = [SAKHNIN];
  });

  it("exposes the one row as profile, unchanged", async () => {
    const { result } = renderHook(() => useProviderProfile(), { wrapper });
    expect(result.current.profile).toBeUndefined(); // loading, as before
    await waitFor(() => expect(result.current.profile).toBe(SAKHNIN));
    expect(result.current.branches).toEqual([SAKHNIN]);
  });

  it("reads by user_id, oldest first", async () => {
    const { result } = renderHook(() => useProviderProfile(), { wrapper });
    await waitFor(() => expect(result.current.profile).toBe(SAKHNIN));
    expect(calls).toContainEqual(expect.objectContaining({ op: "eq", args: ["user_id", USER.id] }));
    expect(calls).toContainEqual(expect.objectContaining({ op: "order", args: ["created_at", { ascending: true }] }));
  });

  it("ignores a stale stored branch id and still returns the one row", async () => {
    setActiveBranchId(USER.id, "pp-deleted");
    const { result } = renderHook(() => useProviderProfile(), { wrapper });
    await waitFor(() => expect(result.current.profile).toBe(SAKHNIN));
  });

  it("writes settings by provider id, never by user_id", async () => {
    const { result } = renderHook(() => useProviderProfile(), { wrapper });
    await waitFor(() => expect(result.current.profile).toBe(SAKHNIN));
    await act(() => result.current.updateShowPrices.mutateAsync(false));
    expect(filtersOfLastWrite()).toEqual([["id", SAKHNIN.id]]);
  });

  it("image uploads update by id instead of upserting on user_id", async () => {
    const { result } = renderHook(() => useProviderProfile(), { wrapper });
    await waitFor(() => expect(result.current.profile).toBe(SAKHNIN));
    await act(() => result.current.uploadCoverImage.mutateAsync(new File(["x"], "c.png")));
    await act(() => result.current.uploadAvatarImage.mutateAsync(new File(["x"], "a.png")));
    const ws = writes();
    expect(ws.map((w) => w.op)).toEqual(["update", "update"]);
    for (const w of ws) {
      expect(calls.filter((c) => c.q === w.q && c.op === "eq").map((c) => c.args)).toEqual([["id", SAKHNIN.id]]);
    }
  });
});

describe("useProviderProfile — two branches", () => {
  beforeEach(() => {
    rows = [SAKHNIN, HAIFA];
  });

  it("defaults to the oldest branch", async () => {
    const { result } = renderHook(() => useProviderProfile(), { wrapper });
    await waitFor(() => expect(result.current.profile).toBe(SAKHNIN));
    expect(result.current.branches).toEqual([SAKHNIN, HAIFA]);
  });

  it("honours a stored active branch", async () => {
    setActiveBranchId(USER.id, HAIFA.id);
    const { result } = renderHook(() => useProviderProfile(), { wrapper });
    await waitFor(() => expect(result.current.profile).toBe(HAIFA));
  });

  it("switching re-renders onto the other branch and writes only to it", async () => {
    const { result } = renderHook(() => useProviderProfile(), { wrapper });
    await waitFor(() => expect(result.current.profile).toBe(SAKHNIN));

    act(() => setActiveBranchId(USER.id, HAIFA.id));
    expect(result.current.profile).toBe(HAIFA);

    await act(() =>
      result.current.upsertProfile.mutateAsync({
        business_name: "Womed Haifa",
        category: "beauty",
        address: "",
        about: "",
        phone: "",
        social_links: null,
      }),
    );
    expect(filtersOfLastWrite()).toEqual([["id", HAIFA.id]]);
    expect(writes().every((w) => w.op === "update")).toBe(true);
  });
});

describe("useProviderProfile — no provider row", () => {
  beforeEach(() => {
    rows = [];
  });

  it("returns null like the old maybeSingle, and refuses to write", async () => {
    const { result } = renderHook(() => useProviderProfile(), { wrapper });
    await waitFor(() => expect(result.current.profile).toBeNull());
    await expect(result.current.updateShowPrices.mutateAsync(true)).rejects.toThrow("No provider profile");
    expect(writes()).toHaveLength(0);
  });
});
