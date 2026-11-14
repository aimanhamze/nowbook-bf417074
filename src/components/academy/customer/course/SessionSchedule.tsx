import { useState } from "react";
import { format, parseISO } from "date-fns";
import { useLang } from "@/contexts/LangContext";
import type { AcademyCourseSessionRow } from "@/integrations/supabase/academyTypes";
import type { WallClock } from "@/lib/academyCustomer";
import { nextSession } from "@/lib/academyCourseView";
import { groupSessionsByWeek, schedulePatterns, weekdayOf } from "@/lib/academySchedule";
import { isSessionPast, toTimeInput } from "@/lib/academySessions";
import { compactDateRange } from "@/lib/compactDateRange";
import { dateFnsLocaleFor } from "@/lib/dateFnsLocale";
import { cn } from "@/lib/utils";
import { patternWeekdays, tileWeekday } from "../courseFormat";

/** Weeks shown before "show all N sessions" … */
const WEEKS_SHOWN = 3;
/** … or, for a course that meets at most once a week, this many tiles (two rows). */
const TILES_SHOWN = 8;
/** Folding is not worth a button for fewer hidden sessions than this. */
const MIN_HIDDEN = 4;

interface Props {
  sessions: AcademyCourseSessionRow[];
  /**
   * Given for a registered customer: finished sessions are tinted and
   * labelled, the next one is outlined, and the folded view opens around the
   * next session instead of at the start. Without it the schedule is plain.
   */
  progressAt?: WallClock;
}

/**
 * A course's sessions as a calendar you can take in at a glance: chips that
 * name the rhythm ("Sun, Mon, Thu · 13:00"), then one row of date tiles per
 * week. A course that meets at most once a week has nothing to group, so its
 * tiles run as one grid and carry the month instead of the weekday (the chip
 * already names the day). Long courses open folded.
 */
export function SessionSchedule({ sessions, progressAt }: Props) {
  const { t, lang } = useLang();
  const locale = dateFnsLocaleFor(lang);
  const [showAll, setShowAll] = useState(false);

  const patterns = schedulePatterns(sessions);
  const weeks = groupSessionsByWeek(sessions);
  const grouped = weeks.some((w) => w.sessions.length > 1);
  const next = progressAt ? nextSession(sessions, progressAt) : null;

  // Folded window: from the start — or, with progress, from one step before
  // the next session, so the last finished week / row stays in view.
  const nextWeekIndex = next ? weeks.findIndex((w) => w.sessions.includes(next)) : 0;
  const weekStart = Math.min(Math.max(0, nextWeekIndex - 1), Math.max(0, weeks.length - WEEKS_SHOWN));
  const foldedWeeks = weeks.slice(weekStart, weekStart + WEEKS_SHOWN);
  const nextIndex = next ? sessions.indexOf(next) : 0;
  const tileStart = Math.min(Math.floor(Math.max(0, nextIndex - 1) / 4) * 4, Math.max(0, sessions.length - TILES_SHOWN));
  const foldedTiles = sessions.slice(tileStart, tileStart + TILES_SHOWN);

  const foldedCount = grouped ? foldedWeeks.reduce((n, w) => n + w.sessions.length, 0) : foldedTiles.length;
  const foldable = sessions.length - foldedCount >= MIN_HIDDEN;
  const folded = foldable && !showAll;

  const tile = (s: AcademyCourseSessionRow) => {
    const ended = !!progressAt && isSessionPast(s, progressAt);
    const isNext = s === next;
    return (
      <li
        key={s.id}
        className={cn(
          "flex flex-col items-center rounded-2xl px-1 py-2.5 text-center",
          // The next session's outline is a border: .surface-soft owns box-shadow, so a ring would not show.
          ended ? "border border-green-200 bg-green-50" : isNext ? "border-2 border-accent bg-white" : "surface-soft",
        )}
      >
        <span className={cn("text-[11px] font-medium", ended ? "text-green-800/80" : "text-muted-foreground")}>
          {grouped ? tileWeekday(weekdayOf(s.session_date), locale) : format(parseISO(s.session_date), "MMM", { locale })}
        </span>
        <span className={cn("text-lg font-bold leading-tight tabular-nums", ended && "text-green-900")}>
          {Number(s.session_date.slice(8, 10))}
        </span>
        <span dir="ltr" className={cn("mt-0.5 text-[11px] tabular-nums", ended ? "text-green-800/80" : "text-foreground/70")}>
          {toTimeInput(s.start_time)}
        </span>
        {progressAt && (
          // Always present, so every tile in a row is the same height.
          <span className={cn("mt-1 min-h-[14px] text-[10px] font-semibold leading-[14px]", isNext ? "text-accent" : "text-green-700")}>
            {ended ? t("academySessionEnded") : isNext ? t("academySessionNext") : ""}
          </span>
        )}
      </li>
    );
  };

  return (
    <div>
      <ul className="flex flex-wrap gap-2">
        {patterns.map((p) => (
          <li
            key={p.time}
            className="flex items-center gap-1.5 rounded-full bg-secondary px-3 py-1.5 text-xs font-medium text-foreground/80"
          >
            <span>{patternWeekdays(p.weekdays, locale, t("academyDaysPattern"))}</span>
            <span aria-hidden>·</span>
            <span dir="ltr" className="tabular-nums">
              {p.time}
            </span>
          </li>
        ))}
      </ul>

      {grouped ? (
        <ol className="mt-4 space-y-4">
          {(folded ? foldedWeeks : weeks).map((week) => {
            const first = week.sessions[0].session_date;
            const last = week.sessions[week.sessions.length - 1].session_date;
            return (
              <li key={week.number}>
                <div className="mb-2 flex items-baseline justify-between gap-3">
                  <h3 className="text-[13px] font-semibold">{t("academyWeekN").replace("{n}", String(week.number))}</h3>
                  <span className="text-xs text-muted-foreground">{compactDateRange(first, last, locale)}</span>
                </div>
                <ul className="grid grid-cols-4 gap-2">{week.sessions.map(tile)}</ul>
              </li>
            );
          })}
        </ol>
      ) : (
        <ol className="mt-4 grid grid-cols-4 gap-2">{(folded ? foldedTiles : sessions).map(tile)}</ol>
      )}

      {foldable && (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          aria-expanded={showAll}
          className="mt-3 flex h-11 w-full items-center justify-center rounded-2xl bg-secondary text-sm font-semibold text-foreground/80 transition-colors active:bg-secondary/70"
        >
          {showAll ? t("showLess") : t("academyShowAllSessions").replace("{n}", String(sessions.length))}
        </button>
      )}
    </div>
  );
}
