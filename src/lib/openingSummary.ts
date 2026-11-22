// "Open now · until 20:00" / "Closed now · opens Tuesday 17:00" for the
// customer provider page (the status line and the hours row).
//
// Open/closed itself still comes from getProviderStatus (shared with Home).
// The NEXT opening is found by asking resolveDayHours for each coming date, so
// blocked dates, date-openings and every-2-weeks off weeks are respected by
// the same code that decides what is bookable.

import { format } from "date-fns";
import { ar, enUS, he } from "date-fns/locale";
import {
  resolveDayHours,
  type DateOverrideRow,
  type MonthlySettings,
  type WeeklyRow,
} from "@/lib/availabilityResolver";
import type { ProviderStatus } from "@/lib/providerStatus";
import type { Lang } from "@/lib/translations";

/** How far ahead the next opening is searched: today plus this many days. */
export const NEXT_OPENING_HORIZON_DAYS = 14;

export interface NextOpening {
  /** Local midnight of the day it opens. */
  date: Date;
  /** "HH:MM" */
  time: string;
  /** 0 = later today, 1 = tomorrow, … */
  daysAhead: number;
}

function hhmm(value: string | null | undefined): string | null {
  const m = /^(\d{2}):(\d{2})/.exec(value ?? "");
  return m ? `${m[1]}:${m[2]}` : null;
}

function minutes(time: string): number {
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
}

/**
 * The next time the provider opens, strictly after `now`: later today if
 * today's window has not started yet, otherwise the first open date within the
 * horizon. null when nothing opens in that range.
 */
export function getNextOpening(
  now: Date,
  settings: MonthlySettings,
  weeklyRows: WeeklyRow[],
  blockedDates: string[],
  overrides: DateOverrideRow[],
  horizonDays: number = NEXT_OPENING_HORIZON_DAYS,
): NextOpening | null {
  const nowMins = now.getHours() * 60 + now.getMinutes();
  for (let daysAhead = 0; daysAhead <= horizonDays; daysAhead++) {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + daysAhead);
    const window = resolveDayHours(date, settings, weeklyRows, blockedDates, overrides);
    const time = hhmm(window?.start_time);
    if (!time || !hhmm(window?.end_time)) continue;
    if (daysAhead === 0 && nowMins >= minutes(time)) continue; // open now, or already over
    return { date, time, daysAhead };
  }
  return null;
}

export type OpeningSummary =
  | { kind: "open"; until: string }
  | {
      kind: "closed";
      next: NextOpening | null;
      /** Today's closing time when today's hours are already over, else null. */
      closedAt: string | null;
    };

/** Combine the shared open/closed verdict with the next opening. */
export function summarizeOpening(
  status: ProviderStatus,
  next: NextOpening | null,
  now: Date,
): OpeningSummary {
  if (status.isOpen && status.todayHours) return { kind: "open", until: status.todayHours.close };
  const nowMins = now.getHours() * 60 + now.getMinutes();
  const closedAt =
    status.todayHours && nowMins >= minutes(status.todayHours.close) ? status.todayHours.close : null;
  return { kind: "closed", next, closedAt };
}

type Translate = (key: string) => string;

const LOCALES = { he, ar, en: enUS } as const;
// Past six days a weekday name alone is ambiguous, so the date is used.
const DATE_PATTERN: Record<Lang, string> = { he: "d 'ב'MMMM", ar: "d MMMM", en: "d MMMM" };

/** "opens at 17:00" / "opens tomorrow 09:00" / "opens Tuesday 17:00" / "opens 4 December 17:00". */
export function nextOpeningText(next: NextOpening, lang: Lang, t: Translate): string {
  if (next.daysAhead === 0) return t("statusOpensAt").replace("{time}", next.time);
  if (next.daysAhead === 1) return t("statusOpensTomorrow").replace("{time}", next.time);
  const day = format(next.date, next.daysAhead <= 6 ? "EEEE" : DATE_PATTERN[lang], { locale: LOCALES[lang] });
  return t("statusOpensDay").replace("{day}", day).replace("{time}", next.time);
}

/** The status line, as its bold head ("Closed now") and its optional detail. */
export function openingStatusParts(
  summary: OpeningSummary,
  lang: Lang,
  t: Translate,
): { head: string; detail: string | null } {
  if (summary.kind === "open") {
    return { head: t("openNow"), detail: t("statusUntil").replace("{time}", summary.until) };
  }
  return {
    head: t("statusClosedNow"),
    detail: summary.next ? nextOpeningText(summary.next, lang, t) : null,
  };
}

/** The whole status line as one string. */
export function openingStatusText(summary: OpeningSummary, lang: Lang, t: Translate): string {
  const { head, detail } = openingStatusParts(summary, lang, t);
  return detail ? `${head} · ${detail}` : head;
}
