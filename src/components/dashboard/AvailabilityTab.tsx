import { useState } from "react";
import { format, parseISO, startOfMonth, startOfToday, addMonths, subMonths, isAfter } from "date-fns";
import { he, ar, enUS } from "date-fns/locale";
import { CalendarOff, X, Coffee, ChevronLeft, ChevronRight } from "lucide-react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useLang } from "@/contexts/LangContext";
import { useProviderAvailability } from "@/hooks/useProviderAvailability";
import { useProviderProfile } from "@/hooks/useProviderProfile";
import { MonthlyAvailabilityCalendar } from "@/components/dashboard/MonthlyAvailabilityCalendar";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const DAY_KEYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;

export function AvailabilityTab() {
  const { t, isRtl, lang } = useLang();
  const { availability, blockedDates, upsertAvailability, blockDate, unblockDate } = useProviderAvailability();
  const { profile } = useProviderProfile();
  // Monthly mode swaps the weekly Working Hours card for the monthly calendar.
  // Weekly providers (the default) get the exact same tab as before.
  const isMonthly = profile?.availability_mode === "monthly";
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
  const blockedParsed = blockedDates.map(bd => parseISO(bd.blocked_date.slice(0, 10)));

  // Matches the nav buttons on the other two calendars, sized down for the popover.
  const navBtn =
    "inline-flex h-9 w-9 items-center justify-center rounded-xl bg-card text-foreground " +
    "shadow-sm ring-1 ring-border transition-all active:scale-95 " +
    "hover:bg-accent hover:text-accent-foreground disabled:opacity-30 disabled:pointer-events-none " +
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

  const getSlot = (dow: number) => availability.find(a => a.day_of_week === dow);

  // Management list only shows today + future blocked dates (past ones stay in
  // the DB — MonthlyAvailabilityCalendar reads the same blockedDates from
  // useProviderAvailability() and still needs past rows to render/edit the
  // currently-displayed month, so we filter here rather than in the hook).
  const todayStr = format(new Date(), "yyyy-MM-dd");
  const upcomingBlockedDates = blockedDates.filter(bd => bd.blocked_date.slice(0, 10) >= todayStr);

  const handleToggle = async (dow: number, checked: boolean) => {
    const existing = getSlot(dow);
    try {
      await upsertAvailability.mutateAsync({
        day_of_week: dow,
        start_time: existing?.start_time || "09:00",
        end_time: existing?.end_time || "17:00",
        is_available: checked,
        break_start: existing?.break_start ?? null,
        break_end: existing?.break_end ?? null,
      });
      toast.success(t("availabilitySaved"));
    } catch (err: any) {
      toast.error(err?.message || "Error saving availability");
    }
  };

  const handleTimeChange = async (dow: number, field: "start_time" | "end_time", value: string) => {
    const existing = getSlot(dow);
    try {
      await upsertAvailability.mutateAsync({
        day_of_week: dow,
        start_time: field === "start_time" ? value : (existing?.start_time || "09:00"),
        end_time: field === "end_time" ? value : (existing?.end_time || "17:00"),
        is_available: existing?.is_available ?? true,
        break_start: existing?.break_start ?? null,
        break_end: existing?.break_end ?? null,
      });
      toast.success(t("availabilitySaved"));
    } catch (err: any) {
      toast.error(err?.message || "Error saving availability");
    }
  };

  const handleBreakToggle = async (dow: number, enabled: boolean) => {
    const existing = getSlot(dow);
    try {
      await upsertAvailability.mutateAsync({
        day_of_week: dow,
        start_time: existing?.start_time || "09:00",
        end_time: existing?.end_time || "17:00",
        is_available: existing?.is_available ?? true,
        break_start: enabled ? "13:00" : null,
        break_end: enabled ? "14:00" : null,
      });
      toast.success(t("availabilitySaved"));
    } catch (err: any) {
      toast.error(err?.message || "Error saving availability");
    }
  };

  const handleBreakTimeChange = async (dow: number, field: "break_start" | "break_end", value: string) => {
    const existing = getSlot(dow);
    try {
      await upsertAvailability.mutateAsync({
        day_of_week: dow,
        start_time: existing?.start_time || "09:00",
        end_time: existing?.end_time || "17:00",
        is_available: existing?.is_available ?? true,
        break_start: field === "break_start" ? value : (existing?.break_start ?? null),
        break_end: field === "break_end" ? value : (existing?.break_end ?? null),
      });
      toast.success(t("availabilitySaved"));
    } catch (err: any) {
      toast.error(err?.message || "Error saving availability");
    }
  };

  const handleBlockDate = async () => {
    if (!blockingDate) return;
    try {
      await blockDate.mutateAsync({ blocked_date: format(blockingDate, "yyyy-MM-dd"), reason: blockReason });
      toast.success(t("dateBlocked"));
      setBlockingDate(undefined);
      setBlockReason("");
    } catch (err: any) {
      toast.error(err?.message || "Error blocking date");
    }
  };

  return (
    <div className="space-y-5">
      <h2 className="text-lg font-semibold">{t("availability")}</h2>

      {/* Monthly mode: calendar editor replaces the weekly Working Hours card. */}
      {isMonthly && <MonthlyAvailabilityCalendar />}

      {/* Weekly schedule — weekly mode only (unchanged for weekly providers) */}
      {!isMonthly && (
      <div className="rounded-2xl border border-border bg-card p-4 space-y-4">
        <h3 className="text-sm font-medium">{t("workingHoursLabel")}</h3>
        {DAY_KEYS.map((dayKey, dow) => {
          const slot = getSlot(dow);
          const isAvail = slot?.is_available ?? false;
          const hasBreak = !!(slot?.break_start && slot?.break_end);

          return (
            <motion.div
              key={dayKey}
              initial={{ opacity: 0, x: 8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: dow * 0.04 }}
              className="space-y-2"
            >
              {/* Working hours row */}
              <div className="flex items-center gap-3">
                <Switch checked={isAvail} onCheckedChange={c => handleToggle(dow, c)} />
                <span className="text-sm font-medium w-16">{t(dayKey)}</span>
                {isAvail ? (
                  <div className="flex items-center gap-1.5 flex-1">
                    <Input
                      key={`${dow}-start-${slot?.start_time ?? "09:00"}`}
                      type="time"
                      className="h-8 text-xs flex-1"
                      defaultValue={slot?.start_time?.slice(0, 5) || "09:00"}
                      onBlur={e => handleTimeChange(dow, "start_time", e.target.value)}
                    />
                    <span className="text-xs text-muted-foreground">–</span>
                    <Input
                      key={`${dow}-end-${slot?.end_time ?? "17:00"}`}
                      type="time"
                      className="h-8 text-xs flex-1"
                      defaultValue={slot?.end_time?.slice(0, 5) || "17:00"}
                      onBlur={e => handleTimeChange(dow, "end_time", e.target.value)}
                    />
                  </div>
                ) : (
                  <span className="text-xs text-muted-foreground">{t("unavailable")}</span>
                )}
              </div>

              {/* Break time row — only shown when day is active */}
              {isAvail && (
                <div className="flex items-start gap-3 ps-[calc(2.25rem+4rem+0.75rem)]">
                  <div className="flex flex-col gap-2 flex-1">
                    <div className="flex items-center gap-2">
                      <Coffee className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <span className="text-xs text-muted-foreground">{t("breakTime")}</span>
                      <Switch
                        checked={hasBreak}
                        onCheckedChange={c => handleBreakToggle(dow, c)}
                        className="scale-75 origin-left"
                      />
                      {hasBreak && (
                        <span className="text-xs text-muted-foreground ms-1">
                          {slot?.break_start?.slice(0, 5)} — {slot?.break_end?.slice(0, 5)}
                        </span>
                      )}
                    </div>
                    {hasBreak && (
                      <div className="flex items-center gap-1.5">
                        <Input
                          key={`${dow}-break-start-${slot?.break_start}`}
                          type="time"
                          className="h-7 text-xs flex-1"
                          defaultValue={slot?.break_start?.slice(0, 5) || "13:00"}
                          onBlur={e => handleBreakTimeChange(dow, "break_start", e.target.value)}
                        />
                        <span className="text-xs text-muted-foreground">–</span>
                        <Input
                          key={`${dow}-break-end-${slot?.break_end}`}
                          type="time"
                          className="h-7 text-xs flex-1"
                          defaultValue={slot?.break_end?.slice(0, 5) || "14:00"}
                          onBlur={e => handleBreakTimeChange(dow, "break_end", e.target.value)}
                        />
                      </div>
                    )}
                  </div>
                </div>
              )}
            </motion.div>
          );
        })}
      </div>
      )}

      {/* Blocked dates */}
      <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
        <h3 className="text-sm font-medium">{t("blockedDates")}</h3>

        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="gap-1.5">
              <CalendarOff className="h-3.5 w-3.5" />
              {t("blockDate")}
            </Button>
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
                  onChange={e => setBlockReason(e.target.value)}
                  className="h-9 rounded-xl text-sm"
                />
                <Button size="sm" className="w-full rounded-xl font-semibold" onClick={handleBlockDate}>
                  {t("save")}
                </Button>
              </div>
            )}
          </PopoverContent>
        </Popover>

        {upcomingBlockedDates.length > 0 && (
          <div className="space-y-1.5">
            {upcomingBlockedDates.map(bd => (
              <div key={bd.id} className="flex items-center justify-between rounded-lg bg-secondary px-3 py-2 text-sm">
                <div>
                  <span className="font-medium">{format(new Date(bd.blocked_date), "MMM d, yyyy")}</span>
                  {bd.reason && <span className="text-muted-foreground ms-2">– {bd.reason}</span>}
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-6 w-6"
                  onClick={async () => {
                    await unblockDate.mutateAsync(bd.id);
                    toast.success(t("dateUnblocked"));
                  }}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
