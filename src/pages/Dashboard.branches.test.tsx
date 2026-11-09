// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { useEffect } from "react";
import { __resetActiveBranchMemory, setActiveBranchId } from "@/lib/activeBranch";

/**
 * Multi-branch Phase 3 at the Dashboard level: the switcher must appear ONLY
 * for an owner with 2+ branches, and a switch must remount the open section
 * (closing its sheets, dropping old-branch form state) while a single-branch
 * owner's section is never remounted — not even when the profile finishes loading.
 *
 * Also the setup hub's routing: /dashboard is the hub, ?section=<id> a section,
 * legacy state.tab deep links still land in the right section, and a section
 * the provider type does not have falls back to the hub.
 *
 * The sections and the hub are stubbed; BusinessProfileTab's stub counts its mounts.
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
vi.mock("@/components/dashboard/AvailabilityTab", () => ({ AvailabilityTab: () => <div data-testid="hours-tab" /> }));
vi.mock("@/components/dashboard/ServicesTab", () => ({ ServicesTab: () => <div data-testid="services-tab" /> }));
vi.mock("@/components/dashboard/PhotosTab", () => ({ PhotosTab: () => <div data-testid="photos-tab" /> }));
vi.mock("@/components/dashboard/PackagesTab", () => ({ PackagesTab: () => <div data-testid="packages-tab" /> }));
// The hub's own rendering is covered by dashboardSetup.test.ts; here it is a
// stub with one row so the routing around it can be driven.
vi.mock("@/components/dashboard/SetupHub", () => ({
  SetupHub: ({ onOpen }: { onOpen: (target: unknown) => void }) => (
    <div data-testid="hub">
      <button onClick={() => onOpen({ kind: "section", section: "booking" })}>open-booking</button>
    </div>
  ),
}));

// Dashboard scrolls to the top on every hub/section change; jsdom lacks it.
window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;

const { default: Dashboard } = await import("./Dashboard");

type Entry = string | { pathname: string; search?: string; state?: unknown };
function renderDashboard(entry: Entry = "/dashboard") {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Dashboard />
    </MemoryRouter>,
  );
}
const PROFILE_SECTION = "/dashboard?section=profile";
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

  it("never remounts the section, including when the profile finishes loading", async () => {
    hook.branches = undefined;
    const { rerender } = renderDashboard(PROFILE_SECTION);
    hook.branches = [SAKHNIN];
    rerender(
      <MemoryRouter initialEntries={[PROFILE_SECTION]}>
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

  it("a switch remounts the open section (closing its sheets) but keeps the section", () => {
    renderDashboard(PROFILE_SECTION);
    expect(profileTabMounts).toBe(1);
    // The chip stays visible inside a section.
    expect(switcherButton()).toHaveAccessibleName("switchBranch: Womed Sakhnin");

    act(() => setActiveBranchId(USER.id, HAIFA.id));
    expect(screen.getByTestId("profile-tab")).toBeInTheDocument();
    expect(profileTabMounts).toBe(2);
  });

  it("a switch keeps a section opened from the hub", () => {
    renderDashboard();
    fireEvent.click(screen.getByRole("button", { name: "open-booking" }));
    act(() => setActiveBranchId(USER.id, HAIFA.id));
    expect(screen.getByTestId("booking-tab")).toBeInTheDocument();
    expect(screen.queryByTestId("hub")).toBeNull();
  });

  it("choosing the branch you are already in changes nothing", async () => {
    renderDashboard(PROFILE_SECTION);
    fireEvent.click(switcherButton()!);
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: /Womed Sakhnin/ }));
    expect(profileTabMounts).toBe(1);
    expect(localStorage.getItem(`ehjezly.activeBranch.${USER.id}`)).toBeNull();
  });
});

describe("Dashboard — setup hub routing", () => {
  beforeEach(() => {
    hook.branches = [SAKHNIN];
  });

  it("/dashboard is the hub, with no section mounted", () => {
    renderDashboard();
    expect(screen.getByTestId("hub")).toBeInTheDocument();
    expect(screen.queryByTestId("profile-tab")).toBeNull();
  });

  it("a hub row opens its section, and the back control returns to the hub", () => {
    renderDashboard();
    fireEvent.click(screen.getByRole("button", { name: "open-booking" }));
    expect(screen.getByTestId("booking-tab")).toBeInTheDocument();
    expect(screen.queryByTestId("hub")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "dashboard" }));
    expect(screen.getByTestId("hub")).toBeInTheDocument();
    expect(screen.queryByTestId("booking-tab")).toBeNull();
  });

  it("a section reached directly backs out to the hub, not off the page", () => {
    renderDashboard("/dashboard?section=booking");
    fireEvent.click(screen.getByRole("button", { name: "dashboard" }));
    expect(screen.getByTestId("hub")).toBeInTheDocument();
  });

  it.each([
    ["services", "services-tab"],
    ["availability", "hours-tab"],
    ["profile", "profile-tab"],
    ["booking", "booking-tab"],
    ["gallery", "photos-tab"],
  ])("legacy state.tab %s lands in its section", (tab, testId) => {
    renderDashboard({ pathname: "/dashboard", state: { tab } });
    expect(screen.getByTestId(testId)).toBeInTheDocument();
    expect(screen.queryByTestId("hub")).toBeNull();
  });

  it("an unknown section falls back to the hub", () => {
    renderDashboard("/dashboard?section=nope");
    expect(screen.getByTestId("hub")).toBeInTheDocument();
  });

  it("packages is hidden for a non-studio", () => {
    renderDashboard("/dashboard?section=packages");
    expect(screen.getByTestId("hub")).toBeInTheDocument();
  });

  describe("fitness studio", () => {
    beforeEach(() => {
      hook.branches = [{ ...SAKHNIN, category: "fitness_studio" }];
    });

    it("has no services section: the legacy services link lands on the hub", () => {
      renderDashboard({ pathname: "/dashboard", state: { tab: "services" } });
      expect(screen.getByTestId("hub")).toBeInTheDocument();
      expect(screen.queryByTestId("services-tab")).toBeNull();
    });

    it("has a packages section", () => {
      renderDashboard("/dashboard?section=packages");
      expect(screen.getByTestId("packages-tab")).toBeInTheDocument();
    });
  });
});
