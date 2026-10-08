/**
 * "Add to calendar" for a booking: an .ics file (Apple Calendar, Outlook, any
 * calendar app) and a Google Calendar link.
 *
 * Booking date/time are stored as Israel wall-clock text, so they are turned
 * into a UTC instant via the Asia/Jerusalem zone — never via the device's own
 * zone, which may be anything for a traveller.
 */

export const BOOKING_TIME_ZONE = "Asia/Jerusalem";

export interface CalendarEvent {
  uid: string;
  title: string;
  /** "YYYY-MM-DD" in BOOKING_TIME_ZONE. */
  date: string;
  /** "HH:MM" in BOOKING_TIME_ZONE. */
  time: string;
  durationMinutes: number;
  location?: string;
  description?: string;
  url?: string;
}

/** Offset (ms) of `timeZone` from UTC at instant `utcMs`. */
function zoneOffsetMs(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - utcMs;
}

/** Wall-clock date + time in `timeZone` → the UTC instant. */
export function zonedTimeToUtc(date: string, time: string, timeZone = BOOKING_TIME_ZONE): Date {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const wall = Date.UTC(y, m - 1, d, hh, mm);
  // Two passes settle the offset across a DST change between the guess and
  // the answer.
  let utc = wall - zoneOffsetMs(wall, timeZone);
  utc = wall - zoneOffsetMs(utc, timeZone);
  return new Date(utc);
}

/** 20261011T113000Z */
function utcStamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function eventRange(e: CalendarEvent): { start: Date; end: Date } {
  const start = zonedTimeToUtc(e.date, e.time);
  return { start, end: new Date(start.getTime() + e.durationMinutes * 60_000) };
}

/** RFC 5545 TEXT escaping. */
function escapeText(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** Fold to 75 octets per line (RFC 5545 §3.1) without splitting a character —
 *  Hebrew and Arabic are multi-byte in UTF-8. */
function fold(line: string): string {
  const encoder = new TextEncoder();
  const out: string[] = [];
  let current = "";
  let bytes = 0;
  for (const ch of line) {
    const n = encoder.encode(ch).length;
    const limit = out.length === 0 ? 75 : 74; // continuation lines start with a space
    if (bytes + n > limit) {
      out.push(current);
      current = "";
      bytes = 0;
    }
    current += ch;
    bytes += n;
  }
  out.push(current);
  return out.join("\r\n ");
}

export function buildIcs(e: CalendarEvent, now: Date = new Date()): string {
  const { start, end } = eventRange(e);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Ehjezly//Booking//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${e.uid}@ehjezly.co.il`,
    `DTSTAMP:${utcStamp(now)}`,
    `DTSTART:${utcStamp(start)}`,
    `DTEND:${utcStamp(end)}`,
    `SUMMARY:${escapeText(e.title)}`,
    ...(e.location ? [`LOCATION:${escapeText(e.location)}`] : []),
    ...(e.description ? [`DESCRIPTION:${escapeText(e.description)}`] : []),
    ...(e.url ? [`URL:${e.url}`] : []),
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.map(fold).join("\r\n") + "\r\n";
}

export function googleCalendarUrl(e: CalendarEvent): string {
  const { start, end } = eventRange(e);
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: e.title,
    dates: `${utcStamp(start)}/${utcStamp(end)}`,
    ctz: BOOKING_TIME_ZONE,
  });
  if (e.location) params.set("location", e.location);
  const details = [e.description, e.url].filter(Boolean).join("\n");
  if (details) params.set("details", details);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/**
 * Hand the .ics to the platform. iOS Safari opens a text/calendar data URL in
 * its "Add to Calendar" sheet, while a download attribute would only save the
 * file to Files; elsewhere a named download opens in the default calendar app.
 */
export function openIcs(ics: string, filename: string): void {
  const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (isIos) {
    window.location.href = `data:text/calendar;charset=utf-8,${encodeURIComponent(ics)}`;
    return;
  }
  const url = URL.createObjectURL(new Blob([ics], { type: "text/calendar;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
