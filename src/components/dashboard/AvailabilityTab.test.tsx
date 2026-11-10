// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * Opening-hours redesign: visual + interaction only. These pin that the day
 * sheet writes the same upsertAvailability row as before (once, on Save),
 * that invalid hours never save, that "apply to all open days" leaves closed
 * days alone, nothing writes on load, and studio/monthly see their screens.
 */

const mutation = () => ({ isPending: false, mutateAsync: vi.fn().mockResolvedValue(undefined) });
let avail: Record<string, unknown>;
let profile: Record<string, unknown>;

// Seeded week: Sun–Thu open 09–17, Fri–Sat closed.
const seed = () =>
  [0, 1, 2, 3, 4, 5, 6].map((d) => ({
    id: `a${d}`, day_of_week: d, is_available: d <= 4, start_time: "09:00:00", end_time: "17:00:00",
    break_start: null, break_end: null,
  }));

vi.mock("@/hooks/useProviderAvailability", () => ({ useProviderAvailability: () => avail }));
vi.mock("@/hooks/useProviderProfile", () => ({ useProviderProfile: () => ({ profile }) }));
vi.mock("@/components/branch/BranchSuffix", () => ({ BranchSuffix: () => null }));
// t() returns the key, except the confirmation body keeps its placeholders
// so the test can see which days it lists.
vi.mock("@/contexts/LangContext", () => ({
  useLang: () => ({ t: (k: string) => (k === "hrsApplyBody" ? "{hours} → {days}" : k), isRtl: true, lang: "he" }),
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const { AvailabilityTab } = await import("./AvailabilityTab");

const renderTab = () => render(<MemoryRouter><AvailabilityTab /></MemoryRouter>);
const upsert = () => (avail.upsertAvailability as ReturnType<typeof mutation>).mutateAsync;
const openDay = async (key: string) => {
  fireEvent.click(screen.getByRole("button", { name: new RegExp(key) }));
  return screen.findByRole("dialog");
};

beforeEach(() => {
  avail = {
    availability: seed(), blockedDates: [], dateOverrides: [],
    upsertAvailability: mutation(), blockDate: mutation(), unblockDate: mutation(),
    upsertDateOverride: mutation(), deleteDateOverride: mutation(),
  };
  profile = { id: "pp1", category: "barber", availability_mode: "weekly" };
  toast.success.mockClear();
  toast.error.mockClear();
});

describe("AvailabilityTab — weekly", () => {
  it("shows a summary row per day and writes nothing on load", () => {
    renderTab();
    expect(screen.getByRole("heading", { name: "workingHoursLabel" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /monday.*09:00 – 17:00/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /saturday.*dayClosedShort/ })).toBeInTheDocument();
    expect(upsert()).not.toHaveBeenCalled();
  });

  it("Save writes one row in the same shape as before", async () => {
    renderTab();
    const sheet = await openDay("monday");
    fireEvent.change(within(sheet).getByLabelText("hrsCloses"), { target: { value: "19:00" } });
    fireEvent.click(within(sheet).getByRole("button", { name: "save" }));
    await waitFor(() => expect(upsert()).toHaveBeenCalledTimes(1));
    expect(upsert()).toHaveBeenCalledWith({
      day_of_week: 1, start_time: "09:00", end_time: "19:00", is_available: true, break_start: null, break_end: null,
    });
    expect(toast.success).toHaveBeenCalledWith("bsSaved");
  });

  it("an unchanged Save writes nothing", async () => {
    renderTab();
    const sheet = await openDay("monday");
    fireEvent.click(within(sheet).getByRole("button", { name: "save" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(upsert()).not.toHaveBeenCalled();
  });

  it("closing a day keeps its times (is_available=false only)", async () => {
    renderTab();
    const sheet = await openDay("monday");
    fireEvent.click(within(sheet).getByRole("switch"));
    fireEvent.click(within(sheet).getByRole("button", { name: "save" }));
    await waitFor(() => expect(upsert()).toHaveBeenCalledWith({
      day_of_week: 1, start_time: "09:00", end_time: "17:00", is_available: false, break_start: null, break_end: null,
    }));
  });

  it("invalid hours show a translated message and cannot be saved", async () => {
    renderTab();
    const sheet = await openDay("monday");
    fireEvent.change(within(sheet).getByLabelText("hrsCloses"), { target: { value: "08:00" } });
    expect(within(sheet).getByRole("alert")).toHaveTextContent("hrsErrEndAfterStart");
    expect(within(sheet).getByRole("button", { name: "save" })).toBeDisabled();
  });

  it("a break is added with the old defaults and must sit inside the hours", async () => {
    renderTab();
    const sheet = await openDay("monday");
    fireEvent.click(within(sheet).getByRole("button", { name: /hrsAddBreak/ }));
    expect(within(sheet).getByLabelText("hrsBreakStart")).toHaveValue("13:00");
    fireEvent.change(within(sheet).getByLabelText("hrsBreakEnd"), { target: { value: "18:00" } });
    expect(within(sheet).getByRole("alert")).toHaveTextContent("hrsErrBreakInside");
    fireEvent.change(within(sheet).getByLabelText("hrsBreakEnd"), { target: { value: "14:00" } });
    fireEvent.click(within(sheet).getByRole("button", { name: "save" }));
    await waitFor(() => expect(upsert()).toHaveBeenCalledWith(
      expect.objectContaining({ day_of_week: 1, break_start: "13:00", break_end: "14:00" }),
    ));
  });

  it("apply to all OPEN days: confirms, writes open days only, closed days untouched", async () => {
    renderTab();
    const sheet = await openDay("monday");
    fireEvent.change(within(sheet).getByLabelText("hrsCloses"), { target: { value: "19:00" } });
    fireEvent.click(within(sheet).getByRole("button", { name: "hrsApplyOpen" }));
    const confirm = await screen.findByRole("alertdialog");
    expect(confirm).toHaveTextContent(/sunday.*tuesday.*wednesday.*thursday/);
    expect(confirm).not.toHaveTextContent(/friday|saturday/);
    expect(upsert()).not.toHaveBeenCalled();

    fireEvent.click(within(confirm).getByRole("button", { name: "hrsApplyConfirm" }));
    await waitFor(() => expect(upsert()).toHaveBeenCalledTimes(5));
    const days = upsert().mock.calls.map(([r]) => r.day_of_week).sort();
    expect(days).toEqual([0, 1, 2, 3, 4]);
    for (const [r] of upsert().mock.calls) expect(r).toMatchObject({ is_available: true, end_time: "19:00" });
  });

  it("a failed save shows the translated error, never the raw message", async () => {
    upsert().mockRejectedValue(new Error("permission denied for table provider_availability"));
    renderTab();
    const sheet = await openDay("monday");
    fireEvent.change(within(sheet).getByLabelText("hrsCloses"), { target: { value: "19:00" } });
    fireEvent.click(within(sheet).getByRole("button", { name: "save" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("bsSaveError"));
  });
});

describe("AvailabilityTab — other providers", () => {
  it("a fitness studio sees only closed days, titled to match its hub row", () => {
    profile = { ...profile, category: "fitness_studio" };
    renderTab();
    expect(screen.getByRole("heading", { name: "setupRowClosedDays" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /monday/ })).toBeNull();
    expect(screen.getByRole("button", { name: "hrsAddClosedDay" })).toBeInTheDocument();
  });

  it("monthly mode shows the default-hours row and calendar, not the week", () => {
    profile = { ...profile, availability_mode: "monthly", monthly_default_available: true, monthly_default_start: "10:00:00", monthly_default_end: "18:00:00" };
    renderTab();
    expect(screen.getByRole("button", { name: /hrsMonthlyDefaultTitle/ })).toBeInTheDocument();
    expect(screen.getByText("monthlyCalendarTitle")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /monday/ })).toBeNull();
  });

  it("removing a closed-day chip unblocks it", async () => {
    const future = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
    avail.blockedDates = [{ id: "b1", blocked_date: future, reason: null }];
    renderTab();
    fireEvent.click(screen.getByRole("button", { name: /hrsRemoveClosedDay/ }));
    await waitFor(() => expect((avail.unblockDate as ReturnType<typeof mutation>).mutateAsync).toHaveBeenCalledWith("b1"));
  });
});
