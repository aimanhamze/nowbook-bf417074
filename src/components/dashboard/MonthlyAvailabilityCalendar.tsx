import { useState } from "react";
import {
  format, parseISO, startOfToday, startOfMonth, endOfMonth,
  addMonths, subMonths, isAfter, isBefore,
} from "date-fns";
import { he, ar, enUS } from "date-fns/locale";
import { Coffee, RotateCcw, ChevronLeft, ChevronRight, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Calendar } from "@/components/ui/calendar";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { providerDesktopSheet } from "@/components/layout/providerDesktop";
import { useLang } from "@/contexts/LangContext";
import { useProviderProfile } from "@/hooks/useProviderProfile";
import { useProviderAvailability } from "@/hooks/useProviderAvailability";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

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
 * Monthly calendar editor — shown in the Availability tab ONLY when the provider
 * is in monthly mode. Every un-overridden day inherits the flat default (Phase 2);
 * tapping a day writes/clears a provider_date_overrides row. Blocked dates are a
 * hard layer shown here but managed in the separate Block a Date card.
 */
export function MonthlyAvailabilityCalendar() {
  const { t, isRtl, lang } = useLang();
  const { profile } = useProviderProfile();
  const { blockedDates, dateOverrides, deleteDateOverride, unblockDate } =
    useProviderAvailability();

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
  // Closing a day now writes a provider_blocked_dates row, so the editor needs
  // the block row's id (to reopen = unblock). Blocked wins in the resolver.
  const editingBlock = editingKey
    ? (blockedDates as BlockedRow[]).find(b => b.blocked_date.slice(0, 10) === editingKey)
    : undefined;

  const defaultSummary = flatAvailable
    ? t("monthlyDefaultSummaryOpen").replace("{start}", flatStart).replace("{end}", flatEnd)
    : t("monthlyDefaultSummaryClosed");

  // Non-default days, merged and date-sorted: custom-hours (override, open) days
  // AND closed days (now blocked rows). Both surface in the calendar's list so it
  // is a complete view; each carries the correct "remove" (delete override /
  // unblock) action.
  const dayList = [
    ...(dateOverrides as OverrideRow[])
      .filter(o => o.is_available && !blockedSet.has(o.override_date))
      .map(o => ({
        key: o.id,
        date: o.override_date,
        closed: false,
        label: `${hhmm(o.start_time, flatStart)}–${hhmm(o.end_time, flatEnd)}`,
        remove: () => deleteDateOverride.mutateAsync(o.id),
      })),
    ...(blockedDates as BlockedRow[]).map(b => ({
      key: b.id,
      date: b.blocked_date.slice(0, 10),
      closed: true,
      label: t("dayClosedShort"),
      remove: () => unblockDate.mutateAsync(b.id),
    })),
  ].sort((a, b) => a.date.localeCompare(b.date));

  const navBtn =
    "inline-flex h-9 w-9 items-center justify-center rounded-xl bg-card text-foreground " +
    "shadow-sm ring-1 ring-border transition-colors hover:bg-accent hover:text-accent-foreground " +
    "hover:ring-accent disabled:opacity-30 disabled:pointer-events-none disabled:hover:bg-card " +
    "disabled:hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

  return (
    <div className="rounded-2xl border border-border bg-card p-4 sm:p-5 space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-foreground">{t("monthlyCalendarTitle")}</h3>
          <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{t("monthlyCalendarHelp")}</p>
        </div>
        {/* Flat-default baseline — the hours every un-overridden day inherits */}
        <div className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-accent/10 px-3 py-1.5 text-xs font-semibold text-accent">
          <Clock className="h-3.5 w-3.5" />
          {defaultSummary}
        </div>
      </div>

      {/* Calendar panel. dir is passed to react-day-picker so the weekday header
          row and day grid flow RTL; the caption below is our own so the nav
          buttons sit/disable on the correct sides in RTL. */}
      <div className="rounded-2xl border border-border bg-secondary/40 p-3 sm:p-4">
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
      </div>

      {/* Legend — two states: custom hours, and closed (a closed day is a blocked
          date, rendered with the destructive tint). */}
      <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-2">
          <span className="h-4 w-4 rounded-md bg-accent/15 ring-1 ring-inset ring-accent/30" />
          {t("legendCustom")}
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="h-4 w-4 rounded-md bg-destructive/10 ring-1 ring-inset ring-destructive/30" />
          {t("legendClosedDay")}
        </span>
      </div>

      {/* Custom-days summary list */}
      <div className="space-y-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t("customDaysTitle")}
        </h4>
        {dayList.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
            {t("noCustomDays")}
          </p>
        ) : (
          dayList.map(entry => (
            <div
              key={entry.key}
              className="flex items-center gap-3 rounded-xl bg-secondary px-3 py-2.5 text-sm transition-colors hover:bg-muted"
            >
              <span
                className={cn(
                  "h-2.5 w-2.5 shrink-0 rounded-full",
                  entry.closed ? "bg-destructive" : "bg-accent",
                )}
              />
              <button
                type="button"
                className="flex flex-1 items-baseline gap-2 text-start"
                onClick={() => setEditingDate(parseISO(entry.date))}
              >
                <span className="font-semibold text-foreground">
                  {format(parseISO(entry.date), "EEE, d MMM", { locale: dateFnsLocale })}
                </span>
                <span className={cn(entry.closed ? "text-destructive/80" : "text-muted-foreground")}>
                  {entry.label}
                </span>
              </button>
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground"
                onClick={async () => {
                  try {
                    await entry.remove();
                    toast.success(t("availabilitySaved"));
                  } catch (err) {
                    toast.error(err instanceof Error ? err.message : "Error");
                  }
                }}
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))
        )}
      </div>

      {/* Day editor sheet */}
      <Sheet open={!!editingDate} onOpenChange={(o) => !o && setEditingDate(null)}>
        <SheetContent
          side="bottom"
          className={`flex max-h-[88vh] flex-col gap-0 rounded-t-3xl border-t p-0 ${providerDesktopSheet}`}
        >
          <div className="mx-auto mt-3 h-1.5 w-10 shrink-0 rounded-full bg-muted-foreground/20" />
          <SheetHeader className="shrink-0 px-5 pb-1 pt-3 text-start">
            <SheetTitle>
              {editingDate && format(editingDate, "EEEE, d MMMM", { locale: dateFnsLocale })}
            </SheetTitle>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto px-5 pb-6 pt-3">
            {editingDate && (
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
            )}
          </div>
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
  const [open, setOpen] = useState(
    blockId ? false : existing ? existing.is_available : flatAvailable,
  );
  const [start, setStart] = useState(hhmm(existing?.start_time, flatStart));
  const [end, setEnd] = useState(hhmm(existing?.end_time, flatEnd));
  const [hasBreak, setHasBreak] = useState(!!(existing?.break_start && existing?.break_end));
  const [breakStart, setBreakStart] = useState(hhmm(existing?.break_start, "13:00"));
  const [breakEnd, setBreakEnd] = useState(hhmm(existing?.break_end, "14:00"));

  const busy =
    upsertDateOverride.isPending || deleteDateOverride.isPending ||
    blockDate.isPending || unblockDate.isPending;

  const save = async () => {
    try {
      if (open) {
        // OPEN with custom hours → write an override; if the day was closed
        // (blocked), unblock it first so the override actually takes effect.
        if (blockId) await unblockDate.mutateAsync(blockId);
        await upsertDateOverride.mutateAsync({
          override_date: dateStr,
          is_available: true,
          start_time: start,
          end_time: end,
          break_start: hasBreak ? breakStart : null,
          break_end: hasBreak ? breakEnd : null,
        });
      } else {
        // CLOSE → block the date (this drives the status pill). Drop any stale
        // custom-hours override so nothing sits under the block.
        if (existing) await deleteDateOverride.mutateAsync(existing.id);
        if (!blockId) await blockDate.mutateAsync({ blocked_date: dateStr });
      }
      toast.success(t("availabilitySaved"));
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error");
    }
  };

  // Reset to flat default: remove any override AND any block for this date.
  const reset = async () => {
    try {
      if (existing) await deleteDateOverride.mutateAsync(existing.id);
      if (blockId) await unblockDate.mutateAsync(blockId);
      toast.success(t("availabilitySaved"));
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error");
    }
  };

  return (
    <div className="space-y-4">
      {/* Open / closed */}
      <div className="flex items-center gap-3">
        <Switch checked={open} onCheckedChange={setOpen} />
        <Label className="text-sm font-medium">{t("editDayOpenLabel")}</Label>
      </div>

      {!open && (
        <p className="rounded-xl bg-destructive/[0.06] px-3 py-2.5 text-xs text-destructive/80">
          {t("dayClosedHint")}
        </p>
      )}

      {open && (
        <>
          {/* Hours */}
          <div>
            <Label className="text-sm">{t("dayHoursLabel")}</Label>
            <div className="mt-2 flex items-center gap-1.5">
              <Input
                type="time"
                className="h-9 text-sm flex-1"
                value={start}
                onChange={e => setStart(e.target.value)}
              />
              <span className="text-xs text-muted-foreground">–</span>
              <Input
                type="time"
                className="h-9 text-sm flex-1"
                value={end}
                onChange={e => setEnd(e.target.value)}
              />
            </div>
          </div>

          {/* Break */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Coffee className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <span className="text-xs text-muted-foreground">{t("breakTime")}</span>
              <Switch
                checked={hasBreak}
                onCheckedChange={setHasBreak}
                className="scale-75 origin-left"
              />
            </div>
            {hasBreak && (
              <div className="flex items-center gap-1.5">
                <Input
                  type="time"
                  className="h-8 text-xs flex-1"
                  value={breakStart}
                  onChange={e => setBreakStart(e.target.value)}
                />
                <span className="text-xs text-muted-foreground">–</span>
                <Input
                  type="time"
                  className="h-8 text-xs flex-1"
                  value={breakEnd}
                  onChange={e => setBreakEnd(e.target.value)}
                />
              </div>
            )}
          </div>
        </>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2 pt-2">
        <Button
          className="h-11 flex-1 text-base font-semibold"
          onClick={save}
          disabled={busy}
        >
          {t("save")}
        </Button>
        {(existing || blockId) && (
          <Button
            variant="outline"
            className="h-11 gap-1.5"
            onClick={reset}
            disabled={busy}
          >
            <RotateCcw className="h-4 w-4" />
            {t("resetToDefault")}
          </Button>
        )}
      </div>
    </div>
  );
}
