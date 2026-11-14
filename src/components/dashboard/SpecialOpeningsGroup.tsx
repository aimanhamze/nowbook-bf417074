import { useMemo, useState, type ReactNode } from "react";
import { addMonths, format, isAfter, startOfMonth, startOfToday, subMonths, type Locale } from "date-fns";
import { he, ar, enUS } from "date-fns/locale";
import type { DateRange } from "react-day-picker";
import { AlertTriangle, ChevronLeft, ChevronRight, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { providerDesktopSheet } from "@/components/layout/providerDesktop";
import { DayHoursEditor } from "@/components/dashboard/DayHoursEditor";
import { SettingsSwitch } from "@/components/dashboard/SettingsSwitch";
import { DIVIDER, GROUP_HEADING, LIST, ROW } from "@/components/dashboard/settingsList";
import { BranchSuffix } from "@/components/branch/BranchSuffix";
import { useLang } from "@/contexts/LangContext";
import { useProviderAvailability, useDayActiveBookingCount } from "@/hooks/useProviderAvailability";
import { useProviderProfile } from "@/hooks/useProviderProfile";
import { useProviderStaff } from "@/hooks/useProviderStaff";
import { useProviderStaffHours } from "@/hooks/useProviderStaffHours";
import { cn } from "@/lib/utils";
import { joinList, ltr } from "@/lib/dashboardSetup";
import { toLocalDateStr } from "@/lib/availabilityResolver";
import {
  DEFAULT_END, DEFAULT_START, formatRanges, hhmm, validateDay, type DayDraft,
} from "@/lib/weeklyHours";
import {
  beyondWindowTargets, blockedTargets, datesInRange, maxRangeEnd, openingErrorKey,
  openingTargets, parseLocal, staffOffOnTargets, type OpeningWeeklyRow,
} from "@/lib/dateOpenings";
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

// How many dates a warning names before it says "+N".
const LIST_MAX = 3;

const NAV_BTN =
  "inline-flex h-11 w-11 items-center justify-center rounded-xl bg-card text-foreground " +
  "shadow-sm ring-1 ring-border transition-all active:scale-95 " +
  "hover:bg-accent hover:text-accent-foreground disabled:opacity-30 disabled:pointer-events-none " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

/**
 * "Special opening days" (weekly providers only; AvailabilityTab gates it).
 * Lists upcoming provider_date_overrides rows and opens a sheet that writes
 * one date or a range in ONE save_date_openings call. Removing one asks first
 * and says how many bookings that day holds.
 */
export function SpecialOpeningsGroup() {
  const { t, lang } = useLang();
  const { blockedDates, dateOverrides, deleteDateOverride } = useProviderAvailability();
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<OverrideRow | null>(null);
  const dateFnsLocale = lang === "he" ? he : lang === "ar" ? ar : enUS;

  const todayStr = toLocalDateStr(new Date());
  const blockedSet = useMemo(
    () => new Set(blockedDates.map((b) => b.blocked_date.slice(0, 10))),
    [blockedDates],
  );
  const upcoming = (dateOverrides as OverrideRow[])
    .filter((o) => o.override_date.slice(0, 10) >= todayStr)
    .sort((a, b) => a.override_date.localeCompare(b.override_date));

  const label = (key: string) => format(parseLocal(key), "EEE, d MMM", { locale: dateFnsLocale });
  const hoursOf = (o: OverrideRow) =>
    formatRanges({
      open: true,
      start: hhmm(o.start_time),
      end: hhmm(o.end_time),
      breakStart: o.break_start ? hhmm(o.break_start) : null,
      breakEnd: o.break_end ? hhmm(o.break_end) : null,
    });

  const confirmRemove = async () => {
    if (!removing) return;
    try {
      await deleteDateOverride.mutateAsync(removing.id);
      toast.success(t("bsSaved"));
      setRemoving(null);
    } catch {
      toast.error(t("bsSaveError"));
    }
  };

  return (
    <section className="space-y-2">
      <h3 className={GROUP_HEADING}>{t("openingsTitle")}</h3>
      <div className={LIST}>
        <div className="space-y-2 p-3">
          <p className="px-1 text-xs leading-relaxed text-foreground/70">{t("openingsHint")}</p>
          {upcoming.length === 0 ? (
            <p className="px-1 py-1 text-sm text-foreground/70">{t("openingsNone")}</p>
          ) : (
            <ul className="space-y-2">
              {upcoming.map((o) => {
                const key = o.override_date.slice(0, 10);
                const closed = !o.is_available || blockedSet.has(key);
                const hours = hoursOf(o);
                return (
                  <li
                    key={o.id}
                    className="flex min-h-11 items-center gap-2 rounded-2xl bg-white/80 ps-3.5 ring-1 ring-foreground/10"
                  >
                    <span className="min-w-0 flex-1 text-sm">
                      <span className="font-semibold">{label(key)}</span>
                      <span className="text-foreground/70 tabular-nums">
                        {" · "}
                        {closed || !hours ? t("dayClosedShort") : ltr(hours)}
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => setRemoving(o)}
                      aria-label={t("hrsRemoveClosedDay").replace("{date}", label(key))}
                      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-foreground/50 hover:text-foreground"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <button
          type="button"
          onClick={() => setAdding(true)}
          className={cn(ROW, DIVIDER, "font-semibold text-accent")}
          aria-haspopup="dialog"
        >
          <Plus className="h-4 w-4 shrink-0" />
          <span className="flex-1 text-sm">{t("openingsAdd")}</span>
        </button>
      </div>

      <Sheet open={adding} onOpenChange={setAdding}>
        <SheetContent
          side="bottom"
          aria-describedby={undefined}
          className={`max-h-[calc(var(--vvh,100dvh)*0.9)] overflow-y-auto rounded-t-3xl pb-[max(1.5rem,env(safe-area-inset-bottom))] ${providerDesktopSheet}`}
        >
          {adding && <OpeningEditor onDone={() => setAdding(false)} />}
        </SheetContent>
      </Sheet>

      <RemoveOpeningDialog
        row={removing}
        label={removing ? label(removing.override_date.slice(0, 10)) : ""}
        busy={deleteDateOverride.isPending}
        onCancel={() => setRemoving(null)}
        onConfirm={() => void confirmRemove()}
      />
    </section>
  );
}

function RemoveOpeningDialog({
  row, label, busy, onCancel, onConfirm,
}: {
  row: OverrideRow | null;
  label: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useLang();
  const { data: count, isLoading } = useDayActiveBookingCount(row ? row.override_date.slice(0, 10) : null);

  return (
    <AlertDialog open={row !== null} onOpenChange={(o) => !o && !busy && onCancel()}>
      <AlertDialogContent className="w-[calc(100%-2rem)] max-w-sm rounded-3xl">
        <AlertDialogHeader>
          <AlertDialogTitle>{t("openingsDeleteTitle")}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2">
              <p>{t("openingsDeleteBody").replace("{date}", label)}</p>
              <p className="font-medium text-foreground" data-testid="opening-booking-count">
                {isLoading
                  ? t("openingsDeleteLoading")
                  : count
                    ? t("openingsDeleteBookings").replace("{n}", String(count))
                    : t("openingsDeleteNoBookings")}
              </p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="gap-2 sm:space-x-0">
          <AlertDialogCancel type="button" className="mt-0 h-11 rounded-2xl" disabled={busy}>
            {t("cancel")}
          </AlertDialogCancel>
          <AlertDialogAction
            type="button"
            className="h-11 rounded-2xl bg-destructive text-destructive-foreground hover:bg-destructive/90"
            disabled={busy || isLoading}
            onClick={(e) => {
              e.preventDefault();
              onConfirm();
            }}
          >
            {t("openingsDeleteConfirm")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function OpeningEditor({ onDone }: { onDone: () => void }) {
  const { t, lang, isRtl } = useLang();
  const { profile } = useProviderProfile();
  const { availability, blockedDates, dateOverrides, saveDateOpenings } = useProviderAvailability();
  const { activeStaff } = useProviderStaff();
  const { hoursByStaff } = useProviderStaffHours(activeStaff.length > 0);
  const dateFnsLocale = lang === "he" ? he : lang === "ar" ? ar : enUS;

  const today = startOfToday();
  const windowDays = (profile as { booking_window_days?: number | null } | null)?.booking_window_days ?? 14;

  const [isRange, setIsRange] = useState(false);
  const [single, setSingle] = useState<Date | undefined>();
  const [range, setRange] = useState<DateRange | undefined>();
  const [includeOpen, setIncludeOpen] = useState(false);
  const [draft, setDraft] = useState<DayDraft>({
    open: true, start: DEFAULT_START, end: DEFAULT_END, breakStart: null, breakEnd: null,
  });
  const [month, setMonth] = useState<Date>(today);
  const [confirmBlocked, setConfirmBlocked] = useState<string[] | null>(null);

  const canGoPrev = isAfter(startOfMonth(month), startOfMonth(today));
  const error = validateDay(draft);

  const from = isRange ? range?.from : single;
  const picked = from ? datesInRange(from, isRange ? range?.to : undefined) : [];
  const targets = openingTargets(picked, availability as OpeningWeeklyRow[], includeOpen);

  const blockedSet = useMemo(
    () => new Set(blockedDates.map((b) => b.blocked_date.slice(0, 10))),
    [blockedDates],
  );
  const blocked = blockedTargets(targets, blockedSet);
  const beyond = beyondWindowTargets(targets, today, windowDays);
  const staffOff = staffOffOnTargets(targets, activeStaff, hoursByStaff);

  const fmt = (key: string) => format(parseLocal(key), "d MMM", { locale: dateFnsLocale });
  const listDates = (keys: string[]) => {
    const shown = keys.slice(0, LIST_MAX).map(fmt);
    const rest = keys.length - shown.length;
    return joinList(lang, shown) + (rest > 0 ? ` +${rest}` : "");
  };

  const blockedParsed = [...blockedSet].map(parseLocal);
  const openingParsed = (dateOverrides as OverrideRow[])
    .filter((o) => o.is_available)
    .map((o) => parseLocal(o.override_date));

  const rangeCap = range?.from ? maxRangeEnd(range.from, windowDays) : null;
  const disabled = (d: Date) => d < today || (isRange && !!rangeCap && d > rangeCap);

  const write = async (replaceBlocks: boolean) => {
    try {
      await saveDateOpenings.mutateAsync({
        dates: targets,
        start: draft.start,
        end: draft.end,
        breakStart: draft.breakStart,
        breakEnd: draft.breakEnd,
        replaceBlocks,
      });
      toast.success(t("openingsSaved"));
      setConfirmBlocked(null);
      onDone();
    } catch (e) {
      toast.error(t(openingErrorKey(e)));
      setConfirmBlocked(null);
    }
  };

  const onSave = () => {
    if (error || targets.length === 0 || saveDateOpenings.isPending) return;
    if (blocked.length > 0) setConfirmBlocked(blocked);
    else void write(false);
  };

  const setMode = (r: boolean) => {
    setIsRange(r);
    setSingle(undefined);
    setRange(undefined);
  };

  const segBtn = (active: boolean) =>
    cn(
      "h-11 flex-1 rounded-xl text-sm font-semibold transition-colors",
      active ? "bg-card text-foreground shadow-sm ring-1 ring-border" : "text-foreground/60 hover:text-foreground",
    );

  return (
    <>
      <SheetHeader className="text-start">
        <SheetTitle>{t("openingsSheetTitle")}<BranchSuffix /></SheetTitle>
      </SheetHeader>

      <div className="mt-4 space-y-4">
        <div role="radiogroup" className="flex gap-1 rounded-2xl bg-foreground/[0.04] p-1">
          <button type="button" role="radio" aria-checked={!isRange} className={segBtn(!isRange)} onClick={() => setMode(false)}>
            {t("openingsSingle")}
          </button>
          <button type="button" role="radio" aria-checked={isRange} className={segBtn(isRange)} onClick={() => setMode(true)}>
            {t("openingsRange")}
          </button>
        </div>

        <div className="rounded-2xl ring-1 ring-foreground/10">
          {/* Own caption row: react-day-picker's nav buttons don't flip in RTL
              (same approach as the closed-days picker). */}
          <div className="flex items-center justify-between px-3 pt-3">
            <button
              type="button"
              aria-label={t("prevMonthAria")}
              disabled={!canGoPrev}
              onClick={() => setMonth(subMonths(month, 1))}
              className={NAV_BTN}
            >
              {isRtl ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
            </button>
            <span className="text-sm font-bold">{format(month, "MMMM yyyy", { locale: dateFnsLocale })}</span>
            <button
              type="button"
              aria-label={t("nextMonthAria")}
              onClick={() => setMonth(addMonths(month, 1))}
              className={NAV_BTN}
            >
              {isRtl ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </button>
          </div>

          {isRange ? (
            <Calendar
              mode="range"
              selected={range}
              onSelect={setRange}
              {...pickerProps(month, setMonth, isRtl, dateFnsLocale, disabled, blockedParsed, openingParsed)}
            />
          ) : (
            <Calendar
              mode="single"
              selected={single}
              onSelect={setSingle}
              {...pickerProps(month, setMonth, isRtl, dateFnsLocale, disabled, blockedParsed, openingParsed)}
            />
          )}

          <div className="flex min-h-11 items-center justify-between gap-2 border-t border-border px-3 py-2">
            <p className="text-xs font-medium text-foreground/70">
              {!from
                ? t("openingsPickDate")
                : isRange && !range?.to
                  ? t("openingsPickEnd").replace("{days}", String(Math.min(windowDays, 90)))
                  : t("openingsCount").replace("{n}", String(targets.length))}
            </p>
            {isRange && range?.from && (
              <button
                type="button"
                onClick={() => setRange(undefined)}
                className="min-h-11 shrink-0 rounded-xl px-2 text-sm font-semibold text-accent hover:bg-accent/10"
              >
                {t("changeDate")}
              </button>
            )}
          </div>
        </div>

        {isRange && (
          <label className="flex min-h-12 cursor-pointer items-start justify-between gap-3 rounded-2xl bg-foreground/[0.03] px-4 py-3">
            <span className="space-y-0.5">
              <span className="block text-sm font-semibold">{t("openingsIncludeOpen")}</span>
              <span className="block text-xs leading-relaxed text-foreground/70">{t("openingsIncludeOpenHint")}</span>
            </span>
            <SettingsSwitch checked={includeOpen} onCheckedChange={setIncludeOpen} aria-label={t("openingsIncludeOpen")} />
          </label>
        )}

        <DayHoursEditor value={draft} onChange={setDraft} error={error} closedHint="" showOpenSwitch={false} />

        {(picked.length > 1 && targets.length === 0) && (
          <Warning>{t("openingsNothing")}</Warning>
        )}
        {blocked.length > 0 && (
          <Warning>{t("openingsWarnBlocked").replace("{dates}", listDates(blocked))}</Warning>
        )}
        {beyond.length > 0 && (
          <Warning>
            {t("openingsWarnWindow").replace("{days}", String(windowDays)).replace("{dates}", listDates(beyond))}
          </Warning>
        )}
        {staffOff.length > 0 && (
          <Warning>{t("openingsWarnStaff").replace("{names}", joinList(lang, staffOff))}</Warning>
        )}

        <Button
          className="h-12 w-full rounded-2xl text-base font-semibold"
          onClick={onSave}
          disabled={!!error || targets.length === 0 || (isRange && !range?.to) || saveDateOpenings.isPending}
        >
          {t("save")}
        </Button>
      </div>

      <AlertDialog open={confirmBlocked !== null} onOpenChange={(o) => !o && !saveDateOpenings.isPending && setConfirmBlocked(null)}>
        <AlertDialogContent className="w-[calc(100%-2rem)] max-w-sm rounded-3xl">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("openingsReplaceTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("openingsReplaceBody").replace("{dates}", listDates(confirmBlocked ?? []))}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:space-x-0">
            <AlertDialogCancel type="button" className="mt-0 h-11 rounded-2xl" disabled={saveDateOpenings.isPending}>
              {t("cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              type="button"
              className="h-11 rounded-2xl"
              disabled={saveDateOpenings.isPending}
              onClick={(e) => {
                e.preventDefault();
                void write(true);
              }}
            >
              {t("openingsReplaceConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function Warning({ children }: { children: ReactNode }) {
  return (
    <p role="note" className="flex gap-2 rounded-2xl bg-amber-500/10 px-3 py-2.5 text-xs leading-relaxed text-foreground/80">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden />
      <span>{children}</span>
    </p>
  );
}

/** Props both picker modes share: month, direction, locale, disabled days, markers, styling. */
function pickerProps(
  month: Date,
  setMonth: (d: Date) => void,
  isRtl: boolean,
  locale: Locale,
  disabled: (d: Date) => boolean,
  blocked: Date[],
  openings: Date[],
) {
  return {
    month,
    onMonthChange: setMonth,
    dir: (isRtl ? "rtl" : "ltr") as "rtl" | "ltr",
    locale,
    weekStartsOn: 0 as const,
    disabled,
    modifiers: { blocked, opening: openings },
    modifiersClassNames: {
      blocked: "bg-destructive/10 text-destructive line-through",
      opening: "ring-1 ring-inset ring-emerald-500/60",
    },
    classNames: {
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
      // `!` pins the selected look over hover (see the closed-days picker).
      day_selected: "!bg-accent !text-accent-foreground font-bold hover:!bg-accent hover:!text-accent-foreground",
      day_range_middle: "!bg-accent/20 !text-foreground !font-medium",
      day_today: "ring-1 ring-inset ring-accent/50 font-bold",
      day_disabled: "text-muted-foreground/30 pointer-events-none hover:bg-transparent",
      day_outside: "text-muted-foreground/25",
      day_hidden: "invisible",
    },
    className: "pointer-events-auto p-3 pt-1",
  };
}
