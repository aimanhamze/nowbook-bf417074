import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  format,
  addDays,
  startOfDay,
  parseISO,
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
} from "date-fns";
import { he, ar, enUS } from "date-fns/locale";
import { Clock, CalendarDays, CalendarX, Info, MoonStar, Pencil, User } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { providerDesktopSheet } from "@/components/layout/providerDesktop";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SectionLabel } from "@/components/ui/SectionLabel";
import { BookingMonthCalendar } from "@/components/booking/BookingMonthCalendar";
import { BackArrow } from "@/components/ui/directional-icon";
import { cn } from "@/lib/utils";
import { bookingDuration } from "@/lib/bookingDuration";
import { useLang } from "@/contexts/LangContext";
import { useProviderProfile } from "@/hooks/useProviderProfile";
import { useProviderServices } from "@/hooks/useProviderServices";
import { useRealAvailability } from "@/hooks/useAllProviders";
import { useResolvedDayWindow } from "@/hooks/useResolvedDayWindow";
import { classifyDay, isOutsideDayWindow } from "@/lib/availabilityResolver";
import { normalizeBookingTime } from "@/lib/bookingTime";
import { useRescheduleBooking, type EnrichedBooking } from "@/hooks/useProviderBookings";
import { toast } from "sonner";

// Same expressive easing the customer + walk-in flows use for their step slides.
const SPRING = { duration: 0.5, ease: [0.16, 1, 0.3, 1] } as const;

/**
 * Provider-side "reschedule" flow: move an existing booking to a different
 * date + time. Reuses the EXACT slot pipeline of the customer/walk-in flows
 * (useRealAvailability → BookingMonthCalendar + getAvailableSlots), so the
 * offered slots always respect the provider's schedule, breaks, blocked dates,
 * slot interval and existing bookings — and never a past date/time.
 *
 * The booking's service(s) are fixed (only the timing changes), so there is no
 * service or customer step — just a 2-step calendar → time wizard.
 */
