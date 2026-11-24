import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import WeeklyHoursTable from "./WeeklyHoursTable";
import { getProviderStatus, type AvailabilityRow } from "@/lib/providerStatus";
import { getNextOpening, summarizeOpening } from "@/lib/openingSummary";
import type { MonthlySettings } from "@/lib/availabilityResolver";
import { translations, type Lang } from "@/lib/translations";

const WEEKLY: MonthlySettings = {
  availability_mode: "weekly",
  monthly_default_available: true,
  monthly_default_start: "09:00",
  monthly_default_end: "17:00",
};

const FRI = 5;

/** Sun–Thu 09:00–17:00, Fri 08:00–13:00, Sat closed. */
function week(friday: Partial<AvailabilityRow> = {}): AvailabilityRow[] {
  return Array.from({ length: 7 }, (_, dow): AvailabilityRow => (
    dow === FRI
      ? { day_of_week: FRI, start_time: "08:00", end_time: "13:00", is_available: true, ...friday }
      : { day_of_week: dow, start_time: "09:00", end_time: "17:00", is_available: dow !== 6 }
  ));
}
const BIWEEKLY = week({ repeat_every_weeks: 2, repeat_anchor_date: "2026-11-27" });

// The table now takes the page's opening summary (the collapsed row's text),
// so the helper builds it the way ProviderDetail does.
function renderTable(availability: AvailabilityRow[], lang: Lang = "en", staffEnabled = false) {
  const dict = translations[lang] as Record<string, string>;
  const t = (key: string) => dict[key] ?? key;
  const now = new Date();
  const status = getProviderStatus(availability, [], now);
  const opening = summarizeOpening(
    status,
    status.isOpen ? null : getNextOpening(now, WEEKLY, availability, [], []),
    now,
  );
  return render(
    <WeeklyHoursTable
      availability={availability}
      blockedDates={[]}
      status={status}
      opening={opening}
      staffEnabled={staffEnabled}
      lang={lang}
      t={t}
    />,
  );
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("WeeklyHoursTable — every-2-weeks line", () => {
  it("every-week providers get no line at all (unchanged)", () => {
    vi.setSystemTime(new Date(2026, 10, 22, 10)); // Sunday
    renderTable(week());
    expect(screen.queryByText(/Every 2 weeks/)).toBeNull();
  });

  it("a later row shows its hours plus 'Every 2 weeks · next: <date>'", () => {
    vi.setSystemTime(new Date(2026, 10, 22, 10)); // Sunday before the working Friday
    renderTable(BIWEEKLY);
    expect(screen.getByText("Every 2 weeks · next: 27 November")).toBeTruthy();
    expect(screen.getByText("08:00 - 13:00")).toBeTruthy();
  });

  it("the week of an off Friday points two weeks past the last working one", () => {
    vi.setSystemTime(new Date(2026, 10, 28, 10)); // Saturday after the working Friday
    renderTable(BIWEEKLY);
    expect(screen.getByText("Every 2 weeks · next: 11 December")).toBeTruthy();
  });

  it("today, on an off Friday: closed, and the line says when it is next", () => {
    vi.setSystemTime(new Date(2026, 11, 4, 10)); // off Friday
    renderTable(BIWEEKLY);
    expect(screen.getByText("Every 2 weeks · next: 11 December")).toBeTruthy();
    expect(screen.getAllByText("Closed").length).toBeGreaterThan(0);
  });

  it("today, on a working Friday: open, and the line says Today", () => {
    vi.setSystemTime(new Date(2026, 11, 11, 10)); // working Friday
    renderTable(BIWEEKLY);
    expect(screen.getByText("Every 2 weeks · Today")).toBeTruthy();
    expect(screen.getByText("08:00 - 13:00")).toBeTruthy();
  });

  it("a broken anchor shows no line (the day behaves as every week)", () => {
    vi.setSystemTime(new Date(2026, 10, 22, 10));
    renderTable(week({ repeat_every_weeks: 2, repeat_anchor_date: "2026-11-28" }));
    expect(screen.queryByText(/Every 2 weeks/)).toBeNull();
  });

  it("Hebrew and Arabic", () => {
    vi.setSystemTime(new Date(2026, 10, 22, 10));
    const { unmount } = renderTable(BIWEEKLY, "he");
    expect(screen.getByText("כל שבועיים · הבא: 27 נובמבר")).toBeTruthy();
    unmount();
    renderTable(BIWEEKLY, "ar");
    expect(screen.getByText("كل أسبوعين · القادم: 27 نوفمبر")).toBeTruthy();
  });
});

describe("WeeklyHoursTable — collapsed today row", () => {
  const toggle = () => screen.getByRole("button");
  const list = () => document.getElementById(toggle().getAttribute("aria-controls")!)!;

  it("starts collapsed and expands in place to seven days starting today", () => {
    vi.setSystemTime(new Date(2026, 10, 22, 10)); // Sunday, open
    renderTable(week());
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
    expect(list().hidden).toBe(true);
    fireEvent.click(toggle());
    expect(toggle().getAttribute("aria-expanded")).toBe("true");
    expect(list().hidden).toBe(false);
    const rows = Array.from(list().querySelectorAll("li")).map((li) => li.textContent);
    expect(rows).toHaveLength(7);
    expect(rows[0]).toBe("Sunday09:00 - 17:00");
    expect(rows[6]).toBe("SaturdayClosed");
  });

  it("open: 'Open now · until <close>'", () => {
    vi.setSystemTime(new Date(2026, 10, 22, 10));
    renderTable(week());
    expect(toggle().textContent).toBe("Today · SundayOpen now · until 17:00");
  });

  it("before opening: 'Closed now · opens at <time>', no bare hours", () => {
    vi.setSystemTime(new Date(2026, 10, 22, 7));
    renderTable(week());
    expect(toggle().textContent).toBe("Today · SundayClosed now · opens at 09:00");
  });

  it("after closing: 'Closed at <time>' and the next opening", () => {
    vi.setSystemTime(new Date(2026, 10, 22, 19));
    renderTable(week());
    expect(toggle().textContent).toBe("Today · SundayClosed at 17:00 · opens tomorrow 09:00");
  });

  it("after closing, Hebrew and Arabic", () => {
    vi.setSystemTime(new Date(2026, 10, 22, 19));
    const { unmount } = renderTable(week(), "he");
    expect(toggle().textContent).toContain("נסגר ב-17:00 · נפתח מחר 09:00");
    unmount();
    renderTable(week(), "ar");
    expect(toggle().textContent).toContain("أغلق الساعة 17:00 · يفتح غدًا 09:00");
  });

  it("a closed day has no hours in the today row", () => {
    vi.setSystemTime(new Date(2026, 10, 28, 10)); // Saturday, closed
    renderTable(week());
    expect(toggle().textContent).toBe("Today · SaturdayClosed now · opens tomorrow 09:00");
  });

  it("the staff-hours note shows only for staff-enabled providers, even collapsed", () => {
    vi.setSystemTime(new Date(2026, 10, 22, 10));
    const { unmount } = renderTable(week(), "en", true);
    expect(screen.getByText(/Individual team members may work different hours/)).toBeTruthy();
    unmount();
    renderTable(week());
    expect(screen.queryByText(/Individual team members/)).toBeNull();
  });

  it("no text under 13px and no muted-foreground anywhere in the table", () => {
    vi.setSystemTime(new Date(2026, 12 - 1, 4, 10)); // off Friday: closed row + repeat line
    const { container } = renderTable(BIWEEKLY, "en", true);
    expect(container.innerHTML).not.toMatch(/text-\[1[0-2]px\]|text-xs|muted-foreground/);
  });
});
