import { format, startOfMonth, addMonths, subMonths, isAfter, isBefore } from "date-fns";
import { he, ar, enUS } from "date-fns/locale";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Calendar as CalendarGrid } from "@/components/ui/calendar";
import { useLang } from "@/contexts/LangContext";
import { cn } from "@/lib/utils";

interface BookingMonthCalendarProps {
  month: Date;
  onMonthChange: (month: Date) => void;
  /** First selectable day (usually today). Also bounds month navigation. */
  fromDate: Date;
  /** Last selectable day (booking-window end). Also bounds month navigation. */
  toDate: Date;
  /**
   * The SINGLE availability question this component asks. Callers pass a
   * closure over their existing slot pipeline (getAvailableSlots /
   * getGroupSlotsWithCapacity), so the calendar can never disagree with the
   * time step that follows it. Days where this returns false are disabled.
   */
  dayHasAvailability: (date: Date) => boolean;
  /**
   * OPTIONAL second question, for callers that may OVERRIDE availability — today
   * only the provider walk-in flow (NewBookingSheet). Days where this returns
   * true stay TAPPABLE even though `dayHasAvailability` said no, and are marked
   * with the `overridable` style so they never read as normal open days.
   *
   * Omitted by the customer flow (BookAppointment) and the reschedule flow
   * (RescheduleSheet): it defaults to "never", which collapses `disabled` back
   * to `!dayHasAvailability(date)` and leaves the `overridable` modifier
   * matching nothing — byte-identical rendering to before this prop existed.
   *
   * This can NOT be folded into `dayHasAvailability`: the slot pipeline behind
   * it collapses "closed", "blocked" and "fully booked" into the same empty
   * array, so it cannot express a third state. Callers answer this one from
   * resolveDayHours instead.
   */
  dayIsOverridable?: (date: Date) => boolean;
  /** Highlighted day, if the user already picked one. */
  selected?: Date;
  onSelectDay: (day: Date) => void;
}

/** Stable default for `dayIsOverridable` — no caller opts in, nothing changes. */
const NEVER_OVERRIDABLE = () => false;

/**
 * Shared month calendar for BOOKING day selection — used by the customer flow
 * (BookAppointment) and the provider walk-in flow (NewBookingSheet), so both
 * always look and behave identically. Presentation only: availability comes in
 * via `dayHasAvailability`; this component never computes slots itself.
 *
 * Design language mirrors the provider's MonthlyAvailabilityCalendar: the
 * built-in react-day-picker caption is hidden and replaced with our own
 * month-title row so the nav buttons sit and disable on the correct sides in
 * RTL (chevrons flip with `isRtl`, `dir` flips the weekday header + day grid).
 */