export function RescheduleSheet({ booking, trigger }: { booking: EnrichedBooking; trigger: ReactNode }) {
  const { lang, t } = useLang();
  const { profile } = useProviderProfile();
  const { services } = useProviderServices();
  // The booking's staff member, so the offered slots are THEIR hours and days
  // off, and only their lane's bookings (plus unassigned ones) block. Without it
  // reschedule used the whole-shop view: it offered days the member is off and
  // hid slots another member's bookings occupy. null (non-staff provider, or an
  // unassigned booking) → no narrowing, identical to before.
  const {
    getAvailableSlots,
    getGroupSlotsWithCapacity,
    isLoading: slotHoursLoading,
  } = useRealAvailability(profile?.id, booking.staff_id);
  const reschedule = useRescheduleBooking();

  const dateFnsLocale = lang === "he" ? he : lang === "ar" ? ar : enUS;

  const [open, setOpen] = useState(false);
  // 2 steps: month calendar → time. Same calendar + time-step pattern as the
  // customer BookAppointment / walk-in flows.
  const [step, setStep] = useState<1 | 2>(1);
  const [date, setDate] = useState<Date>(startOfDay(new Date()));
  const [time, setTime] = useState("");
  const [calMonth, setCalMonth] = useState<Date>(() => startOfDay(new Date()));
  const [dateChosen, setDateChosen] = useState(false);
  // Manual time entry on the time step. `manualTime` holds the RAW input value;
  // `time` only ever receives the normalised "HH:MM" form.
  const [manualOpen, setManualOpen] = useState(false);
  const [manualTime, setManualTime] = useState("");

  const startToday = startOfDay(new Date());
  const windowEnd = addDays(startToday, (profile?.booking_window_days ?? 14) - 1);

  // The booking's service(s) are fixed. Resolve the primary service (for
  // type/capacity) and the TOTAL duration across all booked services — same math
  // the slot pipeline uses when computing overlaps.
  const primaryService = services.find((s) => s.id === booking.service_ids?.[0]);
  const isGroup = primaryService?.service_type === "group";
  // A booking that was given a custom length keeps that length when it moves —
  // rescheduling changes WHEN it happens, never how long it runs.
  const duration = bookingDuration(booking, services);
  const capacity = primaryService?.max_capacity ?? 1;

  // Resolved hours for the OVERRIDE path — same hook, same reasoning as the
  // walk-in sheet: the slot pipeline says THAT a day has no slots, only the
  // shop and staff-narrowed windows together say WHY. Group services are
  // staff-blind in the pipeline (capacity is pooled shop-wide), so they are
  // classified staff-blind here too, or a group day could read "{name} isn't
  // working" while its slots ignore that member entirely.
  const {
    resolveShopWindow,
    resolveWindow,
    staffHasOwnHours,
    isLoading: staffHoursLoading,
  } = useResolvedDayWindow(isGroup ? undefined : (booking.staff_id ?? undefined));

  // Day awaiting the override confirmation. Nothing else moves until confirmed.
  const [pendingOffDay, setPendingOffDay] = useState<Date | null>(null);

  // Reset the wizard each time the sheet opens, seeded on today's month.
  useEffect(() => {
    if (!open) return;
    setDate(startToday);
    setCalMonth(startToday);
    setDateChosen(false);
    setTime("");
    setManualOpen(false);
    setManualTime("");
    setStep(1);
    setPendingOffDay(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // A different day invalidates any previously picked time — typed or tapped.
  // manualOpen is deliberately NOT reset here: commitDaySelection sets it in the
  // same batch as `date`, and this effect runs after that render, so resetting
  // it here would immediately undo the auto-open on an override day.
  useEffect(() => {
    setTime("");
    setManualTime("");
  }, [date]);

  // The step body is its own scroll container — reset it so every step opens at
  // the top instead of inheriting the previous step's scroll position.
  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0 });
  }, [step]);

  const privateSlots =
    primaryService && !isGroup
      ? getAvailableSlots(date, duration, capacity, primaryService.id)
      : [];
  const groupSlots = primaryService && isGroup ? getGroupSlotsWithCapacity(date, capacity) : [];
  const hasSlots = isGroup ? groupSlots.length > 0 : privateSlots.length > 0;

  // A calendar day is tappable iff the EXISTING slot pipeline yields a selectable
  // slot for it — presentation only, so the calendar never disagrees with the
  // time step. Past days fall outside [startToday, windowEnd] and are disabled by
  // the calendar itself.
  const dayHasAvailability = (d: Date): boolean => {
    if (!primaryService) return false;
    if (isGroup) {
      return getGroupSlotsWithCapacity(d, capacity).some((s) => !s.isFull);
    }
    return getAvailableSlots(d, duration, capacity, primaryService.id).length > 0;
  };

  // ── Out-of-hours override (provider-side only) ─────────────────────────────
  // A day the provider may OVERRIDE: inside the SAME [today, booking window]
  // range the calendar enforces, but with nothing bookable — shop closed or
  // blocked, the booking's staff member off, or fully booked. The range is
  // asserted here too so an override can never reach a past day.
  //
  // Held off while hours are still loading: getAvailableSlots fails CLOSED for
  // an in-flight member (and reads an unloaded week as closed), so without this
  // every day would flash dashed on open and then un-dash a moment later.
  const overrideReady = !slotHoursLoading && !staffHoursLoading;
  const dayIsOverridable = (d: Date): boolean => {
    if (!primaryService || !overrideReady) return false;
    const day = startOfDay(d);
    if (day < startToday || day > windowEnd) return false;
    return !dayHasAvailability(d);
  };

  // Why a day has no slots. Both windows plus the grid's own verdict, so the
  // copy can never disagree with the slots it describes.
  const chosenDayStatus = classifyDay(resolveShopWindow(date), resolveWindow(date), hasSlots);
  // Asked of the PENDING day, not `date` — `date` has not moved yet.
  const pendingOffDayStatus = pendingOffDay
    ? classifyDay(
        resolveShopWindow(pendingOffDay),
        resolveWindow(pendingOffDay),
        dayHasAvailability(pendingOffDay),
      )
    : null;

  // Does the displayed month contain a dashed day? Drives the legend, so the
  // dashed cells are explained before one is tapped.
  const monthHasOverridableDay = (() => {
    if (!primaryService || !overrideReady) return false;
    const from = startOfMonth(calMonth) < startToday ? startToday : startOfMonth(calMonth);
    const to = endOfMonth(calMonth) > windowEnd ? windowEnd : endOfMonth(calMonth);
    if (from > to) return false;
    return eachDayOfInterval({ start: from, end: to }).some(dayIsOverridable);
  })();

  const staffName = booking.staff_name ?? "";

  // Everything that happens once a day is ACCEPTED — the normal path and the
  // confirmed-override path run this same code; the dialog is only a gate.
  const commitDaySelection = (day: Date) => {
    setDate(day);
    setTime("");
    setManualTime("");
    // A day with nothing bookable can only be served by manual entry, so open it
    // straight away rather than landing on an empty grid with the way forward
    // hidden behind a pill. Normal days keep the grid-first flow.
    setManualOpen(dayIsOverridable(day));
    setDateChosen(true);
    setStep(2);
  };

  // Advisory flag for a manual time outside the day's hours — the member's
  // hours when the booking has one with their own, else the shop's. Same
  // derived test the provider calendar badges bookings with.
  const manualIsOutOfHours =
    !!time && manualOpen && isOutsideDayWindow(resolveWindow(date), time);

  // On an override day the slot area renders nothing (the provider already saw
  // the dashed cell, the legend and the dialog), so the manual block drops its
  // divider rather than hanging a rule under empty space.
  const selectedDayOverridable = dateChosen && dayIsOverridable(date);
  const slotAreaEmpty = !!primaryService && !hasSlots && selectedDayOverridable;

  const currentDate = parseISO(booking.booking_date);

  const handleConfirm = () => {
    if (!time || reschedule.isPending) return;
    reschedule.mutate(
      { bookingId: booking.id, newDate: format(date, "yyyy-MM-dd"), newTime: time },
      {
        onSuccess: () => {
          toast.success(t("rescheduleSuccess"));
          setOpen(false);
        },
        onError: (err: unknown) => {
          // prevent_booking_conflicts raises 23505 / "no longer available" for a
          // taken private slot and 'GROUP_CAPACITY_EXCEEDED' for a full group
          // slot — both mean the chosen time is gone.
          const msg = err instanceof Error ? err.message : "";
          const code = (err as { code?: string })?.code;
          const slotTaken =
            code === "23505" || /GROUP_CAPACITY_EXCEEDED|no longer available/i.test(msg);
          toast.error(slotTaken ? t("walkInSlotTaken") : t("walkInFailed"));
        },
      },
    );
  };

  return (
    <>
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>{trigger}</SheetTrigger>

      <SheetContent
        side="bottom"
        className={`flex max-h-[92vh] flex-col gap-0 rounded-t-3xl border-t p-0 ${providerDesktopSheet}`}
      >
        {/* Grab handle — bottom-sheet affordance */}
        <div className="mx-auto mt-3 h-1.5 w-10 shrink-0 rounded-full bg-muted-foreground/20" />

        {/* ── Header + current-appointment summary (fixed) ── */}
        <div className="shrink-0 px-5 pt-3">
          <SheetHeader className="text-start">
            <SheetTitle className="text-lg">{t("rescheduleTitle")}</SheetTitle>
            <SheetDescription className="text-xs">{t("currentAppointment")}</SheetDescription>
          </SheetHeader>

          {/* Current booking info */}
          <div className="mt-3 space-y-1.5 rounded-2xl border border-border bg-muted/40 p-3.5">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <User className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="truncate">
                {booking.customer_name || booking.customer_phone || t("currentAppointment")}
              </span>
            </div>
            {booking.service_names.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {booking.service_names.map((name, i) => (
                  <span
                    key={i}
                    className="rounded-full bg-secondary px-2 py-0.5 text-[11px] text-secondary-foreground"
                  >
                    {name}
                  </span>
                ))}
              </div>
            )}
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <CalendarDays className="h-3.5 w-3.5" />
                {format(currentDate, "EEE, d MMM yyyy", { locale: dateFnsLocale })}
              </span>
              <span className="flex items-center gap-1 tabular-nums" dir="ltr">
                <Clock className="h-3.5 w-3.5" />
                {booking.booking_time}
              </span>
            </div>
          </div>

          {/* Step indicator */}
          <div className="mt-4 mb-1">
            <div className="mb-2 flex gap-1.5">
              {[1, 2].map((s) => (
                <div
                  key={s}
                  className={cn(
                    "h-1.5 flex-1 rounded-full transition-colors duration-300",
                    s <= step ? "bg-accent" : "bg-border",
                  )}
                />
              ))}
            </div>
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-accent">
                {step === 1 ? t("selectDate") : t("availableTimes")}
              </p>
              <p className="text-[11px] font-medium text-muted-foreground tabular-nums">{step} / 2</p>
            </div>
          </div>
        </div>

        {/* ── Scrollable step body ── */}
        <div ref={bodyRef} className="flex-1 overflow-y-auto overflow-x-hidden px-5 pb-5 pt-4">
          <AnimatePresence mode="wait">
            {/* ── STEP 1: Month calendar ── */}
            {step === 1 && (
              <motion.div
                key="step1"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={SPRING}
              >
                <SectionLabel className="mb-3">
                  <CalendarDays className="h-3.5 w-3.5" />
                  {t("newAppointment")}
                </SectionLabel>
                <div className="rounded-2xl border border-border bg-secondary/40 p-3">
                  <BookingMonthCalendar
                    month={calMonth}
                    onMonthChange={setCalMonth}
                    fromDate={startToday}
                    toDate={windowEnd}
                    dayHasAvailability={dayHasAvailability}
                    dayIsOverridable={dayIsOverridable}
                    selected={dateChosen ? date : undefined}
                    onSelectDay={(day) => {
                      // An override day is confirmed first. NOTHING is mutated
                      // here — not date, dateChosen or step — until it is.
                      if (dayIsOverridable(day)) {
                        setPendingOffDay(day);
                        return;
                      }
                      commitDaySelection(day);
                    }}
                  />

                  {/* Legend for the dashed cells. Names the staff reason only
                      when the member has hours of their own — otherwise it
                      cannot be why a day is dashed. */}
                  {monthHasOverridableDay && (
                    <div className="mt-3 flex items-start gap-2 rounded-xl border border-dashed border-muted-foreground/40 bg-muted/40 p-3">
                      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <p className="text-[11px] leading-relaxed text-muted-foreground">
                        {staffHasOwnHours && staffName
                          ? t("rescheduleOverrideLegendStaff").replace("{name}", staffName)
                          : t("rescheduleOverrideLegend")}
                      </p>
                    </div>
                  )}
                </div>
              </motion.div>
            )}

            {/* ── STEP 2: Time for the chosen day ── */}
            {step === 2 && (
              <motion.div
                key="step2"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={SPRING}
              >
                {/* Chosen-day summary + back-to-calendar affordance */}
                <div className="mb-5 flex items-center justify-between gap-3 rounded-2xl border border-border bg-card p-3.5 shadow-sm">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-xl bg-accent font-bold text-accent-foreground">
                      <span className="text-base leading-none tabular-nums">{format(date, "d")}</span>
                      <span className="text-[10px]">{format(date, "MMM", { locale: dateFnsLocale })}</span>
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold">{format(date, "EEEE", { locale: dateFnsLocale })}</p>
                      <p className="text-xs text-muted-foreground">{format(date, "d MMMM yyyy", { locale: dateFnsLocale })}</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setStep(1)}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-accent/10 px-3 py-2 text-xs font-semibold text-accent transition-transform active:scale-95"
                  >
                    <CalendarDays className="h-3.5 w-3.5" />
                    {t("changeDate")}
                  </button>
                </div>

                {/* Time grid — unchanged slot computation */}
                <div>
                  <SectionLabel className="mb-3">
                    <Clock className="h-3.5 w-3.5" />
                    {t("availableTimes")}
                  </SectionLabel>
                  {!primaryService ? (
                    <p className="text-sm text-muted-foreground">{t("walkInNoSlots")}</p>
                  ) : !hasSlots && selectedDayOverridable ? null : !hasSlots ? (
                    // Zero slots on a day reached WITHOUT the override context
                    // (e.g. availability changed under the provider) still gets
                    // the card — there, "no times" is news.
                    <div className="rounded-2xl border border-dashed border-border p-8 text-center">
                      <CalendarX className="mx-auto mb-2 h-7 w-7 text-muted-foreground/40" />
                      {/* "No times" is not one fact — say which one it is. */}
                      <p className="text-sm text-muted-foreground">
                        {chosenDayStatus === "staffOff" && staffName
                          ? t("rescheduleStaffOffDay").replace("{name}", staffName)
                          : chosenDayStatus === "closed" || chosenDayStatus === "staffOff"
                            ? t("rescheduleClosedDay")
                            : t("walkInNoSlots")}
                      </p>
                    </div>
                  ) : isGroup ? (
                    <div className="grid grid-cols-3 gap-2">
                      {groupSlots.map((slot) => (
                        <button
                          key={slot.time}
                          type="button"
                          disabled={slot.isFull}
                          onClick={() => {
                            if (slot.isFull) return;
                            // Grid and manual entry are one selection.
                            setManualTime("");
                            setTime(slot.time);
                          }}
                          className={cn(
                            "flex flex-col items-center gap-0.5 rounded-xl border py-2.5 px-1 text-sm font-semibold transition-all active:scale-95",
                            time === slot.time
                              ? "border-transparent bg-accent text-accent-foreground shadow-[0_4px_12px_-4px_hsl(var(--accent)/0.45)]"
                              : slot.isFull
                              ? "cursor-not-allowed border-transparent bg-muted text-muted-foreground opacity-60"
                              : "border-border bg-card text-foreground hover:border-accent/40",
                          )}
                        >
                          <span className="tabular-nums">{slot.time}</span>
                          <span className="text-[9px] leading-none opacity-80">
                            {slot.isFull ? t("spotsFull") : `${slot.spotsLeft} ${t("spotsLeft")}`}
                          </span>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="grid grid-cols-3 gap-2">
                      {privateSlots.map((slot) => (
                        <button
                          key={slot}
                          type="button"
                          onClick={() => {
                            setManualTime("");
                            setTime(slot);
                          }}
                          className={cn(
                            "rounded-xl border py-3 text-sm font-semibold tabular-nums transition-all active:scale-95",
                            time === slot
                              ? "border-transparent bg-accent text-accent-foreground shadow-[0_4px_12px_-4px_hsl(var(--accent)/0.45)]"
                              : "border-border bg-card text-foreground hover:border-accent/40",
                          )}
                        >
                          {slot}
                        </button>
                      ))}
                    </div>
                  )}

                  {/* ── Manual time ──
                      A SIBLING of the slot chain above, never inside a branch:
                      the zero-slot case is exactly where this is the only way
                      forward. Overrides HOURS only — an overlapping time is
                      still rejected by prevent_booking_conflicts and surfaces
                      through handleConfirm's slot-taken toast. */}
                  {!!primaryService && (
                    <div className={cn("mt-4", !slotAreaEmpty && "border-t border-border/60 pt-4")}>
                      {!manualOpen ? (
                        <button
                          type="button"
                          onClick={() => setManualOpen(true)}
                          className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-secondary px-3.5 py-2 text-start text-xs font-semibold text-foreground transition-transform active:scale-95 hover:bg-secondary/80"
                        >
                          <Pencil className="h-3.5 w-3.5 shrink-0" />
                          {t("rescheduleOtherTime")}
                        </button>
                      ) : (
                        <div className="space-y-2">
                          <Label htmlFor="reschedule-manual-time" className="text-xs">
                            {t("rescheduleManualTimeLabel")}
                          </Label>
                          <Input
                            id="reschedule-manual-time"
                            type="time"
                            dir="ltr"
                            step={60}
                            value={manualTime}
                            onChange={(e) => {
                              const raw = e.target.value;
                              setManualTime(raw);
                              // Always normalised before reaching `time`; a
                              // partial entry clears the selection instead of
                              // leaking an unpadded value (see lib/bookingTime).
                              setTime(normalizeBookingTime(raw) ?? "");
                            }}
                            className="h-12 w-full tabular-nums"
                          />
                          <p className="text-[11px] leading-relaxed text-muted-foreground">
                            {t("rescheduleManualTimeHint")}
                          </p>
                          {manualIsOutOfHours && (
                            <p className="flex items-center gap-1.5 text-[11px] font-medium text-amber-600">
                              <MoonStar className="h-3.5 w-3.5 shrink-0" />
                              {t("rescheduleManualOutOfHours")}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* ── Sticky footer: Back / Confirm ── */}
        <div className="shrink-0 border-t border-border bg-background/95 px-5 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] backdrop-blur-sm">
          <div className="flex items-center gap-3">
            {step > 1 && (
              <Button
                type="button"
                variant="outline"
                onClick={() => setStep(1)}
                className="h-12 shrink-0 gap-1.5 px-4"
              >
                <BackArrow variant="arrow" className="h-4 w-4" />
                {t("back")}
              </Button>
            )}
            <motion.div whileTap={time && !reschedule.isPending ? { scale: 0.98 } : undefined} className="flex-1">
              <Button
                className="h-12 w-full text-base font-semibold"
                disabled={!time || reschedule.isPending || step !== 2}
                onClick={handleConfirm}
              >
                {reschedule.isPending ? (
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-accent-foreground/30 border-t-accent-foreground" />
                ) : (
                  t("confirmReschedule")
                )}
              </Button>
            </motion.div>
          </div>
        </div>
      </SheetContent>
    </Sheet>

    {/* ── Override confirmation ──
        Sibling of the Sheet, portalled above it (same placement as the walk-in
        sheet's). Cancel — button, backdrop or Esc — only clears pendingOffDay.
        Confirming overrides HOURS only: prevent_booking_conflicts still rejects
        an overlap with another appointment. */}
    <AlertDialog
      open={!!pendingOffDay}
      onOpenChange={(isOpen) => { if (!isOpen) setPendingOffDay(null); }}
    >
      <AlertDialogContent>
        {/* text-start / gap instead of the primitive's sm:text-left and
            sm:space-x-2, which are physical and break under RTL. */}
        <AlertDialogHeader className="sm:text-start">
          <AlertDialogTitle>{t("rescheduleOffDayConfirmTitle")}</AlertDialogTitle>
          <AlertDialogDescription>
            {/* A staff-off day whose member has no resolvable name (e.g. since
                removed) reads as closed — never as "fully booked". */}
            {pendingOffDayStatus === "staffOff" && staffName
              ? t("rescheduleOffDayConfirmStaffOff").replace("{name}", staffName)
              : pendingOffDayStatus === "closed" || pendingOffDayStatus === "staffOff"
                ? t("rescheduleOffDayConfirmClosed")
                : t("rescheduleOffDayConfirmFull")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {pendingOffDay && (
          <p className="text-sm font-semibold text-foreground">
            {format(pendingOffDay, "EEEE, d MMMM yyyy", { locale: dateFnsLocale })}
          </p>
        )}
        <AlertDialogFooter className="sm:gap-2 sm:space-x-0">
          <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              if (pendingOffDay) commitDaySelection(pendingOffDay);
              setPendingOffDay(null);
            }}
          >
            {t("rescheduleOffDayConfirmAction")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}
