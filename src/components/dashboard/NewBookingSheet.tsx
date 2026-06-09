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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { SectionLabel } from "@/components/ui/SectionLabel";
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
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [serviceId, setServiceId] = useState("");
  const [date, setDate] = useState<Date>(startOfDay(selectedDate));
  const [time, setTime] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const startToday = startOfDay(new Date());
  const dates = Array.from({ length: profile?.booking_window_days ?? 14 }, (_, i) => addDays(startToday, i));

  // Reset the form each time the sheet opens; seed the date from the calendar's
  // selection, clamped into the visible strip.
  useEffect(() => {
    if (!open) return;
    const seedStr = format(selectedDate, "yyyy-MM-dd");
    const inRange = dates.some((d) => format(d, "yyyy-MM-dd") === seedStr);
    setDate(inRange ? startOfDay(selectedDate) : startToday);
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

  const activeServices = services.filter((s) => s.is_active !== false);
  const service = activeServices.find((s) => s.id === serviceId);
  const isGroup = service?.service_type === "group";
  const duration = service?.duration || 15;

  const privateSlots = service && !isGroup ? getAvailableSlots(date, duration, service.max_capacity ?? 1, service.id) : [];
  const groupSlots = service && isGroup
    ? getGroupSlotsWithCapacity(date, service.max_capacity ?? 1)
    : [];
  const hasSlots = isGroup ? groupSlots.length > 0 : privateSlots.length > 0;

  const canSubmit =
    !!service && !!time && name.trim().length > 0 && phone.trim().length > 0 && !submitting;

  // Per-step gate: service → time → (name + phone handled by canSubmit on step 3).
  const canProceed = step === 1 ? !!service : step === 2 ? !!time : true;

  const handleNext = () => {
    if (step === 1 && service) setStep(2);
    else if (step === 2 && time) setStep(3);
  };

  const handleBack = () => setStep((s) => (s > 1 ? ((s - 1) as 1 | 2 | 3) : s));

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

  const stepLabels = [t("selectServices"), t("selectDate"), t("walkInCustomerInfo")];

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
        className="flex max-h-[92vh] flex-col gap-0 rounded-t-3xl border-t p-0"
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
              {[1, 2, 3].map((s) => (
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
                {step} / 3
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

            {/* ── STEP 2: Date + Time ── */}
            {step === 2 && (
              <motion.div
                key="step2"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={SPRING}
              >
                {/* Date strip */}
                <div className="mb-6">
                  <SectionLabel className="mb-3">
                    <CalendarDays className="h-3.5 w-3.5" />
                    {format(date, "MMMM yyyy", { locale: dateFnsLocale })}
                  </SectionLabel>
                  <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-2 scrollbar-none">
                    {dates.map((d) => {
                      const selected = format(d, "yyyy-MM-dd") === format(date, "yyyy-MM-dd");
                      return (
                        <button
                          key={d.toISOString()}
                          type="button"
                          onClick={() => setDate(d)}
                          className={cn(
                            "flex min-w-[58px] flex-col items-center rounded-xl border py-2.5 px-2.5 transition-all active:scale-95",
                            selected
                              ? "border-transparent bg-accent text-accent-foreground shadow-[0_4px_12px_-4px_hsl(var(--accent)/0.45)]"
                              : "border-border bg-card text-foreground"
                          )}
                        >
                          <span className="text-[10px] font-medium uppercase">
                            {format(d, "EEE", { locale: dateFnsLocale })}
                          </span>
                          <span className="text-lg font-bold tabular-nums">{format(d, "d")}</span>
                          <span className="text-[10px]">{format(d, "MMM", { locale: dateFnsLocale })}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Time grid */}
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

            {/* ── STEP 3: Customer info ── */}
            {step === 3 && (
              <motion.div
                key="step3"
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
                    <Input
                      id="walkin-name"
                      autoComplete="name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder={t("walkInCustomerNamePlaceholder")}
                      className="h-12"
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
        <div className="shrink-0 border-t border-border bg-background/95 px-5 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur-sm">
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
            {step < 3 ? (
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
