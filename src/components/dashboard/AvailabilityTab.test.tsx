// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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

const fetchNames = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/useProviderAvailability", () => ({
  useProviderAvailability: () => avail,
  useDayActiveBookingCount: () => ({ data: 0, isLoading: false }),
  fetchUpcomingBookingNames: (...args: unknown[]) => fetchNames(...args),
}));
vi.mock("@/hooks/useProviderStaff", () => ({ useProviderStaff: () => ({ activeStaff: [] }) }));
vi.mock("@/hooks/useProviderStaffHours", () => ({ useProviderStaffHours: () => ({ hoursByStaff: new Map() }) }));
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
  fetchNames.mockReset();
  fetchNames.mockResolvedValue([]);
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

  it("a fitness studio gets no special opening days", () => {
    profile = { ...profile, category: "fitness_studio" };
    renderTab();
    expect(screen.queryByText("openingsTitle")).toBeNull();
  });

  it("an academy gets no special opening days", () => {
    profile = { ...profile, category: "academy" };
    renderTab();
    expect(screen.queryByText("openingsTitle")).toBeNull();
  });

  it("monthly mode gets no special opening days (its calendar edits dates)", () => {
    profile = { ...profile, availability_mode: "monthly" };
    renderTab();
    expect(screen.queryByText("openingsTitle")).toBeNull();
  });

  it("a weekly provider sees special opening days between the week and closed days", () => {
    renderTab();
    const headings = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(headings).toEqual(["openingsTitle", "setupRowClosedDays"]);
    expect(screen.getByRole("button", { name: "openingsAdd" })).toBeInTheDocument();
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

// ── Every 2 weeks (feat/biweekly-weekday) ───────────────────────────────────
// Today is fixed at Sun 22 Nov 2026, so Friday's two choices are 27 Nov and
// 4 Dec, and Monday's are 23 and 30 Nov. Dates render in Hebrew (lang "he").

describe("AvailabilityTab — every 2 weeks", () => {
  const FRI_HOURS = { day_of_week: 5, start_time: "08:00", end_time: "13:00", is_available: true, break_start: null, break_end: null };
  /** Friday open 08–13, plus any repeat columns. */
  const setFriday = (extra: Record<string, unknown> = {}) => {
    avail.availability = seed().map((r) => (r.day_of_week === 5 ? { ...r, ...FRI_HOURS, start_time: "08:00:00", end_time: "13:00:00", ...extra } : r));
  };
  const booking = (id: string, booking_date: string, booking_time: string, name: string | null) => ({ id, booking_date, booking_time, name });

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 10, 22, 10, 0));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("switching to every 2 weeks asks for the next working date before Save is allowed", async () => {
    setFriday();
    renderTab();
    const sheet = await openDay("friday");
    expect(within(sheet).getByRole("radio", { name: "hrsRepeatWeekly" })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(within(sheet).getByRole("radio", { name: "hrsRepeatBiweekly" }));
    expect(within(sheet).getByText("hrsRepeatPick")).toBeInTheDocument();
    expect(within(sheet).getByRole("radio", { name: "27 נובמבר" })).toHaveAttribute("aria-checked", "false");
    expect(within(sheet).getByRole("radio", { name: "4 דצמבר" })).toBeInTheDocument();
    expect(within(sheet).getByRole("button", { name: "save" })).toBeDisabled();
    expect(within(sheet).getByRole("button", { name: "hrsApplyOpen" })).toBeDisabled();
  });

  it("Save writes the hours plus the rule, after checking bookings from today", async () => {
    setFriday();
    renderTab();
    const sheet = await openDay("friday");
    fireEvent.click(within(sheet).getByRole("radio", { name: "hrsRepeatBiweekly" }));
    fireEvent.click(within(sheet).getByRole("radio", { name: "27 נובמבר" }));
    expect(within(sheet).getByText("hrsRepeatHint")).toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole("button", { name: "save" }));
    await waitFor(() => expect(upsert()).toHaveBeenCalledTimes(1));
    expect(fetchNames).toHaveBeenCalledWith("pp1", "2026-11-22");
    expect(upsert()).toHaveBeenCalledWith({
      ...FRI_HOURS, repeat_every_weeks: 2, repeat_anchor_date: "2026-11-27",
    });
  });

  it("warns with date + time + name for bookings on days that will close; Cancel saves nothing", async () => {
    setFriday();
    avail.blockedDates = [{ id: "b1", blocked_date: "2026-12-18" }];
    avail.dateOverrides = [{ override_date: "2027-01-01", is_available: true, start_time: "08:00", end_time: "13:00", break_start: null, break_end: null }];
    fetchNames.mockResolvedValue([
      booking("k1", "2026-11-23", "10:00", "Monday Customer"),   // not a Friday
      booking("k2", "2026-11-27", "09:00", "Working Week"),      // a working Friday: stays open
      booking("k3", "2026-12-04", "11:00", null),                // off Friday, no name -> fallback
      booking("k4", "2026-12-04", "10:00", "דנה כהן"),           // off Friday, walk-in name
      booking("k5", "2026-12-18", "12:00", "Blocked Already"),   // off Friday, already blocked
      booking("k6", "2027-01-01", "09:30", "Kept By Opening"),   // off Friday, a date-opening keeps it open
      booking("k7", "2027-01-15", "08:30", "user@example.com"),  // off Friday, an email is never shown
    ]);
    renderTab();
    const sheet = await openDay("friday");
    fireEvent.click(within(sheet).getByRole("radio", { name: "hrsRepeatBiweekly" }));
    fireEvent.click(within(sheet).getByRole("radio", { name: "27 נובמבר" }));
    fireEvent.click(within(sheet).getByRole("button", { name: "save" }));

    const warn = await screen.findByRole("alertdialog");
    expect(warn).toHaveTextContent("hrsRepeatWarnTitle");
    const headings = within(warn).getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(headings).toEqual(["יום שישי 4 דצמבר", "יום שישי 15 ינואר"]);
    const items = within(warn).getAllByRole("listitem").map((li) => li.textContent);
    expect(items).toEqual(["10:00דנה כהן", "11:00customerFallback", "08:30customerFallback"]);
    expect(warn).not.toHaveTextContent(/Monday Customer|Working Week|Blocked Already|Kept By Opening|user@example/);
    expect(upsert()).not.toHaveBeenCalled();

    fireEvent.click(within(warn).getByRole("button", { name: "cancel" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(upsert()).not.toHaveBeenCalled();
  });

  it("Save anyway writes the rule; nothing is cancelled", async () => {
    setFriday();
    fetchNames.mockResolvedValue([booking("k1", "2026-12-04", "10:00", "דנה כהן")]);
    renderTab();
    const sheet = await openDay("friday");
    fireEvent.click(within(sheet).getByRole("radio", { name: "hrsRepeatBiweekly" }));
    fireEvent.click(within(sheet).getByRole("radio", { name: "27 נובמבר" }));
    fireEvent.click(within(sheet).getByRole("button", { name: "save" }));
    const warn = await screen.findByRole("alertdialog");
    fireEvent.click(within(warn).getByRole("button", { name: "hrsRepeatWarnConfirm" }));
    await waitFor(() => expect(upsert()).toHaveBeenCalledTimes(1));
    expect(upsert()).toHaveBeenCalledWith(expect.objectContaining({ repeat_every_weeks: 2, repeat_anchor_date: "2026-11-27" }));
  });

  it("a stored rule opens with its next working date selected; an unchanged Save writes and checks nothing", async () => {
    setFriday({ repeat_every_weeks: 2, repeat_anchor_date: "2026-11-13" }); // same rhythm as 27 Nov
    renderTab();
    expect(screen.getByRole("button", { name: /friday.*hoursEveryTwoWeeks/ })).toBeInTheDocument();
    const sheet = await openDay("friday");
    expect(within(sheet).getByRole("radio", { name: "hrsRepeatBiweekly" })).toHaveAttribute("aria-checked", "true");
    expect(within(sheet).getByRole("radio", { name: "27 נובמבר" })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(within(sheet).getByRole("button", { name: "save" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(upsert()).not.toHaveBeenCalled();
    expect(fetchNames).not.toHaveBeenCalled();
  });

  it("changing the anchor to the other week is a change (and is checked)", async () => {
    setFriday({ repeat_every_weeks: 2, repeat_anchor_date: "2026-11-13" });
    renderTab();
    const sheet = await openDay("friday");
    fireEvent.click(within(sheet).getByRole("radio", { name: "4 דצמבר" }));
    fireEvent.click(within(sheet).getByRole("button", { name: "save" }));
    await waitFor(() => expect(upsert()).toHaveBeenCalledTimes(1));
    expect(fetchNames).toHaveBeenCalledTimes(1);
    expect(upsert()).toHaveBeenCalledWith(expect.objectContaining({ repeat_every_weeks: 2, repeat_anchor_date: "2026-12-04" }));
  });

  it("switching back to every week clears the anchor", async () => {
    setFriday({ repeat_every_weeks: 2, repeat_anchor_date: "2026-11-27" });
    renderTab();
    const sheet = await openDay("friday");
    fireEvent.click(within(sheet).getByRole("radio", { name: "hrsRepeatWeekly" }));
    expect(within(sheet).queryByRole("radio", { name: "27 נובמבר" })).toBeNull();
    fireEvent.click(within(sheet).getByRole("button", { name: "save" }));
    await waitFor(() => expect(upsert()).toHaveBeenCalledWith({
      ...FRI_HOURS, repeat_every_weeks: 1, repeat_anchor_date: null,
    }));
    expect(screen.queryByRole("alertdialog")).toBeNull(); // every week never closes a day
  });

  it("closing the day keeps the stored rule (no repeat columns written)", async () => {
    setFriday({ repeat_every_weeks: 2, repeat_anchor_date: "2026-11-27" });
    renderTab();
    const sheet = await openDay("friday");
    fireEvent.click(within(sheet).getByRole("switch"));
    expect(within(sheet).queryByRole("radio", { name: "hrsRepeatBiweekly" })).toBeNull();
    fireEvent.click(within(sheet).getByRole("button", { name: "save" }));
    await waitFor(() => expect(upsert()).toHaveBeenCalledWith({ ...FRI_HOURS, is_available: false }));
    expect(fetchNames).not.toHaveBeenCalled();
  });

  it("apply to all open days: the rule goes on this day only; the others get hours only", async () => {
    renderTab();
    const sheet = await openDay("monday");
    fireEvent.change(within(sheet).getByLabelText("hrsCloses"), { target: { value: "19:00" } });
    fireEvent.click(within(sheet).getByRole("radio", { name: "hrsRepeatBiweekly" }));
    fireEvent.click(within(sheet).getByRole("radio", { name: "23 נובמבר" }));
    fireEvent.click(within(sheet).getByRole("button", { name: "hrsApplyOpen" }));
    const confirm = await screen.findByRole("alertdialog");
    fireEvent.click(within(confirm).getByRole("button", { name: "hrsApplyConfirm" }));
    await waitFor(() => expect(upsert()).toHaveBeenCalledTimes(5));
    for (const [r] of upsert().mock.calls) {
      if (r.day_of_week === 1) {
        expect(r).toMatchObject({ end_time: "19:00", repeat_every_weeks: 2, repeat_anchor_date: "2026-11-23" });
      } else {
        expect(r).toMatchObject({ end_time: "19:00" });
        expect(r).not.toHaveProperty("repeat_every_weeks");
        expect(r).not.toHaveProperty("repeat_anchor_date");
      }
    }
  });

  it("if the booking check fails, nothing is saved and a translated error shows", async () => {
    setFriday();
    fetchNames.mockRejectedValue(new Error("permission denied for table bookings"));
    renderTab();
    const sheet = await openDay("friday");
    fireEvent.click(within(sheet).getByRole("radio", { name: "hrsRepeatBiweekly" }));
    fireEvent.click(within(sheet).getByRole("radio", { name: "27 נובמבר" }));
    fireEvent.click(within(sheet).getByRole("button", { name: "save" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("hrsRepeatCheckError"));
    expect(upsert()).not.toHaveBeenCalled();
  });
});
