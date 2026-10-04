// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { useEffect } from "react";
import { __resetActiveBranchMemory, setActiveBranchId } from "@/lib/activeBranch";

/**
 * Multi-branch Phase 3 at the Dashboard level: the switcher must appear ONLY
 * for an owner with 2+ branches, and a switch must remount the open tab (closing
 * its sheets, dropping old-branch form state) while a single-branch owner's tab
 * is never remounted — not even when the profile finishes loading.
 *
 * The tabs are stubbed; BusinessProfileTab's stub counts its mounts.
 */

type Row = { id: string; user_id: string; business_name: string; address: string; avatar_image: string; category: string };
const USER = { id: "user-1" };
const SAKHNIN: Row = { id: "pp-sakhnin", user_id: USER.id, business_name: "Womed Sakhnin", address: "Sakhnin", avatar_image: "", category: "salon" };
const HAIFA: Row = { id: "pp-haifa", user_id: USER.id, business_name: "Womed Haifa", address: "Haifa", avatar_image: "", category: "salon" };

// Mirrors useProviderProfile's contract: profile is the stored active branch,
// else the oldest; undefined while loading.
const hook = { branches: undefined as Row[] | undefined };
vi.mock("@/hooks/useProviderProfile", async () => {
  const { pickActiveBranch, useActiveBranchId } = await import("@/lib/activeBranch");
  return {
    useProviderProfile: () => {
      const activeId = useActiveBranchId(USER.id);
      const rows = hook.branches;
      return {
        profile: rows === undefined ? undefined : pickActiveBranch(rows, activeId),
        branches: rows ?? [],
        isLoading: rows === undefined,
      };
    },
  };
});
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: USER, isProvider: true }) }));
vi.mock("@/contexts/LangContext", () => ({ useLang: () => ({ t: (k: string) => k, isRtl: true, lang: "he" }) }));
vi.mock("@/hooks/usePushSubscription", () => ({
  usePushSubscription: () => ({ isSupported: false, isSubscribed: false, loading: false, subscribe: vi.fn(), unsubscribe: vi.fn() }),
}));

// Pending counts are layer 2's concern (branchLayer2.test.tsx).
vi.mock("@/hooks/useBranchPendingCounts", () => ({
  useBranchPendingCounts: () => ({ countFor: () => 0, otherBranchesPending: false }),
}));
let profileTabMounts = 0;
function ProfileTabStub() {
  useEffect(() => {
    profileTabMounts++;
  }, []);
  return <div data-testid="profile-tab" />;
}
vi.mock("@/components/dashboard/BusinessProfileTab", () => ({ BusinessProfileTab: () => <ProfileTabStub /> }));
vi.mock("@/components/dashboard/BookingSettingsTab", () => ({ BookingSettingsTab: () => <div data-testid="booking-tab" /> }));
vi.mock("@/components/dashboard/AvailabilityTab", () => ({ AvailabilityTab: () => null }));
vi.mock("@/components/dashboard/ServicesTab", () => ({ ServicesTab: () => null }));
vi.mock("@/components/dashboard/PhotosTab", () => ({ PhotosTab: () => null }));
vi.mock("@/components/dashboard/PackagesTab", () => ({ PackagesTab: () => null }));

const { default: Dashboard } = await import("./Dashboard");

function renderDashboard() {
  return render(
    <MemoryRouter initialEntries={["/dashboard"]}>
      <Dashboard />
    </MemoryRouter>,
  );
}
const switcherButton = () => screen.queryByRole("button", { name: /switchBranch/ });

beforeEach(() => {
  localStorage.clear();
  __resetActiveBranchMemory();
  profileTabMounts = 0;
});

describe("Dashboard — single branch (every owner today)", () => {
  beforeEach(() => {
    hook.branches = [SAKHNIN];
  });

  it("shows the plain business-name line and no switcher", () => {
    renderDashboard();
    expect(screen.getByText("Womed Sakhnin").tagName).toBe("P");
    expect(switcherButton()).toBeNull();
  });

  it("never remounts the tab, including when the profile finishes loading", async () => {
    hook.branches = undefined;
    const { rerender } = renderDashboard();
    hook.branches = [SAKHNIN];
    rerender(
      <MemoryRouter initialEntries={["/dashboard"]}>
        <Dashboard />
      </MemoryRouter>,
    );
    expect(profileTabMounts).toBe(1);
  });
});

describe("Dashboard — two branches", () => {
  beforeEach(() => {
    hook.branches = [SAKHNIN, HAIFA];
  });

  it("shows the switcher on the active (oldest) branch", () => {
    renderDashboard();
    expect(switcherButton()).toHaveAccessibleName("switchBranch: Womed Sakhnin");
  });

  it("lists every branch and switching moves the dashboard to it", async () => {
    renderDashboard();
    fireEvent.click(switcherButton()!);
    const sheet = await screen.findByRole("dialog");
    expect(sheet).toHaveTextContent("Womed Sakhnin");
    expect(sheet).toHaveTextContent("Womed Haifa");

    fireEvent.click(screen.getByRole("button", { name: /Womed Haifa/ }));
    expect(switcherButton()).toHaveAccessibleName("switchBranch: Womed Haifa");
    expect(localStorage.getItem(`ehjezly.activeBranch.${USER.id}`)).toBe(HAIFA.id);
  });

  it("a switch remounts the open tab (closing its sheets) but keeps the tab", () => {
    renderDashboard();
    expect(profileTabMounts).toBe(1);

    // Remount: switching while on the profile tab mounts it afresh.
    act(() => setActiveBranchId(USER.id, HAIFA.id));
    expect(screen.getByTestId("profile-tab")).toBeInTheDocument();
    expect(profileTabMounts).toBe(2);

    // Tab kept: switching while on a non-default tab stays on that tab.
    fireEvent.click(screen.getByRole("button", { name: "bookingSettingsTitle" }));
    act(() => setActiveBranchId(USER.id, SAKHNIN.id));
    expect(screen.getByTestId("booking-tab")).toBeInTheDocument();
    expect(screen.queryByTestId("profile-tab")).toBeNull();
  });

  it("choosing the branch you are already in changes nothing", async () => {
    renderDashboard();
    fireEvent.click(switcherButton()!);
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: /Womed Sakhnin/ }));
    expect(profileTabMounts).toBe(1);
    expect(localStorage.getItem(`ehjezly.activeBranch.${USER.id}`)).toBeNull();
  });
});
