import { useEffect, useRef, useState, type ReactNode } from "react";
import { format, addDays, startOfDay, parseISO } from "date-fns";
import { he, ar, enUS } from "date-fns/locale";
import { Clock, CalendarDays, CalendarX, User } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetTrigger,
} from "@/components/ui/sheet";
import { providerDesktopSheet } from "@/components/layout/providerDesktop";
import { Button } from "@/components/ui/button";
import { SectionLabel } from "@/components/ui/SectionLabel";
import { BookingMonthCalendar } from "@/components/booking/BookingMonthCalendar";
import { BackArrow } from "@/components/ui/directional-icon";
import { cn } from "@/lib/utils";
import { bookingDuration } from "@/lib/bookingDuration";
import { useLang } from "@/contexts/LangContext";
import { useProviderProfile } from "@/hooks/useProviderProfile";
import { useProviderServices } from "@/hooks/useProviderServices";
import { useRealAvailability } from "@/hooks/useAllProviders";
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
  const { getAvailableSlots, getGroupSlotsWithCapacity } = useRealAvailability(profile?.id);
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

  // Reset the wizard each time the sheet opens, seeded on today's month.
  useEffect(() => {
    if (!open) return;
    setDate(startToday);
    setCalMonth(startToday);
    setDateChosen(false);
    setTime("");
    setStep(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // A different day invalidates any previously picked time.
  useEffect(() => {
    setTime("");
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
                    selected={dateChosen ? date : undefined}
                    onSelectDay={(day) => {
                      setDate(day);
                      setTime("");
                      setDateChosen(true);
                      setStep(2);
                    }}
                  />
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
                  ) : !hasSlots ? (
                    <div className="rounded-2xl border border-dashed border-border p-8 text-center">
                      <CalendarX className="mx-auto mb-2 h-7 w-7 text-muted-foreground/40" />
                      <p className="text-sm text-muted-foreground">{t("walkInNoSlots")}</p>
                    </div>
                  ) : isGroup ? (
                    <div className="grid grid-cols-3 gap-2">
                      {groupSlots.map((slot) => (
                        <button
                          key={slot.time}
                          type="button"
                          disabled={slot.isFull}
                          onClick={() => !slot.isFull && setTime(slot.time)}
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
                          onClick={() => setTime(slot)}
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
  );
}
