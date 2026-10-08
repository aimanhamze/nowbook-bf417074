import { describe, expect, it } from "vitest";
import { buildIcs, googleCalendarUrl, zonedTimeToUtc, type CalendarEvent } from "./calendarExport";
import { isInstagramInAppBrowser } from "./inAppBrowser";

const event: CalendarEvent = {
  uid: "b1",
  title: "מניקור ג׳ל — nailstest",
  date: "2026-10-11",
  time: "14:30",
  durationMinutes: 50,
  location: "סחנין, רחוב 1; קומה 2",
  description: "שורה 1\nשורה 2",
  url: "https://www.ehjezly.co.il/provider/p1",
};

describe("zonedTimeToUtc (Asia/Jerusalem)", () => {
  it("summer time is UTC+3", () => {
    expect(zonedTimeToUtc("2026-07-01", "10:00").toISOString()).toBe("2026-07-01T07:00:00.000Z");
  });
  it("winter time is UTC+2", () => {
    expect(zonedTimeToUtc("2026-12-01", "10:00").toISOString()).toBe("2026-12-01T08:00:00.000Z");
  });
  it("the day DST ends (2026-10-25) — a morning slot is already +2", () => {
    expect(zonedTimeToUtc("2026-10-25", "09:00").toISOString()).toBe("2026-10-25T07:00:00.000Z");
  });
  it("the day before DST ends is still +3", () => {
    expect(zonedTimeToUtc("2026-10-24", "23:30").toISOString()).toBe("2026-10-24T20:30:00.000Z");
  });
  it("the day DST starts (2027-03-26) — a morning slot is +3", () => {
    expect(zonedTimeToUtc("2027-03-26", "09:00").toISOString()).toBe("2027-03-26T06:00:00.000Z");
  });
});

describe("buildIcs", () => {
  const ics = buildIcs(event, new Date("2026-10-08T10:00:00Z"));

  it("is a CRLF VCALENDAR with UTC start/end", () => {
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics).toContain("DTSTART:20261011T113000Z\r\n");
    expect(ics).toContain("DTEND:20261011T122000Z\r\n");
    expect(ics).toContain("UID:b1@ehjezly.co.il\r\n");
  });

  it("escapes TEXT values", () => {
    const unfolded = ics.replace(/\r\n /g, "");
    expect(unfolded).toContain("LOCATION:סחנין\\, רחוב 1\\; קומה 2");
    expect(unfolded).toContain("DESCRIPTION:שורה 1\\nשורה 2");
  });

  it("folds long lines at 75 octets without splitting characters", () => {
    const long = buildIcs({ ...event, title: "א".repeat(80) });
    const encoder = new TextEncoder();
    for (const line of long.split("\r\n")) {
      expect(encoder.encode(line).length).toBeLessThanOrEqual(75);
    }
    expect(long.replace(/\r\n /g, "")).toContain(`SUMMARY:${"א".repeat(80)}`);
  });
});

describe("googleCalendarUrl", () => {
  it("carries the UTC range and the event text", () => {
    const url = new URL(googleCalendarUrl(event));
    expect(url.hostname).toBe("calendar.google.com");
    expect(url.searchParams.get("action")).toBe("TEMPLATE");
    expect(url.searchParams.get("dates")).toBe("20261011T113000Z/20261011T122000Z");
    expect(url.searchParams.get("text")).toBe(event.title);
    expect(url.searchParams.get("details")).toBe(`${event.description}\n${event.url}`);
  });
});

describe("isInstagramInAppBrowser", () => {
  it("detects Instagram on iOS and Android", () => {
    expect(isInstagramInAppBrowser("Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 339.0.3.12.91 (iPhone15,2; iOS 17_5; he_IL; he; scale=3.00; 1179x2556; 619461904)")).toBe(true);
    expect(isInstagramInAppBrowser("Mozilla/5.0 (Linux; Android 14; SM-S918B Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0.6478.71 Mobile Safari/537.36 Instagram 337.0.0.35.102 Android")).toBe(true);
  });
  it("leaves Safari, Chrome and Facebook alone", () => {
    expect(isInstagramInAppBrowser("Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1")).toBe(false);
    expect(isInstagramInAppBrowser("Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36")).toBe(false);
    expect(isInstagramInAppBrowser("Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/470.0]")).toBe(false);
  });
});
