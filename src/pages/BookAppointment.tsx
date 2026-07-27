import { useParams, useNavigate } from "react-router-dom";
import { useProviderById, useRealAvailability, usePublicProviderSchedule } from "@/hooks/useAllProviders";
import { useProviderActiveStaff } from "@/hooks/useProviderStaff";
import { useProviderSessionsById } from "@/hooks/useProviderSessions";
import { useProviderClassScheduleById, ClassScheduleEntry } from "@/hooks/useProviderClassSchedule";
import type { Service } from "@/lib/mock-data";
import { Check, Clock, CalendarDays, Users, Calendar, CalendarX, Lock, Sparkles, Dumbbell, CalendarCheck, StickyNote, UserRound } from "lucide-react";
import { BackArrow, ForwardArrow } from "@/components/ui/directional-icon";
import { SectionLabel } from "@/components/ui/SectionLabel";
import { BookingMonthCalendar } from "@/components/booking/BookingMonthCalendar";
import { Fragment, useState, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import { format, parseISO, addDays, getDay } from "date-fns";
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
import { useQuery, useQueryClient } from "@tanstack/react-query";

const SPRING = { duration: 0.5, ease: [0.16, 1, 0.3, 1] } as const;

// Returns up to `weeksAhead` upcoming dates (from today) whose day-of-week matches.
//
// `excludeDates` holds LOCAL "yyyy-MM-dd" strings (provider_blocked_dates) that must
// never be offered. A skipped date does NOT consume one of the `weeksAhead` slots —
// the walk keeps going and pulls the next matching date in. That matters for the
// step-1 "next occurrence" card, which asks for weeksAhead=1: filtering AFTER
// generation would leave it with zero dates instead of the next non-blocked one.
function getUpcomingDates(dayOfWeek: number, weeksAhead = 6, windowDays = 90, excludeDates?: Set<string>): Date[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const results: Date[] = [];
  for (let i = 0; i <= windowDays; i++) {
    const d = addDays(today, i);
    if (getDay(d) === dayOfWeek && results.length < weeksAhead) {
      if (!excludeDates?.has(format(d, "yyyy-MM-dd"))) results.push(d);
    }
    if (results.length >= weeksAhead) break;
  }
  return results;
}

const BookAppointment = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { lang, t } = useLang();
  const { user, isProvider } = useAuth();
  const queryClient = useQueryClient();
  const { provider, isLoading: providerLoading } = useProviderById(id);
  // Multi-staff (Phase 4): the chosen staff member narrows availability. Only
  // ever set from the staff step (which only renders for staff-enabled
  // providers + private services), so for everyone else this stays "" and
  // useRealAvailability behaves exactly as before. The staff list query itself
  // is gated on provider.staffEnabled — non-staff providers never fire it.
  const [selectedStaffId, setSelectedStaffId] = useState<string>("");
  const { activeStaff, isLoading: staffLoading } = useProviderActiveStaff(id, provider?.staffEnabled === true);
  const { getAvailableSlots, getGroupSlotsWithCapacity } = useRealAvailability(id, selectedStaffId || undefined);
  const { data: allSessions = [], isLoading: sessionsLoading } = useProviderSessionsById(id);
  const { data: classSchedule = [], isLoading: scheduleLoading } = useProviderClassScheduleById(id);
  // Blocked dates for the FITNESS class path. The class flow builds its dates from
  // provider_class_schedule.day_of_week alone (getUpcomingDates) and never goes
  // through resolveDayHours, so provider_blocked_dates was never consulted and a
  // blocked date stayed bookable. usePublicProviderSchedule reuses the EXACT query
  // keys useRealAvailability already mounts on the line above, so React Query
  // dedupes it — no extra round-trip. ONLY `blockedDates` is read: weekly
  // availability and monthly overrides are deliberately NOT applied to classes here.
  const { blockedDates } = usePublicProviderSchedule(id);
  // PostgREST returns a `date` column as a plain "YYYY-MM-DD" string, which is the
  // same local-calendar format format(d, "yyyy-MM-dd") / toLocalDateStr produce and
  // the same strings resolveDayHours compares against on the private/group paths.
  const blockedDateSet = new Set(blockedDates);

  const dateFnsLocale = lang === "he" ? he : lang === "ar" ? ar : enUS;

  const isFitnessStudio = provider?.category === "fitness_studio";

  // ── Standard flow state ──
  // Standard (non-fitness) flow is 4 steps: services → day (month calendar) →
  // time → confirm. The fitness flow keeps its 3 steps (confirm at 3).
  // Standard flow grows to 5 steps when the selected service collects a customer
  // note (services → day → time → notes → confirm), and by one more when the
  // provider is staff-enabled (services → staff → day → time → [notes] →
  // confirm, max 6). Step numbers are derived below (calendarStep/timeStep/…).
  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5 | 6>(1);
  const [selectedServices, setSelectedServices] = useState<Service[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string>("");
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [selectedTime, setSelectedTime] = useState<string>("");
  const [customerNotes, setCustomerNotes] = useState<string>("");
  // Step-2 calendar UI state: displayed month + whether the customer actively
  // tapped a day (selectedDate defaults to today, so it can't signal that alone).
  const [calMonth, setCalMonth] = useState<Date>(() => new Date());
  const [dateChosen, setDateChosen] = useState(false);

  // ── Fitness-studio flow state ──
  const [selectedClass, setSelectedClass] = useState<ClassScheduleEntry | null>(null);
  const [selectedOccurrence, setSelectedOccurrence] = useState<Date | null>(null);

  const [loading, setLoading] = useState(false);

  const [now, setNow] = useState<Date>(() => new Date());
  useEffect(() => {
    const timerId = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timerId);
  }, []);

  // The page div (not the window) is the scroll container, so its scrollTop
  // survives step changes — reset it so every step opens at the top.
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [step]);

  // Derive occurrence dates here (before early returns) so hooks are never conditional.
  // blockedDateSet removes dates the provider blocked — see getUpcomingDates.
  const _occurrenceDates = selectedClass
    ? getUpcomingDates(selectedClass.day_of_week, 6, provider?.bookingWindowDays ?? 42, blockedDateSet)
    : [];
  const _occurrenceDateStrs = _occurrenceDates.map((d) => format(d, "yyyy-MM-dd"));

  // Uses SECURITY DEFINER RPC to bypass RLS — direct table queries only return
  // the current user's rows, causing spots to always display as max capacity.
  const { data: classBookingCounts = {} } = useQuery({
    queryKey: ["class-booking-counts", selectedClass?.id, _occurrenceDateStrs],
    queryFn: async () => {
      if (!selectedClass || !_occurrenceDateStrs.length) return {} as Record<string, number>;
      const { data, error } = await supabase.rpc("get_class_booking_counts", {
        p_class_ids: [selectedClass.id],
        p_dates: _occurrenceDateStrs,
      });
      if (error) return {} as Record<string, number>;
      const counts: Record<string, number> = {};
      (data || []).forEach((row: { class_schedule_id: string; booking_date: string; booked_count: number }) => {
        counts[row.booking_date] = row.booked_count;
      });
      return counts;
    },
    enabled: !!selectedClass && _occurrenceDateStrs.length > 0,
  });

  // Step 1: live booking counts for the next upcoming occurrence of each class.
  // blockedDateSet makes this the next NON-blocked occurrence.
  const _nextOccMap: Record<string, string> = {};
  if (isFitnessStudio) {
    classSchedule.forEach(cls => {
      const next = getUpcomingDates(cls.day_of_week, 1, provider?.bookingWindowDays ?? 14, blockedDateSet)[0];
      if (next) _nextOccMap[cls.id] = format(next, "yyyy-MM-dd");
    });
  }
  const _nextOccClassIds = Object.keys(_nextOccMap);

  const { data: classNextBookingCounts = {} } = useQuery<Record<string, number>>({
    queryKey: ["class-next-booking-counts", _nextOccClassIds],
    queryFn: async () => {
      if (!_nextOccClassIds.length) return {};
      const dates = [...new Set(Object.values(_nextOccMap))];
      const { data, error } = await supabase.rpc("get_class_booking_counts", {
        p_class_ids: _nextOccClassIds,
        p_dates: dates,
      });
      if (error) return {};
      const counts: Record<string, number> = {};
      (data || []).forEach((row: { class_schedule_id: string; booking_date: string; booked_count: number }) => {
        if (_nextOccMap[row.class_schedule_id] === row.booking_date) {
          counts[row.class_schedule_id] = row.booked_count;
        }
      });
      return counts;
    },
    enabled: _nextOccClassIds.length > 0,
    staleTime: 30_000,
  });

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

  if (providerLoading || sessionsLoading || (isFitnessStudio && scheduleLoading)) {
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

  // ── Standard flow helpers ──
  const toggleService = (service: Service) => {
    setSelectedServices((prev) =>
      prev.find((s) => s.id === service.id) ? [] : [service]
    );
    setSelectedSessionId("");
    setSelectedTime("");
    setCustomerNotes("");
    // Day availability depends on the service (duration/capacity), so a service
    // change sends the customer back through the calendar. The staff choice is
    // reset too: whether the staff step even exists depends on the service
    // (private vs group vs session-based).
    setSelectedStaffId("");
    setDateChosen(false);
  };

  const total = selectedServices.reduce((sum, s) => sum + s.price, 0);
  const totalDuration = selectedServices.reduce((sum, s) => sum + s.duration, 0);

  const primaryService = selectedServices[0];
  // The optional notes step only exists in the standard flow, and only when the
  // chosen service opted in. When active it sits between time and confirm.
  const notesEnabled = !isFitnessStudio && !!primaryService?.customer_notes_enabled;
  const notesPlaceholder =
    primaryService?.customer_notes_placeholder || "הוסף הערות לשירות...";
  const isGroupBooking = primaryService?.service_type === "group";
  const groupMaxCapacity = primaryService?.max_capacity ?? 1;

  const serviceSessions = primaryService
    ? allSessions.filter((s) => s.service_id === primaryService.id)
    : [];
  const hasScheduledSessions = serviceSessions.length > 0;
  const selectedSession = allSessions.find((s) => s.id === selectedSessionId);

  // ── Multi-staff step (Phase 4) ──
  // The "choose staff member" step exists ONLY when ALL of: standard flow,
  // provider opted in, the chosen service is PRIVATE (group capacity is pooled
  // shop-wide — matches the trigger's staff-blind group branch), the service is
  // not session-based (a session is a fixed one-off event, not a per-staff
  // slot), and the provider has at least one ACTIVE staff member. Zero active
  // staff → the step is skipped gracefully and the booking inserts staff_id
  // NULL, exactly like a non-staff provider — never dead-end the customer.
  const staffStepEnabled =
    !isFitnessStudio &&
    provider.staffEnabled &&
    !!primaryService &&
    !isGroupBooking &&
    !hasScheduledSessions &&
    activeStaff.length > 0;
  const selectedStaff = activeStaff.find((s) => s.id === selectedStaffId);

  // Standard-flow step numbers. Without the staff step these collapse to
  // exactly the pre-staff values (calendar 2, time 3, notes 4, confirm 4/5) —
  // non-staff providers keep today's flow untouched. With it, everything after
  // service selection shifts by one (staff 2, calendar 3, time 4, confirm 5/6).
  const calendarStep = staffStepEnabled ? 3 : 2;
  const timeStep = staffStepEnabled ? 4 : 3;
  const notesStep = timeStep + 1; // only reachable when notesEnabled
  const standardConfirmStep = (notesEnabled ? notesStep + 1 : timeStep + 1) as 4 | 5 | 6;

  const minLeadTimeMinutes = provider.minLeadTimeMinutes;
  const isToday =
    selectedDate.getFullYear() === now.getFullYear() &&
    selectedDate.getMonth() === now.getMonth() &&
    selectedDate.getDate() === now.getDate();
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

  // ── Step-2 month calendar (UI only — same availability source as before) ──
  // The calendar's selectable range is IDENTICAL to the old horizontal strip:
  // today .. today + bookingWindowDays - 1.
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const bookingWindowEnd = addDays(todayStart, (provider.bookingWindowDays ?? 14) - 1);

  const slotMins = (s: string) => {
    const [h, m] = s.split(":").map(Number);
    return h * 60 + m;
  };
  const isSameDayAsNow = (d: Date) =>
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();

  // A day is tappable iff the EXISTING slot pipeline (getAvailableSlots /
  // getGroupSlotsWithCapacity, plus the same today-only lead-time filter the
  // time chips apply) yields at least one selectable slot for it. This is
  // presentation only: the calendar greys out exactly the days whose time step
  // would have been empty.
  const dayHasAvailability = (date: Date): boolean => {
    if (isGroupBooking) {
      const open = getGroupSlotsWithCapacity(date, groupMaxCapacity).filter((s) => !s.isFull);
      const usable = isSameDayAsNow(date) ? open.filter((s) => slotMins(s.time) > leadTimeCutoff) : open;
      return usable.length > 0;
    }
    const raw = getAvailableSlots(date, totalDuration || 15, primaryService?.max_capacity ?? 1, primaryService?.id, primaryService?.latest_start_time);
    const usable = isSameDayAsNow(date) ? raw.filter((s) => slotMins(s) > leadTimeCutoff) : raw;
    return usable.length > 0;
  };

  const effectiveDate = selectedSession
    ? selectedSession.session_date
    : format(selectedDate, "yyyy-MM-dd");
  const effectiveTime = selectedSession
    ? selectedSession.session_time.slice(0, 5)
    : selectedTime;

  // ── Fitness-studio flow helpers ──
  const fitnessEffectiveDate = selectedOccurrence ? format(selectedOccurrence, "yyyy-MM-dd") : "";
  const fitnessEffectiveTime = selectedClass ? selectedClass.start_time.slice(0, 5) : "";

  // Group classes by day_of_week for the schedule grid
  const scheduleByDay = classSchedule.reduce((acc, cls) => {
    const day = cls.day_of_week;
    if (!acc[day]) acc[day] = [];
    acc[day].push(cls);
    return acc;
  }, {} as Record<number, ClassScheduleEntry[]>);

  // occurrenceDates / classBookingCounts are computed above the early returns (hooks order)
  const occurrenceDates = _occurrenceDates;
  const occurrenceDateStrs = _occurrenceDateStrs;

  // Standard flow canProceed / handleNext, expressed in the DERIVED step
  // numbers so the same code drives both variants (with/without the staff
  // step). When the service has scheduled sessions, the session card IS
  // date+time, so the time step is skipped (2 → 4), exactly as before —
  // session services never have a staff step, so their numbering is unshifted.
  const canProceed =
    // While a staff-enabled provider's staff list is still loading we don't yet
    // know whether the staff step exists — hold the continue button for that
    // (tiny) window instead of guessing. Non-staff providers never hit this.
    (step === 1 && selectedServices.length > 0 && !(provider.staffEnabled && staffLoading)) ||
    (staffStepEnabled && step === 2 && !!selectedStaffId) ||
    (step === calendarStep && (hasScheduledSessions ? !!selectedSessionId : dateChosen)) ||
    (step === timeStep && !!selectedTime) ||
    // Notes step (only reachable when notesEnabled) — always proceedable since
    // the note is optional. Confirm steps show a confirm button, not "continue".
    (notesEnabled && step === notesStep) ||
    step === standardConfirmStep;

  const handleNext = () => {
    if (step === 1 && selectedServices.length > 0) {
      setStep(2); // staff step when enabled, else calendar — both are step 2
    } else if (staffStepEnabled && step === 2) {
      if (selectedStaffId) setStep(3);
    } else if (step === calendarStep) {
      // Session-based services fold date+time into the session card, so they
      // jump past the time step to step 4 (notes when enabled, else confirm).
      if (hasScheduledSessions && selectedSessionId) setStep(4);
      else if (dateChosen) setStep(timeStep as 3 | 4);
    } else if (step === timeStep && selectedTime) {
      // Time → notes when enabled, otherwise confirm — both are the next step.
      setStep((timeStep + 1) as 4 | 5);
    } else if (notesEnabled && step === notesStep) {
      setStep(standardConfirmStep); // notes → confirm
    }
  };

  const handleBack = () => {
    if (step === 1) {
      navigate(-1);
      return;
    }
    // Session-based services skip the time step, so stepping back from the
    // screen that immediately follows the session list (step 4 — notes or
    // confirm) returns to the session list rather than the empty time step.
    // (Session services never have a staff step, so these are literal numbers.)
    if (!isFitnessStudio && hasScheduledSessions && step === 4) {
      setStep(2);
      return;
    }
    setStep((s) => (s - 1) as 1 | 2 | 3 | 4 | 5 | 6);
  };

  // Fitness flow canProceed / handleNext
  const fitnessStep1Done = !!selectedClass;
  const fitnessStep2Done = !!selectedOccurrence;
  const fitnessCanProceed =
    (step === 1 && fitnessStep1Done) ||
    (step === 2 && fitnessStep2Done) ||
    step === 3;

  const fitnessHandleNext = () => {
    if (step === 1 && fitnessStep1Done) setStep(2);
    else if (step === 2 && fitnessStep2Done) setStep(3);
  };

  const handleConfirm = async () => {
    const bookDate = isFitnessStudio ? fitnessEffectiveDate : effectiveDate;
    const bookTime = isFitnessStudio ? fitnessEffectiveTime : effectiveTime;
    // For fitness studio, we don't require a service to be selected — the class IS the booking unit
    const validation = isFitnessStudio
      ? z.object({ date: z.string().min(1), time: z.string().regex(/^\d{2}:\d{2}$/) }).safeParse({ date: bookDate, time: bookTime })
      : bookingSchema.safeParse({ services: selectedServices, date: bookDate, time: bookTime });

    if (!validation.success) {
      toast.error("בחר שיעור ותאריך");
      return;
    }

    const requiresApproval = provider.requiresBookingApproval;
    const insertedStatus: "pending" | "confirmed" = requiresApproval ? "pending" : "confirmed";

    // DEBUG
    console.log("DEBUG: provider.requiresBookingApproval =", provider.requiresBookingApproval);
    console.log("DEBUG: typeof =", typeof provider.requiresBookingApproval);
    console.log("DEBUG: full provider object =", provider);
    console.log("DEBUG: computed insertedStatus =", insertedStatus);

    if (user) {
      setLoading(true);

      // Build insert payload
      const insertPayload: Record<string, unknown> = {
        user_id: user.id,
        provider_id: provider.id,
        booking_date: bookDate,
        booking_time: bookTime,
        status: insertedStatus,
      };

      if (isFitnessStudio && selectedClass) {
        insertPayload.class_schedule_id = selectedClass.id;
        insertPayload.service_ids = [];
        insertPayload.total_price = 0;
      } else {
        insertPayload.service_ids = selectedServices.map((s) => s.id);
        insertPayload.total_price = total;
        // Persist the optional customer note (only ever collected in the standard
        // flow when the service opted in). Empty / whitespace-only → null.
        if (notesEnabled) {
          insertPayload.customer_notes = customerNotes.trim() || null;
        }
        // Multi-staff: only when the staff step was part of THIS flow. Group,
        // session-based, zero-active-staff, and non-staff providers all omit
        // the column → staff_id NULL, identical to pre-staff bookings.
        if (staffStepEnabled && selectedStaffId) {
          insertPayload.staff_id = selectedStaffId;
        }
      }

      const { error } = await supabase.from("bookings").insert(insertPayload);
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
          queryClient.invalidateQueries({ queryKey: ["class-booking-counts"] });
          queryClient.invalidateQueries({ queryKey: ["class-next-booking-counts"] });
        } else if (error.message === "DUPLICATE_USER_BOOKING") {
          toast.error(t("duplicateUserBookingError"));
        } else {
          toast.error(error.message);
        }
        return;
      }

      const [{ data: customerProfile }, { data: providerProfile }] = await Promise.all([
        supabase.from("profiles").select("display_name").eq("user_id", user.id).single(),
        supabase.from("provider_profiles").select("user_id").eq("id", provider.id).single(),
      ]);
      const customerName = customerProfile?.display_name || "לקוח";
      const serviceName = isFitnessStudio
        ? (selectedClass?.class_name ?? "")
        : (selectedServices[0]?.name[lang] || "");
      const dateStr = format(parseISO(bookDate), "dd/MM");

      const customerNotif = requiresApproval
        ? {
            user_id: user.id,
            title: "בקשת תור נשלחה ⏳",
            body: `הבקשה ל-${provider.name[lang]} ב-${dateStr} בשעה ${bookTime} ממתינה לאישור`,
            url: "/bookings",
            type: "booking_pending",
          }
        : {
            user_id: user.id,
            title: "התור שלך אושר! 📅",
            body: `התור ב-${provider.name[lang]} ב-${dateStr} בשעה ${bookTime} אושר`,
            url: "/bookings",
            type: "booking_confirmed",
          };

      const providerNotifTitle = requiresApproval ? t("newBookingRequest") : "תור חדש 📅";
      const providerNotifBody = requiresApproval
        ? `${customerName} ביקש תור ל-${serviceName} בתאריך ${dateStr} בשעה ${bookTime}`
        : `${customerName} קבע תור ל-${serviceName} בתאריך ${dateStr} בשעה ${bookTime}`;

      await supabase.from("notifications").insert(customerNotif);
      queryClient.invalidateQueries({ queryKey: ["unread-notifications"] });
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      queryClient.invalidateQueries({ queryKey: ["class-booking-counts"] });
      queryClient.invalidateQueries({ queryKey: ["class-next-booking-counts"] });

      const { error: pushError } = await supabase.functions.invoke("send-push", {
        body: {
          provider_id: provider.id,
          title: providerNotifTitle,
          body: providerNotifBody,
          url: "/calendar",
          type: "booking_new",
        },
      });

      if (pushError) {
        console.warn("send-push invoke failed:", pushError.message);
      }

      // send-push is delivery-only — the provider's in-app row is written here
      // unconditionally, whether or not the push itself was delivered.
      if (providerProfile?.user_id) {
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
        services: isFitnessStudio
          ? [selectedClass?.class_name ?? ""]
          : selectedServices.map((s) => s.name[lang]),
        date: format(parseISO(bookDate), "EEE, MMM d", { locale: dateFnsLocale }),
        time: bookTime,
        total: isFitnessStudio ? 0 : total,
        showPrices: isFitnessStudio ? false : provider.showPrices,
        isGroup: isFitnessStudio ? selectedClass?.class_type === "group" : isGroupBooking,
        participantCount: 1,
        status: insertedStatus,
      },
    });
  };

  // ── Fitness-studio step labels ──
  const fitnessStepLabels = [t("pickClass"), t("selectOccurrence"), t("confirm")];
  // ── Standard step labels ── assembled from the same conditions that shape
  // the step machine: the staff step slides in after services, the notes step
  // before confirm. Without either, this is exactly the original 4-step list.
  const stepLabels = [
    t("selectServices"),
    ...(staffStepEnabled ? [t("pickStaff")] : []),
    t("selectDate"),
    t("pickTime"),
    ...(notesEnabled ? [t("customerNotes")] : []),
    t("confirm"),
  ];

  // Derived labels for current mode
  const activeStepLabels = isFitnessStudio ? fitnessStepLabels : stepLabels;
  const activeStepIcons = isFitnessStudio
    ? [Dumbbell, CalendarDays, Check]
    : [
        Sparkles,
        ...(staffStepEnabled ? [UserRound] : []),
        CalendarDays,
        Clock,
        ...(notesEnabled ? [StickyNote] : []),
        Check,
      ];
  const activeCanProceed = isFitnessStudio ? fitnessCanProceed : canProceed;
  const activeHandleNext = isFitnessStudio ? fitnessHandleNext : handleNext;

  const DAY_KEYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;

  return (
    <div
      // h-[100dvh] + overflow-y-auto makes THIS div the scroll container, so the
      // sticky header sticks to it. Window-level sticky is broken here by the
      // global `html, body { overflow-x: hidden }` WebView backstop in index.css
      // (it turns body into the nearest scrollport, which never scrolls itself).
      ref={scrollRef}
      className="relative h-[100dvh] overflow-y-auto overflow-x-clip pb-32"
      style={{ background: "var(--bg-atmosphere)" }}
    >
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
        {/* ── Sticky header + step indicator — stays visible while scrolling.
            Background reproduces the TOP SLICE of --bg-atmosphere (0% stop
            hsl(24 90% 94%) → interpolated ~21% point), so the pinned header is
            indistinguishable from the unpinned page background. The ::after
            strip fades scrolled content out softly just below it. ── */}
        <div className="sticky top-0 z-40 mb-6 bg-gradient-to-b from-[hsl(24_90%_94%)] to-[hsl(34_54%_95%)] after:pointer-events-none after:absolute after:inset-x-0 after:top-full after:h-5 after:bg-gradient-to-b after:from-[hsl(34_54%_95%)] after:to-transparent">
        <header className="px-5 pt-10 pb-4">
          <div className="flex items-center gap-3">
            <button
              onClick={handleBack}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-white/85 shadow-[0_4px_16px_rgba(0,0,0,0.08)] ring-1 ring-white/40 backdrop-blur-md transition-transform active:scale-95 shrink-0"
            >
              <BackArrow variant="arrow" className="h-5 w-5" />
            </button>
            <h1 className="text-lg font-bold">{t("bookAt")} {provider.name[lang]}</h1>
          </div>
        </header>

        {/* ── Step indicator — icon nodes joined by connector lines ── */}
        <div className="px-5 pb-4">
          <div className="flex items-center">
            {activeStepLabels.map((label, i) => {
              const s = i + 1;
              const Icon = activeStepIcons[i];
              const isDone = s < step;
              const isCurrent = s === step;
              return (
                <Fragment key={`${label}-${i}`}>
                  {i > 0 && (
                    <div
                      className={cn(
                        "mx-1.5 h-1 flex-1 rounded-full transition-colors duration-300",
                        s <= step ? "bg-accent" : "bg-border"
                      )}
                    />
                  )}
                  <div
                    aria-current={isCurrent ? "step" : undefined}
                    className={cn(
                      "flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-all duration-300",
                      isCurrent
                        ? "scale-110 bg-accent text-accent-foreground shadow-[0_4px_12px_-4px_hsl(var(--accent)/0.5)] ring-4 ring-accent/15"
                        : isDone
                        ? "bg-accent text-accent-foreground"
                        : "bg-white/80 text-muted-foreground/50 ring-1 ring-border"
                    )}
                  >
                    {isDone ? <Check className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
                  </div>
                </Fragment>
              );
            })}
          </div>
          <p className="mt-2.5 text-xs font-semibold text-accent text-end">
            {activeStepLabels[step - 1]}
          </p>
        </div>
        </div>

        <AnimatePresence mode="wait">

          {/* ═══════════════════════════════════════════════
              FITNESS STUDIO FLOW
              ═══════════════════════════════════════════════ */}
          {isFitnessStudio && step === 1 && (
            <motion.div
              key="fs-step1"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={SPRING}
              className="px-5"
            >
              {classSchedule.length === 0 ? (
                <div className="glass-card-md rounded-2xl p-8 text-center">
                  <CalendarX className="h-8 w-8 text-muted-foreground/40 mx-auto mb-3" />
                  <p className="text-sm font-semibold mb-1">{t("classScheduleEmpty")}</p>
                  <p className="text-xs text-muted-foreground">{t("classScheduleEmptyHelp")}</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {DAY_KEYS.map((dayKey, dayIdx) => {
                    const dayClasses = scheduleByDay[dayIdx] || [];
                    if (dayClasses.length === 0) return null;
                    return (
                      <div key={dayKey}>
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 px-1">
                          {t(dayKey)}
                        </p>
                        <div className="flex flex-col gap-2">
                          {dayClasses.map((cls, i) => {
                            const isSelected = selectedClass?.id === cls.id;
                            const isGroup = cls.class_type === "group";
                            const nextBooked = classNextBookingCounts[cls.id] ?? 0;
                            const nextSpotsLeft = cls.max_capacity - nextBooked;
                            const nextIsFull = isGroup && nextSpotsLeft <= 0;
                            return (
                              <motion.button
                                key={cls.id}
                                initial={{ opacity: 0, y: 8 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ ...SPRING, delay: i * 0.05 }}
                                onClick={() => {
                                  setSelectedClass(cls);
                                  setSelectedOccurrence(null);
                                }}
                                className={cn(
                                  "flex items-center justify-between p-4 rounded-2xl border transition-all active:scale-[0.98]",
                                  isSelected
                                    ? "border-accent bg-accent/10 ring-2 ring-accent/20 shadow-sm"
                                    : "border-white/60 bg-white/70 shadow-[0_6px_16px_-10px_rgba(120,70,30,0.15)] hover:border-accent/30"
                                )}
                              >
                                <div className="text-right flex-1 min-w-0">
                                  <div className="flex items-center gap-2 flex-wrap mb-1">
                                    <p className="text-sm font-semibold">{cls.class_name}</p>
                                    <span className={cn(
                                      "inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full font-semibold shrink-0",
                                      isGroup ? "bg-accent/10 text-accent" : "bg-secondary text-muted-foreground"
                                    )}>
                                      {isGroup ? <Users className="h-2.5 w-2.5" /> : <Lock className="h-2.5 w-2.5" />}
                                      {isGroup ? t("groupClass") : t("privateService")}
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-[11px] text-muted-foreground">
                                      <Clock className="h-3 w-3" />
                                      {cls.start_time.slice(0, 5)} · {cls.duration_minutes} {t("min")}
                                    </span>
                                    {isGroup && (
                                      <span className={cn(
                                        "inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full font-semibold shrink-0",
                                        nextIsFull ? "bg-red-100 text-red-600"
                                        : nextSpotsLeft === 1 ? "bg-orange-100 text-orange-600"
                                        : "bg-secondary text-muted-foreground"
                                      )}>
                                        <Users className="h-2.5 w-2.5" />
                                        {nextIsFull
                                          ? t("classFull")
                                          : nextSpotsLeft === 1
                                          ? t("lastSpot")
                                          : `${nextSpotsLeft}/${cls.max_capacity} ${t("spotsLeft")}`}
                                      </span>
                                    )}
                                  </div>
                                </div>
                                {isSelected && (
                                  <div className="w-5 h-5 rounded-full bg-accent flex items-center justify-center shrink-0 ms-3">
                                    <Check className="h-3 w-3 text-accent-foreground" />
                                  </div>
                                )}
                              </motion.button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </motion.div>
          )}

          {isFitnessStudio && step === 2 && selectedClass && (
            <motion.div
              key="fs-step2"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={SPRING}
              className="px-5"
            >
              <SectionLabel className="mb-4">
                <CalendarDays className="h-3.5 w-3.5" />
                {t("selectOccurrence")}
              </SectionLabel>
              <p className="text-sm font-semibold mb-3">{selectedClass.class_name} · {selectedClass.start_time.slice(0, 5)}</p>

              {occurrenceDates.length === 0 ? (
                <div className="glass-card-md rounded-2xl p-8 text-center">
                  <CalendarX className="h-8 w-8 text-muted-foreground/40 mx-auto mb-3" />
                  <p className="text-sm text-muted-foreground">{t("unavailable")}</p>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {occurrenceDates.map((date) => {
                    const dateStr = format(date, "yyyy-MM-dd");
                    const isSelected =
                      selectedOccurrence !== null &&
                      dateStr === format(selectedOccurrence, "yyyy-MM-dd");
                    const [classH, classM] = selectedClass.start_time.split(":").map(Number);
                    const classDateTime = new Date(date);
                    classDateTime.setHours(classH, classM, 0, 0);
                    const isPast = classDateTime < new Date(now.getTime() + minLeadTimeMinutes * 60 * 1000);
                    if (isPast) return null;
                    const bookedCount = classBookingCounts[dateStr] || 0;
                    const spotsLeft = selectedClass.max_capacity - bookedCount;
                    const isFull = spotsLeft <= 0;
                    const isGroup = selectedClass.class_type === "group";
                    return (
                      <button
                        key={date.toISOString()}
                        onClick={() => !isFull && setSelectedOccurrence(date)}
                        disabled={isFull}
                        className={cn(
                          "flex items-center justify-between p-4 rounded-2xl border transition-all active:scale-[0.98]",
                          isSelected
                            ? "border-accent bg-accent/10 ring-2 ring-accent/20 shadow-sm"
                            : isFull
                            ? "border-border/40 bg-muted/60 opacity-60 cursor-not-allowed"
                            : "border-white/60 bg-white/70 shadow-[0_6px_16px_-10px_rgba(120,70,30,0.15)] hover:border-accent/30"
                        )}
                      >
                        <div className="flex items-center gap-3">
                          <div className={cn(
                            "w-12 h-12 rounded-xl flex flex-col items-center justify-center text-xs font-bold shrink-0",
                            isSelected ? "bg-accent text-accent-foreground" : isFull ? "bg-muted text-muted-foreground" : "bg-secondary text-foreground"
                          )}>
                            <span className="text-[10px] uppercase">{format(date, "EEE", { locale: dateFnsLocale })}</span>
                            <span className="text-lg leading-none">{format(date, "d")}</span>
                            <span className="text-[10px]">{format(date, "MMM", { locale: dateFnsLocale })}</span>
                          </div>
                          <div className="text-right">
                            <p className="text-sm font-semibold">{format(date, "dd/MM/yyyy")}</p>
                            <p className="text-xs text-muted-foreground flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              {selectedClass.start_time.slice(0, 5)} · {selectedClass.duration_minutes} {t("min")}
                            </p>
                            {isGroup && (
                              <p className={cn(
                                "text-[11px] font-semibold mt-0.5 flex items-center gap-1",
                                isFull ? "text-red-500"
                                : spotsLeft === 1 ? "text-orange-500"
                                : "text-emerald-600"
                              )}>
                                <span className={cn(
                                  "w-1.5 h-1.5 rounded-full shrink-0",
                                  isFull ? "bg-red-500" : spotsLeft === 1 ? "bg-orange-400" : "bg-emerald-500"
                                )} />
                                {isFull
                                  ? t("classFull")
                                  : spotsLeft === 1
                                  ? t("lastSpot")
                                  : `${spotsLeft} ${t("spotsLeft")}`}
                              </p>
                            )}
                          </div>
                        </div>
                        {isSelected && !isFull && (
                          <div className="w-5 h-5 rounded-full bg-accent flex items-center justify-center shrink-0">
                            <Check className="h-3 w-3 text-accent-foreground" />
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </motion.div>
          )}

          {isFitnessStudio && step === 3 && (
            <motion.div
              key="fs-step3"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={SPRING}
              className="px-5 space-y-3"
            >
              {/* Hero */}
              <motion.div
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ ...SPRING, delay: 0.08 }}
                className="glass-card rounded-3xl p-6 text-center"
              >
                <p className="text-xs font-semibold text-accent uppercase tracking-widest mb-2">
                  {format(parseISO(fitnessEffectiveDate), "EEEE", { locale: dateFnsLocale })}
                </p>
                <p className="text-3xl font-black tracking-tight mb-1 text-balance">
                  {format(parseISO(fitnessEffectiveDate), "d MMMM", { locale: dateFnsLocale })}
                </p>
                <p className="text-2xl font-bold text-foreground/70" dir="ltr">
                  {fitnessEffectiveTime}
                </p>
              </motion.div>

              {/* Summary */}
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
                  <div className="flex items-center gap-1.5 text-sm">
                    {selectedClass?.class_type === "group"
                      ? <Users className="h-3.5 w-3.5 text-accent" />
                      : <Lock className="h-3.5 w-3.5 text-muted-foreground" />}
                    <span>{selectedClass?.class_name}</span>
                    <span className="text-muted-foreground text-xs">· {selectedClass?.duration_minutes} {t("min")}</span>
                  </div>
                </div>
                {selectedClass?.class_type === "group" && (
                  <>
                    <div className="h-px bg-border/40" />
                    <div className="flex items-center gap-2 text-sm text-foreground/70">
                      <Users className="h-4 w-4 text-accent shrink-0" />
                      <span>{t("groupClass")} · {t("maxCapacity")}: {selectedClass.max_capacity}</span>
                    </div>
                  </>
                )}
              </motion.div>

              {/* Pay at venue */}
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ ...SPRING, delay: 0.18 }}
                className="p-4 rounded-xl bg-accent/[0.1] border border-accent/20 backdrop-blur-md text-sm text-foreground/70"
              >
                {t("payAtVenue")}
              </motion.div>
            </motion.div>
          )}

          {/* ═══════════════════════════════════════════════
              STANDARD FLOW (non-fitness_studio)
              ═══════════════════════════════════════════════ */}
          {!isFitnessStudio && step === 1 && (
            <motion.div
              key="step1"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={SPRING}
              className="px-5"
            >
              <div className="flex flex-col gap-3">
                {provider.services.map((service, i) => {
                  const isSelected = !!selectedServices.find((s) => s.id === service.id);
                  const isGroup = service.service_type === "group";
                  const sessionCount = allSessions.filter((s) => s.service_id === service.id).length;

                  return (
                    <motion.button
                      key={service.id}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ ...SPRING, delay: i * 0.06 }}
                      onClick={() => toggleService(service)}
                      className={cn(
                        "flex w-full items-center gap-3.5 rounded-3xl border p-4 text-start transition-all active:scale-[0.98]",
                        isSelected
                          ? "border-accent/60 bg-accent/[0.08] ring-2 ring-accent/25 shadow-[0_10px_28px_-14px_hsl(var(--accent)/0.45)]"
                          : "border-white/60 bg-white/70 shadow-[0_6px_16px_-10px_rgba(120,70,30,0.15)] backdrop-blur-md hover:border-accent/30"
                      )}
                    >
                      {/* Icon tile */}
                      <div
                        className={cn(
                          "flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl transition-colors duration-300",
                          isSelected ? "bg-accent text-accent-foreground shadow-[0_4px_12px_-4px_hsl(var(--accent)/0.5)]" : "bg-accent/10 text-accent"
                        )}
                      >
                        {isGroup ? <Users className="h-5 w-5" /> : <Sparkles className="h-5 w-5" />}
                      </div>

                      {/* Details */}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-[15px] font-bold leading-tight">{service.name[lang]}</p>
                          {isGroup && (
                            <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-accent/10 text-accent font-semibold">
                              <Users className="h-2.5 w-2.5" /> {t("groupClass")}
                            </span>
                          )}
                        </div>
                        {service.latest_start_time && (
                          <p className="mt-0.5 text-[11px] text-orange-600 font-medium">
                            {t("availableUntil").replace("{time}", service.latest_start_time.slice(0, 5))}
                          </p>
                        )}
                        <div className="mt-1.5 flex items-center gap-2 flex-wrap">
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
                            <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-[10px] text-muted-foreground">
                              <Users className="h-2.5 w-2.5" />
                              {t("maxCapacity")}: {service.max_capacity}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Price + selection indicator */}
                      <div className="flex shrink-0 flex-col items-end gap-2">
                        {provider.showPrices && service.price > 0 && (
                          <div className="text-end leading-none">
                            <span className="text-xs font-semibold text-accent">₪</span>
                            <span className="text-lg font-black tracking-tight">{service.price}</span>
                          </div>
                        )}
                        <div
                          className={cn(
                            "flex h-6 w-6 items-center justify-center rounded-full border-2 transition-all duration-300",
                            isSelected ? "border-accent bg-accent" : "border-border bg-white/60"
                          )}
                        >
                          {isSelected && <Check className="h-3.5 w-3.5 text-accent-foreground" />}
                        </div>
                      </div>
                    </motion.button>
                  );
                })}
              </div>
            </motion.div>
          )}

          {/* Staff step — "who will take care of you". Exists only for
              staff-enabled providers + private, non-session services. Tapping a
              staff member selects AND advances (same gesture as tapping a day
              on the calendar). Re-picking a different member resets the chosen
              date/time — availability is per-staff. */}
          {!isFitnessStudio && staffStepEnabled && step === 2 && (
            <motion.div
              key="step-staff"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={SPRING}
              className="px-5"
            >
              <SectionLabel className="mb-4">
                <UserRound className="h-3.5 w-3.5" />
                {t("pickStaff")}
              </SectionLabel>
              <div className="flex flex-col gap-3">
                {activeStaff.map((member, i) => {
                  const isSelected = selectedStaffId === member.id;
                  return (
                    <motion.button
                      key={member.id}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ ...SPRING, delay: i * 0.06 }}
                      onClick={() => {
                        if (member.id !== selectedStaffId) {
                          // New staff member → their calendar differs; the
                          // previously picked day/time may not exist for them.
                          setSelectedTime("");
                          setDateChosen(false);
                        }
                        setSelectedStaffId(member.id);
                        setStep(3);
                      }}
                      className={cn(
                        "flex w-full items-center gap-3.5 rounded-3xl border p-4 text-start transition-all active:scale-[0.98]",
                        isSelected
                          ? "border-accent/60 bg-accent/[0.08] ring-2 ring-accent/25 shadow-[0_10px_28px_-14px_hsl(var(--accent)/0.45)]"
                          : "border-white/60 bg-white/70 shadow-[0_6px_16px_-10px_rgba(120,70,30,0.15)] backdrop-blur-md hover:border-accent/30"
                      )}
                    >
                      {/* Initial-letter tile — the staff twist on the app's
                          icon-tile language used by the service cards. */}
                      <div
                        className={cn(
                          "flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-lg font-black transition-colors duration-300",
                          isSelected
                            ? "bg-accent text-accent-foreground shadow-[0_4px_12px_-4px_hsl(var(--accent)/0.5)]"
                            : "bg-accent/10 text-accent"
                        )}
                      >
                        {member.name.trim().charAt(0)}
                      </div>
                      <p className="min-w-0 flex-1 truncate text-[15px] font-bold leading-tight">
                        {member.name}
                      </p>
                      <div
                        className={cn(
                          "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition-all duration-300",
                          isSelected ? "border-accent bg-accent" : "border-border bg-white/60"
                        )}
                      >
                        {isSelected && <Check className="h-3.5 w-3.5 text-accent-foreground" />}
                      </div>
                    </motion.button>
                  );
                })}
              </div>
            </motion.div>
          )}

          {!isFitnessStudio && step === calendarStep && (
            <motion.div
              key="step2"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={SPRING}
              className="px-5"
            >
              {hasScheduledSessions ? (
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
                <div>
                  <SectionLabel className="mb-3">
                    <CalendarDays className="h-3.5 w-3.5" />
                    {t("selectDate")}
                  </SectionLabel>

                  {/* Month calendar — same react-day-picker setup + design
                      language as the provider's MonthlyAvailabilityCalendar
                      (hidden built-in caption, RTL-aware custom nav). Days in
                      the past, beyond the booking window, or without a single
                      free slot are disabled; tapping a free day advances to
                      the time step. */}
                  <div className="rounded-3xl border border-white/60 bg-white/70 p-3 shadow-[0_6px_16px_-10px_rgba(120,70,30,0.15)] backdrop-blur-md">
                    <BookingMonthCalendar
                      month={calMonth}
                      onMonthChange={setCalMonth}
                      fromDate={todayStart}
                      toDate={bookingWindowEnd}
                      dayHasAvailability={dayHasAvailability}
                      selected={dateChosen ? selectedDate : undefined}
                      onSelectDay={(day) => {
                        setSelectedDate(day);
                        setSelectedTime("");
                        setDateChosen(true);
                        setStep(timeStep as 3 | 4);
                      }}
                    />
                  </div>
                </div>
              )}
            </motion.div>
          )}

          {/* Time step — pick a time for the chosen day */}
          {!isFitnessStudio && step === timeStep && (
            <motion.div
              key="step3-time"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={SPRING}
              className="px-5"
            >
              {/* Chosen-day summary + back-to-calendar affordance */}
              <div className="mb-5 flex items-center justify-between gap-3 rounded-2xl border border-white/60 bg-white/70 p-4 shadow-[0_6px_16px_-10px_rgba(120,70,30,0.15)] backdrop-blur-md">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-xl bg-accent font-bold text-accent-foreground">
                    <span className="text-lg leading-none">{format(selectedDate, "d")}</span>
                    <span className="text-[10px]">{format(selectedDate, "MMM", { locale: dateFnsLocale })}</span>
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold">{format(selectedDate, "EEEE", { locale: dateFnsLocale })}</p>
                    <p className="text-xs text-muted-foreground">{format(selectedDate, "d MMMM yyyy", { locale: dateFnsLocale })}</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setStep(calendarStep as 2 | 3)}
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

              {isGroupBooking ? (
                availableGroupSlots.length > 0 ? (
                  <div className="grid grid-cols-3 gap-2.5">
                    {availableGroupSlots.map((slotInfo) => (
                      <button
                        key={slotInfo.time}
                        onClick={() => !slotInfo.isFull && setSelectedTime(slotInfo.time)}
                        disabled={slotInfo.isFull}
                        className={cn(
                          "py-3.5 px-1 rounded-2xl text-sm font-semibold transition-all active:scale-95 flex flex-col items-center gap-1 border",
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
                  <div className="grid grid-cols-3 gap-2.5">
                    {availableSlots.map((slot) => (
                      <button
                        key={slot}
                        onClick={() => setSelectedTime(slot)}
                        className={cn(
                          "py-3.5 rounded-2xl text-sm font-semibold transition-all active:scale-95 border",
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
            </motion.div>
          )}

          {/* Notes step — optional, only when the service opted in. Sits between
              the time step and confirm. */}
          {!isFitnessStudio && notesEnabled && step === notesStep && (
            <motion.div
              key="step-notes"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={SPRING}
              className="px-5"
            >
              <div className="mb-3 flex items-center justify-between">
                <SectionLabel>
                  <StickyNote className="h-3.5 w-3.5" />
                  {t("customerNotes")}
                </SectionLabel>
                <span className="text-xs text-muted-foreground">{t("notesOptional")}</span>
              </div>
              <div className="rounded-3xl border border-white/60 bg-white/70 p-4 shadow-[0_6px_16px_-10px_rgba(120,70,30,0.15)] backdrop-blur-md">
                <textarea
                  autoFocus
                  value={customerNotes}
                  onChange={(e) => setCustomerNotes(e.target.value)}
                  placeholder={notesPlaceholder}
                  rows={4}
                  maxLength={500}
                  className="w-full resize-none bg-transparent text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none"
                />
              </div>
            </motion.div>
          )}

          {!isFitnessStudio && step === standardConfirmStep && (
            <motion.div
              key="step4"
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
                {staffStepEnabled && selectedStaff && (
                  <>
                    <div className="h-px bg-border/40" />
                    <div>
                      <p className="text-xs text-muted-foreground uppercase tracking-wide mb-0.5">{t("staffMemberLabel")}</p>
                      <p className="text-sm font-semibold flex items-center gap-1.5">
                        <UserRound className="h-3.5 w-3.5 text-accent" />
                        {selectedStaff.name}
                      </p>
                    </div>
                  </>
                )}
                <div className="h-px bg-border/40" />
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1.5">{t("services")}</p>
                  {selectedServices.map((s) => (
                    <div key={s.id} className="flex justify-between items-center text-sm py-0.5">
                      <span className="flex items-center gap-1.5 text-foreground/80">
                        {s.service_type === "group" && <Users className="h-3.5 w-3.5 text-accent" />}
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

              {/* Customer note recap — shows what the customer typed on the notes step */}
              {notesEnabled && customerNotes.trim() && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ ...SPRING, delay: 0.16 }}
                  className="glass-card rounded-2xl p-4"
                >
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <StickyNote className="h-3.5 w-3.5 text-accent" />
                    <p className="text-xs text-muted-foreground uppercase tracking-wide">{t("customerNotes")}</p>
                  </div>
                  <p className="text-sm text-foreground/80 whitespace-pre-wrap break-words">{customerNotes.trim()}</p>
                </motion.div>
              )}

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
          {step === (isFitnessStudio ? 3 : standardConfirmStep) ? (
            <div>
              <div className="flex items-baseline justify-between mb-3">
                <p className="text-xs text-muted-foreground">{provider.name[lang]}</p>
                {!isFitnessStudio && provider.showPrices && total > 0 ? <p className="text-lg font-bold">₪{total}</p> : null}
              </div>
              <button
                onClick={handleConfirm}
                disabled={loading}
                className="w-full rounded-2xl bg-accent text-accent-foreground py-4 text-base font-semibold shadow-[0_8px_24px_-8px_hsl(var(--accent)/0.55)] transition-transform active:scale-[0.98] disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {loading ? (
                  <span className="w-4 h-4 rounded-full border-2 border-accent-foreground/30 border-t-accent-foreground animate-spin" />
                ) : (
                  <>
                    <CalendarCheck className="h-5 w-5" />
                    {t("confirmBooking")}
                  </>
                )}
              </button>
            </div>
          ) : (
            <div>
              {(!isFitnessStudio || selectedClass) && (
                <div className="flex items-baseline justify-between mb-3">
                  {!isFitnessStudio ? (
                    <>
                      <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                        {primaryService ? (
                          <>
                            <span className="font-semibold text-foreground/80">{primaryService.name[lang]}</span>
                            {" · "}{totalDuration} {t("min")}
                            {effectiveTime && (
                              <>
                                {" · "}
                                <span dir="ltr" className="tabular-nums">{effectiveTime}</span>
                              </>
                            )}
                          </>
                        ) : (
                          `${selectedServices.length} ${t("serviceCount")}`
                        )}
                      </p>
                      {provider.showPrices && total > 0 ? <p className="ms-3 shrink-0 text-lg font-bold">₪{total}</p> : null}
                    </>
                  ) : (
                    <p className="text-sm font-semibold">{selectedClass?.class_name}</p>
                  )}
                </div>
              )}
              <button
                disabled={!activeCanProceed}
                onClick={activeHandleNext}
                className={cn(
                  "w-full rounded-2xl bg-accent text-accent-foreground py-4 text-base font-semibold shadow-[0_8px_24px_-8px_hsl(var(--accent)/0.55)] transition-all active:scale-[0.98] flex items-center justify-center gap-2",
                  !activeCanProceed && "opacity-40 pointer-events-none shadow-none"
                )}
              >
                {t("continue")}
                <ForwardArrow variant="arrow" className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default BookAppointment;
