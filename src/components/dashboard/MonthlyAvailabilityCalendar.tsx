import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  format, parseISO, startOfToday, startOfMonth, endOfMonth,
  addMonths, subMonths, isAfter, isBefore,
} from "date-fns";
import { he, ar, enUS } from "date-fns/locale";
import { RotateCcw, ChevronLeft, ChevronRight, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ForwardArrow } from "@/components/ui/directional-icon";
import { providerDesktopSheet } from "@/components/layout/providerDesktop";
import { useLang } from "@/contexts/LangContext";
import { useProviderProfile } from "@/hooks/useProviderProfile";
import { useProviderAvailability } from "@/hooks/useProviderAvailability";
import { DayHoursEditor } from "@/components/dashboard/DayHoursEditor";
import { DIVIDER, GROUP_HEADING, LIST, ROW } from "@/components/dashboard/settingsList";
import { ltr } from "@/lib/dashboardSetup";
import { formatRanges, validateDay, type DayDraft } from "@/lib/weeklyHours";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { BranchSuffix } from "@/components/branch/BranchSuffix";

type OverrideRow = {
  id: string;
  override_date: string;
  is_available: boolean;
  start_time: string;
  end_time: string;
  break_start: string | null;
  break_end: string | null;
};

type BlockedRow = {
  id: string;
  blocked_date: string;
  reason: string | null;
};

const dayKey = (d: Date) => format(d, "yyyy-MM-dd");
const hhmm = (v: string | null | undefined, fallback: string) => (v ?? fallback).slice(0, 5);

/**
 * Monthly calendar editor, shown in the opening-hours section ONLY when the
 * provider is in monthly mode. Every un-overridden day inherits the flat
 * default (edited in Settings). Tapping a day writes/clears a
 * provider_date_overrides row, or closes it via provider_blocked_dates.
 * Closed days are listed once, in the section's closed-days group.
 */
