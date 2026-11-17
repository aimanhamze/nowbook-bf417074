// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * NameGate asks a customer for a name only when the profile really has none.
 * profiles is not readable without a session, so a read that goes out with a
 * dead token is refused — that is "unknown", and must not show the name
 * screen to a customer who already has a name.
 */

const read: { data: { display_name: string | null } | null; error: { message: string; code?: string } | null } = {
  data: null,
  error: null,
};
const auth = {
  user: { id: "u1" } as { id: string } | null,
  isProvider: false,
  isAdmin: false,
  roleLoading: false,
  signOut: vi.fn(),
};
let reads = 0;

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => {
            reads += 1;
            return Promise.resolve({ data: read.data, error: read.error });
          },
        }),
      }),
    }),
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => auth }));
vi.mock("@/contexts/LangContext", () => ({ useLang: () => ({ t: (k: string) => k, isRtl: true }) }));

const { NameGate } = await import("./NameGate");

const renderGate = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <NameGate>
        <div>the app</div>
      </NameGate>
    </QueryClientProvider>,
  );

beforeEach(() => {
  read.data = null;
  read.error = null;
  auth.user = { id: "u1" };
  auth.isProvider = false;
  auth.isAdmin = false;
  auth.roleLoading = false;
  reads = 0;
});

describe("NameGate", () => {
  it("lets a customer with a name through", async () => {
    read.data = { display_name: "Dana" };
    renderGate();
    expect(await screen.findByText("the app")).toBeTruthy();
    expect(screen.queryByText("nameGateTitle")).toBeNull();
  });

  it("asks for a name when the profile has none", async () => {
    read.data = { display_name: null };
    renderGate();
    expect(await screen.findByText("nameGateTitle")).toBeTruthy();
    expect(screen.queryByText("the app")).toBeNull();
  });

  it("asks for a name when there is no profile row and no error", async () => {
    read.data = null;
    renderGate();
    expect(await screen.findByText("nameGateTitle")).toBeTruthy();
  });

  it("does NOT ask for a name when the read fails — unknown is not nameless", async () => {
    read.error = { message: "permission denied for table profiles", code: "42501" };
    renderGate();
    await waitFor(() => expect(screen.getByText("the app")).toBeTruthy(), { timeout: 4000 });
    expect(screen.queryByText("nameGateTitle")).toBeNull();
    // One quick retry, not the default three.
    expect(reads).toBe(2);
  });

  it("never reads a profile for a logged-out visitor, a provider or an admin", async () => {
    auth.user = null;
    const { unmount } = renderGate();
    expect(screen.getByText("the app")).toBeTruthy();
    unmount();

    auth.user = { id: "u1" };
    auth.isProvider = true;
    renderGate();
    expect(screen.getAllByText("the app").length).toBe(1);
    expect(reads).toBe(0);
  });
});
