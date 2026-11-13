// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import type { ProviderCustomer } from "@/hooks/useProviderCustomers";

/**
 * Step 4's customer search + the new-customer view. What must hold: nothing
 * is listed until typing, picking
 * fills name + phone exactly as the old autocomplete did (trimmed), "New
 * customer" hands over what was typed, Add validates like Create (name and
 * phone required, translated) and returns the values exactly as typed, Back
 * saves nothing, and the keyboard keys go name → phone → Add.
 */

let customers: ProviderCustomer[];
vi.mock("@/hooks/useProviderCustomers", () => ({
  useProviderCustomers: () => ({ data: customers, isLoading: false }),
}));
vi.mock("@/contexts/LangContext", () => ({ useLang: () => ({ t: (k: string) => k, isRtl: true }) }));

const { CustomerPicker } = await import("./CustomerPicker");
const { NewCustomerView } = await import("./NewCustomerView");
const { Sheet, SheetContent } = await import("@/components/ui/sheet");
const { rankCustomers } = await import("@/lib/customerSearch");
const { useVisualKeyboardUp } = await import("@/hooks/useKeyboardOpen");

const c = (key: string, name: string | null, phone: string | null, bookingCount = 1, lastVisit = "2026-10-01"): ProviderCustomer =>
  ({ key, name, phone, bookingCount, lastVisit, registered: false });

class FakeViewport extends EventTarget { height = 800; offsetTop = 0; }
let vv: FakeViewport;

beforeEach(() => {
  customers = [
    c("a", " Dana Levi ", " 050-1234567 ", 3, "2026-11-01"),
    c("b", "Adam Dana", "052-7654321", 9, "2026-09-01"),
    c("x", null, "054-0000000", 1, "2026-08-01"),
  ];
  vv = new FakeViewport();
  Object.defineProperty(window, "visualViewport", { configurable: true, value: vv });
});

const handlers = () => ({
  onPick: vi.fn(), onClear: vi.fn(), onNew: vi.fn(), onEdit: vi.fn(), onIncomplete: vi.fn(),
});

describe("CustomerPicker", () => {
  it("search first; picking a customer fills name + phone like before (trimmed)", () => {
    const h = handlers();
    render(<CustomerPicker name="" phone="" {...h} />);
    fireEvent.change(screen.getByLabelText("nbSearch"), { target: { value: "dana" } });
    fireEvent.click(screen.getByRole("button", { name: /Dana Levi/ }));
    expect(h.onPick).toHaveBeenCalledWith("Dana Levi", "050-1234567");
  });

  it("nothing is listed before typing; '+ New customer' sits under the search", () => {
    render(<CustomerPicker name="" phone="" {...handlers()} />);
    expect(screen.queryByRole("list")).toBeNull();
    expect(screen.queryByRole("button", { name: /Dana Levi/ })).toBeNull();
    expect(screen.getByRole("button", { name: /walkInNewCustomer/ })).toBeInTheDocument();
  });

  it("'+ New customer' hands over what was typed", () => {
    const h = handlers();
    render(<CustomerPicker name="" phone="" {...h} />);
    fireEvent.change(screen.getByLabelText("nbSearch"), { target: { value: "054 12-3" } });
    fireEvent.click(screen.getByRole("button", { name: /walkInNewCustomer/ }));
    expect(h.onNew).toHaveBeenCalledWith("054 12-3");
  });

  it("while typing: at most five results", () => {
    customers = Array.from({ length: 8 }, (_, i) => c(String(i), `Dana ${i}`, `050${i}`));
    render(<CustomerPicker name="" phone="" {...handlers()} />);
    fireEvent.change(screen.getByLabelText("nbSearch"), { target: { value: "dana" } });
    expect(screen.getAllByRole("listitem")).toHaveLength(5);
  });

  it("a past customer missing a name goes to completion, not the card", () => {
    const h = handlers();
    render(<CustomerPicker name="" phone="" {...h} />);
    fireEvent.change(screen.getByLabelText("nbSearch"), { target: { value: "0540" } });
    fireEvent.click(screen.getByRole("button", { name: /054-0000000/ }));
    expect(h.onPick).not.toHaveBeenCalled();
    expect(h.onIncomplete).toHaveBeenCalledWith("", "054-0000000", "0540");
  });

  it("with a customer set: the card; Change clears, tapping the card edits", () => {
    const h = handlers();
    render(<CustomerPicker name="Dana" phone="050" {...h} />);
    fireEvent.click(screen.getByRole("button", { name: "nbChange" }));
    expect(h.onClear).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /nbEditDetails/ }));
    expect(h.onEdit).toHaveBeenCalled();
  });

  it("Back from the new-customer view returns to the same search", () => {
    render(<CustomerPicker name="" phone="" initialQuery="dan" {...handlers()} />);
    expect(screen.getByLabelText("nbSearch")).toHaveValue("dan");
  });

  it("no past customers: just the new-customer row", () => {
    customers = [];
    render(<CustomerPicker name="" phone="" {...handlers()} />);
    expect(screen.queryByLabelText("nbSearch")).toBeNull();
    expect(screen.getByRole("button", { name: /walkInNewCustomer/ })).toBeInTheDocument();
  });
});

