import { useEffect, useState, type ReactNode } from "react";
import { format, addDays, startOfDay, parseISO } from "date-fns";
import { he, ar, enUS } from "date-fns/locale";
import { Clock, CalendarDays, CalendarX } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { SectionLabel } from "@/components/ui/SectionLabel";
import { BookingMonthCalendar } from "@/components/booking/BookingMonthCalendar";
import { BackArrow } from "@/components/ui/directional-icon";
import { cn } from "@/lib/utils";
import { bookingDuration } from "@/lib/bookingDuration";
import { useLang } from "@/contexts/LangContext";
import { useRealAvailability } from "@/hooks/useAllProviders";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import type { Provider } from "@/lib/mock-data";
import { toast } from "sonner";

const SPRING = { duration: 0.5, ease: [0.16, 1, 0.3, 1] } as const;

/**
 * CUSTOMER-side reschedule: move one of my own confirmed bookings to another
 * slot, when the provider allows it (provider_profiles.allow_customer_reschedule).
 *
 * Deliberately NOT the provider's RescheduleSheet. That one reads the signed-in
 * provider's own profile/services/hours (empty for a customer) and carries
 * provider-only powers -- overriding closed days and typing an arbitrary time.
 * Here the customer can only pick from the same slot pipeline the booking page
 * uses (useRealAvailability with the booking's provider and staff member), so
 * hours, breaks, blocked dates, staff time off and existing bookings all apply.
 *
 * The database is the guarantee, not this sheet: trg_enforce_customer_reschedule
 * (20261003000001) re-checks the toggle, the cancellation cutoff, the booking
 * window and blocked dates, and sends the booking back to 'pending' when the
 * provider requires approval. Overlaps stay with prevent_booking_conflicts.
 */
