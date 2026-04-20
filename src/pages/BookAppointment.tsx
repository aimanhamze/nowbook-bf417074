import { useParams, useNavigate } from "react-router-dom";
import { useProviderById, useRealAvailability } from "@/hooks/useAllProviders";
import { useProviderSessionsById } from "@/hooks/useProviderSessions";
import type { Service } from "@/lib/mock-data";
import { Check, Clock, CalendarDays, Users, Calendar } from "lucide-react";
import { BackArrow } from "@/components/ui/directional-icon";
import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import { format, parseISO } from "date-fns";
import { he, ar, enUS } from "date-fns/locale";
import { z } from "zod";

const bookingSchema = z.object({
  services: z.array(z.object({ id: z.string() })).min(1, "בחר לפחות שירות אחד"),
  date: z.string().min(1),
  time: z.string().regex(/^\d{2}:\d{2}$/, "בחר שעה"),
});
import { useLang } from "@/contexts/LangContext";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { addDays } from "date-fns";

const BookAppointment = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { lang, t } = useLang();
  const { user, isProvider } = useAuth();
  const queryClient = useQueryClient();
  const { provider, isLoading: providerLoading } = useProviderById(id);
  const { getAvailableSlots, getGroupSlotsWithCapacity } = useRealAvailability(id);
  const { data: allSessions = [], isLoading: sessionsLoading } = useProviderSessionsById(id);

  const dateFnsLocale = lang === "he" ? he : lang === "ar" ? ar : enUS;

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [selectedServices, setSelectedServices] = useState<Service[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string>("");
  // For services without sessions (open availability)
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [selectedTime, setSelectedTime] = useState<string>("");
  const [loading, setLoading] = useState(false);

  // Live clock — re-filters slots every 60 s so stale "near-future" slots disappear
  const [now, setNow] = useState<Date>(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  if (!user) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6 text-center gap-4">
        <h2 className="text-lg font-bold">{t("mustLoginToBook")}</h2>
        <button
          onClick={() => navigate("/auth", { state: { from: `/provider/${id}/book` } })}
          className="px-6 py-3 rounded-2xl bg-accent text-accent-foreground font-semibold"
        >
          {t("loginLabel")}
        </button>
      </div>
    );
  }

  if (isProvider) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-5 gap-4">
        <p className="text-muted-foreground">{t("providerOnlyCannotBook")}</p>
        <button onClick={() => navigate(-1)} className="text-accent font-semibold">← {t("backToHome")}</button>
      </div>
    );
  }

  if (providerLoading || sessionsLoading) {
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
      prev.find((s) => s.id === service.id) ? [] : [service]
    );
    setSelectedSessionId("");
    setSelectedTime("");
  };

  const total = selectedServices.reduce((sum, s) => sum + s.price, 0);
  const totalDuration = selectedServices.reduce((sum, s) => sum + s.duration, 0);

  const primaryService = selectedServices[0];
  const isGroupBooking = primaryService?.service_type === 'group';
  const groupMaxCapacity = primaryService?.max_capacity ?? 1;

  // Sessions for the selected service
  const serviceSessions = primaryService
    ? allSessions.filter(s => s.service_id === primaryService.id)
    : [];

  // Does this service use scheduled sessions?
  const hasScheduledSessions = serviceSessions.length > 0;

  // Selected session object
  const selectedSession = allSessions.find(s => s.id === selectedSessionId);

  // For open-availability (no sessions): slot generation
  const minLeadTimeMinutes = provider.minLeadTimeMinutes;
  const isToday =
    selectedDate.getFullYear() === now.getFullYear() &&
    selectedDate.getMonth() === now.getMonth() &&
    selectedDate.getDate() === now.getDate();
  // Cutoff: slot start must be strictly greater than now + lead time
  const leadTimeCutoff = now.getHours() * 60 + now.getMinutes() + minLeadTimeMinutes;

  const allSlotsRaw = !hasScheduledSessions && !isGroupBooking
    ? getAvailableSlots(selectedDate, totalDuration || 15)
    : [];

  const availableSlots = isToday
    ? allSlotsRaw.filter((slot) => {
        const [h, m] = slot.split(":").map(Number);
        return h * 60 + m > leadTimeCutoff;
      })
    : allSlotsRaw;

  const groupSlotsRaw = !hasScheduledSessions && isGroupBooking
    ? getGroupSlotsWithCapacity(selectedDate, groupMaxCapacity)
    : [];

  const availableGroupSlots = isToday
    ? groupSlotsRaw.filter((slot) => {
        const [h, m] = slot.time.split(":").map(Number);
        return h * 60 + m > leadTimeCutoff;
      })
    : groupSlotsRaw;

  const allSlotsPassed = isToday && allSlotsRaw.length > 0 && availableSlots.length === 0;
  const allGroupSlotsPassed = isToday && groupSlotsRaw.length > 0 && availableGroupSlots.length === 0;

  const dates = Array.from({ length: 14 }, (_, i) => addDays(new Date(), i));

  // Effective booking date/time
  const effectiveDate = selectedSession
    ? selectedSession.session_date
    : format(selectedDate, "yyyy-MM-dd");
  const effectiveTime = selectedSession
    ? selectedSession.session_time.slice(0, 5)
    : selectedTime;

  const canProceed =
    (step === 1 && selectedServices.length > 0) ||
    (step === 2 && (hasScheduledSessions ? !!selectedSessionId : !!selectedTime)) ||
    step === 3;

  const handleNext = () => {
    if (step === 1 && selectedServices.length > 0) setStep(2);
    else if (step === 2 && effectiveTime) setStep(3);
  };

  const handleConfirm = async () => {
    const validation = bookingSchema.safeParse({
      services: selectedServices,
      date: effectiveDate,
      time: effectiveTime,
    });
    if (!validation.success) {
      toast.error(validation.error.errors[0].message);
      return;
    }
    if (user) {
      setLoading(true);
      const { error } = await supabase.from("bookings").insert({
        user_id: user.id,
        provider_id: provider.id,
        service_ids: selectedServices.map((s) => s.id),
        booking_date: effectiveDate,
        booking_time: effectiveTime,
        total_price: total,
        status: "confirmed",
      });
      setLoading(false);
      if (error) {
        if (error.message === "LEAD_TIME_VIOLATION") {
          const leadTimeLabels: Record<number, string> = {
            15: t("leadTime15"), 30: t("leadTime30"), 60: t("leadTime60"),
            120: t("leadTime120"), 240: t("leadTime240"), 1440: t("leadTime1440"),
          };
          const timeDisplay = leadTimeLabels[minLeadTimeMinutes] ?? `${minLeadTimeMinutes} ${t("min")}`;
          toast.error(t("leadTimeError").replace("{time}", timeDisplay));
        } else {
          toast.error(error.message);
        }
        return;
      }

      await supabase.from("notifications").insert({
        user_id: user.id,
        title: isGroupBooking ? "הצטרפת לשיעור! ✅" : "התור נקבע בהצלחה! ✅",
        body: `${isGroupBooking ? "שיעור" : "תור"} ל-${provider.name[lang]} ב-${format(parseISO(effectiveDate), "dd/MM")} בשעה ${effectiveTime}`,
        url: `/provider/${id}`,
        type: "booking_confirmed",
      });
      queryClient.invalidateQueries({ queryKey: ["unread-notifications"] });
      queryClient.invalidateQueries({ queryKey: ["notifications"] });

      await supabase.functions.invoke("send-push", {
        body: {
          provider_id: provider.id,
          title: isGroupBooking ? "משתתף חדש לשיעור! 👥" : "הזמנה חדשה! 🎉",
          body: `${format(parseISO(effectiveDate), "dd/MM")} בשעה ${effectiveTime}`,
          url: "/dashboard",
          type: "booking_new",
        },
      });
    }

    navigate("/booking-confirmed", {
      state: {
        provider: provider.name[lang],
        services: selectedServices.map((s) => s.name[lang]),
        date: format(parseISO(effectiveDate), "EEE, MMM d", { locale: dateFnsLocale }),
        time: effectiveTime,
        total,
        isGroup: isGroupBooking,
        participantCount: 1,
      },
    });
  };

  const stepLabels = [t("selectServices"), t("selectDate"), t("confirm")];

  return (
    <div className="min-h-screen pb-28">
      <header className="flex items-center gap-3 px-5 pt-10 pb-4">
        <button
          onClick={() => (step > 1 ? setStep((s) => (s - 1) as 1 | 2 | 3) : navigate(-1))}
          className="p-2 rounded-full active:scale-95"
        >
          <BackArrow variant="arrow" className="h-5 w-5" />
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
        {/* ── STEP 1: Select Service ── */}
        {step === 1 && (
          <motion.div key="step1" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.3 }} className="px-5">
            <div className="flex flex-col gap-2">
              {provider.services.map((service) => {
                const isSelected = !!selectedServices.find((s) => s.id === service.id);
                const isGroup = service.service_type === 'group';
                const sessionCount = allSessions.filter(s => s.service_id === service.id).length;

                return (
                  <button key={service.id} onClick={() => toggleService(service)}
                    className={cn(
                      "flex items-center justify-between p-4 rounded-xl border transition-all active:scale-[0.98]",
                      isSelected ? "border-accent bg-accent/5" : "border-border bg-card"
                    )}>
                    <div className="text-right flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-medium">{service.name[lang]}</p>
                        {isGroup && (
                          <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 font-medium">
                            <Users className="h-2.5 w-2.5" /> {t("groupClass")}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {service.duration} {t("min")}
                        </span>
                        {sessionCount > 0 && (
                          <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-accent/10 text-accent font-semibold">
                            <Calendar className="h-2.5 w-2.5" />
                            {sessionCount} מפגשים זמינים
                          </span>
                        )}
                        {isGroup && service.max_capacity && (
                          <span className="text-[10px] text-muted-foreground">
                            · {t("maxCapacity")}: {service.max_capacity}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-3 ms-3">
                      <span className="text-sm font-bold">₪{service.price}</span>
                      {isSelected && (
                        <div className="w-5 h-5 rounded-full bg-accent flex items-center justify-center shrink-0">
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

        {/* ── STEP 2: Pick Session or Date+Time ── */}
        {step === 2 && (
          <motion.div key="step2" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.3 }} className="px-5">

            {hasScheduledSessions ? (
              /* Provider has scheduled sessions → pick from list */
              <div>
                <h3 className="text-sm font-semibold mb-3 flex items-center gap-1.5">
                  <CalendarDays className="h-4 w-4 text-accent" />
                  בחר מפגש
                </h3>
                <div className="flex flex-col gap-2">
                  {serviceSessions.map(session => {
                    const sessionDate = parseISO(session.session_date);
                    const timeDisplay = session.session_time.slice(0, 5);
                    const isSelected = selectedSessionId === session.id;
                    const leadTimeCutoffMs = minLeadTimeMinutes * 60 * 1000;
                    const isPast = new Date(session.session_date + "T" + session.session_time) < new Date(now.getTime() + leadTimeCutoffMs);

                    if (isPast) return null;

                    return (
                      <button
                        key={session.id}
                        onClick={() => setSelectedSessionId(session.id)}
                        disabled={isPast}
                        className={cn(
                          "flex items-center justify-between p-4 rounded-xl border transition-all active:scale-[0.98]",
                          isSelected ? "border-accent bg-accent/5" : "border-border bg-card",
                          isPast && "opacity-40 cursor-not-allowed"
                        )}
                      >
                        <div className="flex items-center gap-3">
                          <div className={cn(
                            "w-12 h-12 rounded-xl flex flex-col items-center justify-center text-xs font-bold shrink-0",
                            isSelected ? "bg-accent text-accent-foreground" : "bg-secondary text-foreground"
                          )}>
                            <span className="text-[10px] uppercase">{format(sessionDate, "EEE", { locale: dateFnsLocale })}</span>
                            <span className="text-lg leading-none">{format(sessionDate, "d")}</span>
                            <span className="text-[10px]">{format(sessionDate, "MMM", { locale: dateFnsLocale })}</span>
                          </div>
                          <div className="text-right">
                            <p className="text-sm font-semibold">{format(sessionDate, "dd/MM/yyyy")}</p>
                            <p className="text-xs text-muted-foreground flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              {timeDisplay} · {primaryService?.duration} {t("min")}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {isGroupBooking && (
                            <span className="text-xs text-muted-foreground flex items-center gap-1">
                              <Users className="h-3 w-3" />
                              {groupMaxCapacity}
                            </span>
                          )}
                          {isSelected && (
                            <div className="w-5 h-5 rounded-full bg-accent flex items-center justify-center shrink-0">
                              <Check className="h-3 w-3 text-accent-foreground" />
                            </div>
                          )}
                        </div>
                      </button>
                    );
                  })}
                  {serviceSessions.filter(s => new Date(s.session_date + "T" + s.session_time) >= new Date(now.getTime() + minLeadTimeMinutes * 60 * 1000)).length === 0 && (
                    <div className="text-center py-8 text-muted-foreground text-sm">
                      אין מפגשים זמינים כרגע
                    </div>
                  )}
                </div>
              </div>
            ) : (
              /* No sessions → open availability: date strip + time grid */
              <div>
                <div className="mb-6">
                  <h3 className="text-sm font-semibold mb-3 flex items-center gap-1.5">
                    <CalendarDays className="h-4 w-4 text-accent" />
                    {t("selectDate")}
                  </h3>
                  <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-none -mx-1 px-1">
                    {dates.map((date) => {
                      const isSelected = format(date, "yyyy-MM-dd") === format(selectedDate, "yyyy-MM-dd");
                      return (
                        <button key={date.toISOString()}
                          onClick={() => { setSelectedDate(date); setSelectedTime(""); }}
                          className={cn(
                            "flex flex-col items-center min-w-[56px] py-2.5 px-3 rounded-xl transition-colors",
                            isSelected ? "bg-accent text-accent-foreground" : "bg-secondary text-foreground"
                          )}>
                          <span className="text-[10px] font-medium uppercase">{format(date, "EEE", { locale: dateFnsLocale })}</span>
                          <span className="text-lg font-bold">{format(date, "d", { locale: dateFnsLocale })}</span>
                          <span className="text-[10px]">{format(date, "MMM", { locale: dateFnsLocale })}</span>
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

                  {isGroupBooking ? (
                    availableGroupSlots.length > 0 ? (
                      <div className="grid grid-cols-3 gap-2">
                        {availableGroupSlots.map((slotInfo) => (
                          <button
                            key={slotInfo.time}
                            onClick={() => !slotInfo.isFull && setSelectedTime(slotInfo.time)}
                            disabled={slotInfo.isFull}
                            className={cn(
                              "py-2.5 px-1 rounded-xl text-xs font-medium transition-colors active:scale-95 flex flex-col items-center gap-0.5",
                              selectedTime === slotInfo.time
                                ? "bg-accent text-accent-foreground"
                                : slotInfo.isFull
                                ? "bg-muted text-muted-foreground opacity-60 cursor-not-allowed"
                                : slotInfo.spotsLeft === 1
                                ? "bg-orange-50 text-orange-700 border border-orange-200 hover:bg-orange-100"
                                : "bg-secondary text-foreground hover:bg-secondary/80"
                            )}
                          >
                            <span>{slotInfo.time}</span>
                            <span className={cn("text-[9px] leading-none",
                              selectedTime === slotInfo.time ? "text-accent-foreground/80"
                              : slotInfo.isFull ? "text-muted-foreground"
                              : slotInfo.spotsLeft === 1 ? "text-orange-600"
                              : "text-emerald-600"
                            )}>
                              {slotInfo.isFull ? `🔴 ${t("spotsFull")}` : slotInfo.spotsLeft === 1 ? `⚠️ ${t("lastSpot")}` : `${slotInfo.spotsLeft} ${t("spotsLeft")}`}
                            </span>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="text-center py-6">
                        <p className="text-sm text-muted-foreground">
                          {allGroupSlotsPassed ? t("noSlotsToday") : t("unavailable")}
                        </p>
                      </div>
                    )
                  ) : (
                    availableSlots.length > 0 ? (
                      <div className="grid grid-cols-3 gap-2">
                        {availableSlots.map((slot) => (
                          <button key={slot} onClick={() => setSelectedTime(slot)}
                            className={cn("py-2.5 rounded-xl text-xs font-medium transition-colors active:scale-95",
                              selectedTime === slot ? "bg-accent text-accent-foreground" : "bg-secondary text-foreground hover:bg-secondary/80"
                            )}>
                            {slot}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="text-center py-6">
                        <p className="text-sm text-muted-foreground">
                          {allSlotsPassed ? t("noSlotsToday") : t("unavailable")}
                        </p>
                      </div>
                    )
                  )}
                </div>
              </div>
            )}
          </motion.div>
        )}

        {/* ── STEP 3: Confirm ── */}
        {step === 3 && (
          <motion.div key="step3" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.3 }} className="px-5">
            <div className="rounded-2xl border border-border bg-card p-5 space-y-4">
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide">{t("provider")}</p>
                <p className="font-semibold">{provider.name[lang]}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide">{t("dateTime")}</p>
                <p className="font-semibold">
                  {format(parseISO(effectiveDate), "EEE, MMM d", { locale: dateFnsLocale })} — {effectiveTime}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1.5">{t("services")}</p>
                {selectedServices.map((s) => (
                  <div key={s.id} className="flex justify-between text-sm py-1">
                    <span className="flex items-center gap-1.5">
                      {s.service_type === 'group' && <Users className="h-3.5 w-3.5 text-blue-600" />}
                      {s.name[lang]} <span className="text-muted-foreground">({s.duration} {t("min")})</span>
                    </span>
                    <span className="font-medium">₪{s.price}</span>
                  </div>
                ))}
              </div>
              <div className="border-t border-border pt-3 flex justify-between">
                <p className="text-sm text-muted-foreground">{t("total")} ({totalDuration} {t("min")})</p>
                <p className="text-lg font-bold">₪{total}</p>
              </div>
            </div>
            {isGroupBooking && (
              <div className="mt-3 p-3 rounded-xl bg-blue-50 border border-blue-100 flex items-center gap-2 text-sm text-blue-700">
                <Users className="h-4 w-4 shrink-0" />
                <span>{t("groupClass")} · {t("maxCapacity")}: {groupMaxCapacity}</span>
              </div>
            )}
            <div className="mt-4 p-4 rounded-xl bg-secondary/60 text-sm text-muted-foreground">
              {t("payAtVenue")}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Bottom bar ── */}
      <div className="fixed bottom-0 left-0 right-0 p-4 bg-card/80 backdrop-blur-xl border-t border-border">
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="text-xs text-muted-foreground">
              {selectedServices.length} {selectedServices.length !== 1 ? t("serviceCount") : t("service")}
            </p>
            <p className="text-lg font-bold">₪{total}</p>
          </div>
          {step < 3 ? (
            <button disabled={!canProceed} onClick={handleNext}
              className={cn("px-8 py-3 rounded-2xl text-sm font-semibold transition-all active:scale-[0.97]",
                canProceed ? "bg-accent text-accent-foreground" : "bg-muted text-muted-foreground cursor-not-allowed"
              )}>
              {t("continue")}
            </button>
          ) : (
            <button onClick={handleConfirm} disabled={loading}
              className="px-8 py-3 rounded-2xl bg-accent text-accent-foreground text-sm font-semibold active:scale-[0.97] transition-transform disabled:opacity-50">
              {loading ? "..." : t("confirmBooking")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default BookAppointment;
