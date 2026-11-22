import { useId, useState } from "react";
import { format, parseISO, startOfMonth, startOfToday, addMonths, subMonths, isAfter } from "date-fns";
import { he, ar, enUS } from "date-fns/locale";
import { ChevronLeft, ChevronRight, Plus, X } from "lucide-react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ForwardArrow } from "@/components/ui/directional-icon";
import { providerDesktopSheet } from "@/components/layout/providerDesktop";
import { useLang } from "@/contexts/LangContext";
import {
  fetchUpcomingBookingNames, useProviderAvailability, type UpcomingBookingName,
} from "@/hooks/useProviderAvailability";
import { useProviderProfile } from "@/hooks/useProviderProfile";
import { MonthlyAvailabilityCalendar } from "@/components/dashboard/MonthlyAvailabilityCalendar";
import { DayHoursEditor } from "@/components/dashboard/DayHoursEditor";
import { DIVIDER, GROUP_HEADING, LIST, ROW } from "@/components/dashboard/settingsList";
import { cn } from "@/lib/utils";
import { joinList, ltr } from "@/lib/dashboardSetup";
import {
  draftDiffers, draftFromRow, draftToRow, formatRanges, openDaysToChange, validateDay,
  type DayDraft, type WeeklyDayRow,
} from "@/lib/weeklyHours";
import { toast } from "sonner";
import { BranchSuffix } from "@/components/branch/BranchSuffix";
import { SpecialOpeningsGroup } from "@/components/dashboard/SpecialOpeningsGroup";
import { isAcademyCategory } from "@/lib/academyCategory";
import { customerLabel } from "@/lib/customerLabel";
import { toLocalDateStr, type DateOverrideRow, type WeeklyRow } from "@/lib/availabilityResolver";
import {
  anchorChoices, bookingsOnClosingDays, groupByDate, repeatDiffers, repeatFromRow, repeatIncomplete,
  repeatPayload, type RepeatDraft,
} from "@/lib/repeatWeeks";

// The app's week order (Sunday first), as everywhere else.
const DAY_KEYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;

/**
 * Opening hours ("שעות פעילות"). Weekly providers get a one-row-per-day week
 * summary; tapping a day opens a sheet with a draft that Save writes in ONE
 * upsertAvailability call (same row shape as before). Monthly providers get
 * the monthly calendar. Every provider gets the closed-days group; it's all a
 * fitness studio sees (its hours are its class schedule). Nothing writes on
 * load. Everything goes through useProviderAvailability, which targets the
 * active branch.
 */
export function AvailabilityTab() {
  const { t } = useLang();
  const { profile } = useProviderProfile();
  // Monthly mode swaps the weekly summary for the monthly calendar.
  const isMonthly = profile?.availability_mode === "monthly";
  // A fitness studio's hours ARE its class schedule (edited from /calendar), so
  // both hours editors are hidden for it. The closed-days group stays: it is a
  // studio's only way to close a day, and the class booking flow honours it.
  const isFitnessStudio = profile?.category === "fitness_studio";
  // Special opening days: weekly providers only (monthly mode edits each date
  // in its own calendar). Never a studio or an academy; the RPC refuses both.
  // An academy never reaches this section (lib/dashboardSetup); the check is
  // defence in depth.
  const showsOpenings = !isFitnessStudio && !isMonthly && !isAcademyCategory(profile?.category);

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
      <h2 className="text-lg font-semibold">
        {t(isFitnessStudio ? "setupRowClosedDays" : "workingHoursLabel")}
        <BranchSuffix />
      </h2>

      {!isFitnessStudio && isMonthly && <MonthlyAvailabilityCalendar />}
      {!isFitnessStudio && !isMonthly && <WeekSummary />}

      {showsOpenings && <SpecialOpeningsGroup />}

      <ClosedDaysGroup showHeading={!isFitnessStudio} />
    </motion.div>
  );
}

// ── Weekly ───────────────────────────────────────────────────────────────────

