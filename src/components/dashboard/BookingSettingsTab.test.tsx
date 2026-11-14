// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * The booking settings redesign is visual + copy only. These pin the
 * behaviour it must keep: each control calls its own mutation with the
 * chosen value, the two guard flows (approval with pending bookings,
 * waiting list with people waiting), fitness-studio visibility, and
 * translated toasts instead of raw error text.
 */

const mutation = () => ({ isPending: false, mutateAsync: vi.fn().mockResolvedValue(undefined) });
let m: Record<string, ReturnType<typeof mutation>>;
let profile: Record<string, unknown>;
let pendingCount = 0;
let waitingTotal = 0;

vi.mock("@/hooks/useProviderProfile", () => ({
  useProviderProfile: () => ({ profile, ...m }),
}));
vi.mock("@/components/dashboard/PendingTab", () => ({ usePendingCount: () => pendingCount }));
vi.mock("@/hooks/useProviderWaitlist", () => ({
  useProviderWaitlistCounts: () => ({ fetchTotal: vi.fn(async () => waitingTotal) }),
}));
vi.mock("@/contexts/LangContext", () => ({ useLang: () => ({ t: (k: string) => k, isRtl: true, lang: "he" }) }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const { BookingSettingsTab } = await import("./BookingSettingsTab");

const renderTab = () =>
  render(
    <MemoryRouter>
      <BookingSettingsTab />
    </MemoryRouter>,
  );
// By label, not role: getByRole computes accessible names for the whole tab on
// every call, which made this file the slowest in the suite and let the switch
// test approach the 5s timeout under full-suite load. The label (htmlFor) points
// at the same role="switch" element, asserted below.
const sw = (name: string) => {
  const el = screen.getByLabelText(new RegExp(name));
  expect(el).toHaveAttribute("role", "switch");
  return el;
};

beforeEach(() => {
  m = Object.fromEntries(
    [
      "updateBookingApproval", "updateTreatmentNotesEnabled", "updateShowPrices",
      "updateAllowCustomerReschedule", "updateDepositRequestEnabled", "updateMinLeadTime",
      "updateBookingWindow", "updateCancellationNoticeHours", "updateSlotInterval", "updateWaitlistEnabled",
    ].map((k) => [k, mutation()]),
  );
  profile = {
    id: "pp1", category: "barber", requires_booking_approval: false, treatment_notes_enabled: false,
    show_prices: true, allow_customer_reschedule: false, deposit_request_enabled: false,
    min_lead_time_minutes: 15, booking_window_days: 14, cancellation_notice_hours: 5,
    slot_interval_minutes: 15, waitlist_enabled: true,
  };
  pendingCount = 0;
  waitingTotal = 0;
  toast.success.mockClear();
  toast.error.mockClear();
});

describe("BookingSettingsTab", () => {
  it("each switch calls its own mutation with the next value, then a short saved toast", async () => {
    renderTab();
    const cases: Array<[string, string, boolean]> = [
      ["bsPricesTitle", "updateShowPrices", false],
      ["bsRescheduleTitle", "updateAllowCustomerReschedule", true],
      ["bsNotesTitle", "updateTreatmentNotesEnabled", true],
      ["bsDepositTitle", "updateDepositRequestEnabled", true],
      ["bsApprovalTitle", "updateBookingApproval", true],
    ];
    for (const [name, key, next] of cases) {
      fireEvent.click(sw(name));
      await waitFor(() => expect(m[key].mutateAsync).toHaveBeenCalledWith(next));
    }
    expect(toast.success).toHaveBeenCalledWith("bsSaved");
  });

  it("an off switch is not disabled", () => {
    renderTab();
    expect(sw("bsNotesTitle")).toHaveAttribute("data-state", "unchecked");
    expect(sw("bsNotesTitle")).not.toBeDisabled();
  });

  it("a value row opens a sheet with the same options; choosing saves that value", async () => {
    renderTab();
    fireEvent.click(screen.getByRole("button", { name: /bsCancelTitle/ }));
    const options = await screen.findAllByRole("radio");
    expect(options).toHaveLength(9); // 0,1,2,3,5,12,24,48,72
    fireEvent.click(screen.getByRole("radio", { name: "cancellationNoticeAlways" }));
    await waitFor(() => expect(m.updateCancellationNoticeHours.mutateAsync).toHaveBeenCalledWith(0));
    await waitFor(() => expect(screen.queryByRole("radiogroup")).toBeNull());
  });

  it("the other pickers save to their own columns", async () => {
    renderTab();
    const cases: Array<[string, string, string, number]> = [
      ["bsLeadTitle", "leadTime60", "updateMinLeadTime", 60],
      ["bsWindowTitle", "bookingWindow30", "updateBookingWindow", 30],
    ];
    for (const [row, option, key, value] of cases) {
      fireEvent.click(screen.getByRole("button", { name: new RegExp(row) }));
      fireEvent.click(await screen.findByRole("radio", { name: option }));
      await waitFor(() => expect(m[key].mutateAsync).toHaveBeenCalledWith(value));
      await waitFor(() => expect(screen.queryByRole("radiogroup")).toBeNull());
    }
    fireEvent.click(screen.getByRole("button", { name: /bsSpacingTitle/ }));
    expect(await screen.findAllByRole("radio")).toHaveLength(6);
  });

  it("a failed save shows the translated error, never the raw message", async () => {
    m.updateShowPrices.mutateAsync.mockRejectedValue(new Error('new row violates check constraint "x"'));
    renderTab();
    fireEvent.click(sw("bsPricesTitle"));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("bsSaveError"));
  });

  it("approval cannot be turned off while bookings are pending", async () => {
    profile.requires_booking_approval = true;
    pendingCount = 2;
    renderTab();
    fireEvent.click(sw("bsApprovalTitle"));
    expect(await screen.findByText("cannotDisableApprovalTitle")).toBeInTheDocument();
    expect(m.updateBookingApproval.mutateAsync).not.toHaveBeenCalled();
  });

  it("waiting list: turning off with people waiting asks first, then saves", async () => {
    waitingTotal = 3;
    renderTab();
    fireEvent.click(sw("bsWaitlistTitle"));
    expect(await screen.findByText("waitlistOffConfirmTitle")).toBeInTheDocument();
    expect(m.updateWaitlistEnabled.mutateAsync).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "waitlistOffConfirm" }));
    await waitFor(() => expect(m.updateWaitlistEnabled.mutateAsync).toHaveBeenCalledWith(false));
  });

  it("waiting list: nobody waiting turns off straight away", async () => {
    renderTab();
    fireEvent.click(sw("bsWaitlistTitle"));
    await waitFor(() => expect(m.updateWaitlistEnabled.mutateAsync).toHaveBeenCalledWith(false));
    expect(screen.queryByText("waitlistOffConfirmTitle")).toBeNull();
  });

  it("descriptions follow the current state", () => {
    profile.waitlist_enabled = false;
    renderTab();
    expect(screen.getByText("bsWaitlistOff")).toBeInTheDocument();
    expect(screen.getByText("bsPricesOn")).toBeInTheDocument();
    expect(screen.getByText("bsApprovalOff")).toBeInTheDocument();
  });

  it("a fitness studio has no reschedule or waiting-list rows", () => {
    profile.category = "fitness_studio";
    renderTab();
    expect(screen.queryByRole("switch", { name: /bsRescheduleTitle/ })).toBeNull();
    expect(screen.queryByRole("switch", { name: /bsWaitlistTitle/ })).toBeNull();
    expect(sw("bsPricesTitle")).toBeInTheDocument();
    expect(screen.getAllByRole("switch")).toHaveLength(4); // approval, prices, notes, deposit
  });
});
