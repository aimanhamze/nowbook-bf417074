import { useState } from "react";
import { addDays, format } from "date-fns";
import { he, ar, enUS } from "date-fns/locale";
import { ChevronDown } from "lucide-react";
import {
  resolveDayHours,
  type MonthlySettings,
  type DateOverrideRow,
} from "@/lib/availabilityResolver";
import type { Lang } from "@/lib/translations";

// The customer-facing hours list for MONTHLY-mode providers. Weekly providers
// keep their weekday list (WeeklyHoursTable) — this component is never rendered
// for them. Hours per date come from the SAME resolveDayHours the booking slot
// logic uses, so what the profile shows and what's bookable can't diverge:
// blocked → per-date override → flat monthly default (precedence lives in the
// resolver, not here).

const INITIAL_DAYS = 7;

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + (m || 0);
}

interface Props {
  monthlySettings: MonthlySettings;
  blockedDates: string[];
  overrides: DateOverrideRow[];
  bookingWindowDays: number;
  lang: Lang;
  t: (key: string) => string;
}

export default function MonthlyHoursTable({
  monthlySettings,
  blockedDates,
  overrides,
  bookingWindowDays,
  lang,
  t,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const locale = lang === "he" ? he : lang === "ar" ? ar : enUS;

  // Clamp the window to a sane minimum; 7 shown first, "show more" reveals the
  // rest up to booking_window_days (default 14).
  const windowDays = Math.max(1, bookingWindowDays || 14);
  const canExpand = windowDays > INITIAL_DAYS;
  const visibleCount = expanded ? windowDays : Math.min(INITIAL_DAYS, windowDays);

  const today = new Date();
  const nowMins = today.getHours() * 60 + today.getMinutes();

  const days = Array.from({ length: visibleCount }, (_, i) => {
    const date = addDays(today, i);
    // Weekly rows param is [] — for monthly mode the resolver never reads it.
    const window = resolveDayHours(date, monthlySettings, [], blockedDates, overrides);
    return { i, date, window };
  });

  const dateLabel = (date: Date) => format(date, "d MMMM · EEEE", { locale });
  const rowLabel = (i: number, date: Date) => {
    if (i === 0) return `${t("today")} · ${dateLabel(date)}`;
    if (i === 1) return `${t("tomorrow")} · ${dateLabel(date)}`;
    return dateLabel(date);
  };

  const todayWindow = days[0]?.window ?? null;
  const isOpenNow =
    !!todayWindow &&
    nowMins >= toMinutes(todayWindow.start_time) &&
    nowMins < toMinutes(todayWindow.end_time);

  const closedPill = (
    <span className="rounded-full bg-muted/60 px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground">
      {t("providerStatusClosed")}
    </span>
  );

  const hoursBadge = (window: { start_time: string; end_time: string }, tone: "today" | "row") =>
    tone === "today" ? (
      <span
        dir="ltr"
        className={`rounded-full bg-white/70 px-3 py-1 text-sm font-semibold tabular-nums ${
          isOpenNow ? "text-green-700" : "text-muted-foreground"
        }`}
      >
        {window.start_time.slice(0, 5)} - {window.end_time.slice(0, 5)}
      </span>
    ) : (
      <span dir="ltr" className="text-sm tabular-nums text-foreground">
        {window.start_time.slice(0, 5)} - {window.end_time.slice(0, 5)}
      </span>
    );

  return (
    <div className="glass-card rounded-2xl p-2">
      {/* Today row — elevated card mirroring WeeklyHoursTable, with a live
          status dot and today's resolved hours as a badge. */}
      <div
        className={`flex items-center justify-between gap-3 rounded-xl px-3.5 py-3 ring-1 ring-inset ${
          isOpenNow ? "bg-green-500/10 ring-green-500/20" : "bg-muted/40 ring-black/5"
        }`}
      >
        <div className="flex items-center gap-2.5">
          <span aria-hidden className="relative flex h-2 w-2 shrink-0">
            {isOpenNow && (
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-500 opacity-60 motion-reduce:hidden" />
            )}
            <span
              className={`relative inline-flex h-2 w-2 rounded-full ${
                isOpenNow ? "bg-green-500" : "bg-muted-foreground/40"
              }`}
            />
          </span>
          <div className="flex flex-col">
            <span className="text-sm font-semibold text-foreground">
              {rowLabel(0, days[0]?.date ?? today)}
            </span>
            <span
              className={`text-[11px] font-medium ${
                isOpenNow ? "text-green-700" : "text-muted-foreground"
              }`}
            >
              {t(isOpenNow ? "providerStatusOpen" : "providerStatusClosed")}
            </span>
          </div>
        </div>
        {todayWindow ? hoursBadge(todayWindow, "today") : closedPill}
      </div>

      {/* Remaining days — hairline-separated rows, tabular digits so the times
          align into a clean column, closed/blocked days as muted pills. */}
      <div className="flex flex-col divide-y divide-border/40 px-2 pt-1">
        {days.slice(1).map(({ i, date, window }) => (
          <div key={i} className="flex items-center justify-between px-1.5 py-2.5">
            <span
              className={`text-sm ${
                window ? "font-medium text-foreground/80" : "text-muted-foreground"
              }`}
            >
              {rowLabel(i, date)}
            </span>
            {window ? hoursBadge(window, "row") : closedPill}
          </div>
        ))}
      </div>

      {canExpand && (
        <button
          type="button"
          onClick={() => setExpanded(v => !v)}
          className="mt-1 flex w-full items-center justify-center gap-1.5 rounded-xl px-3 py-2.5 text-sm font-medium text-accent transition-colors hover:bg-accent/5"
        >
          {t(expanded ? "showLess" : "showMoreDays")}
          <ChevronDown
            className={`h-4 w-4 transition-transform ${expanded ? "rotate-180" : ""}`}
          />
        </button>
      )}
    </div>
  );
}
