import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import MonthlyHoursTable from "./MonthlyHoursTable";
import type { MonthlySettings } from "@/lib/availabilityResolver";
import { translations } from "@/lib/translations";

// Open every date 09:00–17:00 unless blocked.
const MONTHLY: MonthlySettings = {
  availability_mode: "monthly",
  monthly_default_available: true,
  monthly_default_start: "09:00",
  monthly_default_end: "17:00",
};

function renderTable(blockedDates: string[] = [], bookingWindowDays = 14, staffEnabled = false) {
  const dict = translations.en as Record<string, string>;
  return render(
    <MonthlyHoursTable
      monthlySettings={MONTHLY}
      blockedDates={blockedDates}
      overrides={[]}
      bookingWindowDays={bookingWindowDays}
      staffEnabled={staffEnabled}
      lang="en"
      t={(key) => dict[key] ?? key}
    />,
  );
}

const toggle = () => screen.getAllByRole("button")[0];
const list = () => document.getElementById(toggle().getAttribute("aria-controls")!)!;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("MonthlyHoursTable — collapsed today row", () => {
  it("starts collapsed; expands to 7 dates, then to the booking window", () => {
    vi.setSystemTime(new Date(2026, 10, 22, 10)); // Sunday 22 November
    renderTable();
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
    expect(list().hidden).toBe(true);
    fireEvent.click(toggle());
    expect(list().hidden).toBe(false);
    const rows = () => Array.from(list().querySelectorAll("li")).map((li) => li.textContent);
    expect(rows()).toHaveLength(7);
    expect(rows()[0]).toBe("22 November · Sunday09:00 - 17:00");
    expect(rows()[1]).toBe("Tomorrow · 23 November · Monday09:00 - 17:00");
    fireEvent.click(screen.getByText("Show more days"));
    expect(rows()).toHaveLength(14);
  });

  it("open, before opening, after closing", () => {
    vi.setSystemTime(new Date(2026, 10, 22, 10));
    const open = renderTable();
    expect(toggle().textContent).toBe("TodayOpen now · until 17:00");
    open.unmount();

    vi.setSystemTime(new Date(2026, 10, 22, 7));
    const before = renderTable();
    expect(toggle().textContent).toBe("TodayClosed now · opens at 09:00");
    before.unmount();

    vi.setSystemTime(new Date(2026, 10, 22, 19));
    renderTable();
    expect(toggle().textContent).toBe("TodayClosed at 17:00 · opens tomorrow 09:00");
  });

  it("a blocked today is closed with the next opening, and its row says Closed", () => {
    vi.setSystemTime(new Date(2026, 10, 22, 10));
    renderTable(["2026-11-22", "2026-11-23"]);
    expect(toggle().textContent).toBe("TodayClosed now · opens Tuesday 09:00");
    expect(list().querySelector("li")!.textContent).toBe("22 November · SundayClosed");
  });

  it("no 'show more' when the window is a week or less; staff note; no small or muted text", () => {
    vi.setSystemTime(new Date(2026, 10, 22, 10));
    const { container } = renderTable(["2026-11-23"], 7, true);
    expect(screen.queryByText("Show more days")).toBeNull();
    expect(screen.getByText(/Individual team members may work different hours/)).toBeTruthy();
    expect(container.innerHTML).not.toMatch(/text-\[1[0-2]px\]|text-xs|muted-foreground/);
  });
});
