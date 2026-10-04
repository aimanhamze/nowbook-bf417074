// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { useEffect } from "react";
import { __resetActiveBranchMemory, setActiveBranchId } from "@/lib/activeBranch";

/**
 * Multi-branch layer 1: branch identity on every provider screen.
 * The guarantees under test are the single-branch ones — customers and
 * single-branch owners get byte-identical titles, no provider-profile hook from
 * the title, and no remount — plus the switch behaviour for multi-branch owners.
 */

type Row = { id: string; user_id: string; business_name: string; address: string; avatar_image: string | null };
const USER = { id: "owner-1" };
const A: Row = { id: "pp-a", user_id: USER.id, business_name: "Branch A", address: "City A", avatar_image: null };
const B: Row = { id: "pp-b", user_id: USER.id, business_name: "Branch B", address: "City B", avatar_image: null };

const state = { isProvider: true, branches: [A] as Row[] };
const profileHookCalls = { n: 0 };
vi.mock("@/hooks/useProviderProfile", async () => {
  const { pickActiveBranch, useActiveBranchId } = await import("@/lib/activeBranch");
  return {
    useProviderProfile: () => {
      profileHookCalls.n++;
      const activeId = useActiveBranchId(USER.id);
      return { profile: pickActiveBranch(state.branches, activeId), branches: state.branches, isLoading: false };
    },
  };
});
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: USER, isProvider: state.isProvider }) }));
vi.mock("@/contexts/LangContext", () => ({ useLang: () => ({ t: (k: string) => k, isRtl: true, lang: "he" }) }));
const toastSpy = vi.fn();
vi.mock("sonner", () => ({ toast: (...args: unknown[]) => toastSpy(...args) }));

const { ProviderPageTitle } = await import("./ProviderPageTitle");
const { BranchScope } = await import("./BranchScope");

const CLS = "text-xl font-bold flex-1";

beforeEach(() => {
  localStorage.clear();
  __resetActiveBranchMemory();
  profileHookCalls.n = 0;
  toastSpy.mockClear();
  state.isProvider = true;
  state.branches = [A];
});

function renderTitle(path = "/calendar", as?: "h1" | "p") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ProviderPageTitle className={CLS} as={as}>Title</ProviderPageTitle>
    </MemoryRouter>,
  );
}

describe("ProviderPageTitle", () => {
  it("customer: the same <h1>, and never touches the provider-profile hook", () => {
    state.isProvider = false;
    const { container } = renderTitle();
    expect(container.innerHTML).toBe(`<h1 class="${CLS}">Title</h1>`);
    expect(profileHookCalls.n).toBe(0);
  });

  it("single-branch owner: byte-identical <h1>, no chip", () => {
    const { container } = renderTitle();
    expect(container.innerHTML).toBe(`<h1 class="${CLS}">Title</h1>`);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("single-branch owner, as=p: byte-identical <p>", () => {
    const { container } = renderTitle("/staff/x", "p");
    expect(container.innerHTML).toBe(`<p class="${CLS}">Title</p>`);
  });

  it("multi-branch owner: title keeps its text, chip names the active branch", () => {
    state.branches = [A, B];
    renderTitle();
    const h1 = screen.getByRole("heading", { name: "Title" });
    expect(h1.className).toContain("flex-none");
    expect(h1.className).not.toMatch(/\bflex-1\b/);
    expect(screen.getByRole("button", { name: "switchBranch: Branch A" })).toBeInTheDocument();
  });
});

describe("switching from the chip", () => {
  beforeEach(() => {
    state.branches = [A, B];
  });

  async function switchTo(name: string) {
    fireEvent.click(screen.getByRole("button", { name: /^switchBranch:/ }));
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: new RegExp(name) }));
  }

  it("stays on the screen, updates the chip and toasts the new branch name", async () => {
    renderTitle("/calendar");
    await switchTo("Branch B");
    expect(screen.getByRole("button", { name: "switchBranch: Branch B" })).toBeInTheDocument();
    expect(toastSpy).toHaveBeenCalledWith("switchedToBranch".replace("{name}", "⁨Branch B⁩"));
  });

  it("choosing the active branch does nothing — no toast, nothing stored", async () => {
    renderTitle("/calendar");
    await switchTo("Branch A");
    expect(toastSpy).not.toHaveBeenCalled();
    expect(localStorage.getItem(`ehjezly.activeBranch.${USER.id}`)).toBeNull();
  });

  it("from a staff member page, returns to the staff list", async () => {
    let path = "";
    function Where() {
      path = useLocation().pathname;
      return null;
    }
    render(
      <MemoryRouter initialEntries={["/staff/member-1"]}>
        <Routes>
          <Route path="*" element={<><ProviderPageTitle className={CLS}>Title</ProviderPageTitle><Where /></>} />
        </Routes>
      </MemoryRouter>,
    );
    await switchTo("Branch B");
    expect(path).toBe("/staff");
  });
});

describe("BranchScope", () => {
  let mounts = 0;
  function Page() {
    useEffect(() => {
      mounts++;
    }, []);
    return null;
  }
  const ui = () => (
    <BranchScope>
      <Page />
    </BranchScope>
  );

  beforeEach(() => {
    mounts = 0;
  });

  it("single-branch owner: never remounts", () => {
    const { rerender } = render(ui());
    rerender(ui());
    rerender(ui());
    expect(mounts).toBe(1);
  });

  it("multi-branch owner: a switch remounts the screen once", () => {
    state.branches = [A, B];
    render(ui());
    act(() => setActiveBranchId(USER.id, B.id));
    expect(mounts).toBe(2);
  });
});
