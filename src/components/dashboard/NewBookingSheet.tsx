import { useEffect, useRef, useState } from "react";
import { format, addDays, startOfDay, endOfMonth, startOfMonth, eachDayOfInterval } from "date-fns";
import { he, ar, enUS } from "date-fns/locale";
import { Plus, Clock, Users, CalendarDays, Check, CalendarX, UserRound, Pencil, Info, MoonStar } from "lucide-react";
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
import { useProviderActiveStaff } from "@/hooks/useProviderStaff";
import { useProviderAvailability } from "@/hooks/useProviderAvailability";
import { useRealAvailability } from "@/hooks/useAllProviders";
import {
  resolveDayHours,
  isOutsideDayWindow,
  type DateOverrideRow,
  type MonthlySettings,
  type WeeklyRow,
} from "@/lib/availabilityResolver";
import { normalizeBookingTime } from "@/lib/bookingTime";
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
  // Multi-staff (Phase 5, mirrors the Phase 4 customer picker): the walk-in
  // provider IS the current provider, so staff_enabled + the active-staff list
  // come straight from the profile. Same gated public hook as the customer
  // flow (shared query key/cache); non-staff providers never fire the query.
  const staffEnabled = profile?.staff_enabled === true;
  const { activeStaff, isLoading: staffLoading } = useProviderActiveStaff(profile?.id, staffEnabled);
  const [staffId, setStaffId] = useState("");
  const { getAvailableSlots, getGroupSlotsWithCapacity } = useRealAvailability(profile?.id, staffId || undefined);
  // Raw schedule inputs for the OVERRIDE path. The slot pipeline above answers
  // "are there bookable slots?"; it cannot answer "why not?", because
  // resolveDayHours → null (closed/blocked) and "every slot taken" both arrive
  // here as the same empty array. So the override path resolves the day's hours
  // itself, from the same shared resolver the pipeline uses.
  const { availability, blockedDates, dateOverrides } = useProviderAvailability();
  const queryClient = useQueryClient();

  const dateFnsLocale = lang === "he" ? he : lang === "ar" ? ar : enUS;

  const [open, setOpen] = useState(false);
  // 4 steps: service → month calendar → time → customer info (same calendar +
  // time-step pattern as the customer BookAppointment flow). Staff-enabled
  // providers gain a "choose staff" step after service (5 steps total) — the
  // step numbers are DERIVED below so the 4-step machine is unchanged for
  // everyone else. One machine, not forked.
  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5>(1);
  const [serviceId, setServiceId] = useState("");
  const [date, setDate] = useState<Date>(startOfDay(selectedDate));
  const [time, setTime] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  // Manual ("שעה אחרת…") time entry on the time step. `manualTime` holds the
  // RAW input value; `time` only ever receives the normalised form.
  const [manualOpen, setManualOpen] = useState(false);
  const [manualTime, setManualTime] = useState("");
  // Calendar UI state: displayed month + whether a day was actively tapped
  // (`date` always holds a value, so it can't signal that alone).
  const [calMonth, setCalMonth] = useState<Date>(() => startOfDay(selectedDate));
  const [dateChosen, setDateChosen] = useState(false);
  // An OFF day (closed / blocked / full) awaiting confirmation. Held here and
  // NOT written into `date` until the provider confirms, so cancelling leaves
  // every piece of booking state exactly as it was.
  const [pendingOffDay, setPendingOffDay] = useState<Date | null>(null);

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
    setPendingOffDay(null);
    setStep(1);
    setServiceId("");
    setStaffId("");
    setTime("");
    setManualOpen(false);
    setManualTime("");
    setName("");
    setPhone("");
    setNotes("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // A different service/date invalidates any previously picked time — including
  // a manually entered one, whose validity is just as day-dependent.
  useEffect(() => {
    setTime("");
    setManualTime("");
    setManualOpen(false);
  }, [serviceId, date]);

  // Day availability depends on the service (duration/capacity), so switching
  // service sends the provider back through the calendar. The staff choice
  // resets too: whether the staff step even exists depends on the service
  // (private vs group).
  useEffect(() => {
    setDateChosen(false);
    setStaffId("");
  }, [serviceId]);

  // The step body is its own scroll container — reset it so every step opens
  // at the top instead of inheriting the previous step's scroll position.
  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0 });
  }, [step]);

  const activeServices = services.filter((s) => s.is_active !== false);
  const service = activeServices.find((s) => s.id === serviceId);
  const isGroup = service?.service_type === "group";
  const duration = service?.duration || 15;

  // Same conditions as the customer flow's staff step: provider opted in,
  // PRIVATE service (group capacity is pooled shop-wide, staff-blind), and at
  // least one ACTIVE staff member. Zero active staff → step skipped, walk-in
  // inserts staff_id NULL — same graceful fallback as Phase 4.
  const staffStepEnabled = staffEnabled && !!service && !isGroup && activeStaff.length > 0;
  const selectedStaff = activeStaff.find((s) => s.id === staffId);

  // Derived step numbers — collapse to the literal 4-step values whenever the
  // staff step is absent, so non-staff providers keep today's flow untouched.
  const calendarStep = staffStepEnabled ? 3 : 2;
  const timeStep = staffStepEnabled ? 4 : 3;
  const infoStep = staffStepEnabled ? 5 : 4;
  const totalSteps = staffStepEnabled ? 5 : 4;

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

  // ── Out-of-hours override (walk-in only) ───────────────────────────────────
  // Adapters onto resolveDayHours' signature. useProviderAvailability returns
  // provider_blocked_dates ROWS (the resolver wants "YYYY-MM-DD" strings) and
  // select("*") override rows (a superset of DateOverrideRow — the extra
  // columns are simply unread). Weekly rows already match WeeklyRow.
  const blockedDateStrs = blockedDates.map((b) => b.blocked_date);
  // Same weekly-by-default resolution useRealAvailability applies, so both
  // agree on which branch a provider is on (useAllProviders.ts:453-459).
  const monthlySettings: MonthlySettings = {
    availability_mode: profile?.availability_mode === "monthly" ? "monthly" : "weekly",
    monthly_default_available: profile?.monthly_default_available ?? true,
    monthly_default_start: profile?.monthly_default_start ?? "09:00",
    monthly_default_end: profile?.monthly_default_end ?? "17:00",
  };
  const resolveWindow = (d: Date) =>
    resolveDayHours(
      d,
      monthlySettings,
      availability as WeeklyRow[],
      blockedDateStrs,
      dateOverrides as DateOverrideRow[],
    );

  // A day the provider may OVERRIDE: inside the SAME [today, booking window]
  // range the calendar already enforces, but with nothing bookable — closed,
  // blocked, or fully booked. Out-of-hours must never mean retroactive, so the
  // range check is asserted here too rather than relying solely on the
  // calendar's fromDate/toDate.
  const dayIsOverridable = (d: Date): boolean => {
    if (!service) return false;
    const day = startOfDay(d);
    if (day < startToday || day > windowEnd) return false;
    return !dayHasAvailability(d);
  };

  // Why the CHOSEN day has no slots — only resolveDayHours can tell these apart,
  // which is exactly why the predicate above can't live in the slot pipeline.
  const chosenDayWindow = resolveWindow(date);
  const chosenDayIsClosed = chosenDayWindow === null;
  const selectedDayOverridable = dateChosen && dayIsOverridable(date);

  // The SAME closed-vs-full distinction as chosenDayIsClosed, asked of the day
  // awaiting confirmation rather than the chosen one — `date` deliberately has
  // not moved yet at that point, so it cannot answer for the pending day.
  const pendingOffDayIsClosed = pendingOffDay ? resolveWindow(pendingOffDay) === null : false;

  // Does the displayed month contain any marked day? Drives the legend under
  // the calendar, so the dashed cells are explained before one is tapped.
  // Bounded to the selectable range; same per-day cost the calendar itself
  // already pays for `disabled` and its modifiers.
  const monthHasOverridableDay = (() => {
    if (!service) return false;
    const from = startOfMonth(calMonth) < startToday ? startToday : startOfMonth(calMonth);
    const to = endOfMonth(calMonth) > windowEnd ? windowEnd : endOfMonth(calMonth);
    if (from > to) return false;
    return eachDayOfInterval({ start: from, end: to }).some(dayIsOverridable);
  })();

  // The manual time is advisory-flagged when it falls outside the day's resolved
  // window — the same DERIVED test the provider calendar badges bookings with.
  const manualIsOutOfHours = !!time && manualOpen && isOutsideDayWindow(chosenDayWindow, time);

  // On an overridable day the slot area above the manual entry renders nothing
  // at all (see the time step), so the manual block's divider would hang under
  // an empty region. Drop the rule and its padding in exactly that case.
  const slotAreaEmpty = !!service && !hasSlots && selectedDayOverridable;

  const canSubmit =
    !!service && !!time && name.trim().length > 0 && phone.trim().length > 0 && !submitting;

  // Per-step gate: service → [staff] → day → time → (name + phone handled by
  // canSubmit on the info step). While a staff-enabled provider's staff list
  // is still loading we don't yet know whether the staff step exists — hold
  // the continue button for that (tiny) window. Non-staff providers never hit
  // that clause.
  const canProceed =
    step === 1
      ? !!service && !(staffEnabled && staffLoading)
      : staffStepEnabled && step === 2
      ? !!staffId
      : step === calendarStep
      ? dateChosen
      : step === timeStep
      ? !!time
      : true;

  const handleNext = () => {
    if (step === 1 && service) setStep(2); // staff step when enabled, else calendar
    else if (staffStepEnabled && step === 2 && staffId) setStep(3);
    else if (step === calendarStep && dateChosen) setStep(timeStep as 3 | 4);
    else if (step === timeStep && time) setStep(infoStep as 4 | 5);
  };

  const handleBack = () => setStep((s) => (s > 1 ? ((s - 1) as 1 | 2 | 3 | 4 | 5) : s));

  // Everything that happens once a day is ACCEPTED. Extracted so the normal
  // path and the confirmed-off-day path run literally the same code — the
  // confirmation is a gate in front of this, never a second implementation.
  const commitDaySelection = (day: Date) => {
    setDate(day);
    setTime("");
    setManualTime("");
    // A day with nothing bookable can only be served by the manual entry, so
    // open it straight away instead of landing the provider on an empty grid
    // with a hidden affordance. Normal days keep the grid-first flow.
    setManualOpen(dayIsOverridable(day));
    setDateChosen(true);
    setStep(timeStep as 3 | 4);
  };

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
      // Multi-staff: set only when the staff step was part of THIS flow —
      // group, zero-active-staff and non-staff providers stay NULL, identical
      // to pre-staff walk-ins. Same rule as the customer flow's insert.
      staff_id: staffStepEnabled && staffId ? staffId : null,
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

  const stepLabels = [
    t("selectServices"),
    ...(staffStepEnabled ? [t("pickStaff")] : []),
    t("selectDate"),
    t("pickTime"),
    t("walkInCustomerInfo"),
  ];

  return (
    <>
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
              {Array.from({ length: totalSteps }, (_, i) => i + 1).map((s) => (
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
                {step} / {totalSteps}
              </p>
            </div>
          </div>
        </div>

        {/* ── Scrollable step body ── */}
        <div ref={bodyRef} className="flex-1 overflow-y-auto overflow-x-hidden px-5 pb-5 pt-4">
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

            {/* ── Staff step: "choose staff" (only for staff-enabled providers
                + private services; mirrors the Phase 4 customer picker — same
                initial-letter avatar card, tap selects AND advances, re-picking
                a different member resets date/time since availability is
                per-staff). ── */}
            {staffStepEnabled && step === 2 && (
              <motion.div
                key="step-staff"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={SPRING}
              >
                <SectionLabel className="mb-3">
                  <UserRound className="h-3.5 w-3.5" />
                  {t("pickStaff")}
                </SectionLabel>
                <div className="flex flex-col gap-2.5">
                  {activeStaff.map((member, i) => {
                    const selected = staffId === member.id;
                    return (
                      <motion.button
                        key={member.id}
                        type="button"
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ ...SPRING, delay: i * 0.04 }}
                        onClick={() => {
                          if (member.id !== staffId) {
                            // A different member → their calendar differs; the
                            // previously picked day/time may not exist for them.
                            setTime("");
                            setDateChosen(false);
                          }
                          setStaffId(member.id);
                          setStep(3);
                        }}
                        className={cn(
                          "flex items-center gap-3.5 rounded-2xl border p-4 text-start shadow-sm transition-all active:scale-[0.98]",
                          selected
                            ? "border-accent bg-accent/10 ring-2 ring-accent/20"
                            : "border-border bg-card hover:border-accent/40"
                        )}
                      >
                        {/* Initial-letter tile — same staff visual as the
                            customer picker. */}
                        <div
                          className={cn(
                            "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-lg font-black transition-colors duration-300",
                            selected ? "bg-accent text-accent-foreground" : "bg-accent/10 text-accent"
                          )}
                        >
                          {member.name.trim().charAt(0)}
                        </div>
                        <p className="min-w-0 flex-1 truncate text-sm font-semibold">{member.name}</p>
                        {selected && (
                          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent">
                            <Check className="h-3 w-3 text-accent-foreground" />
                          </span>
                        )}
                      </motion.button>
                    );
                  })}
                </div>
              </motion.div>
            )}

            {/* ── Calendar step: month calendar (shared with the customer flow) ── */}
            {step === calendarStep && (
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
                    dayIsOverridable={dayIsOverridable}
                    selected={dateChosen ? date : undefined}
                    onSelectDay={(day) => {
                      // An OFF day (closed / blocked / full) is confirmed
                      // first, so the provider can never land on the time step
                      // without having registered that the day is off. NOTHING
                      // is mutated here — not `date`, not `dateChosen`, not
                      // `step` — until they confirm. A normal day never enters
                      // this branch and behaves exactly as before.
                      if (dayIsOverridable(day)) {
                        setPendingOffDay(day);
                        return;
                      }
                      commitDaySelection(day);
                    }}
                  />

                  {/* Inline note — lives HERE, not in the shared calendar, which
                      carries no caller-specific copy. Day-specific once a marked
                      day is chosen (seen on return via "שינוי תאריך"), otherwise
                      a legend explaining the dashed cells. */}
                  {(selectedDayOverridable || monthHasOverridableDay) && (
                    <div className="mt-3 flex items-start gap-2 rounded-xl border border-dashed border-muted-foreground/40 bg-muted/40 p-3">
                      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <p className="text-[11px] leading-relaxed text-muted-foreground">
                        {selectedDayOverridable
                          ? chosenDayIsClosed
                            ? t("walkInOverrideClosedNote")
                            : t("walkInOverrideFullNote")
                          : t("walkInOverrideLegend")}
                      </p>
                    </div>
                  )}
                </div>
              </motion.div>
            )}

            {/* ── Time step: time for the chosen day ── */}
            {step === timeStep && (
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
                    onClick={() => setStep(calendarStep as 2 | 3)}
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
                    // Zero slots splits two ways. On an OVERRIDABLE day the
                    // provider has already been told three times that the day is
                    // off — the marked cell, the note under the calendar, and
                    // the confirm dialog — so a fourth, loud empty-state card
                    // only buries the manual entry that IS the way forward.
                    // Every OTHER zero-slot case still gets the card: a day the
                    // provider reached without that context (service switched
                    // after the day was picked, availability changed under
                    // them, staff re-picked), where "no times here" is news.
                    selectedDayOverridable ? null : (
                      <div className="rounded-2xl border border-dashed border-border p-8 text-center">
                        <CalendarX className="mx-auto mb-2 h-7 w-7 text-muted-foreground/40" />
                        <p className="text-sm text-muted-foreground">{t("walkInNoSlots")}</p>
                      </div>
                    )
                  ) : isGroup ? (
                    <div className="grid grid-cols-3 gap-2">
                      {groupSlots.map((slot) => (
                        <button
                          key={slot.time}
                          type="button"
                          disabled={slot.isFull}
                          onClick={() => {
                            if (slot.isFull) return;
                            // Grid and manual entry are one selection: picking a
                            // chip clears whatever was typed.
                            setManualTime("");
                            setTime(slot.time);
                          }}
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
                          onClick={() => {
                            setManualTime("");
                            setTime(slot);
                          }}
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

                  {/* ── Manual time ("שעה אחרת…") ──
                      A SIBLING of the whole !service / !hasSlots / isGroup /
                      else chain above — deliberately NOT inside any branch. The
                      zero-slot branch (a closed, blocked or fully-booked day) is
                      exactly where this is the only way forward, so nesting it
                      would hide it precisely when it is needed most.
                      Conflicts are untouched: a colliding manual time is still
                      rejected by prevent_booking_conflicts and surfaces through
                      the existing handleCreate error branch. */}
                  {!!service && (
                    <div className={cn("mt-4", !slotAreaEmpty && "border-t border-border/60 pt-4")}>
                      {!manualOpen ? (
                        <button
                          type="button"
                          onClick={() => setManualOpen(true)}
                          // max-w-full + text-start so the longer label wraps
                          // inside the pill on a narrow phone instead of
                          // overflowing the sheet.
                          className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-secondary px-3.5 py-2 text-start text-xs font-semibold text-foreground transition-transform active:scale-95 hover:bg-secondary/80"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                          {t("walkInOtherTime")}
                        </button>
                      ) : (
                        <div className="space-y-2">
                          <Label htmlFor="walkin-manual-time" className="text-xs">
                            {t("walkInManualTimeLabel")}
                          </Label>
                          <Input
                            id="walkin-manual-time"
                            type="time"
                            dir="ltr"
                            step={60}
                            value={manualTime}
                            onChange={(e) => {
                              const raw = e.target.value;
                              setManualTime(raw);
                              // ALWAYS normalised before it reaches `time`, which
                              // is what the insert and canProceed read. A partial
                              // or invalid entry clears the selection rather than
                              // leaking an unpadded value downstream — see
                              // lib/bookingTime.ts for the two silent failures
                              // this prevents.
                              setTime(normalizeBookingTime(raw) ?? "");
                            }}
                            className="h-12 w-full tabular-nums"
                          />
                          <p className="text-[11px] leading-relaxed text-muted-foreground">
                            {t("walkInManualTimeHint")}
                          </p>
                          {manualIsOutOfHours && (
                            <p className="flex items-center gap-1.5 text-[11px] font-medium text-amber-600">
                              <MoonStar className="h-3.5 w-3.5 shrink-0" />
                              {t("walkInManualOutOfHours")}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </motion.div>
            )}

            {/* ── Info step: customer info ── */}
            {step === infoStep && (
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
                  {staffStepEnabled && selectedStaff && (
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-xs text-muted-foreground">{t("staffMemberLabel")}</span>
                      <span className="flex items-center gap-1.5 truncate text-sm font-semibold">
                        <UserRound className="h-3.5 w-3.5 text-accent shrink-0" />
                        {selectedStaff.name}
                      </span>
                    </div>
                  )}
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
            {step < infoStep ? (
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

    {/* ── OFF-day confirmation ──
        Sibling of the Sheet (same placement as the deactivate-staff dialog):
        it portals above the still-open sheet rather than nesting inside it.
        Reached ONLY from the overridable branch of onSelectDay, so a normal
        available day never renders it. Cancel — the backdrop, Esc, or the
        cancel button — closes via onOpenChange and only clears pendingOffDay,
        leaving date / dateChosen / time / step untouched. */}
    <AlertDialog
      open={!!pendingOffDay}
      onOpenChange={(isOpen) => { if (!isOpen) setPendingOffDay(null); }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("walkInOffDayConfirmTitle")}</AlertDialogTitle>
          <AlertDialogDescription>
            {/* Same closed-vs-full distinction the inline note uses, resolved
                for the pending day. */}
            {pendingOffDayIsClosed
              ? t("walkInOffDayConfirmClosed")
              : t("walkInOffDayConfirmFull")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {pendingOffDay && (
          <p className="text-sm font-semibold text-foreground">
            {format(pendingOffDay, "EEEE, d MMMM yyyy", { locale: dateFnsLocale })}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              // Proceed exactly as a normal day does — same single code path.
              if (pendingOffDay) commitDaySelection(pendingOffDay);
              setPendingOffDay(null);
            }}
          >
            {t("continue")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}
