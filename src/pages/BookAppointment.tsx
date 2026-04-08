import { useParams, useNavigate } from "react-router-dom";
import { useProviderById, useRealAvailability } from "@/hooks/useAllProviders";
import type { Service } from "@/lib/mock-data";
import { ArrowLeft, Check, Clock, CalendarDays } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import { format, addDays } from "date-fns";
import { useLang } from "@/contexts/LangContext";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

const BookAppointment = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { lang, t } = useLang();
  const { user, isProvider } = useAuth();
  const queryClient = useQueryClient();
  const { provider, isLoading: providerLoading } = useProviderById(id);
  const { getAvailableSlots } = useRealAvailability(id);

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [selectedServices, setSelectedServices] = useState<Service[]>([]);
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [selectedTime, setSelectedTime] = useState<string>("");
  const [loading, setLoading] = useState(false);

  // Must be logged in to book
  if (!user) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6 text-center gap-4">
        <h2 className="text-lg font-bold">{lang === "he" ? "יש להתחבר כדי לקבוע תור" : "Please sign in to book"}</h2>
        <button
          onClick={() => navigate("/auth", { state: { from: `/provider/${id}/book` } })}
          className="px-6 py-3 rounded-2xl bg-accent text-accent-foreground font-semibold"
        >
          {lang === "he" ? "התחברות" : "Sign in"}
        </button>
      </div>
    );
  }

  // Providers cannot book appointments
  if (isProvider) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-5 gap-4">
        <p className="text-muted-foreground">ספקים לא יכולים להזמין תורים</p>
        <button onClick={() => navigate(-1)} className="text-accent font-semibold">← {t("backToHome")}</button>
      </div>
    );
  }

  if (providerLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 rounded-full border-2 border-accent border-t-transparent animate-spin" />
      </div>
    );
  }

  if (!provider) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-muted-foreground">{t("providerNotFound")}</p>
      </div>
    );
  }

  const toggleService = (service: Service) => {
    setSelectedServices((prev) =>
      prev.find((s) => s.id === service.id)
        ? prev.filter((s) => s.id !== service.id)
        : [...prev, service]
    );
  };

  const total = selectedServices.reduce((sum, s) => sum + s.price, 0);
  const totalDuration = selectedServices.reduce((sum, s) => sum + s.duration, 0);

  const allSlots = getAvailableSlots(selectedDate, totalDuration || 15);

  // Filter out past time slots if the selected date is today
  const now = new Date();
  const isToday =
    selectedDate.getFullYear() === now.getFullYear() &&
    selectedDate.getMonth() === now.getMonth() &&
    selectedDate.getDate() === now.getDate();

  const availableSlots = (() => {
    if (!isToday) return allSlots;
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    return allSlots.filter((slot) => {
      const [h, m] = slot.split(":").map(Number);
      return h * 60 + m > currentMinutes;
    });
  })();

  const allSlotsPassed = isToday && allSlots.length > 0 && availableSlots.length === 0;

  const dates = Array.from({ length: 14 }, (_, i) => addDays(new Date(), i));

  const canProceed =
    (step === 1 && selectedServices.length > 0) ||
    (step === 2 && selectedTime) ||
    step === 3;

  const handleNext = () => {
    if (step === 1 && selectedServices.length > 0) setStep(2);
    else if (step === 2 && selectedTime) setStep(3);
  };

  const handleConfirm = async () => {
    if (user) {
      setLoading(true);
      const { error } = await supabase.from("bookings").insert({
        user_id: user.id,
        provider_id: provider.id,
        service_ids: selectedServices.map((s) => s.id),
        booking_date: format(selectedDate, "yyyy-MM-dd"),
        booking_time: selectedTime,
        total_price: total,
      });
      setLoading(false);
      if (error) {
        toast.error(error.message);
        return;
      }

      // Save confirmation notification for the customer
      await supabase.from("notifications").insert({
        user_id: user.id,
        title: "התור נקבע בהצלחה! ✅",
        body: `תור ל-${provider.name[lang]} ב-${format(selectedDate, "dd/MM")} בשעה ${selectedTime}`,
        url: `/provider/${id}`,
        type: "booking_confirmed",
      });
      queryClient.invalidateQueries({ queryKey: ["unread-notifications"] });
      queryClient.invalidateQueries({ queryKey: ["notifications"] });

      // Send push notification to provider
      const { data: pushData, error: pushError } = await supabase.functions.invoke("send-push", {
        body: {
          provider_id: provider.id,
          title: "הזמנה חדשה! 🎉",
          body: `הזמנה חדשה ל-${format(selectedDate, "dd/MM")} בשעה ${selectedTime}`,
          url: "/dashboard",
          type: "booking_new",
        },
      });

      if (pushError) {
        console.error("Push notification failed:", pushError.message);
      } else if (pushData?.results?.some((r: any) => r.status === "rejected" || (r.value && r.value.ok === false))) {
        console.error("Push notification delivery failed:", pushData);
      }
    }

    navigate("/booking-confirmed", {
      state: {
        provider: provider.name[lang],
        services: selectedServices.map((s) => s.name[lang]),
        date: format(selectedDate, "EEE, MMM d"),
        time: selectedTime,
        total,
      },
    });
  };

  const stepLabels = [t("selectServices"), t("pickTime"), t("confirm")];

  return (
    <div className="min-h-screen pb-28">
      <header className="flex items-center gap-3 px-5 pt-10 pb-4">
        <button
          onClick={() => (step > 1 ? setStep((s) => (s - 1) as 1 | 2 | 3) : navigate(-1))}
          className="p-2 rounded-full active:scale-95"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div>
          <h1 className="text-lg font-bold">{t("bookAt")} {provider.name[lang]}</h1>
          <p className="text-xs text-muted-foreground">
            {t("step")} {step} {t("of")} 3 — {stepLabels[step - 1]}
          </p>
        </div>
      </header>

      <div className="flex gap-1.5 px-5 mb-6">
        {[1, 2, 3].map((s) => (
          <div key={s} className={cn("h-1 flex-1 rounded-full transition-colors duration-300", s <= step ? "bg-accent" : "bg-border")} />
        ))}
      </div>

      <AnimatePresence mode="wait">
        {step === 1 && (
          <motion.div key="step1" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.3 }} className="px-5">
            <div className="flex flex-col gap-2">
              {provider.services.map((service) => {
                const isSelected = selectedServices.find((s) => s.id === service.id);
                return (
                  <button key={service.id} onClick={() => toggleService(service)} className={cn("flex items-center justify-between p-4 rounded-xl border transition-all active:scale-[0.98]", isSelected ? "border-accent bg-accent/5" : "border-border bg-card")}>
                    <div className="text-right">
                      <p className="text-sm font-medium">{service.name[lang]}</p>
                      <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                        <Clock className="h-3 w-3" />
                        {service.duration} {t("min")}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-bold">₪{service.price}</span>
                      {isSelected && (
                        <div className="w-5 h-5 rounded-full bg-accent flex items-center justify-center">
                          <Check className="h-3 w-3 text-accent-foreground" />
                        </div>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </motion.div>
        )}

        {step === 2 && (
          <motion.div key="step2" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.3 }} className="px-5">
            <div className="mb-6">
              <h3 className="text-sm font-semibold mb-3 flex items-center gap-1.5">
                <CalendarDays className="h-4 w-4 text-accent" />
                {t("selectDate")}
              </h3>
              <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-none -mx-1 px-1">
                {dates.map((date) => {
                  const isSelected = format(date, "yyyy-MM-dd") === format(selectedDate, "yyyy-MM-dd");
                  return (
                    <button key={date.toISOString()} onClick={() => { setSelectedDate(date); setSelectedTime(""); }} className={cn("flex flex-col items-center min-w-[56px] py-2.5 px-3 rounded-xl transition-colors", isSelected ? "bg-accent text-accent-foreground" : "bg-secondary text-foreground")}>
                      <span className="text-[10px] font-medium uppercase">{format(date, "EEE")}</span>
                      <span className="text-lg font-bold">{format(date, "d")}</span>
                      <span className="text-[10px]">{format(date, "MMM")}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <h3 className="text-sm font-semibold mb-3 flex items-center gap-1.5">
                <Clock className="h-4 w-4 text-accent" />
                {t("availableTimes")}
              </h3>
              {availableSlots.length > 0 ? (
                <div className="grid grid-cols-3 gap-2">
                  {availableSlots.map((slot) => (
                    <button key={slot} onClick={() => setSelectedTime(slot)} className={cn("py-2.5 rounded-xl text-xs font-medium transition-colors active:scale-95", selectedTime === slot ? "bg-accent text-accent-foreground" : "bg-secondary text-foreground hover:bg-secondary/80")}>
                      {slot}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="text-center py-6">
                  <p className="text-sm text-muted-foreground">
                    {allSlotsPassed
                      ? (lang === "he" ? "כל השעות של היום כבר עברו, בחר תאריך אחר" : "All times for today have passed, pick another date")
                      : t("unavailable")}
                  </p>
                </div>
              )}
            </div>
          </motion.div>
        )}

        {step === 3 && (
          <motion.div key="step3" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.3 }} className="px-5">
            <div className="rounded-2xl border border-border bg-card p-5 space-y-4">
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide">{t("provider")}</p>
                <p className="font-semibold">{provider.name[lang]}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide">{t("dateTime")}</p>
                <p className="font-semibold">{format(selectedDate, "EEE, MMM d")} — {selectedTime}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1.5">{t("services")}</p>
                {selectedServices.map((s) => (
                  <div key={s.id} className="flex justify-between text-sm py-1">
                    <span>{s.name[lang]} <span className="text-muted-foreground">({s.duration} {t("min")})</span></span>
                    <span className="font-medium">₪{s.price}</span>
                  </div>
                ))}
              </div>
              <div className="border-t border-border pt-3 flex justify-between">
                <p className="text-sm text-muted-foreground">{t("total")} ({totalDuration} {t("min")})</p>
                <p className="text-lg font-bold">₪{total}</p>
              </div>
            </div>
            <div className="mt-4 p-4 rounded-xl bg-secondary/60 text-sm text-muted-foreground">
              {t("payAtVenue")}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="fixed bottom-0 left-0 right-0 p-4 bg-card/80 backdrop-blur-xl border-t border-border">
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="text-xs text-muted-foreground">
              {selectedServices.length} {selectedServices.length !== 1 ? t("serviceCount") : t("service")}
            </p>
            <p className="text-lg font-bold">₪{total}</p>
          </div>
          {step < 3 ? (
            <button disabled={!canProceed} onClick={handleNext} className={cn("px-8 py-3 rounded-2xl text-sm font-semibold transition-all active:scale-[0.97]", canProceed ? "bg-accent text-accent-foreground" : "bg-muted text-muted-foreground cursor-not-allowed")}>
              {t("continue")}
            </button>
          ) : (
            <button onClick={handleConfirm} disabled={loading} className="px-8 py-3 rounded-2xl bg-accent text-accent-foreground text-sm font-semibold active:scale-[0.97] transition-transform disabled:opacity-50">
              {loading ? "..." : t("confirmBooking")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default BookAppointment;
