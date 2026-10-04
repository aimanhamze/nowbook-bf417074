// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";

/**
 * Multi-branch layer 3: " · {branch}" on titles of sheets that write data.
 * Titles must be byte-identical for customers and single-branch owners.
 */

type Row = { id: string; business_name: string };
const A: Row = { id: "pp-a", business_name: "Branch A" };
const B: Row = { id: "pp-b", business_name: "Branch B" };
const state = { isProvider: true, branches: [A] as Row[], hookCalls: 0 };

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u" }, isProvider: state.isProvider }) }));
vi.mock("@/hooks/useProviderProfile", () => ({
  useProviderProfile: () => {
    state.hookCalls++;
    return { profile: state.branches[0], branches: state.branches };
  },
}));

const { BranchSuffix } = await import("./BranchSuffix");

const title = () => render(<h3 className="text-sm font-medium">Working hours<BranchSuffix /></h3>);

beforeEach(() => {
  state.isProvider = true;
  state.branches = [A];
  state.hookCalls = 0;
});

describe("BranchSuffix", () => {
  it("customer: title unchanged and the profile hook is never called", () => {
    state.isProvider = false;
    const { container } = title();
    expect(container.innerHTML).toBe('<h3 class="text-sm font-medium">Working hours</h3>');
    expect(state.hookCalls).toBe(0);
  });

  it("single-branch owner: title byte-identical", () => {
    const { container } = title();
    expect(container.innerHTML).toBe('<h3 class="text-sm font-medium">Working hours</h3>');
  });

  it("multi-branch owner: ' · name', name isolated in <bdi> and truncatable", () => {
    state.branches = [A, B];
    const { container } = title();
    expect(container.textContent).toBe("Working hours · Branch A");
    const bdi = container.querySelector("bdi")!;
    expect(bdi.textContent).toBe("Branch A");
    expect(bdi.className).toContain("truncate");
  });
});
