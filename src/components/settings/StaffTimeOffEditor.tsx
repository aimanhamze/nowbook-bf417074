import { useState } from "react";
import { format, addMonths, subMonths, startOfMonth, startOfToday, isAfter } from "date-fns";
import { he, ar, enUS } from "date-fns/locale";
import { CalendarOff, X, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useLang } from "@/contexts/LangContext";
import { toDateKey, fromDateKey, toggleDate } from "@/lib/staffTimeOff";
import { cn } from "@/lib/utils";

interface Props {
  /** Upcoming days off as "YYYY-MM-DD", sorted. Empty = none. */
  dates: string[];
  onChange: (next: string[]) => void;
}

/**
 * Per-staff time off, rendered inside StaffSection's edit sheet below the hours
 * editor.
 *
 * PURELY PRESENTATIONAL — it owns no state beyond the popover's own month, and
 * performs no writes. Everything it produces goes into StaffSection's `editing`
 * draft and reaches the database only on Save, exactly like the name, services
 * and hours above it.
 *
 * WHY THIS DOES NOT MIRROR AvailabilityTab'S WRITE TIMING: the shop's blocked
 * dates write immediately on pick, because they live on their own tab with no
 * Save button. Here the same control sits among three draft-then-save
 * neighbours, and one field that committed instantly while the three above it
 * waited would be the surprising thing. The DATA MODEL is mirrored exactly —
 * individual dates, one row per date; the write timing follows the sheet.
 *
 * ONLY FUTURE DATES are selectable, and only future dates are ever held: past
 * days off are history, kept in the table and never shown here. That is the
 * other half of the writer's range-scoped delete (see useProviderStaffTimeOff) —
 * the editor's contents and the delete's scope have to describe the same set.
 */
export function StaffTimeOffEditor({ dates, onChange }: Props) {
  const { t, isRtl, lang } = useLang();
  const dateFnsLocale = lang === "he" ? he : lang === "ar" ? ar : enUS;

  const today = startOfToday();
  const [month, setMonth] = useState<Date>(() => startOfToday());
  const canGoPrevMonth = isAfter(startOfMonth(month), startOfMonth(today));

  // Same nav-button treatment AvailabilityTab uses for its blocked-date popover:
  // react-day-picker's own nav is absolutely positioned left/right with
  // hardcoded chevrons, which point the wrong way in RTL.
  const navBtn =
    "inline-flex h-9 w-9 items-center justify-center rounded-xl bg-card text-foreground " +
    "shadow-sm ring-1 ring-border transition-all active:scale-95 " +
    "hover:bg-accent hover:text-accent-foreground disabled:opacity-30 disabled:pointer-events-none " +
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

  const selected = dates.map(fromDateKey);

  return (
    <div className="space-y-2">
      <Label>{t("staffTimeOffLabel")}</Label>
      <p className="text-xs leading-relaxed text-muted-foreground">
        {t("staffTimeOffHelp")}
      </p>

      <Popover>
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" size="sm" className="gap-1.5">
            <CalendarOff className="h-3.5 w-3.5" />
            {t("staffTimeOffAdd")}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[19.5rem] rounded-2xl p-0" align="start">
          <div className="flex items-center justify-between px-3 pt-3">
            <button
              type="button"
              aria-label={t("prevMonthAria")}
              disabled={!canGoPrevMonth}
              onClick={() => setMonth(subMonths(month, 1))}
              className={navBtn}
            >
              {isRtl ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
            </button>
            <span className="text-sm font-bold text-foreground">
              {format(month, "MMMM yyyy", { locale: dateFnsLocale })}
            </span>
            <button
              type="button"
              aria-label={t("nextMonthAria")}
              onClick={() => setMonth(addMonths(month, 1))}
              className={navBtn}
            >
              {isRtl ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </button>
          </div>

          {/* mode="multiple" so several days can be marked without reopening the
              popover — the common case is a run of consecutive days. There is
              deliberately no upper bound on how far ahead a day off can be set,
              matching the shop's own blocked-date picker; the customer side
              consults a rolling window, so a distant date simply takes effect
              once it enters that window. */}
          <Calendar
            mode="multiple"
            month={month}
            onMonthChange={setMonth}
            dir={isRtl ? "rtl" : "ltr"}
            locale={dateFnsLocale}
            selected={selected}
            // Day-level toggle rather than reading react-day-picker's whole
            // next-selection array: it keeps the sort/de-dupe in one tested
            // helper, and it cannot be confused by the library re-ordering.
            onDayClick={(day) => onChange(toggleDate(dates, toDateKey(day)))}
            disabled={(date) => date < today}
            classNames={{
              caption: "hidden",
              months: "w-full",
              month: "w-full space-y-3",
              table: "w-full border-collapse",
              head_row: "flex w-full",
              head_cell:
                "text-muted-foreground font-semibold text-[0.72rem] uppercase tracking-wide w-full py-2",
              row: "flex w-full mt-1.5",
              cell: "relative w-full p-0.5 text-center",
              day: cn(
                "h-11 w-full rounded-xl text-sm font-medium text-foreground",
                "inline-flex items-center justify-center transition-all",
                "hover:bg-secondary active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40",
              ),
              // `!` is load-bearing here for the same reason AvailabilityTab
              // documents: react-day-picker concatenates `day` and
              // `day_selected` onto one element, and Tailwind emits
              // hover:bg-secondary / text-foreground after their accent
              // counterparts, so at equal specificity the wrong rule won and a
              // just-tapped day rendered near-invisible.
              day_selected:
                "!bg-destructive !text-destructive-foreground font-bold hover:!bg-destructive hover:!text-destructive-foreground",
              day_today: "ring-1 ring-inset ring-accent/50 font-bold !text-accent",
              day_disabled: "text-muted-foreground/30 pointer-events-none hover:bg-transparent",
              day_outside: "text-muted-foreground/25",
              day_hidden: "invisible",
            }}
            className="pointer-events-auto p-3 pt-1"
          />
        </PopoverContent>
      </Popover>

      {dates.length > 0 ? (
        <div className="space-y-1.5">
          {dates.map((key) => (
            <div
              key={key}
              className="flex items-center justify-between rounded-xl bg-secondary px-3 py-2 text-sm"
            >
              <span className="font-medium">
                {format(fromDateKey(key), "EEEE, d MMMM yyyy", { locale: dateFnsLocale })}
              </span>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-6 w-6"
                aria-label={t("staffTimeOffRemove")}
                onClick={() => onChange(toggleDate(dates, key))}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
      ) : (
        // Absence is the common case and the default, so it gets a quiet line
        // rather than an empty region the owner has to interpret.
        <p className="text-xs text-muted-foreground">{t("staffTimeOffNone")}</p>
      )}
    </div>
  );
}
