// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

/**
 * The packages redesign is UI only: same template payload, the active switch
 * still saves on its own, Activate stays one tap from the list, and an
 * unknown DB error is never shown raw.
 */

const mutation = () => ({ isPending: false, mutate: vi.fn(), mutateAsync: vi.fn().mockResolvedValue(undefined) });
let m: Record<string, ReturnType<typeof mutation>>;
let templates: Array<Record<string, unknown>>;
let packages: Array<Record<string, unknown>>;

vi.mock("@/hooks/usePackageTemplates", () => ({
  usePackageTemplates: () => ({ templates, isLoading: false, upsertTemplate: m.upsertTemplate, deleteTemplate: m.deleteTemplate, toggleActive: m.toggleActive }),
}));
vi.mock("@/hooks/useCustomerPackages", () => ({
  useCustomerPackages: () => ({ data: packages, isLoading: false }),
  usePackageHistory: () => ({ data: [], isLoading: false }),
}));
vi.mock("@/hooks/usePackageActions", async (orig) => ({
  ...(await orig<typeof import("@/hooks/usePackageActions")>()),
  usePackageActions: () => ({ activatePackage: m.activatePackage, addEntries: m.addEntries, sellPackage: m.sellPackage, cancelPackage: m.cancelPackage }),
}));
vi.mock("@/hooks/useProviderCustomers", () => ({ useProviderCustomers: () => ({ data: [] }) }));
vi.mock("@/hooks/useProviderProfile", () => ({ useProviderProfile: () => ({ profile: { id: "pp1" }, branches: [] }) }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ isProvider: true }) }));
vi.mock("@/contexts/LangContext", () => ({ useLang: () => ({ t: (k: string) => k, isRtl: true, lang: "he" }) }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const { PackagesTab } = await import("./PackagesTab");

beforeEach(() => {
  m = Object.fromEntries(
    ["upsertTemplate", "deleteTemplate", "toggleActive", "activatePackage", "addEntries", "sellPackage", "cancelPackage"].map((k) => [k, mutation()]),
  );
  templates = [{ id: "t1", name: "10 classes", description: null, total_entries: 10, validity_days: 90, price: 350, is_active: true }];
  packages = [{
    id: "p1", customer_id: "c1", customer_name: "Dana", customer_phone: "0501234567", template_name: "10 classes",
    status: "pending_activation", entries_remaining: 10, total_entries: 10, expires_at: null, created_at: "2026-11-01T00:00:00Z",
  }];
  toast.success.mockClear();
  toast.error.mockClear();
});

describe("PackagesTab", () => {
  it("writes nothing on load", () => {
    render(<PackagesTab />);
    for (const k of Object.keys(m)) {
      expect(m[k].mutate).not.toHaveBeenCalled();
      expect(m[k].mutateAsync).not.toHaveBeenCalled();
    }
  });

  it("the active switch saves on its own, without opening the editor", () => {
    render(<PackagesTab />);
    fireEvent.click(screen.getByRole("switch", { name: /packageActive/ }));
    expect(m.toggleActive.mutate).toHaveBeenCalledWith({ id: "t1", is_active: false }, expect.anything());
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("editing a package type sends the same payload", async () => {
    render(<PackagesTab />);
    fireEvent.click(screen.getAllByRole("button", { name: /10 classes/ })[0]);
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "save" }));
    await waitFor(() => expect(m.upsertTemplate.mutateAsync).toHaveBeenCalledWith({
      id: "t1", name: "10 classes", description: "", total_entries: 10, validity_days: 90, price: 350, is_active: true,
    }));
  });

  it("Activate is on the list row", () => {
    render(<PackagesTab />);
    fireEvent.click(screen.getByRole("button", { name: /activatePackage/ }));
    expect(m.activatePackage.mutate).toHaveBeenCalledWith("p1", expect.anything());
  });

  it("an unknown DB error is translated, a known one keeps its message", async () => {
    m.upsertTemplate.mutateAsync
      .mockRejectedValueOnce(new Error("connection reset by peer"))
      .mockRejectedValueOnce(new Error("TEMPLATE_IN_USE"));
    render(<PackagesTab />);
    fireEvent.click(screen.getAllByRole("button", { name: /10 classes/ })[0]);
    const save = () => fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "save" }));
    save();
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("bsSaveError"));
    save();
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("packageTemplateInUse"));
  });
});
