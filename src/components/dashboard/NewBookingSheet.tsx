import { useEffect, useState } from "react";
import { format, addDays, startOfDay } from "date-fns";
import { he, ar, enUS } from "date-fns/locale";
import { Plus, Clock, Users, CalendarDays, Check, CalendarX } from "lucide-react";
import { motion } from "framer-motion";
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
import { cn } from "@/lib/utils";
import { useLang } from "@/contexts/LangContext";
import { useProviderProfile } from "@/hooks/useProviderProfile";
import { useProviderServices } from "@/hooks/useProviderServices";
import { useRealAvailability } from "@/hooks/useAllProviders";
import { supabase } from "@/integrations/supabase/client";
import type { TablesInsert } from "@/integrations/supabase/types";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

export function NewBookingSheet({ selectedDate }: { selectedDate: Date }) {
  const { lang, t } = useLang();
  const { profile } = useProviderProfile();
  const { services } = useProviderServices();
  const { getAvailableSlots, getGroupSlotsWithCapacity } = useRealAvailability(profile?.id);
  const queryClient = useQueryClient();

  const dateFnsLocale = lang === "he" ? he : lang === "ar" ? ar : enUS;

  const [open, setOpen] = useState(false);
  const [serviceId, setServiceId] = useState("");
  const [date, setDate] = useState<Date>(startOfDay(selectedDate));
  const [time, setTime] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // 14-day strip starting today (matches the customer flow's horizon). No
  // same-day lead-time filter here: providers are exempt by the DB trigger, so
  // a walk-in may take any available slot, including imminent ones today.
  const startToday = startOfDay(new Date());
  const dates = Array.from({ length: 14 }, (_, i) => addDays(startToday, i));

  // Reset the form each time the sheet opens; seed the date from the calendar's
  // selection, clamped into the visible strip.
  useEffect(() => {
    if (!open) return;
    const seedStr = format(selectedDate, "yyyy-MM-dd");
    const inRange = dates.some((d) => format(d, "yyyy-MM-dd") === seedStr);
    setDate(inRange ? startOfDay(selectedDate) : startToday);
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

  const privateSlots = service && !isGroup ? getAvailableSlots(date, duration) : [];
  const groupSlots = service && isGroup
    ? getGroupSlotsWithCapacity(date, service.max_capacity ?? 1)
    : [];
  const hasSlots = isGroup ? groupSlots.length > 0 : privateSlots.length > 0;

  const canSubmit =
    !!service && !!time && name.trim().length > 0 && phone.trim().length > 0 && !submitting;

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
        className="max-h-[90vh] overflow-y-auto rounded-t-3xl border-t p-5"
      >
        <SheetHeader className="text-start">
          <SheetTitle>{t("newBookingSheetTitle")}</SheetTitle>
          <SheetDescription>{t("newBookingSheetDesc")}</SheetDescription>
        </SheetHeader>

        <div className="mt-4 space-y-5">
          {/* ── Service ── */}
          <div>
            <SectionLabel className="mb-3">
              <Users className="h-3.5 w-3.5" />
              {t("walkInService")}
            </SectionLabel>
            {activeServices.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("unavailable")}</p>
            ) : (
              <div className="flex flex-col gap-2">
                {activeServices.map((s) => {
                  const selected = s.id === serviceId;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setServiceId(s.id)}
                      className={cn(
                        "flex items-center justify-between p-3 rounded-xl border transition-all active:scale-[0.98] text-start",
                        selected
                          ? "border-accent bg-accent/10 ring-2 ring-accent/20"
                          : "border-border bg-card hover:border-accent/30"
                      )}
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-semibold truncate">{s.name}</p>
                        <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                          <Clock className="h-3 w-3" />
                          {s.duration} {t("min")}
                          {s.service_type === "group" && (
                            <span className="inline-flex items-center gap-0.5 ms-1 text-accent">
                              <Users className="h-3 w-3" /> {s.max_capacity}
                            </span>
                          )}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0 ms-2">
                        {s.price > 0 && <span className="text-sm font-bold">₪{s.price}</span>}
                        {selected && (
                          <span className="w-5 h-5 rounded-full bg-accent flex items-center justify-center">
                            <Check className="h-3 w-3 text-accent-foreground" />
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* ── Date ── */}
          <div>
            <SectionLabel className="mb-3">
              <CalendarDays className="h-3.5 w-3.5" />
              {t("selectDate")}
            </SectionLabel>
            <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-none -mx-1 px-1">
              {dates.map((d) => {
                const selected = format(d, "yyyy-MM-dd") === format(date, "yyyy-MM-dd");
                return (
                  <button
                    key={d.toISOString()}
                    type="button"
                    onClick={() => setDate(d)}
                    className={cn(
                      "flex flex-col items-center min-w-[56px] py-2 px-2.5 rounded-xl border transition-all",
                      selected
                        ? "border-transparent bg-accent text-accent-foreground"
                        : "border-border bg-card text-foreground"
                    )}
                  >
                    <span className="text-[10px] font-medium uppercase">
                      {format(d, "EEE", { locale: dateFnsLocale })}
                    </span>
                    <span className="text-lg font-bold">{format(d, "d")}</span>
                    <span className="text-[10px]">{format(d, "MMM", { locale: dateFnsLocale })}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* ── Time ── */}
          <div>
            <SectionLabel className="mb-3">
              <Clock className="h-3.5 w-3.5" />
              {t("availableTimes")}
            </SectionLabel>
            {!service ? (
              <p className="text-sm text-muted-foreground">{t("walkInService")}…</p>
            ) : !hasSlots ? (
              <div className="rounded-2xl border border-dashed border-border p-6 text-center">
                <CalendarX className="h-7 w-7 text-muted-foreground/40 mx-auto mb-2" />
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
                      "py-2.5 px-1 rounded-xl text-sm font-semibold transition-all active:scale-95 flex flex-col items-center gap-0.5 border",
                      time === slot.time
                        ? "border-transparent bg-accent text-accent-foreground"
                        : slot.isFull
                        ? "border-transparent bg-muted text-muted-foreground opacity-60 cursor-not-allowed"
                        : "border-border bg-card text-foreground hover:border-accent/30"
                    )}
                  >
                    <span>{slot.time}</span>
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
                      "py-2.5 rounded-xl text-sm font-semibold transition-all active:scale-95 border",
                      time === slot
                        ? "border-transparent bg-accent text-accent-foreground"
                        : "border-border bg-card text-foreground hover:border-accent/30"
                    )}
                  >
                    {slot}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* ── Customer details ── */}
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="walkin-name" className="text-xs">
                {t("walkInCustomerName")} <span className="text-destructive">*</span>
              </Label>
              <Input
                id="walkin-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
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
                dir="ltr"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder={t("walkInCustomerPhonePlaceholder")}
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

          {/* ── Confirm ── */}
          <motion.div whileTap={canSubmit ? { scale: 0.98 } : undefined}>
            <Button
              className="w-full h-12 text-base font-semibold"
              disabled={!canSubmit}
              onClick={handleCreate}
            >
              {submitting ? (
                <span className="w-4 h-4 rounded-full border-2 border-accent-foreground/30 border-t-accent-foreground animate-spin" />
              ) : (
                t("walkInCreate")
              )}
            </Button>
          </motion.div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
