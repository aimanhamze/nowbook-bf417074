import { useEffect, useState } from "react";
import { format, addDays, startOfDay } from "date-fns";
import { he, ar, enUS } from "date-fns/locale";
import { Plus, Clock, Users, CalendarDays, Check, CalendarX } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { SectionLabel } from "@/components/ui/SectionLabel";
import { BookingMonthCalendar } from "@/components/booking/BookingMonthCalendar";
import { CustomerAutocomplete } from "@/components/dashboard/CustomerAutocomplete";
import { BackArrow } from "@/components/ui/directional-icon";
import { cn } from "@/lib/utils";
import { useLang } from "@/contexts/LangContext";
import { useProviderProfile } from "@/hooks/useProviderProfile";
import { useProviderServices } from "@/hooks/useProviderServices";
import { useRealAvailability } from "@/hooks/useAllProviders";
import { supabase } from "@/integrations/supabase/client";
import type { TablesInsert } from "@/integrations/supabase/types";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

// Same expressive easing the customer BookAppointment flow uses for its step
// slides — keeps the walk-in wizard feeling identical to the customer one.
const SPRING = { duration: 0.5, ease: [0.16, 1, 0.3, 1] } as const;

export function NewBookingSheet({ selectedDate }: { selectedDate: Date }) {
  const { lang, t } = useLang();
  const { profile } = useProviderProfile();
  const { services } = useProviderServices();
  const { getAvailableSlots, getGroupSlotsWithCapacity } = useRealAvailability(profile?.id);
  const queryClient = useQueryClient();

  const dateFnsLocale = lang === "he" ? he : lang === "ar" ? ar : enUS;

  const [open, setOpen] = useState(false);
  // 4 steps: service → month calendar → time → customer info (same calendar +
  // time-step pattern as the customer BookAppointment flow).
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [serviceId, setServiceId] = useState("");
  const [date, setDate] = useState<Date>(startOfDay(selectedDate));
  const [time, setTime] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  // Calendar UI state: displayed month + whether a day was actively tapped
  // (`date` always holds a value, so it can't signal that alone).
  const [calMonth, setCalMonth] = useState<Date>(() => startOfDay(selectedDate));
  const [dateChosen, setDateChosen] = useState(false);

  const startToday = startOfDay(new Date());
  // Same selectable range the old date strip had: today .. today + window - 1.
  const windowEnd = addDays(startToday, (profile?.booking_window_days ?? 14) - 1);

  // Reset the form each time the sheet opens; the calendar opens on the month of
  // the provider-calendar's selected day (clamped into the booking window).
  useEffect(() => {
    if (!open) return;
    const seed = startOfDay(selectedDate);
    const inRange = seed >= startToday && seed <= windowEnd;
    setDate(inRange ? seed : startToday);
    setCalMonth(inRange ? seed : startToday);
    setDateChosen(false);
    setStep(1);
    setServiceId("");
    setTime("");
    setName("");
    setPhone("");
    setNotes("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // A different service/date invalidates any previously picked time.
  useEffect(() => {
    setTime("");
  }, [serviceId, date]);

  // Day availability depends on the service (duration/capacity), so switching
  // service sends the provider back through the calendar.
  useEffect(() => {
    setDateChosen(false);
  }, [serviceId]);

  const activeServices = services.filter((s) => s.is_active !== false);
  const service = activeServices.find((s) => s.id === serviceId);
  const isGroup = service?.service_type === "group";
  const duration = service?.duration || 15;

  const privateSlots = service && !isGroup ? getAvailableSlots(date, duration, service.max_capacity ?? 1, service.id) : [];
  const groupSlots = service && isGroup
    ? getGroupSlotsWithCapacity(date, service.max_capacity ?? 1)
    : [];
  const hasSlots = isGroup ? groupSlots.length > 0 : privateSlots.length > 0;

  // A calendar day is tappable iff the EXISTING slot pipeline above (same
  // functions, same arguments) yields a selectable slot for it — presentation
  // only, so the calendar can never disagree with the time step.
  const dayHasAvailability = (d: Date): boolean => {
    if (!service) return false;
    if (isGroup) {
      return getGroupSlotsWithCapacity(d, service.max_capacity ?? 1).some((s) => !s.isFull);
    }
    return getAvailableSlots(d, duration, service.max_capacity ?? 1, service.id).length > 0;
  };

  const canSubmit =
    !!service && !!time && name.trim().length > 0 && phone.trim().length > 0 && !submitting;

  // Per-step gate: service → day → time → (name + phone handled by canSubmit on step 4).
  const canProceed =
    step === 1 ? !!service : step === 2 ? dateChosen : step === 3 ? !!time : true;

  const handleNext = () => {
    if (step === 1 && service) setStep(2);
    else if (step === 2 && dateChosen) setStep(3);
    else if (step === 3 && time) setStep(4);
  };

  const handleBack = () => setStep((s) => (s > 1 ? ((s - 1) as 1 | 2 | 3 | 4) : s));

  const handleCreate = async () => {
    if (!profile || !service) return;
    if (!name.trim()) { toast.error(t("walkInNameRequired")); return; }
    if (!phone.trim()) { toast.error(t("walkInPhoneRequired")); return; }
    if (!time) return;

    setSubmitting(true);
    const payload: TablesInsert<"bookings"> = {
      user_id: null,
      provider_id: profile.id,
      service_ids: [service.id],
      booking_date: format(date, "yyyy-MM-dd"),
      booking_time: time,
      total_price: service.price,
      status: "confirmed",
      customer_name: name.trim(),
      customer_phone: phone.trim(),
      guest_notes: notes.trim() || null,
    };

    const { error } = await supabase.from("bookings").insert(payload);
    setSubmitting(false);

    if (error) {
      // prevent_booking_conflicts raises SQLSTATE 23505 ("...no longer
      // available") for private overlaps and 'GROUP_CAPACITY_EXCEEDED' for full
      // group slots. Both mean: the slot is gone — surface gracefully and
      // refresh availability so it drops out of the grid.
      const slotTaken =
        error.code === "23505" ||
        /GROUP_CAPACITY_EXCEEDED|no longer available/i.test(error.message || "");
      toast.error(slotTaken ? t("walkInSlotTaken") : t("walkInFailed"));
      queryClient.invalidateQueries({ queryKey: ["provider-bookings-public", profile.id] });
      return;
    }

    // No notifications: a walk-in has no account to notify, and the provider is
    // the one creating it.
    queryClient.invalidateQueries({ queryKey: ["provider-bookings-enriched", profile.id] });
    queryClient.invalidateQueries({ queryKey: ["provider-bookings-public", profile.id] });
    toast.success(t("walkInCreated"));
    setOpen(false);
  };

  const stepLabels = [t("selectServices"), t("selectDate"), t("pickTime"), t("walkInCustomerInfo")];

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button size="sm" className="h-8 gap-1 text-xs shrink-0">
          <Plus className="h-3.5 w-3.5" />
          {t("newBookingBtn")}
        </Button>
      </SheetTrigger>

      <SheetContent
        side="bottom"
        className={`flex max-h-[92vh] flex-col gap-0 rounded-t-3xl border-t p-0 ${providerDesktopSheet}`}
      >
        {/* Grab handle — bottom-sheet affordance */}
        <div className="mx-auto mt-3 h-1.5 w-10 shrink-0 rounded-full bg-muted-foreground/20" />

        {/* ── Header + step indicator (fixed; content below scrolls) ── */}
        <div className="shrink-0 px-5 pt-3">
          <SheetHeader className="text-start">
            <SheetTitle className="text-lg">{t("newBookingSheetTitle")}</SheetTitle>
            <SheetDescription className="text-xs">{t("newBookingSheetDesc")}</SheetDescription>
          </SheetHeader>

          <div className="mt-4 mb-1">
            <div className="mb-2 flex gap-1.5">
              {[1, 2, 3, 4].map((s) => (
                <div
                  key={s}
                  className={cn(
                    "h-1.5 flex-1 rounded-full transition-colors duration-300",
                    s <= step ? "bg-accent" : "bg-border"
                  )}
                />
              ))}
            </div>
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-accent">{stepLabels[step - 1]}</p>
              <p className="text-[11px] font-medium text-muted-foreground tabular-nums">
                {step} / 4
              </p>
            </div>
          </div>
        </div>

        {/* ── Scrollable step body ── */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden px-5 pb-5 pt-4">
          <AnimatePresence mode="wait">
            {/* ── STEP 1: Service ── */}
            {step === 1 && (
              <motion.div
                key="step1"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={SPRING}
              >
                {activeServices.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t("unavailable")}</p>
                ) : (
                  <div className="flex flex-col gap-2.5">
                    {activeServices.map((s, i) => {
                      const selected = s.id === serviceId;
                      return (
                        <motion.button
                          key={s.id}
                          type="button"
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ ...SPRING, delay: i * 0.04 }}
                          onClick={() => setServiceId(s.id)}
                          className={cn(
                            "flex items-center justify-between rounded-2xl border p-4 text-start shadow-sm transition-all active:scale-[0.98]",
                            selected
                              ? "border-accent bg-accent/10 ring-2 ring-accent/20"
                              : "border-border bg-card hover:border-accent/40"
                          )}
                        >
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold">{s.name}</p>
                            <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                              <Clock className="h-3 w-3" />
                              <span className="tabular-nums">{s.duration}</span> {t("min")}
                              {s.service_type === "group" && (
                                <span className="ms-1 inline-flex items-center gap-0.5 rounded-full bg-accent/10 px-1.5 py-0.5 text-accent">
                                  <Users className="h-3 w-3" /> {s.max_capacity}
                                </span>
                              )}
                            </p>
                          </div>
                          <div className="ms-3 flex shrink-0 items-center gap-3">
                            {s.price > 0 && (
                              <span className="text-base font-bold tabular-nums">₪{s.price}</span>
                            )}
                            {selected && (
                              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-accent">
                                <Check className="h-3 w-3 text-accent-foreground" />
                              </span>
                            )}
                          </div>
                        </motion.button>
                      );
                    })}
                  </div>
                )}
              </motion.div>
            )}

            {/* ── STEP 2: Month calendar (shared with the customer flow) ── */}
            {step === 2 && (
              <motion.div
                key="step2"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={SPRING}
              >
                <SectionLabel className="mb-3">
                  <CalendarDays className="h-3.5 w-3.5" />
                  {t("selectDate")}
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
                      setStep(3);
                    }}
                  />
                </div>
              </motion.div>
            )}

            {/* ── STEP 3: Time for the chosen day ── */}
            {step === 3 && (
              <motion.div
                key="step3-time"
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
                    onClick={() => setStep(2)}
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
                  {!service ? (
                    <p className="text-sm text-muted-foreground">{t("walkInService")}…</p>
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
                              : "border-border bg-card text-foreground hover:border-accent/40"
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
                              : "border-border bg-card text-foreground hover:border-accent/40"
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

            {/* ── STEP 4: Customer info ── */}
            {step === 4 && (
              <motion.div
                key="step4"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={SPRING}
                className="space-y-5"
              >
                {/* Booking summary */}
                <div className="space-y-2.5 rounded-2xl border border-border bg-muted/40 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs text-muted-foreground">{t("walkInService")}</span>
                    <span className="truncate text-sm font-semibold">{service?.name}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs text-muted-foreground">{t("selectDate")}</span>
                    <span className="text-sm font-medium">
                      {format(date, "EEE, d MMM", { locale: dateFnsLocale })}
                      {" · "}
                      <span dir="ltr" className="tabular-nums">{time}</span>
                    </span>
                  </div>
                  {!!service && service.price > 0 && (
                    <div className="flex items-center justify-between gap-3 border-t border-border/60 pt-2.5">
                      <span className="text-xs text-muted-foreground">{t("total")}</span>
                      <span className="text-lg font-bold text-accent tabular-nums">₪{service.price}</span>
                    </div>
                  )}
                </div>

                {/* Fields */}
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="walkin-name" className="text-xs">
                      {t("walkInCustomerName")} <span className="text-destructive">*</span>
                    </Label>
                    <CustomerAutocomplete
                      id="walkin-name"
                      value={name}
                      onValueChange={setName}
                      onSelectCustomer={(pickedName, pickedPhone) => {
                        // Pre-fill BOTH text fields; they stay editable. This does
                        // NOT link the booking to an account — walk-in stays a text
                        // name/phone with user_id NULL on insert.
                        setName(pickedName);
                        setPhone(pickedPhone);
                      }}
                      placeholder={t("walkInCustomerNamePlaceholder")}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="walkin-phone" className="text-xs">
                      {t("walkInCustomerPhone")} <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      id="walkin-phone"
                      type="tel"
                      inputMode="tel"
                      autoComplete="tel"
                      dir="ltr"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder={t("walkInCustomerPhonePlaceholder")}
                      className="h-12"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="walkin-notes" className="text-xs">
                      {t("walkInNotes")}
                    </Label>
                    <Textarea
                      id="walkin-notes"
                      rows={2}
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder={t("walkInNotesPlaceholder")}
                    />
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* ── Sticky footer: Back / Continue or Create ── */}
        <div className="shrink-0 border-t border-border bg-background/95 px-5 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] backdrop-blur-sm">
          <div className="flex items-center gap-3">
            {step > 1 && (
              <Button
                type="button"
                variant="outline"
                onClick={handleBack}
                className="h-12 shrink-0 gap-1.5 px-4"
              >
                <BackArrow variant="arrow" className="h-4 w-4" />
                {t("back")}
              </Button>
            )}
            {step < 4 ? (
              <Button
                type="button"
                onClick={handleNext}
                disabled={!canProceed}
                className="h-12 flex-1 text-base font-semibold"
              >
                {t("continue")}
              </Button>
            ) : (
              <motion.div whileTap={canSubmit ? { scale: 0.98 } : undefined} className="flex-1">
                <Button
                  className="h-12 w-full text-base font-semibold"
                  disabled={!canSubmit}
                  onClick={handleCreate}
                >
                  {submitting ? (
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-accent-foreground/30 border-t-accent-foreground" />
                  ) : (
                    t("walkInCreate")
                  )}
                </Button>
              </motion.div>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
