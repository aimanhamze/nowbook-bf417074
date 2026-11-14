import { useState } from "react";
import { format, parseISO } from "date-fns";
import { useLang } from "@/contexts/LangContext";
import type { AcademyCourseSessionRow } from "@/integrations/supabase/academyTypes";
import { groupSessionsByWeek, schedulePatterns, weekdayOf } from "@/lib/academySchedule";
import { toTimeInput } from "@/lib/academySessions";
import { compactDateRange } from "@/lib/compactDateRange";
import { dateFnsLocaleFor } from "@/lib/dateFnsLocale";
import { patternWeekdays, tileWeekday } from "../courseFormat";

/** Weeks shown before "show all N sessions" … */
const WEEKS_SHOWN = 3;
/** … or, for a course that meets at most once a week, this many tiles (two rows). */
const TILES_SHOWN = 8;
/** Folding is not worth a button for fewer hidden sessions than this. */
const MIN_HIDDEN = 4;

/**
 * A course's sessions as a calendar you can take in at a glance: chips that
 * name the rhythm ("Sun, Mon, Thu · 13:00"), then one row of date tiles per
 * week. A course that meets at most once a week has nothing to group, so its
 * tiles run as one grid and carry the month instead of the weekday (the chip
 * already names the day). Long courses open folded.
 */
export function SessionSchedule({ sessions }: { sessions: AcademyCourseSessionRow[] }) {
  const { t, lang } = useLang();
  const locale = dateFnsLocaleFor(lang);
  const [showAll, setShowAll] = useState(false);

  const patterns = schedulePatterns(sessions);
  const weeks = groupSessionsByWeek(sessions);
  const grouped = weeks.some((w) => w.sessions.length > 1);

  const foldedWeeks = weeks.slice(0, WEEKS_SHOWN);
  const foldedCount = grouped ? foldedWeeks.reduce((n, w) => n + w.sessions.length, 0) : TILES_SHOWN;
  const foldable = sessions.length - foldedCount >= MIN_HIDDEN;
  const folded = foldable && !showAll;

  const tile = (s: AcademyCourseSessionRow) => (
    <li key={s.id} className="surface-soft flex flex-col items-center rounded-2xl px-1 py-2.5 text-center">
      <span className="text-[11px] font-medium text-muted-foreground">
        {grouped ? tileWeekday(weekdayOf(s.session_date), locale) : format(parseISO(s.session_date), "MMM", { locale })}
      </span>
      <span className="text-lg font-bold leading-tight tabular-nums">{Number(s.session_date.slice(8, 10))}</span>
      <span dir="ltr" className="mt-0.5 text-[11px] tabular-nums text-foreground/70">
        {toTimeInput(s.start_time)}
      </span>
    </li>
  );

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
        <ol className="mt-4 grid grid-cols-4 gap-2">{(folded ? sessions.slice(0, TILES_SHOWN) : sessions).map(tile)}</ol>
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