describe("NewCustomerView", () => {
  const renderView = (props: Partial<Parameters<typeof NewCustomerView>[0]> = {}) => {
    const onCommit = vi.fn();
    const onBack = vi.fn();
    render(
      <Sheet open>
        <SheetContent side="bottom" hideClose>
          <NewCustomerView kind="new" initialName="" initialPhone="" onBack={onBack} onCommit={onCommit} {...props} />
        </SheetContent>
      </Sheet>,
    );
    return { onCommit, onBack };
  };

  it("Add sits in the header; the sheet's corner close is hidden", () => {
    renderView();
    expect(screen.getByRole("button", { name: "nbAdd" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "closeBtn" })).toBeNull();
  });

  it("Add validates like Create: name and phone required, translated, nothing returned", () => {
    const { onCommit } = renderView();
    fireEvent.click(screen.getByRole("button", { name: "nbAdd" }));
    expect(screen.getByText("walkInNameRequired")).toBeInTheDocument();
    expect(screen.getByText("walkInPhoneRequired")).toBeInTheDocument();
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("returns name + phone exactly as typed", () => {
    const { onCommit } = renderView({ initialName: "Dana" });
    fireEvent.change(screen.getByLabelText(/walkInCustomerPhone/), { target: { value: " 050-12 34 " } });
    fireEvent.click(screen.getByRole("button", { name: "nbAdd" }));
    expect(onCommit).toHaveBeenCalledWith("Dana", " 050-12 34 ");
  });

  it("keys: name Next → phone; phone Done = Add", () => {
    const { onCommit } = renderView();
    const nameInput = screen.getByLabelText(/walkInCustomerName/);
    const phoneInput = screen.getByLabelText(/walkInCustomerPhone/);
    expect(nameInput).toHaveAttribute("enterkeyhint", "next");
    expect(phoneInput).toHaveAttribute("enterkeyhint", "done");
    fireEvent.change(nameInput, { target: { value: "Dana" } });
    act(() => nameInput.focus());
    fireEvent.keyDown(nameInput, { key: "Enter" });
    expect(phoneInput).toHaveFocus();
    fireEvent.change(phoneInput, { target: { value: "0501234567" } });
    fireEvent.keyDown(phoneInput, { key: "Enter" });
    expect(onCommit).toHaveBeenCalledWith("Dana", "0501234567");
  });

  it("Back saves nothing", () => {
    const { onBack, onCommit } = renderView({ initialName: "Dana" });
    fireEvent.click(screen.getByRole("button", { name: "back" }));
    expect(onBack).toHaveBeenCalled();
    expect(onCommit).not.toHaveBeenCalled();
  });
});

describe("useVisualKeyboardUp", () => {
  it("true while the viewport is shrunk by the keyboard, false once it closes (Android back keeps focus)", () => {
    const { result } = renderHook(() => useVisualKeyboardUp(true));
    expect(result.current).toBe(false);
    act(() => { vv.height = 420; vv.dispatchEvent(new Event("resize")); });
    expect(result.current).toBe(true);
    act(() => { vv.height = 800; vv.dispatchEvent(new Event("resize")); });
    expect(result.current).toBe(false);
  });
});

describe("rankCustomers", () => {
  it("same matches as before (name OR phone digits), best first, capped", () => {
    const list = [
      c("1", "Adam Dana", "0521", 9), c("2", "Dana Levi", "0502", 1), c("3", "Yardana", "0503", 50),
      c("4", "Moshe", "0549999", 1),
    ];
    expect(rankCustomers(list, "dana").map((x) => x.key)).toEqual(["2", "1", "3"]);
    expect(rankCustomers(list, "054-99").map((x) => x.key)).toEqual(["4"]);
    expect(rankCustomers(list, "zzz")).toEqual([]);
    const many = Array.from({ length: 9 }, (_, i) => c(String(i), `Dan ${i}`, null));
    expect(rankCustomers(many, "dan")).toHaveLength(5);
  });
});