export function BookingMonthCalendar({
  month,
  onMonthChange,
  fromDate,
  toDate,
  dayHasAvailability,
  dayIsOverridable = NEVER_OVERRIDABLE,
  selected,
  onSelectDay,
}: BookingMonthCalendarProps) {
  const { t, isRtl, lang } = useLang();
  const dateFnsLocale = lang === "he" ? he : lang === "ar" ? ar : enUS;

  // Month navigation bounds: [month of fromDate, month of toDate].
  const firstMonthStart = startOfMonth(fromDate);
  const lastMonthStart = startOfMonth(toDate);
  const displayedMonthStart = startOfMonth(month);
  const canGoPrev = isAfter(displayedMonthStart, firstMonthStart);
  const canGoNext = isBefore(displayedMonthStart, lastMonthStart);

  const navBtn =
    "inline-flex h-10 w-10 items-center justify-center rounded-xl bg-card text-foreground " +
    "shadow-sm ring-1 ring-border transition-all active:scale-95 " +
    "hover:bg-accent hover:text-accent-foreground disabled:opacity-30 disabled:pointer-events-none " +
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <button
          type="button"
          aria-label={t("prevMonthAria")}
          disabled={!canGoPrev}
          onClick={() => onMonthChange(subMonths(month, 1))}
          className={navBtn}
        >
          {isRtl ? <ChevronRight className="h-5 w-5" /> : <ChevronLeft className="h-5 w-5" />}
        </button>
        <span className="text-base font-bold text-foreground">
          {format(month, "MMMM yyyy", { locale: dateFnsLocale })}
        </span>
        <button
          type="button"
          aria-label={t("nextMonthAria")}
          disabled={!canGoNext}
          onClick={() => onMonthChange(addMonths(month, 1))}
          className={navBtn}
        >
          {isRtl ? <ChevronLeft className="h-5 w-5" /> : <ChevronRight className="h-5 w-5" />}
        </button>
      </div>

      <CalendarGrid
        month={month}
        onMonthChange={onMonthChange}
        dir={isRtl ? "rtl" : "ltr"}
        locale={dateFnsLocale}
        fromDate={fromDate}
        toDate={toDate}
        // An overridable day is NOT disabled — that is the whole point. Days
        // outside [fromDate, toDate] stay disabled regardless: react-day-picker
        // pushes { before: fromDate } / { after: toDate } into its own disabled
        // matchers alongside this prop, so no predicate here can make the past
        // (or beyond the booking window) selectable.
        disabled={(date) => !dayHasAvailability(date) && !dayIsOverridable(date)}
        selected={selected}
        onDayClick={(day, mods) => {
          // Overridable days reach this with mods.disabled === false, so the
          // existing guard lets them through unchanged.
          if (mods.disabled) return;
          onSelectDay(day);
        }}
        modifiers={{
          hasSlots: (date) => date >= fromDate && date <= toDate && dayHasAvailability(date),
          // Mutually exclusive with hasSlots by construction (`!dayHasAvailability`),
          // so an overridable day gets the muted mark but NEVER the accent dot —
          // "open" and "closed but bookable" stay visually distinct for free.
          overridable: (date) =>
            date >= fromDate && date <= toDate && !dayHasAvailability(date) && dayIsOverridable(date),
        }}
        modifiersClassNames={{
          hasSlots:
            "relative after:absolute after:bottom-1 after:left-1/2 after:-translate-x-1/2 " +
            "after:h-1 after:w-1 after:rounded-full after:bg-accent/60 aria-selected:after:bg-accent-foreground/90",
          // Dashed + muted: reads as "not a normal open day", still obviously
          // tappable. The aria-selected overrides win on specificity (attribute
          // selector) so a picked overridable day still shows the accent fill
          // rather than depending on stylesheet ordering against day_selected.
          overridable:
            "border border-dashed border-muted-foreground/45 bg-muted/50 text-muted-foreground/80 " +
            "aria-selected:border-transparent aria-selected:bg-accent aria-selected:text-accent-foreground",
        }}
        classNames={{
          caption: "hidden",
          months: "w-full",
          month: "w-full space-y-3",
          table: "w-full border-collapse",
          head_row: "flex w-full",
          head_cell: "text-muted-foreground font-semibold text-[0.72rem] uppercase tracking-wide w-full py-2",
          row: "flex w-full mt-1.5",
          cell: "relative w-full p-0.5 text-center",
          day: cn(
            "h-11 w-full rounded-xl text-sm font-medium text-foreground",
            "inline-flex items-center justify-center transition-all",
            "hover:bg-secondary active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40",
          ),
          day_selected:
            "bg-accent text-accent-foreground font-bold shadow-[0_4px_12px_-4px_hsl(var(--accent)/0.4)] hover:bg-accent hover:text-accent-foreground",
          day_today: "ring-1 ring-inset ring-accent/50 font-bold text-accent",
          day_disabled: "text-muted-foreground/30 pointer-events-none hover:bg-transparent",
          day_outside: "text-muted-foreground/25",
          day_hidden: "invisible",
        }}
        className="p-0"
      />
    </div>
  );
}