export function MonthlyAvailabilityCalendar() {
  const { t, isRtl, lang } = useLang();
  const navigate = useNavigate();
  const { profile } = useProviderProfile();
  const { blockedDates, dateOverrides, deleteDateOverride } = useProviderAvailability();

  const dateFnsLocale = lang === "he" ? he : lang === "ar" ? ar : enUS;

  const flatAvailable = profile?.monthly_default_available ?? true;
  const flatStart = hhmm(profile?.monthly_default_start, "09:00");
  const flatEnd = hhmm(profile?.monthly_default_end, "17:00");

  const today = startOfToday();
  // Provider PLANNING range: the current calendar month through the END of next
  // month (2 full months). Past days in the current month stay visible but
  // disabled (via fromDate). In react-day-picker, fromDate/toDate also bound
  // month navigation to [current month, next month]. This governs only how far
  // ahead the PROVIDER can set availability — it does NOT touch
  // booking_window_days or when customers can actually book.
  const rangeEnd = endOfMonth(addMonths(today, 1));

  const [month, setMonth] = useState<Date>(today);
  const [editingDate, setEditingDate] = useState<Date | null>(null);

  // Custom-caption nav bounds (same [current month, next month] range as the
  // grid). Rendered in the parent scope so the buttons flow/disable correctly in
  // RTL — no logic change, just drives the existing month/setMonth state.
  const currentMonthStart = startOfMonth(today);
  const nextMonthStart = startOfMonth(addMonths(today, 1));
  const displayedStart = startOfMonth(month);
  const canGoPrev = isAfter(displayedStart, currentMonthStart);
  const canGoNext = isBefore(displayedStart, nextMonthStart);

  // Lookup structures. Blocked wins, so blocked keys are excluded from the
  // override modifier arrays — only the blocked marker shows on those days.
  const blockedSet = new Set(blockedDates.map(b => b.blocked_date.slice(0, 10)));
  const overrideMap = new Map<string, OverrideRow>(
    (dateOverrides as OverrideRow[]).map(o => [o.override_date, o]),
  );

  const overrideOpenDates = (dateOverrides as OverrideRow[])
    .filter(o => o.is_available && !blockedSet.has(o.override_date))
    .map(o => parseISO(o.override_date));
  const overrideClosedDates = (dateOverrides as OverrideRow[])
    .filter(o => !o.is_available && !blockedSet.has(o.override_date))
    .map(o => parseISO(o.override_date));
  const blockedParsed = blockedDates.map(b => parseISO(b.blocked_date.slice(0, 10)));

  const editingKey = editingDate ? dayKey(editingDate) : null;
  const editingOverride = editingKey ? overrideMap.get(editingKey) : undefined;
  // Closing a day writes a provider_blocked_dates row, so the editor needs
  // the block row's id (to reopen = unblock). Blocked wins in the resolver.
  const editingBlock = editingKey
    ? (blockedDates as BlockedRow[]).find(b => b.blocked_date.slice(0, 10) === editingKey)
    : undefined;

  // Custom-hours days (open overrides), date-sorted. Closed days are blocked
  // dates and appear in the closed-days group below, so they're not repeated.
  const customDays = (dateOverrides as OverrideRow[])
    .filter(o => o.is_available && !blockedSet.has(o.override_date))
    .sort((a, b) => a.override_date.localeCompare(b.override_date));

  const resetDay = async (id: string) => {
    try {
      await deleteDateOverride.mutateAsync(id);
      toast.success(t("bsSaved"));
    } catch {
      toast.error(t("bsSaveError"));
    }
  };

  const navBtn =
    "inline-flex h-11 w-11 items-center justify-center rounded-xl bg-card text-foreground " +
    "shadow-sm ring-1 ring-border transition-colors hover:bg-accent hover:text-accent-foreground " +
    "hover:ring-accent disabled:opacity-30 disabled:pointer-events-none disabled:hover:bg-card " +
    "disabled:hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

  const defaultLine = flatAvailable
    ? t("hrsMonthlyDefaultOpen").replace("{hours}", ltr(`${flatStart} – ${flatEnd}`))
    : t("hrsMonthlyDefaultClosed");

  return (
    <div className="space-y-6">
      {/* The flat default every un-overridden day inherits. Edited in Settings
          (AvailabilityModeSection), so the row goes there. */}
      <ul className={LIST}>
        <li>
          <button type="button" onClick={() => navigate("/settings")} className={ROW}>
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent">
              <Clock className="h-[18px] w-[18px]" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold leading-snug">{t("hrsMonthlyDefaultTitle")}</span>
              <span className="mt-0.5 block text-xs leading-snug text-foreground/70">{defaultLine}</span>
            </span>
            <ForwardArrow className="h-4 w-4 shrink-0 text-foreground/40" />
          </button>
        </li>
      </ul>

      <section className="space-y-2">
        <h3 className={GROUP_HEADING}>{t("monthlyCalendarTitle")}</h3>
        <div className={cn(LIST, "p-3")}>
          {/* Our own caption so the nav buttons sit/disable on the correct
              sides in RTL; dir flips react-day-picker's header + grid. */}
          <div className="mb-2 flex items-center justify-between">
            <button
              type="button"
              aria-label={t("prevMonthAria")}
              disabled={!canGoPrev}
              onClick={() => setMonth(subMonths(month, 1))}
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
              onClick={() => setMonth(addMonths(month, 1))}
              className={navBtn}
            >
              {isRtl ? <ChevronLeft className="h-5 w-5" /> : <ChevronRight className="h-5 w-5" />}
            </button>
          </div>

          <Calendar
            month={month}
            onMonthChange={setMonth}
            dir={isRtl ? "rtl" : "ltr"}
            locale={dateFnsLocale}
            weekStartsOn={0}
            fromDate={today}
            toDate={rangeEnd}
            onDayClick={(day, mods) => {
              if (mods.disabled) return;
              setEditingDate(day);
            }}
            modifiers={{ ovOpen: overrideOpenDates, ovClosed: overrideClosedDates, blocked: blockedParsed }}
            modifiersClassNames={{
              ovOpen: "bg-accent/15 text-accent font-bold ring-1 ring-inset ring-accent/30 hover:bg-accent/20",
              ovClosed: "bg-muted text-muted-foreground line-through hover:bg-muted",
              blocked: "bg-destructive/10 text-destructive line-through hover:bg-destructive/10",
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
                "inline-flex items-center justify-center transition-colors",
                "hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40",
              ),
              day_today: "ring-1 ring-inset ring-accent/50 font-bold text-accent",
              day_disabled: "text-muted-foreground/30 pointer-events-none hover:bg-transparent",
              day_outside: "text-muted-foreground/25",
              day_hidden: "invisible",
            }}
            className="p-0"
          />

          {/* Legend — custom hours, and closed (a closed day is a blocked date,
              rendered with the destructive tint). */}
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 px-1 text-xs text-foreground/70">
            <span className="inline-flex items-center gap-2">
              <span className="h-4 w-4 rounded-md bg-accent/15 ring-1 ring-inset ring-accent/30" />
              {t("legendCustom")}
            </span>
            <span className="inline-flex items-center gap-2">
              <span className="h-4 w-4 rounded-md bg-destructive/10 ring-1 ring-inset ring-destructive/30" />
              {t("legendClosedDay")}
            </span>
          </div>
        </div>
        <p className="px-1 text-xs leading-relaxed text-foreground/70">{t("monthlyCalendarHelp")}</p>
      </section>

      {/* Custom-hours days */}
      <section className="space-y-2">
        <h3 className={GROUP_HEADING}>{t("customDaysTitle")}</h3>
        <ul className={LIST}>
          {customDays.length === 0 ? (
            <li className="px-4 py-4 text-sm text-foreground/70">{t("noCustomDays")}</li>
          ) : (
            customDays.map((o, i) => (
              <li key={o.id} className={cn("flex items-center", i > 0 && DIVIDER)}>
                <button
                  type="button"
                  onClick={() => setEditingDate(parseISO(o.override_date))}
                  className={cn(ROW, "flex-1")}
                  aria-haspopup="dialog"
                >
                  <span className="w-28 shrink-0 text-sm font-semibold">
                    {format(parseISO(o.override_date), "EEE, d MMM", { locale: dateFnsLocale })}
                  </span>
                  <span className="min-w-0 flex-1 text-sm tabular-nums text-foreground/80">
                    {ltr(formatRanges({
                      open: true,
                      start: hhmm(o.start_time, flatStart),
                      end: hhmm(o.end_time, flatEnd),
                      breakStart: o.break_start ? hhmm(o.break_start, "") : null,
                      breakEnd: o.break_end ? hhmm(o.break_end, "") : null,
                    }) ?? "")}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => void resetDay(o.id)}
                  aria-label={t("resetToDefault")}
                  title={t("resetToDefault")}
                  className="me-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-foreground/50 hover:text-foreground"
                >
                  <RotateCcw className="h-4 w-4" />
                </button>
              </li>
            ))
          )}
        </ul>
      </section>

      {/* Day editor sheet */}
      <Sheet open={!!editingDate} onOpenChange={(o) => !o && setEditingDate(null)}>
        <SheetContent
          side="bottom"
          aria-describedby={undefined}
          className={`max-h-[calc(var(--vvh,100dvh)*0.90)] overflow-y-auto rounded-t-3xl pb-[max(1.5rem,env(safe-area-inset-bottom))] ${providerDesktopSheet}`}
        >
          <SheetHeader className="text-start">
            <SheetTitle>
              {editingDate && format(editingDate, "EEEE, d MMMM", { locale: dateFnsLocale })}
              <BranchSuffix />
            </SheetTitle>
          </SheetHeader>
          {editingDate && (
            <div className="mt-5">
              <DayOverrideEditor
                key={editingKey ?? ""}
                dateStr={editingKey!}
                existing={editingOverride}
                blockId={editingBlock?.id}
                flatAvailable={flatAvailable}
                flatStart={flatStart}
                flatEnd={flatEnd}
                onClose={() => setEditingDate(null)}
              />
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function DayOverrideEditor({
  dateStr,
  existing,
  blockId,
  flatAvailable,
  flatStart,
  flatEnd,
  onClose,
}: {
  dateStr: string;
  existing: OverrideRow | undefined;
  blockId: string | undefined;
  flatAvailable: boolean;
  flatStart: string;
  flatEnd: string;
  onClose: () => void;
}) {
  const { t } = useLang();
  const { upsertDateOverride, deleteDateOverride, blockDate, unblockDate } =
    useProviderAvailability();

  // A day is "closed" when it has a blocked-date row (blockId). Custom-hours days
  // have an is_available override. Otherwise the day follows the flat default.
  const hadBreak = !!(existing?.break_start && existing?.break_end);
  const [draft, setDraft] = useState<DayDraft>(() => ({
    open: blockId ? false : existing ? existing.is_available : flatAvailable,
    start: hhmm(existing?.start_time, flatStart),
    end: hhmm(existing?.end_time, flatEnd),
    breakStart: hadBreak ? hhmm(existing!.break_start, "13:00") : null,
    breakEnd: hadBreak ? hhmm(existing!.break_end, "14:00") : null,
  }));
  const error = validateDay(draft);

  const busy =
    upsertDateOverride.isPending || deleteDateOverride.isPending ||
    blockDate.isPending || unblockDate.isPending;

  const save = async () => {
    if (error) return;
    try {
      if (draft.open) {
        // OPEN with custom hours → write an override; if the day was closed
        // (blocked), unblock it first so the override actually takes effect.
        if (blockId) await unblockDate.mutateAsync(blockId);
        await upsertDateOverride.mutateAsync({
          override_date: dateStr,
          is_available: true,
          start_time: draft.start,
          end_time: draft.end,
          break_start: draft.breakStart,
          break_end: draft.breakEnd,
        });
      } else {
        // CLOSE → block the date (this drives the status pill). Drop any stale
        // custom-hours override so nothing sits under the block.
        if (existing) await deleteDateOverride.mutateAsync(existing.id);
        if (!blockId) await blockDate.mutateAsync({ blocked_date: dateStr });
      }
      toast.success(t("bsSaved"));
      onClose();
    } catch {
      toast.error(t("bsSaveError"));
    }
  };

  // Reset to flat default: remove any override AND any block for this date.
  const reset = async () => {
    try {
      if (existing) await deleteDateOverride.mutateAsync(existing.id);
      if (blockId) await unblockDate.mutateAsync(blockId);
      toast.success(t("bsSaved"));
      onClose();
    } catch {
      toast.error(t("bsSaveError"));
    }
  };

  return (
    <div className="space-y-6">
      <DayHoursEditor value={draft} onChange={setDraft} error={error} closedHint={t("dayClosedHint")} />

      <div className="space-y-2">
        <Button className="h-12 w-full rounded-2xl text-base font-semibold" onClick={save} disabled={busy || !!error}>
          {t("save")}
        </Button>
        {(existing || blockId) && (
          <Button variant="outline" className="h-11 w-full gap-1.5 rounded-2xl" onClick={reset} disabled={busy}>
            <RotateCcw className="h-4 w-4" />
            {t("resetToDefault")}
          </Button>
        )}
      </div>
    </div>
  );
}
