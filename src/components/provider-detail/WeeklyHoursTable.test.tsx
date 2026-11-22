import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import WeeklyHoursTable from "./WeeklyHoursTable";
import { getProviderStatus, type AvailabilityRow } from "@/lib/providerStatus";
import { translations, type Lang } from "@/lib/translations";

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

function renderTable(availability: AvailabilityRow[], lang: Lang = "en") {
  const dict = translations[lang] as Record<string, string>;
  const t = (key: string) => dict[key] ?? key;
  const status = getProviderStatus(availability, [], new Date());
  return render(
    <WeeklyHoursTable availability={availability} blockedDates={[]} status={status} staffEnabled={false} lang={lang} t={t} />,
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
