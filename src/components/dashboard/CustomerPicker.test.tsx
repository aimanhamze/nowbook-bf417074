// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { useState } from "react";
import type { ProviderCustomer } from "@/hooks/useProviderCustomers";

/**
 * Step 4's customer search. What must hold: picking fills name + phone
 * exactly as the old autocomplete did (trimmed, nothing else), "New customer"
 * opens the same two fields, the sheet goes compact only while searching with
 * the keyboard up, and the ranking puts the best matches first.
 */

let customers: ProviderCustomer[];
vi.mock("@/hooks/useProviderCustomers", () => ({
  useProviderCustomers: () => ({ data: customers, isLoading: false }),
}));
vi.mock("@/contexts/LangContext", () => ({ useLang: () => ({ t: (k: string) => k }) }));

const { CustomerPicker } = await import("./CustomerPicker");
const { rankCustomers } = await import("@/lib/customerSearch");
const { useVisualKeyboardUp } = await import("@/hooks/useKeyboardOpen");

const c = (key: string, name: string | null, phone: string | null, bookingCount = 1, lastVisit = "2026-10-01"): ProviderCustomer =>
  ({ key, name, phone, bookingCount, lastVisit, registered: false });

class FakeViewport extends EventTarget { height = 800; }
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

function Harness() {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  return (
    <>
      <CustomerPicker name={name} phone={phone} onNameChange={setName} onPhoneChange={setPhone} />
      <output data-testid="state">{JSON.stringify({ name, phone })}</output>
    </>
  );
}
const state = () => JSON.parse(screen.getByTestId("state").textContent || "{}");

describe("CustomerPicker", () => {
  it("starts with the search and recent customers; picking fills name + phone like before", () => {
    render(<Harness />);
    expect(screen.getByLabelText("nbSearch")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("nbSearch"), { target: { value: "dana" } });
    fireEvent.click(screen.getByRole("button", { name: /Dana Levi/ }));
    expect(state()).toEqual({ name: "Dana Levi", phone: "050-1234567" });
    // Compact card with a change action
    expect(screen.getByRole("button", { name: "nbChange" })).toBeInTheDocument();
  });

  it("Change clears the pick and goes back to the search", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: /Dana Levi/ }));
    fireEvent.click(screen.getByRole("button", { name: "nbChange" }));
    expect(state()).toEqual({ name: "", phone: "" });
    expect(screen.getByLabelText("nbSearch")).toBeInTheDocument();
  });

  it("a customer without a name opens the fields to complete it", () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText("nbSearch"), { target: { value: "0540" } });
    fireEvent.click(screen.getByRole("button", { name: /054-0000000/ }));
    expect(state()).toEqual({ name: "", phone: "054-0000000" });
    expect(screen.getByLabelText(/walkInCustomerName/)).toBeInTheDocument();
  });

  it("New customer opens the same fields, prefilled from the query, phone kept as typed", () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText("nbSearch"), { target: { value: "054 12-3" } });
    fireEvent.click(screen.getByRole("button", { name: /walkInNewCustomer/ }));
    expect(state()).toEqual({ name: "", phone: "054 12-3" });
    expect(screen.getByLabelText(/walkInCustomerPhone/)).toHaveValue("054 12-3");
  });

  it("no past customers: straight to the fields", () => {
    customers = [];
    render(<Harness />);
    expect(screen.queryByLabelText("nbSearch")).toBeNull();
    expect(screen.getByLabelText(/walkInCustomerName/)).toBeInTheDocument();
  });

  it("keyboard keys: name Next → phone, phone Done → keyboard closes", () => {
    customers = [];
    render(<Harness />);
    const nameInput = screen.getByLabelText(/walkInCustomerName/);
    const phoneInput = screen.getByLabelText(/walkInCustomerPhone/);
    expect(nameInput).toHaveAttribute("enterkeyhint", "next");
    expect(phoneInput).toHaveAttribute("enterkeyhint", "done");
    act(() => nameInput.focus());
    fireEvent.keyDown(nameInput, { key: "Enter" });
    expect(phoneInput).toHaveFocus();
    fireEvent.keyDown(phoneInput, { key: "Enter" });
    expect(phoneInput).not.toHaveFocus();
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