export function CustomerRescheduleSheet({
  booking,
  provider,
  trigger,
}: {
  booking: Tables<"bookings">;
  provider: Provider;
  trigger: ReactNode;
}) {
  const { lang, t } = useLang();
  const queryClient = useQueryClient();
  const { getAvailableSlots, getGroupSlotsWithCapacity } = useRealAvailability(
    provider.id,
    booking.staff_id,
  );

  const dateFnsLocale = lang === "he" ? he : lang === "ar" ? ar : enUS;

  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<1 | 2>(1);
  const [date, setDate] = useState<Date>(startOfDay(new Date()));
  const [time, setTime] = useState("");
  const [calMonth, setCalMonth] = useState<Date>(() => startOfDay(new Date()));
  const [dateChosen, setDateChosen] = useState(false);

  const startToday = startOfDay(new Date());
  const windowEnd = addDays(startToday, (provider.bookingWindowDays ?? 14) - 1);

  // Services are fixed -- only the timing moves. A custom length (set by the
  // provider) travels with the booking, same as the provider's reschedule.
  const primaryService = provider.services.find((s) => s.id === booking.service_ids?.[0]);
  const isGroup = primaryService?.service_type === "group";
  const duration = bookingDuration(booking, provider.services);
  const capacity = primaryService?.max_capacity ?? 1;

  useEffect(() => {
    if (!open) return;
    setDate(startToday);
    setCalMonth(startToday);
    setDateChosen(false);
    setTime("");
    setStep(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    setTime("");
  }, [date]);

  const privateSlots =
    primaryService && !isGroup
      ? getAvailableSlots(date, duration, capacity, primaryService.id, primaryService.latest_start_time)
      : [];
  const groupSlots = primaryService && isGroup ? getGroupSlotsWithCapacity(date, capacity) : [];
  const hasSlots = isGroup ? groupSlots.some((s) => !s.isFull) : privateSlots.length > 0;

  const dayHasAvailability = (d: Date): boolean => {
    if (!primaryService) return false;
    if (isGroup) return getGroupSlotsWithCapacity(d, capacity).some((s) => !s.isFull);
    return (
      getAvailableSlots(d, duration, capacity, primaryService.id, primaryService.latest_start_time)
        .length > 0
    );
  };

  const reschedule = useMutation({
    mutationFn: async ({ newDate, newTime }: { newDate: string; newTime: string }) => {
      // The trigger may flip status to 'pending' (provider requires approval),
      // so read it back rather than assume.
      const { data, error } = await supabase
        .from("bookings")
        .update({ booking_date: newDate, booking_time: newTime })
        .eq("id", booking.id)
        .select("status")
        .single();
      if (error) throw error;
      const pending = data?.status === "pending";

      // Bell rows only -- no WhatsApp/push for reschedule yet. Best-effort: the
      // move is already committed, so a failed notification never fails it.
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          await supabase.from("notifications").insert({
            user_id: user.id,
            title: pending ? "התור שונה וממתין לאישור ⏳" : "התור שונה בהצלחה 📅",
            body: `התור החדש: ${newDate} בשעה ${newTime}`,
            url: "/bookings",
            type: pending ? "booking_pending" : "booking_confirmed",
          });
        }
        const { data: providerProfile } = await supabase
          .from("provider_profiles")
          .select("user_id")
          .eq("id", booking.provider_id)
          .single();
        if (providerProfile?.user_id) {
          await supabase.from("notifications").insert({
            user_id: providerProfile.user_id,
            title: "תור שונה על ידי לקוח 📅",
            body: `לקוח שינה את מועד התור ל-${newDate} ${newTime}`,
            url: "/calendar",
            type: "booking_rescheduled",
          });
        }
      } catch (err) {
        console.warn("reschedule notifications failed:", err);
      }

      return { pending };
    },
    onSuccess: ({ pending }) => {
      queryClient.invalidateQueries({ queryKey: ["bookings"] });
      queryClient.invalidateQueries({ queryKey: ["provider-bookings-public"] });
      queryClient.invalidateQueries({ queryKey: ["unread-notifications"] });
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      toast.success(pending ? t("rescheduleSuccessPending") : t("rescheduleSuccess"));
      setOpen(false);
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : (err as { message?: string })?.message ?? "";
      const code = (err as { code?: string })?.code;
      if (code === "23505" || /GROUP_CAPACITY_EXCEEDED|no longer available|DUPLICATE_USER_BOOKING/i.test(msg)) {
        toast.error(t("walkInSlotTaken"));
      } else if (/RESCHEDULE_TOO_LATE/.test(msg)) {
        toast.error(t("rescheduleTooLate"));
      } else {
        toast.error(t("rescheduleFailed"));
      }
    },
  });

  const handleConfirm = () => {
    if (!time || reschedule.isPending) return;
    const newDate = format(date, "yyyy-MM-dd");
    // Same slot as now: nothing to do, close quietly.
    if (newDate === booking.booking_date && time === booking.booking_time) {
      setOpen(false);
      return;
    }
    reschedule.mutate({ newDate, newTime: time });
  };

  const currentDate = parseISO(booking.booking_date);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>{trigger}</SheetTrigger>

      <SheetContent side="bottom" className="flex max-h-[92vh] flex-col gap-0 rounded-t-3xl border-t p-0">
        <div className="mx-auto mt-3 h-1.5 w-10 shrink-0 rounded-full bg-muted-foreground/20" />

        <div className="shrink-0 px-5 pt-3">
          <SheetHeader className="text-start">
            <SheetTitle className="text-lg">{t("rescheduleTitle")}</SheetTitle>
            <SheetDescription className="text-xs">{t("currentAppointment")}</SheetDescription>
          </SheetHeader>

          <div className="mt-3 space-y-1.5 rounded-2xl border border-border bg-muted/40 p-3.5">
            <p className="truncate text-sm font-semibold">{provider.name[lang]}</p>
            {primaryService && (
              <span className="inline-block rounded-full bg-secondary px-2 py-0.5 text-[11px] text-secondary-foreground">
                {primaryService.name[lang]}
              </span>
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

        <div className="flex-1 overflow-y-auto overflow-x-hidden px-5 pb-5 pt-4">
          <AnimatePresence mode="wait">
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
                      setDateChosen(true);
                      setStep(2);
                    }}
                  />
                </div>
              </motion.div>
            )}

            {step === 2 && (
              <motion.div
                key="step2"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={SPRING}
              >
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

                <SectionLabel className="mb-3">
                  <Clock className="h-3.5 w-3.5" />
                  {t("availableTimes")}
                </SectionLabel>
                {!primaryService || !hasSlots ? (
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
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="shrink-0 border-t border-border bg-background/95 px-5 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] backdrop-blur-sm">
          <div className="flex items-center gap-3">
            {step > 1 && (
              <Button type="button" variant="outline" onClick={() => setStep(1)} className="h-12 shrink-0 gap-1.5 px-4">
                <BackArrow variant="arrow" className="h-4 w-4" />
                {t("back")}
              </Button>
            )}
            <Button
              className="h-12 flex-1 text-base font-semibold"
              disabled={!time || reschedule.isPending || step !== 2}
              onClick={handleConfirm}
            >
              {reschedule.isPending ? (
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-accent-foreground/30 border-t-accent-foreground" />
              ) : (
                t("confirmReschedule")
              )}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