function WeekSummary() {
  const { t } = useLang();
  const { availability } = useProviderAvailability();
  const [editing, setEditing] = useState<number | null>(null);
  const rows = availability as WeeklyDayRow[];
  const rowFor = (dow: number) => rows.find((r) => r.day_of_week === dow);

  return (
    <>
      <ul className={LIST}>
        {DAY_KEYS.map((key, dow) => {
          const ranges = formatRanges(draftFromRow(rowFor(dow)));
          return (
            <li key={key} className={dow > 0 ? DIVIDER : undefined}>
              <button type="button" onClick={() => setEditing(dow)} className={ROW} aria-haspopup="dialog">
                <span className="w-20 shrink-0 text-sm font-semibold">{t(key)}</span>
                <span
                  className={cn(
                    "min-w-0 flex-1 text-sm tabular-nums",
                    ranges ? "text-foreground/80" : "text-foreground/55",
                  )}
                >
                  {ranges ? ltr(ranges) : t("dayClosedShort")}
                  {ranges && rowFor(dow)?.repeat_every_weeks === 2 && (
                    <span className="block text-xs text-foreground/70">{t("hoursEveryTwoWeeks")}</span>
                  )}
                </span>
                <ForwardArrow className="h-4 w-4 shrink-0 text-foreground/40" />
              </button>
            </li>
          );
        })}
      </ul>

      <Sheet open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <SheetContent
          side="bottom"
          aria-describedby={undefined}
          className={`max-h-[calc(var(--vvh,100dvh)*0.90)] overflow-y-auto rounded-t-3xl pb-[max(1.5rem,env(safe-area-inset-bottom))] ${providerDesktopSheet}`}
        >
          {editing !== null && (
            <WeekDayEditor
              key={editing}
              dow={editing}
              rows={rows}
              onDone={() => setEditing(null)}
            />
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}

function WeekDayEditor({ dow, rows, onDone }: { dow: number; rows: WeeklyDayRow[]; onDone: () => void }) {
  const { t, lang } = useLang();
  const { profile } = useProviderProfile();
  const { upsertAvailability, blockedDates, dateOverrides } = useProviderAvailability();
  const stored = rows.find((r) => r.day_of_week === dow);
  const [draft, setDraft] = useState<DayDraft>(() => draftFromRow(stored));
  // Fixed for the sheet's lifetime, so the two date choices can't shift under
  // the owner if the sheet stays open past midnight.
  const [today] = useState(() => startOfToday());
  // The every-2-weeks setting, kept apart from the hours draft: DayHoursEditor
  // is shared with the monthly and special-opening sheets, and "apply to all
  // open days" copies the hours draft only.
  const [repeat, setRepeat] = useState<RepeatDraft>(() => repeatFromRow(stored, today));
  const [busy, setBusy] = useState(false);
  // Days the confirmation lists; null = closed.
  const [confirmDays, setConfirmDays] = useState<number[] | null>(null);
  // Bookings the repeat change would leave on closed days, and what Save does
  // if the owner goes ahead. null = no warning showing.
  const [stranded, setStranded] = useState<{ bookings: UpcomingBookingName[]; proceed: () => void } | null>(null);
  const error = validateDay(draft);
  // Closing the day KEEPS the stored repeat setting: repeat edits only count,
  // and are only written, while the day is open.
  const repeatChanged = draft.open && repeatDiffers(stored, repeat);
  const repeatBlocked = draft.open && repeatIncomplete(repeat);
  const cantSave = !!error || repeatBlocked || busy;
  const dateFnsLocale = lang === "he" ? he : lang === "ar" ? ar : enUS;

  const write = (day: number, d: DayDraft, withRepeat: boolean) =>
    upsertAvailability.mutateAsync({ ...draftToRow(day, d), ...(withRepeat ? repeatPayload(repeat) : {}) });

  const doSave = async () => {
    if (!draftDiffers(stored, draft) && !repeatChanged) {
      onDone();
      return;
    }
    setBusy(true);
    try {
      await write(dow, draft, repeatChanged);
      toast.success(t("bsSaved"));
      onDone();
    } catch {
      toast.error(t("bsSaveError"));
    } finally {
      setBusy(false);
    }
  };

  /**
   * Before a repeat change is written: list the existing bookings that would
   * land on days that become closed. Decided by resolveDayHours with the real
   * blocked dates and openings (lib/repeatWeeks bookingsOnClosingDays), so
   * dates already closed, or kept open by an opening, are not listed. Nothing
   * is cancelled; the owner may still save. With no repeat change, or nothing
   * affected, it goes straight on.
   */
  const checkRepeat = async (proceed: () => void) => {
    if (!repeatChanged || !profile) {
      proceed();
      return;
    }
    setBusy(true);
    let affected: UpcomingBookingName[];
    try {
      const upcoming = await fetchUpcomingBookingNames(profile.id, toLocalDateStr(today));
      const newRow: WeeklyRow = { ...draftToRow(dow, draft), ...repeatPayload(repeat) };
      affected = bookingsOnClosingDays(
        upcoming,
        rows as WeeklyRow[],
        newRow,
        blockedDates.map((b) => b.blocked_date.slice(0, 10)),
        dateOverrides as DateOverrideRow[],
      );
    } catch {
      toast.error(t("hrsRepeatCheckError"));
      setBusy(false);
      return;
    }
    setBusy(false);
    if (affected.length === 0) proceed();
    else setStranded({ bookings: affected, proceed });
  };

  const save = () => {
    if (cantSave) return;
    void checkRepeat(() => void doSave());
  };

  const targets = draft.open ? openDaysToChange(rows, dow, draft) : [];

  const applyToOpenDays = async (days: number[]) => {
    setBusy(true);
    try {
      // Sequential, one upsertAvailability per day: the same write as Save.
      // Not one transaction, so if one fails it stops there and says so; the
      // summary refreshes from whatever was saved.
      if (draftDiffers(stored, draft) || repeatChanged) await write(dow, draft, repeatChanged);
      for (const day of days) {
        const target = rows.find((r) => r.day_of_week === day);
        // Only currently-open days get here; they stay open. HOURS ONLY: each
        // target keeps its own every-week / every-2-weeks setting.
        if (target?.is_available) await write(day, { ...draft, open: true }, false);
      }
      toast.success(t("bsSaved"));
      setConfirmDays(null);
      onDone();
    } catch {
      toast.error(t("bsSaveError"));
      setConfirmDays(null);
    } finally {
      setBusy(false);
    }
  };

  const onApply = () => {
    if (cantSave) return;
    void checkRepeat(() => {
      if (targets.length === 0) void doSave();
      else setConfirmDays(targets);
    });
  };

  return (
    <>
      <SheetHeader className="text-start">
        <SheetTitle>{t(DAY_KEYS[dow])}<BranchSuffix /></SheetTitle>
      </SheetHeader>

      <div className="mt-5">
        <DayHoursEditor value={draft} onChange={setDraft} error={error} closedHint={t("hrsClosedHint")} />
        {draft.open && <RepeatEditor dow={dow} today={today} value={repeat} onChange={setRepeat} />}
      </div>

      <div className="mt-6 space-y-2">
        <Button className="h-12 w-full rounded-2xl text-base font-semibold" onClick={save} disabled={cantSave}>
          {t("save")}
        </Button>
        {draft.open && (
          <Button
            variant="outline"
            className="h-11 w-full rounded-2xl"
            onClick={onApply}
            disabled={cantSave}
          >
            {t("hrsApplyOpen")}
          </Button>
        )}
      </div>

      <AlertDialog open={confirmDays !== null} onOpenChange={(o) => !o && !busy && setConfirmDays(null)}>
        <AlertDialogContent className="w-[calc(100%-2rem)] max-w-sm rounded-3xl">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("hrsApplyTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("hrsApplyBody")
                .replace("{hours}", ltr(formatRanges(draft) ?? ""))
                .replace("{days}", joinList(lang, (confirmDays ?? []).map((d) => t(DAY_KEYS[d]))))}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:space-x-0">
            <AlertDialogCancel type="button" className="mt-0 h-11 rounded-2xl" disabled={busy}>
              {t("cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              type="button"
              className="h-11 rounded-2xl"
              disabled={busy}
              onClick={(e) => {
                // Keep the dialog up until the writes finish.
                e.preventDefault();
                void applyToOpenDays(confirmDays ?? []);
              }}
            >
              {t("hrsApplyConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={stranded !== null} onOpenChange={(o) => !o && setStranded(null)}>
        <AlertDialogContent className="w-[calc(100%-2rem)] max-w-sm rounded-3xl">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("hrsRepeatWarnTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("hrsRepeatWarnBody").replace("{day}", t(DAY_KEYS[dow]))}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {/* Grouped by date; time + name only (never a phone number). Names wrap
              rather than truncate: in RTL an ellipsis cuts off the START of a name. */}
          <div className="max-h-[calc(var(--vvh,100dvh)*0.4)] space-y-3 overflow-y-auto rounded-2xl bg-foreground/[0.03] p-3">
            {groupByDate(stranded?.bookings ?? []).map(([date, list]) => (
              <section key={date}>
                <h3 className="text-xs font-semibold text-foreground/70">
                  {format(parseISO(date), "EEEE d MMMM", { locale: dateFnsLocale })}
                </h3>
                <ul className="mt-1 space-y-1">
                  {list.map((b) => (
                    <li key={b.id} className="flex items-baseline gap-3 text-sm">
                      <span dir="ltr" className="shrink-0 tabular-nums">{b.booking_time.slice(0, 5)}</span>
                      <span className="min-w-0 break-words">{customerLabel(b.name, null, t("customerFallback"))}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
          <AlertDialogFooter className="gap-2 sm:space-x-0">
            <AlertDialogCancel type="button" className="mt-0 h-11 rounded-2xl">
              {t("cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              type="button"
              className="h-11 rounded-2xl"
              onClick={() => {
                const proceed = stranded?.proceed;
                setStranded(null);
                proceed?.();
              }}
            >
              {t("hrsRepeatWarnConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/**
 * Every week / every 2 weeks for one weekday. With every 2 weeks the owner
 * picks the NEXT working date from the next two occurrences; that date becomes
 * the anchor. Switching back to every week clears it.
 */
function RepeatEditor({
  dow, today, value, onChange,
}: { dow: number; today: Date; value: RepeatDraft; onChange: (next: RepeatDraft) => void }) {
  const { t, lang } = useLang();
  const dateFnsLocale = lang === "he" ? he : lang === "ar" ? ar : enUS;
  const labelId = useId();
  const nextId = useId();
  const choices = anchorChoices(dow, today);

  const segment = (on: boolean) =>
    cn(
      "flex h-11 items-center justify-center rounded-xl text-sm font-medium transition-colors",
      on ? "bg-white text-foreground shadow-sm" : "text-foreground/70",
    );

  return (
    <div className="mt-5 space-y-4">
      <div className="space-y-1.5">
        <p id={labelId} className="px-1 text-xs font-medium text-foreground/70">{t("hrsRepeatLabel")}</p>
        <div role="radiogroup" aria-labelledby={labelId} className="grid grid-cols-2 gap-1 rounded-2xl bg-foreground/[0.05] p-1">
          <button
            type="button"
            role="radio"
            aria-checked={value.every === 1}
            onClick={() => onChange({ every: 1, anchor: null })}
            className={segment(value.every === 1)}
          >
            {t("hrsRepeatWeekly")}
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={value.every === 2}
            onClick={() => value.every !== 2 && onChange({ every: 2, anchor: null })}
            className={segment(value.every === 2)}
          >
            {t("hrsRepeatBiweekly")}
          </button>
        </div>
      </div>

      {value.every === 2 && (
        <div className="space-y-1.5">
          <p id={nextId} className="px-1 text-xs font-medium text-foreground/70">
            {t("hrsRepeatNextLabel").replace("{day}", t(DAY_KEYS[dow]))}
          </p>
          <div role="radiogroup" aria-labelledby={nextId} className="grid grid-cols-2 gap-2">
            {choices.map((date) => {
              const on = value.anchor === date;
              return (
                <button
                  key={date}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => onChange({ every: 2, anchor: date })}
                  className={cn(
                    "h-12 rounded-xl border text-sm tabular-nums transition-colors",
                    on ? "border-accent bg-accent/10 font-semibold text-foreground" : "border-border text-foreground/80",
                  )}
                >
                  {format(parseISO(date), "d MMMM", { locale: dateFnsLocale })}
                </button>
              );
            })}
          </div>
          <p className="px-1 text-xs leading-relaxed text-foreground/70">
            {t(value.anchor ? "hrsRepeatHint" : "hrsRepeatPick")}
          </p>
        </div>
      )}
    </div>
  );
}

// ── Closed days (provider_blocked_dates) ────────────────────────────────────

function ClosedDaysGroup({ showHeading }: { showHeading: boolean }) {
  const { t, isRtl, lang } = useLang();
  const { blockedDates, blockDate, unblockDate } = useProviderAvailability();
  const [blockingDate, setBlockingDate] = useState<Date | undefined>();
  const [blockReason, setBlockReason] = useState("");

  // Same language→locale selection the other two calendars use
  // (MonthlyAvailabilityCalendar, BookingMonthCalendar) so month names and
  // weekday headers follow the app language instead of defaulting to English.
  const dateFnsLocale = lang === "he" ? he : lang === "ar" ? ar : enUS;

  // Controlled month, needed because we hide react-day-picker's built-in caption
  // and render our own nav row — its absolute left/right nav buttons don't flip
  // in RTL. Nav is bounded below at the current month (every earlier day is
  // disabled anyway); there's deliberately no upper bound, so a provider can
  // still block a date any distance in the future, exactly as before.
  const blockToday = startOfToday();
  const [blockMonth, setBlockMonth] = useState<Date>(() => startOfToday());
  const canGoPrevMonth = isAfter(startOfMonth(blockMonth), startOfMonth(blockToday));

  // Already-blocked days, tinted in the picker so the provider can see at a
  // glance what's taken (blocking the same date twice hits the
  // unique(provider_id, blocked_date) constraint). Visual only — not disabled.
  const blockedParsed = blockedDates.map((bd) => parseISO(bd.blocked_date.slice(0, 10)));

  // Only today + future blocked dates are listed (past ones stay in the DB —
  // MonthlyAvailabilityCalendar reads the same blockedDates and still needs
  // them to render the displayed month, so we filter here, not in the hook).
  const todayStr = format(new Date(), "yyyy-MM-dd");
  const upcoming = blockedDates.filter((bd) => bd.blocked_date.slice(0, 10) >= todayStr);

  const navBtn =
    "inline-flex h-9 w-9 items-center justify-center rounded-xl bg-card text-foreground " +
    "shadow-sm ring-1 ring-border transition-all active:scale-95 " +
    "hover:bg-accent hover:text-accent-foreground disabled:opacity-30 disabled:pointer-events-none " +
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

  const handleBlockDate = async () => {
    if (!blockingDate) return;
    try {
      await blockDate.mutateAsync({ blocked_date: format(blockingDate, "yyyy-MM-dd"), reason: blockReason });
      toast.success(t("dateBlocked"));
      setBlockingDate(undefined);
      setBlockReason("");
    } catch {
      toast.error(t("bsSaveError"));
    }
  };

  const handleUnblock = async (id: string) => {
    try {
      await unblockDate.mutateAsync(id);
      toast.success(t("dateUnblocked"));
    } catch {
      toast.error(t("bsSaveError"));
    }
  };

  const chipDate = (d: string) => format(parseISO(d.slice(0, 10)), "EEE, d MMM", { locale: dateFnsLocale });

  return (
    <section className="space-y-2">
      {showHeading && <h3 className={GROUP_HEADING}>{t("setupRowClosedDays")}</h3>}
      <div className={LIST}>
        <div className="p-3">
          {upcoming.length === 0 ? (
            <p className="px-1 py-2 text-sm text-foreground/70">{t("setupClosedDaysNone")}</p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {upcoming.map((bd) => {
                const label = chipDate(bd.blocked_date);
                return (
                  <li
                    key={bd.id}
                    className="flex min-h-11 max-w-full items-center rounded-full bg-white/80 ps-3.5 ring-1 ring-foreground/10"
                  >
                    <span className="min-w-0 truncate text-sm">
                      <span className="font-semibold">{label}</span>
                      {bd.reason && <span className="text-foreground/60"> · {bd.reason}</span>}
                    </span>
                    <button
                      type="button"
                      onClick={() => void handleUnblock(bd.id)}
                      aria-label={t("hrsRemoveClosedDay").replace("{date}", label)}
                      className="flex h-11 w-10 shrink-0 items-center justify-center rounded-full text-foreground/50 hover:text-foreground"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <Popover>
          <PopoverTrigger asChild>
            <button type="button" className={cn(ROW, DIVIDER, "font-semibold text-accent")}>
              <Plus className="h-4 w-4 shrink-0" />
              <span className="flex-1 text-sm">{t("hrsAddClosedDay")}</span>
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-[19.5rem] rounded-2xl p-0" align="start">
            {/* Own caption row instead of react-day-picker's: its nav buttons are
                absolutely positioned left/right and its chevrons are hardcoded,
                so they point the wrong way in RTL. `dir` flips the weekday
                header + day grid; `locale` localizes month and weekday names. */}
            <div className="flex items-center justify-between px-3 pt-3">
              <button
                type="button"
                aria-label={t("prevMonthAria")}
                disabled={!canGoPrevMonth}
                onClick={() => setBlockMonth(subMonths(blockMonth, 1))}
                className={navBtn}
              >
                {isRtl ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
              </button>
              <span className="text-sm font-bold text-foreground">
                {format(blockMonth, "MMMM yyyy", { locale: dateFnsLocale })}
              </span>
              <button
                type="button"
                aria-label={t("nextMonthAria")}
                onClick={() => setBlockMonth(addMonths(blockMonth, 1))}
                className={navBtn}
              >
                {isRtl ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              </button>
            </div>

            <Calendar
              mode="single"
              month={blockMonth}
              onMonthChange={setBlockMonth}
              dir={isRtl ? "rtl" : "ltr"}
              locale={dateFnsLocale}
              weekStartsOn={0}
              selected={blockingDate}
              onSelect={setBlockingDate}
              disabled={(date) => date < blockToday}
              modifiers={{ blocked: blockedParsed }}
              modifiersClassNames={{
                blocked: "bg-destructive/10 text-destructive line-through hover:bg-destructive/10",
              }}
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
                // `!` is load-bearing: react-day-picker concatenates `day` and
                // `day_selected` onto one element, and Tailwind emits
                // hover:bg-secondary / text-foreground AFTER their accent
                // counterparts. At equal specificity the later rule won, so the
                // just-clicked day (cursor still resting on it, and hover sticks
                // on touch) rendered white-on-near-white. Important pins the
                // selected state regardless of stylesheet order.
                day_selected:
                  "!bg-accent !text-accent-foreground font-bold shadow-[0_4px_12px_-4px_hsl(var(--accent)/0.4)] hover:!bg-accent hover:!text-accent-foreground",
                day_today: "ring-1 ring-inset ring-accent/50 font-bold !text-accent",
                day_disabled: "text-muted-foreground/30 pointer-events-none hover:bg-transparent",
                day_outside: "text-muted-foreground/25",
                day_hidden: "invisible",
              }}
              className="pointer-events-auto p-3 pt-1"
            />

            {blockingDate && (
              <div className="space-y-2.5 border-t border-border bg-secondary/40 p-3">
                <p className="text-xs font-medium text-muted-foreground">
                  {format(blockingDate, "EEEE, d MMMM yyyy", { locale: dateFnsLocale })}
                </p>
                <Input
                  placeholder={t("reason")}
                  value={blockReason}
                  onChange={(e) => setBlockReason(e.target.value)}
                  className="h-11 rounded-xl text-sm"
                />
                <Button className="h-11 w-full rounded-xl font-semibold" onClick={handleBlockDate}>
                  {t("save")}
                </Button>
              </div>
            )}
          </PopoverContent>
        </Popover>
      </div>
    </section>
  );
}
