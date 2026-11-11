import { useState } from "react";
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
import { useProviderAvailability } from "@/hooks/useProviderAvailability";
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

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
      <h2 className="text-lg font-semibold">
        {t(isFitnessStudio ? "setupRowClosedDays" : "workingHoursLabel")}
        <BranchSuffix />
      </h2>

      {!isFitnessStudio && isMonthly && <MonthlyAvailabilityCalendar />}
      {!isFitnessStudio && !isMonthly && <WeekSummary />}

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
  const { upsertAvailability } = useProviderAvailability();
  const stored = rows.find((r) => r.day_of_week === dow);
  const [draft, setDraft] = useState<DayDraft>(() => draftFromRow(stored));
  const [busy, setBusy] = useState(false);
  // Days the confirmation lists; null = closed.
  const [confirmDays, setConfirmDays] = useState<number[] | null>(null);
  const error = validateDay(draft);

  const write = (day: number, d: DayDraft) => upsertAvailability.mutateAsync(draftToRow(day, d));

  const save = async () => {
    if (error || busy) return;
    if (!draftDiffers(stored, draft)) {
      onDone();
      return;
    }
    setBusy(true);
    try {
      await write(dow, draft);
      toast.success(t("bsSaved"));
      onDone();
    } catch {
      toast.error(t("bsSaveError"));
    } finally {
      setBusy(false);
    }
  };

  const targets = draft.open ? openDaysToChange(rows, dow, draft) : [];

  const applyToOpenDays = async (days: number[]) => {
    setBusy(true);
    try {
      // Sequential, one upsertAvailability per day: the same write as Save.
      // Not one transaction, so if one fails it stops there and says so; the
      // summary refreshes from whatever was saved.
      if (draftDiffers(stored, draft)) await write(dow, draft);
      for (const day of days) {
        const target = rows.find((r) => r.day_of_week === day);
        // Only currently-open days get here; they stay open.
        if (target?.is_available) await write(day, { ...draft, open: true });
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
    if (error || busy) return;
    if (targets.length === 0) void save();
    else setConfirmDays(targets);
  };

  return (
    <>
      <SheetHeader className="text-start">
        <SheetTitle>{t(DAY_KEYS[dow])}<BranchSuffix /></SheetTitle>
      </SheetHeader>

      <div className="mt-5">
        <DayHoursEditor value={draft} onChange={setDraft} error={error} closedHint={t("hrsClosedHint")} />
      </div>

      <div className="mt-6 space-y-2">
        <Button className="h-12 w-full rounded-2xl text-base font-semibold" onClick={save} disabled={!!error || busy}>
          {t("save")}
        </Button>
        {draft.open && (
          <Button
            variant="outline"
            className="h-11 w-full rounded-2xl"
            onClick={onApply}
            disabled={!!error || busy}
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
    </>
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
