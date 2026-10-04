// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { __resetActiveBranchMemory } from "@/lib/activeBranch";

/**
 * Multi-branch layer 2: per-branch pending counts. Runs the REAL
 * useBranchPendingCounts against a recording Supabase mock to prove:
 *   - single-branch owners issue NO bookings query at all;
 *   - multi-branch owners issue exactly ONE, for all branches, grouped;
 *   - the active branch's number is the bottom-nav badge's (usePendingCount);
 *   - the chip's dot means ANOTHER branch has pending, never the active one.
 */

type Row = { id: string; user_id: string; business_name: string; address: string; avatar_image: string | null };
const USER = { id: "owner-1" };
const A: Row = { id: "pp-a", user_id: USER.id, business_name: "Branch A", address: "", avatar_image: null };
const B: Row = { id: "pp-b", user_id: USER.id, business_name: "Branch B", address: "", avatar_image: null };
const C: Row = { id: "pp-c", user_id: USER.id, business_name: "Branch C", address: "", avatar_image: null };

const state = { branches: [A] as Row[], activePending: 0, pendingRows: [] as Array<{ provider_id: string }> };
const calls: Array<{ table: string; op: string; args: unknown[] }> = [];

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      const b: Record<string, unknown> = {};
      for (const op of ["select", "in", "eq"]) {
        b[op] = (...args: unknown[]) => {
          calls.push({ table, op, args });
          return b;
        };
      }
      b.then = (resolve: (v: unknown) => unknown) => resolve({ data: state.pendingRows, error: null });
      return b;
    },
  },
}));
vi.mock("@/hooks/useProviderProfile", async () => {
  const { pickActiveBranch, useActiveBranchId } = await import("@/lib/activeBranch");
  return {
    useProviderProfile: () => {
      const activeId = useActiveBranchId(USER.id);
      return { profile: pickActiveBranch(state.branches, activeId), branches: state.branches, isLoading: false };
    },
  };
});
// The bottom-nav badge's source for the active branch.
vi.mock("@/hooks/useProviderBookings", () => ({ usePendingCount: () => state.activePending }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: USER, isProvider: true }) }));
vi.mock("@/contexts/LangContext", () => ({ useLang: () => ({ t: (k: string) => k, isRtl: true, lang: "he" }) }));
vi.mock("sonner", () => ({ toast: vi.fn() }));

const { ProviderPageTitle } = await import("./ProviderPageTitle");

function renderTitle() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/calendar"]}>
        <ProviderPageTitle className="text-xl font-bold flex-1">Title</ProviderPageTitle>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const bookingsQueries = () => calls.filter((c) => c.table === "bookings" && c.op === "select");
const dot = () => screen.queryByTestId("other-branch-pending-dot");

beforeEach(() => {
  calls.length = 0;
  localStorage.clear();
  __resetActiveBranchMemory();
  state.branches = [A];
  state.activePending = 0;
  state.pendingRows = [];
});

describe("single-branch owner", () => {
  it("issues no bookings query and shows no dot", async () => {
    state.activePending = 4;
    renderTitle();
    await act(() => new Promise((r) => setTimeout(r, 20)));
    expect(bookingsQueries()).toHaveLength(0);
    expect(dot()).toBeNull();
  });
});

describe("multi-branch owner", () => {
  beforeEach(() => {
    state.branches = [A, B, C];
  });

  it("ONE grouped query for all branches, pending only", async () => {
    renderTitle();
    await waitFor(() => expect(bookingsQueries()).toHaveLength(1));
    expect(calls).toContainEqual({ table: "bookings", op: "in", args: ["provider_id", ["pp-a", "pp-b", "pp-c"]] });
    expect(calls).toContainEqual({ table: "bookings", op: "eq", args: ["status", "pending"] });
  });

  it("another branch pending → dot; each row shows its own count, active from the badge source", async () => {
    state.activePending = 2;
    state.pendingRows = [{ provider_id: "pp-b" }, { provider_id: "pp-b" }, { provider_id: "pp-b" }, { provider_id: "pp-a" }];
    renderTitle();
    await waitFor(() => expect(dot()).not.toBeNull());
    expect(screen.getByRole("button", { name: /otherBranchPending/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^switchBranch:/ }));
    const sheet = await screen.findByRole("dialog");
    const row = (name: string) => within(sheet).getByRole("button", { name: new RegExp(name) });
    // Active branch: 2 from usePendingCount, NOT the 1 the grouped query saw.
    expect(within(row("Branch A")).getByLabelText("2 pendingTab")).toHaveTextContent("2");
    expect(within(row("Branch B")).getByLabelText("3 pendingTab")).toHaveTextContent("3");
    expect(within(row("Branch C")).queryByLabelText(/pendingTab/)).toBeNull();
  });

  it("only the ACTIVE branch has pending → no dot (the bottom-nav badge covers it)", async () => {
    state.activePending = 5;
    state.pendingRows = [{ provider_id: "pp-a" }];
    renderTitle();
    await waitFor(() => expect(bookingsQueries()).toHaveLength(1));
    await act(() => new Promise((r) => setTimeout(r, 20)));
    expect(dot()).toBeNull();
  });
});
