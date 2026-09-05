import { useEffect, useState } from "react";
import { format, addMonths, subMonths, startOfMonth, startOfToday, isAfter } from "date-fns";
import { CalendarOff, ChevronLeft, ChevronRight, X } from "lucide-react";
import { Calendar } from "@/components/ui/calendar";
import { useLang } from "@/contexts/LangContext";
import { dateFnsLocaleFor } from "@/lib/dateFnsLocale";
import { toDateKey, fromDateKey, toggleDate } from "@/lib/staffTimeOff";
import { cn } from "@/lib/utils";
import { FacetSheet } from "./FacetSheet";

interface Props {
  open: boolean;
  onClose: () => void;
  memberName: string;
  /** Upcoming "YYYY-MM-DD" days off, sorted. Past dates never enter the draft. */
  initialDates: string[];
  onSave: (dates: string[]) => Promise<void>;
  saving: boolean;
}

/**
 * Days off, edited on an INLINE month calendar rather than a popover inside a
 * sheet: a sheet is already the focused surface, and a second layer over it
 * left a 19rem picker floating in the middle of a phone screen.
 *
 * Data model and rules are unchanged from the shop's own blocked-date picker
 * and the settings editor this replaced: individual dates,
 * one row per date, multi-select, future only, and the draft is what gets
 * written on Save — never on pick. The chosen dates list under the calendar is
 * the same range the mutation's delete clears (see useProviderStaffTimeOff).
 */
export function TimeOffSheet({ open, onClose, memberName, initialDates, onSave, saving }: Props) {
  const { t, lang, isRtl } = useLang();
  const locale = dateFnsLocaleFor(lang);

  const today = startOfToday();
  const [dates, setDates] = useState<string[]>([]);
  const [month, setMonth] = useState<Date>(() => startOfMonth(today));

  useEffect(() => {
    if (open) {
      setDates(initialDates);
      setMonth(startOfMonth(startOfToday()));
    }
  }, [open, initialDates]);

  const canGoPrev = isAfter(startOfMonth(month), startOfMonth(today));

  // Same nav-button treatment the other pickers use: react-day-picker's own nav
  // is absolutely positioned left/right with hardcoded chevrons, which point the
  // wrong way in RTL.
  const navBtn =
    "inline-flex h-10 w-10 items-center justify-center rounded-xl bg-card text-foreground " +
    "shadow-sm ring-1 ring-border transition-all active:scale-95 " +
    "hover:bg-accent hover:text-accent-foreground disabled:opacity-30 disabled:pointer-events-none " +
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

  return (
    <FacetSheet
      open={open}
      onClose={onClose}
      icon={CalendarOff}
      title={t("staffTimeOffLabel")}
      subtitle={memberName}
      saving={saving}
      onSave={() => onSave(dates)}
    >
      <p className="px-1 text-[13px] leading-relaxed text-muted-foreground">{t("staffTimeOffHelp")}</p>

      <div className="surface-soft rounded-2xl p-3">
        <div className="mb-1 flex items-center justify-between">
          <button type="button" aria-label={t("prevMonthAria")} disabled={!canGoPrev} onClick={() => setMonth(subMonths(month, 1))} className={navBtn}>
            {isRtl ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          </button>
          <span className="text-sm font-bold">{format(month, "MMMM yyyy", { locale })}</span>
          <button type="button" aria-label={t("nextMonthAria")} onClick={() => setMonth(addMonths(month, 1))} className={navBtn}>
            {isRtl ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        </div>

        <Calendar
          mode="multiple"
          month={month}
          onMonthChange={setMonth}
          dir={isRtl ? "rtl" : "ltr"}
          locale={locale}
          selected={dates.map(fromDateKey)}
          onDayClick={(day) => setDates((prev) => toggleDate(prev, toDateKey(day)))}
          disabled={(date) => date < today}
          classNames={{
            caption: "hidden",
            months: "w-full",
            month: "w-full space-y-3",
            table: "w-full border-collapse",
            head_row: "flex w-full",
            head_cell: "text-muted-foreground font-semibold text-[0.72rem] uppercase tracking-wide w-full py-2",
            row: "flex w-full mt-1",
            cell: "relative w-full p-0.5 text-center",
            day: cn(
              "h-11 w-full rounded-xl text-sm font-medium text-foreground",
              "inline-flex items-center justify-center transition-all",
              "hover:bg-secondary active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40",
            ),
            // `!` is load-bearing: react-day-picker concatenates `day` and
            // `day_selected` onto one element, and at equal specificity the
            // hover/text rules above would win over the accent fill.
            day_selected: "!bg-accent !text-accent-foreground font-bold hover:!bg-accent hover:!text-accent-foreground",
            day_today: "ring-1 ring-inset ring-accent/50 font-bold !text-accent",
            day_disabled: "text-muted-foreground/30 pointer-events-none hover:bg-transparent",
            day_outside: "text-muted-foreground/25",
            day_hidden: "invisible",
          }}
          className="pointer-events-auto p-1 pt-0"
        />
      </div>

      <div>
        <p className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {t("staffTimeOffChosen").replace("{n}", String(dates.length))}
        </p>
        {dates.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {dates.map((key) => (
              <span
                key={key}
                className="inline-flex items-center gap-1.5 rounded-full bg-accent/10 ps-3 pe-2 py-1.5 text-[13px] font-semibold text-accent"
              >
                <bdi>{format(fromDateKey(key), "EEE, d MMM", { locale })}</bdi>
                <button
                  type="button"
                  aria-label={t("staffTimeOffRemove")}
                  onClick={() => setDates((prev) => toggleDate(prev, key))}
                  className="flex h-6 w-6 items-center justify-center rounded-full bg-accent/15 active:scale-90"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </span>
            ))}
          </div>
        ) : (
          <p className="px-1 text-[13px] text-muted-foreground">{t("staffTimeOffNone")}</p>
        )}
      </div>
    </FacetSheet>
  );
}
