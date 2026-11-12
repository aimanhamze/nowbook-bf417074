// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

/**
 * Special opening days: what the sheet sends to save_date_openings (single
 * date, range with and without already-open days, blocked replacement after a
 * confirm), the warnings, and removal showing that day's booking count.
 * Today is pinned to Thu 2026-11-12. The week is Sun-Thu open, Fri-Sat closed.
 */

const mutation = () => ({ isPending: false, mutateAsync: vi.fn().mockResolvedValue(1) });
let avail: Record<string, unknown>;
let profile: Record<string, unknown>;
let staff: { id: string; name: string }[];
let staffHours: Map<string, Map<number, { is_available: boolean }>>;
let bookingCount: { data: number | undefined; isLoading: boolean };

const week = () =>
  [0, 1, 2, 3, 4, 5, 6].map((d) => ({
    id: `a${d}`, day_of_week: d, is_available: d <= 4, start_time: "09:00:00", end_time: "17:00:00",
    break_start: null, break_end: null,
  }));

vi.mock("@/hooks/useProviderAvailability", () => ({
  useProviderAvailability: () => avail,
  useDayActiveBookingCount: (date: string | null) => (date ? bookingCount : { data: undefined, isLoading: false }),
}));
vi.mock("@/hooks/useProviderProfile", () => ({ useProviderProfile: () => ({ profile }) }));
vi.mock("@/hooks/useProviderStaff", () => ({ useProviderStaff: () => ({ activeStaff: staff }) }));
vi.mock("@/hooks/useProviderStaffHours", () => ({ useProviderStaffHours: () => ({ hoursByStaff: staffHours }) }));
vi.mock("@/components/branch/BranchSuffix", () => ({ BranchSuffix: () => null }));
vi.mock("@/contexts/LangContext", () => ({
  useLang: () => ({ t: (k: string) => k, isRtl: true, lang: "he" }),
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const { SpecialOpeningsGroup } = await import("./SpecialOpeningsGroup");

const save = () => (avail.saveDateOpenings as ReturnType<typeof mutation>).mutateAsync;

const openSheet = async () => {
  render(<SpecialOpeningsGroup />);
  fireEvent.click(screen.getByRole("button", { name: "openingsAdd" }));
  return screen.findByRole("dialog");
};
const day = (sheet: HTMLElement, n: number) =>
  fireEvent.click(within(sheet).getAllByRole("gridcell", { name: String(n) })[0]);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 10, 12, 10, 0));
  avail = {
    availability: week(), blockedDates: [], dateOverrides: [],
    saveDateOpenings: mutation(), deleteDateOverride: mutation(),
  };
  profile = { id: "pp1", category: "barber", availability_mode: "weekly", booking_window_days: 14 };
  staff = [];
  staffHours = new Map();
  bookingCount = { data: 0, isLoading: false };
  toast.success.mockClear();
  toast.error.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("SpecialOpeningsGroup — adding", () => {
  it("one day: writes that date with the window, no break, no block replacement", async () => {
    const sheet = await openSheet();
    expect(within(sheet).queryByRole("switch", { name: "editDayOpenLabel" })).toBeNull();
    day(sheet, 13);
    fireEvent.change(within(sheet).getByLabelText("hrsOpens"), { target: { value: "10:00" } });
    fireEvent.change(within(sheet).getByLabelText("hrsCloses"), { target: { value: "14:00" } });
    fireEvent.click(within(sheet).getByRole("button", { name: "save" }));
    await waitFor(() => expect(save()).toHaveBeenCalledTimes(1));
    expect(save()).toHaveBeenCalledWith({
      dates: ["2026-11-13"], start: "10:00", end: "14:00", breakStart: null, breakEnd: null, replaceBlocks: false,
    });
    expect(toast.success).toHaveBeenCalledWith("openingsSaved");
  });

  it("an optional break is sent with the window", async () => {
    const sheet = await openSheet();
    day(sheet, 14);
    fireEvent.click(within(sheet).getByRole("button", { name: /hrsAddBreak/ }));
    fireEvent.click(within(sheet).getByRole("button", { name: "save" }));
    await waitFor(() => expect(save()).toHaveBeenCalledWith(
      expect.objectContaining({ dates: ["2026-11-14"], breakStart: "13:00", breakEnd: "14:00" }),
    ));
  });

  it("invalid hours cannot be saved", async () => {
    const sheet = await openSheet();
    day(sheet, 13);
    fireEvent.change(within(sheet).getByLabelText("hrsCloses"), { target: { value: "08:00" } });
    expect(within(sheet).getByRole("alert")).toHaveTextContent("hrsErrEndAfterStart");
    expect(within(sheet).getByRole("button", { name: "save" })).toBeDisabled();
  });

  it("nothing picked: Save is disabled", async () => {
    const sheet = await openSheet();
    expect(within(sheet).getByRole("button", { name: "save" })).toBeDisabled();
  });

  it("range: only normally-closed days by default", async () => {
    const sheet = await openSheet();
    fireEvent.click(within(sheet).getByRole("radio", { name: "openingsRange" }));
    day(sheet, 12);
    expect(within(sheet).getByRole("button", { name: "save" })).toBeDisabled();
    day(sheet, 16);
    fireEvent.click(within(sheet).getByRole("button", { name: "save" }));
    await waitFor(() => expect(save()).toHaveBeenCalledWith(
      expect.objectContaining({ dates: ["2026-11-13", "2026-11-14"], replaceBlocks: false }),
    ));
  });

  it("range with 'include days already open' sends every day", async () => {
    const sheet = await openSheet();
    fireEvent.click(within(sheet).getByRole("radio", { name: "openingsRange" }));
    day(sheet, 12);
    day(sheet, 16);
    fireEvent.click(within(sheet).getByRole("switch", { name: "openingsIncludeOpen" }));
    fireEvent.click(within(sheet).getByRole("button", { name: "save" }));
    await waitFor(() => expect(save()).toHaveBeenCalledWith(
      expect.objectContaining({ dates: ["2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15", "2026-11-16"] }),
    ));
  });

  it("a range of only open days says so and cannot be saved", async () => {
    const sheet = await openSheet();
    fireEvent.click(within(sheet).getByRole("radio", { name: "openingsRange" }));
    day(sheet, 15);
    day(sheet, 19);
    expect(within(sheet).getByText("openingsNothing")).toBeInTheDocument();
    expect(within(sheet).getByRole("button", { name: "save" })).toBeDisabled();
  });

  it("range is capped at the booking window: later days are disabled", async () => {
    profile = { ...profile, booking_window_days: 7 };
    const sheet = await openSheet();
    fireEvent.click(within(sheet).getByRole("radio", { name: "openingsRange" }));
    day(sheet, 13);
    // 13 + 7 - 1 = 19 is the last allowed end.
    expect(within(sheet).getAllByRole("gridcell", { name: "19" })[0]).not.toBeDisabled();
    expect(within(sheet).getAllByRole("gridcell", { name: "20" })[0]).toBeDisabled();
  });

  it("past days are disabled", async () => {
    const sheet = await openSheet();
    expect(within(sheet).getAllByRole("gridcell", { name: "11" })[0]).toBeDisabled();
  });

  it("a blocked date: warns, asks, then replaces the block", async () => {
    avail.blockedDates = [{ id: "b1", blocked_date: "2026-11-13", reason: null }];
    const sheet = await openSheet();
    day(sheet, 13);
    expect(within(sheet).getByText("openingsWarnBlocked")).toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole("button", { name: "save" }));
    const confirm = await screen.findByRole("alertdialog");
    expect(confirm).toHaveTextContent("openingsReplaceTitle");
    expect(save()).not.toHaveBeenCalled();
    fireEvent.click(within(confirm).getByRole("button", { name: "openingsReplaceConfirm" }));
    await waitFor(() => expect(save()).toHaveBeenCalledWith(
      expect.objectContaining({ dates: ["2026-11-13"], replaceBlocks: true }),
    ));
  });

  it("beyond the booking window: warns, still saves", async () => {
    profile = { ...profile, booking_window_days: 3 };
    const sheet = await openSheet();
    day(sheet, 20);
    expect(within(sheet).getByText("openingsWarnWindow")).toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole("button", { name: "save" }));
    await waitFor(() => expect(save()).toHaveBeenCalledWith(expect.objectContaining({ dates: ["2026-11-20"] })));
  });

  it("staff with their own weekly hours who are off that weekday: warns", async () => {
    staff = [{ id: "s1", name: "Rami" }, { id: "s2", name: "Dana" }];
    staffHours = new Map([["s1", new Map([0, 1, 2, 3, 4].map((d) => [d, { is_available: true }]))]]);
    const sheet = await openSheet();
    day(sheet, 13);
    expect(within(sheet).getByText("openingsWarnStaff")).toBeInTheDocument();
  });

  it("no warning for staff without their own hours", async () => {
    staff = [{ id: "s2", name: "Dana" }];
    const sheet = await openSheet();
    day(sheet, 13);
    expect(within(sheet).queryByText("openingsWarnStaff")).toBeNull();
  });

  it("a refused save shows a translated message, never the raw one", async () => {
    save().mockRejectedValue({ message: "DATE_IN_PAST" });
    const sheet = await openSheet();
    day(sheet, 13);
    fireEvent.click(within(sheet).getByRole("button", { name: "save" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("openingsErrPast"));
  });
});

describe("SpecialOpeningsGroup — list and removal", () => {
  const row = (date: string, patch: Record<string, unknown> = {}) => ({
    id: `o-${date}`, override_date: date, is_available: true, start_time: "10:00", end_time: "14:00",
    break_start: null, break_end: null, ...patch,
  });

  it("lists upcoming openings only, sorted", () => {
    avail.dateOverrides = [row("2026-11-20"), row("2026-11-01"), row("2026-11-13")];
    render(<SpecialOpeningsGroup />);
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("10:00 – 14:00");
  });

  it("empty state", () => {
    render(<SpecialOpeningsGroup />);
    expect(screen.getByText("openingsNone")).toBeInTheDocument();
  });

  it("removal shows that day's booking count, then deletes", async () => {
    bookingCount = { data: 2, isLoading: false };
    avail.dateOverrides = [row("2026-11-13")];
    render(<SpecialOpeningsGroup />);
    fireEvent.click(screen.getByRole("button", { name: "hrsRemoveClosedDay" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByTestId("opening-booking-count")).toHaveTextContent("openingsDeleteBookings");
    fireEvent.click(within(dialog).getByRole("button", { name: "openingsDeleteConfirm" }));
    await waitFor(() =>
      expect((avail.deleteDateOverride as ReturnType<typeof mutation>).mutateAsync).toHaveBeenCalledWith("o-2026-11-13"),
    );
  });

  it("removal with no bookings says so; confirm waits while counting", async () => {
    avail.dateOverrides = [row("2026-11-13")];
    bookingCount = { data: undefined, isLoading: true };
    const { rerender } = render(<SpecialOpeningsGroup />);
    fireEvent.click(screen.getByRole("button", { name: "hrsRemoveClosedDay" }));
    let dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByRole("button", { name: "openingsDeleteConfirm" })).toBeDisabled();
    bookingCount = { data: 0, isLoading: false };
    rerender(<SpecialOpeningsGroup />);
    dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByTestId("opening-booking-count")).toHaveTextContent("openingsDeleteNoBookings");
  });
});
