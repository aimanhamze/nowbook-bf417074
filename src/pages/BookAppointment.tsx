import { useParams, useNavigate } from "react-router-dom";
import { useProviderById, useRealAvailability } from "@/hooks/useAllProviders";
import { useProviderSessionsById } from "@/hooks/useProviderSessions";
import type { Service } from "@/lib/mock-data";
import { Check, Clock, CalendarDays, Users, Calendar, CalendarX } from "lucide-react";
import { BackArrow } from "@/components/ui/directional-icon";
import { SectionLabel } from "@/components/ui/SectionLabel";
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

const SPRING = { duration: 0.5, ease: [0.16, 1, 0.3, 1] } as const;

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
    ? getAvailableSlots(selectedDate, totalDuration || 15, primaryService?.max_capacity ?? 1, primaryService?.id, primaryService?.latest_start_time)
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

  const dates = Array.from({ length: provider.bookingWindowDays ?? 14 }, (_, i) => addDays(new Date(), i));

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
    // Provider's approval preference. The DB trigger enforce_booking_approval_status
    // re-checks this server-side, so a stale client cache can't auto-confirm a
    // booking for a provider who now requires approval.
    const requiresApproval = provider.requiresBookingApproval;
    const insertedStatus: "pending" | "confirmed" = requiresApproval ? "pending" : "confirmed";

    // DEBUG (temporary): pending-toggle investigation
    console.log("DEBUG: provider.requiresBookingApproval =", provider.requiresBookingApproval);
    console.log("DEBUG: typeof =", typeof provider.requiresBookingApproval);
    console.log("DEBUG: full provider object =", provider);
    console.log("DEBUG: computed insertedStatus =", insertedStatus);

    if (user) {
      setLoading(true);
      const { error } = await supabase.from("bookings").insert({
        user_id: user.id,
        provider_id: provider.id,
        service_ids: selectedServices.map((s) => s.id),
        booking_date: effectiveDate,
        booking_time: effectiveTime,
        total_price: total,
        status: insertedStatus,
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
        } else if (error.message === "GROUP_CAPACITY_EXCEEDED") {
          toast.error(t("bookingCapacityFullError"));
          queryClient.invalidateQueries({ queryKey: ["provider-bookings-public", provider.id] });
        } else if (error.message === "DUPLICATE_USER_BOOKING") {
          toast.error(t("duplicateUserBookingError"));
        } else {
          toast.error(error.message);
        }
        return;
      }

      // Fetch customer name + provider user_id in parallel for notifications
      const [{ data: customerProfile }, { data: providerProfile }] = await Promise.all([
        supabase.from("profiles").select("display_name").eq("user_id", user.id).single(),
        supabase.from("provider_profiles").select("user_id").eq("id", provider.id).single(),
      ]);
      const customerName = customerProfile?.display_name || "לקוח";
      const serviceName = selectedServices[0]?.name[lang] || "";
      const dateStr = format(parseISO(effectiveDate), "dd/MM");

      const customerNotif = requiresApproval
        ? {
            user_id: user.id,
            title: "בקשת תור נשלחה ⏳",
            body: `הבקשה ל-${provider.name[lang]} ב-${dateStr} בשעה ${effectiveTime} ממתינה לאישור`,
            url: "/bookings",
            type: "booking_pending",
          }
        : {
            user_id: user.id,
            title: "התור שלך אושר! 📅",
            body: `התור ב-${provider.name[lang]} ב-${dateStr} בשעה ${effectiveTime} אושר`,
            url: "/bookings",
            type: "booking_confirmed",
          };

      const providerNotifTitle = requiresApproval ? t("newBookingRequest") : "תור חדש 📅";
      const providerNotifBody = requiresApproval
        ? `${customerName} ביקש תור ל-${serviceName} בתאריך ${dateStr} בשעה ${effectiveTime}`
        : `${customerName} קבע תור ל-${serviceName} בתאריך ${dateStr} בשעה ${effectiveTime}`;

      // Only the customer notification is inserted here. The provider
      // notification is owned by the send-push function below (it inserts the
      // DB row AND pushes), so inserting it here too would create a duplicate.
      await supabase.from("notifications").insert(customerNotif);
      queryClient.invalidateQueries({ queryKey: ["unread-notifications"] });
      queryClient.invalidateQueries({ queryKey: ["notifications"] });

      // Push notification to provider. send-push is the single source of truth
      // for the provider notification: it inserts the DB row, then pushes.
      const { error: pushError } = await supabase.functions.invoke("send-push", {
        body: {
          provider_id: provider.id,
          title: providerNotifTitle,
          body: providerNotifBody,
          url: "/calendar",
          type: "booking_new",
        },
      });

      // Fallback: if send-push failed, it may not have inserted the provider's
      // notification — insert it directly so the provider isn't left with zero.
      if (pushError && providerProfile?.user_id) {
        await supabase.from("notifications").insert({
          user_id: providerProfile.user_id,
          title: providerNotifTitle,
          body: providerNotifBody,
          url: "/calendar",
          type: "booking_new",
        });
      }
    }

    navigate("/booking-confirmed", {
      state: {
        provider: provider.name[lang],
        services: selectedServices.map((s) => s.name[lang]),
        date: format(parseISO(effectiveDate), "EEE, MMM d", { locale: dateFnsLocale }),
        time: effectiveTime,
        total,
        showPrices: provider.showPrices,
        isGroup: isGroupBooking,
        participantCount: 1,
        status: insertedStatus,
      },
    });
  };

  const stepLabels = [t("selectServices"), t("selectDate"), t("confirm")];

  return (
    <div
      className="relative min-h-screen overflow-x-clip pb-32"
      style={{ background: "var(--bg-atmosphere)" }}
    >
      {/* Radial accent glows — positioned to sit behind content (header is
          small, sticky bar is bottom) without bleeding into the sticky bar. */}
      <div
        aria-hidden
        className="pointer-events-none absolute top-[6rem] [inset-inline-end:-5rem] h-[22rem] w-[22rem] rounded-full blur-3xl opacity-55"
        style={{ background: "radial-gradient(circle, hsl(24 95% 78% / 0.55) 0%, transparent 65%)" }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute top-[24rem] [inset-inline-start:-6rem] h-[26rem] w-[26rem] rounded-full blur-3xl opacity-45"
        style={{ background: "radial-gradient(circle, hsl(265 60% 80% / 0.45) 0%, transparent 65%)" }}
      />

      <div className="relative">
      {/* ── Header ── */}
      <header className="px-5 pt-10 pb-6">
        <div className="flex items-center gap-3">
          <button
            onClick={() => (step > 1 ? setStep((s) => (s - 1) as 1 | 2 | 3) : navigate(-1))}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-white/85 shadow-[0_4px_16px_rgba(0,0,0,0.08)] ring-1 ring-white/40 backdrop-blur-md transition-transform active:scale-95 shrink-0"
          >
            <BackArrow variant="arrow" className="h-5 w-5" />
          </button>
          <h1 className="text-lg font-bold">{t("bookAt")} {provider.name[lang]}</h1>
        </div>
      </header>

      {/* ── Step indicator ── */}
      <div className="px-5 mb-6">
        <div className="flex gap-1.5 mb-2">
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
        <p className="text-xs font-semibold text-accent text-end">
          {stepLabels[step - 1]}
        </p>
      </div>

      <AnimatePresence mode="wait">

        {/* ── STEP 1: Select Service ── */}
        {step === 1 && (
          <motion.div
            key="step1"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={SPRING}
            className="px-5"
          >
            <div className="flex flex-col gap-2">
              {provider.services.map((service, i) => {
                const isSelected = !!selectedServices.find((s) => s.id === service.id);
                const isGroup = service.service_type === 'group';
                const sessionCount = allSessions.filter(s => s.service_id === service.id).length;

                return (
                  <motion.button
                    key={service.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ ...SPRING, delay: i * 0.06 }}
                    onClick={() => toggleService(service)}
                    className={cn(
                      "flex items-center justify-between p-4 rounded-2xl border transition-all active:scale-[0.98]",
                      isSelected
                        ? "border-accent bg-accent/10 ring-2 ring-accent/20 shadow-sm"
                        : "border-white/60 bg-white/70 shadow-[0_6px_16px_-10px_rgba(120,70,30,0.15)] hover:border-accent/30"
                    )}
                  >
                    <div className="text-right flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <p className="text-sm font-semibold">{service.name[lang]}</p>
                        {isGroup && (
                          <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-accent/10 text-accent font-semibold">
                            <Users className="h-2.5 w-2.5" /> {t("groupClass")}
                          </span>
                        )}
                      </div>
                      {service.latest_start_time && (
                        <p className="text-[11px] text-orange-600 font-medium mb-1">
                          {t("availableUntil").replace("{time}", service.latest_start_time.slice(0, 5))}
                        </p>
                      )}
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-[11px] text-muted-foreground">
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
                    <div className="flex items-center gap-3 ms-3 shrink-0">
                      {provider.showPrices && service.price > 0 && (
                        <div className="text-end">
                          <span className="text-xs text-accent">₪</span>
                          <span className="text-base font-bold">{service.price}</span>
                        </div>
                      )}
                      {isSelected && (
                        <div className="w-5 h-5 rounded-full bg-accent flex items-center justify-center shrink-0">
                          <Check className="h-3 w-3 text-accent-foreground" />
                        </div>
                      )}
                    </div>
                  </motion.button>
                );
              })}
            </div>
          </motion.div>
        )}

        {/* ── STEP 2: Pick Session or Date+Time ── */}
        {step === 2 && (
          <motion.div
            key="step2"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={SPRING}
            className="px-5"
          >

            {hasScheduledSessions ? (
              /* Provider has scheduled sessions → pick from list */
              <div>
                <SectionLabel className="mb-4">
                  <CalendarDays className="h-3.5 w-3.5" />
                  בחר מפגש
                </SectionLabel>
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
                          "flex items-center justify-between p-4 rounded-2xl border transition-all active:scale-[0.98]",
                          isSelected
                            ? "border-accent bg-accent/10 ring-2 ring-accent/20 shadow-sm"
                            : "border-white/60 bg-white/70 shadow-[0_6px_16px_-10px_rgba(120,70,30,0.15)] hover:border-accent/30",
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
                    <div className="glass-card-md rounded-2xl p-8 text-center">
                      <CalendarX className="h-8 w-8 text-muted-foreground/40 mx-auto mb-3" />
                      <p className="text-sm text-muted-foreground">אין מפגשים זמינים כרגע</p>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              /* No sessions → open availability: date strip + time grid */
              <div>
                <div className="mb-6">
                  <SectionLabel className="mb-3">
                    <CalendarDays className="h-3.5 w-3.5" />
                    {format(selectedDate, "MMMM yyyy", { locale: dateFnsLocale })}
                  </SectionLabel>
                  <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-none -mx-1 px-1">
                    {dates.map((date) => {
                      const isSelected = format(date, "yyyy-MM-dd") === format(selectedDate, "yyyy-MM-dd");
                      return (
                        <button
                          key={date.toISOString()}
                          onClick={() => { setSelectedDate(date); setSelectedTime(""); }}
                          className={cn(
                            "flex flex-col items-center min-w-[60px] py-2.5 px-3 rounded-xl border transition-all",
                            isSelected
                              ? "border-transparent bg-accent text-accent-foreground shadow-[0_4px_12px_-4px_hsl(var(--accent)/0.35)]"
                              : "border-white/60 bg-white/70 text-foreground shadow-[0_4px_12px_-10px_rgba(120,70,30,0.18)]"
                          )}
                        >
                          <span className="text-[10px] font-medium uppercase">{format(date, "EEE", { locale: dateFnsLocale })}</span>
                          <span className="text-lg font-bold">{format(date, "d", { locale: dateFnsLocale })}</span>
                          <span className="text-[10px]">{format(date, "MMM", { locale: dateFnsLocale })}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <SectionLabel className="mb-3">
                    <Clock className="h-3.5 w-3.5" />
                    {t("availableTimes")}
                  </SectionLabel>

                  {isGroupBooking ? (
                    availableGroupSlots.length > 0 ? (
                      <div className="grid grid-cols-3 gap-2">
                        {availableGroupSlots.map((slotInfo) => (
                          <button
                            key={slotInfo.time}
                            onClick={() => !slotInfo.isFull && setSelectedTime(slotInfo.time)}
                            disabled={slotInfo.isFull}
                            className={cn(
                              "py-3 px-1 rounded-2xl text-sm font-semibold transition-all active:scale-95 flex flex-col items-center gap-1 border",
                              selectedTime === slotInfo.time
                                ? "border-transparent bg-accent text-accent-foreground shadow-[0_4px_12px_-4px_hsl(var(--accent)/0.4)]"
                                : slotInfo.isFull
                                ? "border-transparent bg-muted text-muted-foreground opacity-60 cursor-not-allowed"
                                : slotInfo.spotsLeft === 1
                                ? "bg-orange-50 text-orange-700 border-orange-200 hover:bg-orange-100"
                                : "border-white/60 bg-white/70 text-foreground shadow-[0_4px_12px_-10px_rgba(120,70,30,0.18)] hover:bg-white/80"
                            )}
                          >
                            <span>{slotInfo.time}</span>
                            <span className={cn(
                              "text-[9px] leading-none flex items-center gap-1",
                              selectedTime === slotInfo.time ? "text-accent-foreground/80"
                              : slotInfo.isFull ? "text-muted-foreground"
                              : slotInfo.spotsLeft === 1 ? "text-orange-600"
                              : "text-emerald-600"
                            )}>
                              {slotInfo.isFull ? (
                                <>
                                  <span className="w-1.5 h-1.5 rounded-full bg-destructive shrink-0" />
                                  {t("spotsFull")}
                                </>
                              ) : slotInfo.spotsLeft === 1 ? (
                                <>
                                  <span className="w-1.5 h-1.5 rounded-full bg-accent shrink-0" />
                                  {t("lastSpot")}
                                </>
                              ) : (
                                `${slotInfo.spotsLeft} ${t("spotsLeft")}`
                              )}
                            </span>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="glass-card-md rounded-2xl p-8 text-center">
                        <CalendarX className="h-8 w-8 text-muted-foreground/40 mx-auto mb-3" />
                        <p className="text-sm text-muted-foreground">
                          {allGroupSlotsPassed ? t("noSlotsToday") : t("unavailable")}
                        </p>
                      </div>
                    )
                  ) : (
                    availableSlots.length > 0 ? (
                      <div className="grid grid-cols-3 gap-2">
                        {availableSlots.map((slot) => (
                          <button
                            key={slot}
                            onClick={() => setSelectedTime(slot)}
                            className={cn(
                              "py-3 rounded-2xl text-sm font-semibold transition-all active:scale-95 border",
                              selectedTime === slot
                                ? "border-transparent bg-accent text-accent-foreground shadow-[0_4px_12px_-4px_hsl(var(--accent)/0.4)]"
                                : "border-white/60 bg-white/70 text-foreground shadow-[0_4px_12px_-10px_rgba(120,70,30,0.18)] hover:bg-white/80"
                            )}
                          >
                            {slot}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="glass-card-md rounded-2xl p-8 text-center">
                        <CalendarX className="h-8 w-8 text-muted-foreground/40 mx-auto mb-3" />
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
          <motion.div
            key="step3"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={SPRING}
            className="px-5 space-y-3"
          >
            {/* Zone A — Booking hero */}
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...SPRING, delay: 0.08 }}
              className="glass-card rounded-3xl p-6 text-center"
            >
              <p className="text-xs font-semibold text-accent uppercase tracking-widest mb-2">
                {format(parseISO(effectiveDate), "EEEE", { locale: dateFnsLocale })}
              </p>
              <p className="text-3xl font-black tracking-tight mb-1 text-balance">
                {format(parseISO(effectiveDate), "d MMMM", { locale: dateFnsLocale })}
              </p>
              <p className="text-2xl font-bold text-foreground/70" dir="ltr">
                {effectiveTime}
              </p>
            </motion.div>

            {/* Zone B — Service + price summary */}
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...SPRING, delay: 0.14 }}
              className="glass-card rounded-2xl p-5 space-y-3"
            >
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide mb-0.5">{t("provider")}</p>
                <p className="text-sm font-semibold">{provider.name[lang]}</p>
              </div>
              <div className="h-px bg-border/40" />
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1.5">{t("services")}</p>
                {selectedServices.map((s) => (
                  <div key={s.id} className="flex justify-between items-center text-sm py-0.5">
                    <span className="flex items-center gap-1.5 text-foreground/80">
                      {s.service_type === 'group' && <Users className="h-3.5 w-3.5 text-accent" />}
                      {s.name[lang]}
                      <span className="text-muted-foreground text-xs">· {s.duration} {t("min")}</span>
                    </span>
                    {provider.showPrices && s.price > 0 ? <span className="font-medium">₪{s.price}</span> : null}
                  </div>
                ))}
              </div>
              <div className="h-px bg-border/40" />
              <div className="flex items-baseline justify-between pt-0.5">
                <p className="text-xs text-muted-foreground">{t("total")} · {totalDuration} {t("min")}</p>
                {provider.showPrices && total > 0 ? <p className="text-3xl font-black text-accent">₪{total}</p> : null}
              </div>
            </motion.div>

            {/* Group notice */}
            {isGroupBooking && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ ...SPRING, delay: 0.18 }}
                className="surface-soft p-3 rounded-xl flex items-center gap-2 text-sm text-foreground/70"
              >
                <Users className="h-4 w-4 text-accent shrink-0" />
                <span>{t("groupClass")} · {t("maxCapacity")}: {groupMaxCapacity}</span>
              </motion.div>
            )}

            {/* Pay at venue */}
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...SPRING, delay: isGroupBooking ? 0.22 : 0.18 }}
              className="p-4 rounded-xl bg-accent/[0.1] border border-accent/20 backdrop-blur-md text-sm text-foreground/70"
            >
              {t("payAtVenue")}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Bottom bar ── */}
      <div className="fixed bottom-0 left-0 right-0 p-4 bg-white/70 backdrop-blur-xl border-t border-white/40">
        {step === 3 ? (
          /* Step 3: price + provider name on top, full-width confirm below */
          <div>
            <div className="flex items-baseline justify-between mb-3">
              <p className="text-xs text-muted-foreground">{provider.name[lang]}</p>
              {provider.showPrices && total > 0 ? <p className="text-lg font-bold">₪{total}</p> : null}
            </div>
            <button
              onClick={handleConfirm}
              disabled={loading}
              className="w-full rounded-2xl bg-accent text-accent-foreground py-4 text-base font-semibold shadow-[0_8px_24px_-8px_hsl(var(--accent)/0.55)] transition-transform active:scale-[0.98] disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {loading ? (
                <span className="w-4 h-4 rounded-full border-2 border-accent-foreground/30 border-t-accent-foreground animate-spin" />
              ) : t("confirmBooking")}
            </button>
          </div>
        ) : (
          /* Steps 1–2: price left, continue right */
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground">
                {selectedServices.length} {selectedServices.length !== 1 ? t("serviceCount") : t("service")}
              </p>
              {provider.showPrices && total > 0 ? <p className="text-lg font-bold">₪{total}</p> : null}
            </div>
            <button
              disabled={!canProceed}
              onClick={handleNext}
              className={cn(
                "px-8 py-3 rounded-2xl text-sm font-semibold transition-all active:scale-[0.97] bg-accent text-accent-foreground shadow-[0_8px_24px_-8px_hsl(var(--accent)/0.55)]",
                !canProceed && "opacity-40 pointer-events-none shadow-none"
              )}
            >
              {t("continue")}
            </button>
          </div>
        )}
      </div>
      </div>
    </div>
  );
};

export default BookAppointment;
