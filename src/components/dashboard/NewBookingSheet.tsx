import { useEffect, useRef, useState } from "react";
import { format, addDays, startOfDay, endOfMonth, startOfMonth, eachDayOfInterval } from "date-fns";
import { he, ar, enUS } from "date-fns/locale";
import { Plus, Clock, Users, CalendarDays, Check, CalendarX, UserRound, Pencil, Info, MoonStar, Repeat, Minus, ChevronDown } from "lucide-react";
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
import { Checkbox } from "@/components/ui/checkbox";
import { SectionLabel } from "@/components/ui/SectionLabel";
import { BookingMonthCalendar } from "@/components/booking/BookingMonthCalendar";
import { CustomerPicker } from "@/components/dashboard/CustomerPicker";
import { NewCustomerView, type CustomerViewKind } from "@/components/dashboard/NewCustomerView";
import { looksLikePhone } from "@/lib/customerSearch";
import { isTextEntry, useVisualKeyboardUp } from "@/hooks/useKeyboardOpen";
import { BackArrow } from "@/components/ui/directional-icon";
import { cn } from "@/lib/utils";
import { useLang } from "@/contexts/LangContext";
import { useProviderProfile } from "@/hooks/useProviderProfile";
import { useProviderServices } from "@/hooks/useProviderServices";
import { useProviderActiveStaff, useProviderStaffAssignments } from "@/hooks/useProviderStaff";
import { eligibleStaffForService } from "@/lib/staffServices";
import { useRealAvailability } from "@/hooks/useAllProviders";
import { useResolvedDayWindow } from "@/hooks/useResolvedDayWindow";
import { classifyDay, isOutsideDayWindow } from "@/lib/availabilityResolver";
import { normalizeBookingTime } from "@/lib/bookingTime";
import { isWhatsAppMobile } from "@/lib/whatsappPhone";
import { notifyBookingConfirmed } from "@/lib/whatsappConfirm";
import { supabase } from "@/integrations/supabase/client";
import type { TablesInsert } from "@/integrations/supabase/types";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { BranchSuffix } from "@/components/branch/BranchSuffix";
import { canOfferRepeat, SERIES_MAX_COUNT, SERIES_MIN_COUNT, type SeriesDateStatus } from "@/lib/recurringSeries";
import { useCreateRecurringSeries, useSeriesPreview } from "@/hooks/useRecurringSeries";

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
  // Declared up here, ahead of the availability hook, because the eligible-staff
  // filter needs the chosen service and the availability hook in turn needs the
  // filtered staff pick. (The rest of the step state stays together below.)
  const [serviceId, setServiceId] = useState("");
  // Per-staff services (Phase 3). Same public hook the customer flow uses, so
  // the two pickers share a cache and cannot drift; the owner-side editor
  // invalidates this key on save, so assignments edited in settings show up here
  // immediately rather than after the 5-minute staleTime.
  const { servicesByStaff, isLoading: staffServicesLoading } = useProviderStaffAssignments(
    profile?.id,
    staffEnabled
  );
  // The walk-in sheet ENFORCES the same restriction as the customer flow — no
  // owner override. The owner is the one who set the assignments, and a picker
  // that disagrees with the customer-facing one is how this feature would rot.
  const eligibleStaff = eligibleStaffForService(activeStaff, servicesByStaff, serviceId || undefined);
  // A pick can go stale (assignments refetch, or the owner edits them in another
  // tab). Resolving it once here keeps availability, the continue gate, the
  // summary and the insert all reading the same staff id.
  const effectiveStaffId = staffId && eligibleStaff.some((s) => s.id === staffId) ? staffId : "";
  const { getAvailableSlots, getGroupSlotsWithCapacity, resolveDayWindows } = useRealAvailability(profile?.id, effectiveStaffId || undefined);
  // Resolved hours for the OVERRIDE path. The slot pipeline above answers "are
  // there bookable slots?"; it cannot answer "why not?", because a closed day
  // and a fully-booked one both arrive here as the same empty array. So the
  // override path resolves the day's hours itself, from the same shared resolver
  // the pipeline uses — SHOP window and staff-NARROWED window kept separate,
  // since that separation is the only thing that can tell "the shop is shut"
  // apart from "this member isn't working". The hook mounts the same shared
  // query keys the pipeline does, so React Query dedupes them: no extra round
  // trips, and the two can never disagree about a member's week.
  const { resolveShopWindow, resolveWindow, staffHasOwnHours } = useResolvedDayWindow(
    effectiveStaffId || undefined,
  );
  const queryClient = useQueryClient();

  const dateFnsLocale = lang === "he" ? he : lang === "ar" ? ar : enUS;

  const [open, setOpen] = useState(false);
  // 4 steps: service → month calendar → time → customer info (same calendar +
  // time-step pattern as the customer BookAppointment flow). Staff-enabled
  // providers gain a "choose staff" step after service (5 steps total) — the
  // step numbers are DERIVED below so the 4-step machine is unchanged for
  // everyone else. One machine, not forked.
  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5>(1);
  // serviceId is declared with the staff state above — the eligible-staff filter
  // needs it before the availability hook runs.
  const [date, setDate] = useState<Date>(startOfDay(selectedDate));
  const [time, setTime] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  // Step 4's notes field is folded to a "+ Add a note" link until tapped.
  const [notesOpen, setNotesOpen] = useState(false);
  const notesRef = useRef<HTMLTextAreaElement>(null);
  // The provider tapped "+ Add a note": the caret goes in (keyboard expected).
  useEffect(() => {
    if (notesOpen) notesRef.current?.focus();
  }, [notesOpen]);
  // Provider-recorded consent for WhatsApp messages about THIS booking. Per
  // booking, never remembered per customer — the provider has to ask each time.
  const [whatsappConsent, setWhatsappConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // The id of the focused text field in step 4 (search, notes; null = none).
  // Together with the measured keyboard below this drives compact mode and
  // search mode.
  const [focusedField, setFocusedField] = useState<string | null>(null);
  // Step 4's new-customer view (new / edit the card / complete a half record).
  // While open it replaces the sheet's header, step content and footer.
  // Only ever writes `name` + `phone` (on Add), the same state as before.
  const [customerView, setCustomerView] = useState<{ kind: CustomerViewKind; name: string; phone: string } | null>(null);
  // The search text when the view was opened, so Back returns to it.
  const [customerQuery, setCustomerQuery] = useState("");
  // Recurring series. `repeatOpen` only shows/hides the options; the choice
  // itself is `repeatWeekly` + `repeatCount` (2–12, this appointment included).
  const [repeatOpen, setRepeatOpen] = useState(false);
  const [repeatWeekly, setRepeatWeekly] = useState(false);
  const [repeatCount, setRepeatCount] = useState(4);
  const createSeries = useCreateRecurringSeries();
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
    setCustomerView(null);
    setCustomerQuery("");
    setNotes("");
    setNotesOpen(false);
    setWhatsappConsent(false);
    setRepeatOpen(false);
    setRepeatWeekly(false);
    setRepeatCount(4);
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
    setFocusedField(null);
    setCustomerView(null);
  }, [step]);

  const activeServices = services.filter((s) => s.is_active !== false);
  const service = activeServices.find((s) => s.id === serviceId);
  const isGroup = service?.service_type === "group";
  const duration = service?.duration || 15;

  // Same conditions as the customer flow's staff step: provider opted in,
  // PRIVATE service (group capacity is pooled shop-wide, staff-blind), and at
  // least one ELIGIBLE staff member. Zero eligible staff → step skipped, walk-in
  // inserts staff_id NULL — same graceful fallback as Phase 4, now also covering
  // "every member is assigned away from this service" (Phase 3).
  const staffStepEnabled = staffEnabled && !!service && !isGroup && eligibleStaff.length > 0;
  const selectedStaff = eligibleStaff.find((s) => s.id === effectiveStaffId);

  // Derived step numbers — collapse to the literal 4-step values whenever the
  // staff step is absent, so non-staff providers keep today's flow untouched.
  const calendarStep = staffStepEnabled ? 3 : 2;
  const timeStep = staffStepEnabled ? 4 : 3;
  const infoStep = staffStepEnabled ? 5 : 4;
  const totalSteps = staffStepEnabled ? 5 : 4;

  // Compact mode, step 4 only: while ANY text field there is focused and the
  // keyboard is actually up, the header drops to a back control + short title
  // and the footer (Back / Create) steps aside, so the fields get the strip
  // above the keyboard. It all returns when the keyboard closes — also via
  // Android's back button, which keeps focus (hence the measured keyboard,
  // not focus alone). Other sheets keep their Save above the keyboard.
  const keyboardUp = useVisualKeyboardUp(open && step === infoStep);
  const compact = step === infoStep && !!focusedField && keyboardUp;
  // SEARCH MODE: the customer search is focused with the keyboard up (it only
  // exists while no customer is set). The summary card, the consent box and
  // the notes link step aside, so the search sits right under the compact
  // header and its results get all the space above the keyboard. It ends when
  // a customer is picked, the ✕ clears the search (it drops focus), or the
  // keyboard closes — Android's back button included, via the measured
  // keyboard — and the normal layout returns.
  const searching = compact && focusedField === "walkin-search";

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

  // Why the CHOSEN day has no slots — only the resolver can tell these apart,
  // which is exactly why the predicate above can't live in the slot pipeline.
  // classifyDay is handed BOTH windows plus the grid's own verdict, so each
  // cause gets its own answer ("closed" / "staffOff" / "full") and the sheet's
  // copy can never disagree with the slots it is describing.
  const chosenDayWindow = resolveWindow(date);
  const chosenDayStatus = classifyDay(resolveShopWindow(date), chosenDayWindow, hasSlots);
  const selectedDayOverridable = dateChosen && dayIsOverridable(date);

  // The SAME classification, asked of the day awaiting confirmation rather than
  // the chosen one — `date` deliberately has not moved yet at that point, so it
  // cannot answer for the pending day. A pending day is overridable by
  // construction (only that branch of onSelectDay sets it) and therefore has no
  // slots, but the verdict is computed honestly rather than assumed, so the
  // dialog cannot start lying if that branch ever widens.
  const pendingOffDayStatus = pendingOffDay
    ? classifyDay(
        resolveShopWindow(pendingOffDay),
        resolveWindow(pendingOffDay),
        dayHasAvailability(pendingOffDay),
      )
    : null;

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

  // WhatsApp consent is offered only to providers who send WhatsApp messages at
  // all. `consentActive` — never raw `whatsappConsent` — is what the checks, the
  // payload and the send read, so a box ticked before the provider turned the
  // flag off cannot leak through as consent.
  const whatsappConsentOffered = profile?.whatsapp_confirm_enabled === true;
  const consentActive = whatsappConsentOffered && whatsappConsent;
  // Consent to a number the WhatsApp functions would refuse is no consent at
  // all: block Create and say why. Shown only once a phone is typed — an empty
  // phone already blocks Create through its own required marker. Unticking
  // always clears it.
  const consentPhoneInvalid =
    consentActive && phone.trim().length > 0 && !isWhatsAppMobile(phone);

  // ── Recurring series ───────────────────────────────────────────────────────
  // Ruling 3: offered only for a private service, at a time picked FROM THE
  // SLOT LIST, on an open day. A manual time leaves `manualTime` non-empty (a
  // chip tap clears it), so that — not `manualOpen`, which stays open after a
  // chip is tapped — is what marks a manual pick.
  const repeatOffered =
    !!service &&
    !!time &&
    canOfferRepeat({
      serviceType: service.service_type,
      providerCategory: profile?.category,
      manualTime: manualTime !== "",
      dayOverridden: selectedDayOverridable,
      timeInSlotList: privateSlots.includes(time),
    });
  const seriesActive = repeatOffered && repeatWeekly;
  const series = useSeriesPreview({
    enabled: seriesActive,
    providerId: profile?.id,
    // The same lane the sheet's own useRealAvailability instance runs in.
    staffId: effectiveStaffId || undefined,
    serviceId: service?.id,
    duration,
    capacity: service?.max_capacity ?? 1,
    time,
    firstDate: date,
    count: repeatCount,
    getAvailableSlots,
    resolveDayWindows,
  });
  const seriesAvailable = series.availableKeys.length;
  const seriesSkipped = series.preview.length - seriesAvailable;
  const seriesReady = seriesActive && !series.isLoading && !series.isError && series.preview.length > 0;

  const canSubmit =
    !!service &&
    !!time &&
    name.trim().length > 0 &&
    phone.trim().length > 0 &&
    !(consentActive && !isWhatsAppMobile(phone)) &&
    !(seriesActive && (!seriesReady || seriesAvailable === 0)) &&
    !submitting;

  // Per-step gate: service → [staff] → day → time → (name + phone handled by
  // canSubmit on the info step). While a staff-enabled provider's staff list OR
  // its per-staff service assignments are still loading we don't yet know
  // whether the staff step exists — hold the continue button for that (tiny)
  // window. Both must be waited on, or the step can flash in on the staff list
  // and back out when the assignments empty it. Non-staff providers never hit
  // that clause.
  const canProceed =
    step === 1
      ? !!service && !(staffEnabled && (staffLoading || staffServicesLoading))
      : staffStepEnabled && step === 2
      ? !!effectiveStaffId
      : step === calendarStep
      ? dateChosen
      : step === timeStep
      ? !!time
      : true;

  const handleNext = () => {
    if (step === 1 && service) setStep(2); // staff step when enabled, else calendar
    else if (staffStepEnabled && step === 2 && effectiveStaffId) setStep(3);
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
    if (consentActive && !isWhatsAppMobile(phone)) { toast.error(t("walkInWhatsappPhoneInvalid")); return; }
    if (!time) return;

    if (seriesActive) {
      await handleCreateSeries();
      return;
    }

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
      // Stored exactly as typed — validated above, never reformatted:
      // link_walkin_to_account matches its digits against profiles.phone.
      customer_phone: phone.trim(),
      guest_notes: notes.trim() || null,
      whatsapp_consent: consentActive,
      // Multi-staff: set only when the staff step was part of THIS flow —
      // group, zero-eligible-staff and non-staff providers stay NULL, identical
      // to pre-staff walk-ins. Same rule as the customer flow's insert, and
      // effectiveStaffId for the same reason: never write a pick that has since
      // become ineligible.
      staff_id: staffStepEnabled && effectiveStaffId ? effectiveStaffId : null,
    };

    // .select("id") returns the new row's id for the WhatsApp trigger below; the
    // provider's own SELECT policy covers the row they just inserted.
    const { data: created, error } = await supabase
      .from("bookings")
      .insert(payload)
      .select("id")
      .single();
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

    // No in-app notification: a walk-in has no account to notify, and the
    // provider is the one creating it. WhatsApp only with recorded consent —
    // fire-and-forget, so a messaging failure can never fail the booking. The
    // Edge Function re-reads consent, the flag, the phone and the allowlist
    // itself; this call only asks it to look.
    if (consentActive && created?.id) {
      notifyBookingConfirmed(created.id);
    }
    queryClient.invalidateQueries({ queryKey: ["provider-bookings-enriched", profile.id] });
    queryClient.invalidateQueries({ queryKey: ["provider-bookings-public", profile.id] });
    toast.success(t("walkInCreated"));
    setOpen(false);
  };

  // The series path. Every date in it is a normal walk-in with the same
  // fields as the one-off insert above; the RPC skips any date taken since the
  // preview and reports it. ONE WhatsApp confirmation, for the first booking
  // actually created, under the same consent rule — the reminder cron covers
  // every booking in the series on its own.
  const handleCreateSeries = async () => {
    if (!profile || !service || !seriesReady || seriesAvailable === 0) return;
    setSubmitting(true);
    let result: Awaited<ReturnType<typeof createSeries.mutateAsync>>;
    try {
      result = await createSeries.mutateAsync({
        providerId: profile.id,
        serviceId: service.id,
        staffId: staffStepEnabled && effectiveStaffId ? effectiveStaffId : null,
        time,
        dates: series.availableKeys,
        requestedCount: repeatCount,
        customerName: name.trim(),
        customerPhone: phone.trim(),
        guestNotes: notes.trim() || null,
        whatsappConsent: consentActive,
      });
    } catch {
      setSubmitting(false);
      toast.error(t("seriesFailed"));
      return;
    }
    setSubmitting(false);

    if (result.code === "ALL_TAKEN") {
      // Stay open: the preview refetches and shows what changed.
      toast.error(t("seriesAllTaken"));
      return;
    }
    if (result.code !== "OK") {
      toast.error(t("seriesFailed"));
      return;
    }

    if (consentActive && result.firstBookingId) {
      notifyBookingConfirmed(result.firstBookingId);
    }
    const n = result.createdDates.length;
    const m = result.skippedDates.length;
    if (m === 0) {
      toast.success(n === 1 ? t("seriesCreatedOne") : t("seriesCreated").replace("{n}", String(n)));
    } else {
      const title = (n === 1 ? t("seriesCreatedSkippedOne") : t("seriesCreatedSkipped"))
        .replace("{n}", String(n))
        .replace("{m}", String(m));
      const dates = result.skippedDates
        .map((key) => {
          const [y, mo, d] = key.split("-").map(Number);
          return format(new Date(y, mo - 1, d), "d/M");
        })
        .join(", ");
      toast.success(title, { description: t("seriesSkippedDates").replace("{dates}", dates) });
    }
    setOpen(false);
  };

  const seriesStatusLabel = (status: SeriesDateStatus): string =>
    status === "available"
      ? t("seriesStatusAvailable")
      : status === "taken"
        ? t("seriesStatusTaken")
        : status === "staffOff"
          ? t("seriesStatusStaffOff").replace("{name}", selectedStaff?.name ?? "")
          : t("seriesStatusClosed");

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
        // Search mode takes the whole visible height (no top gap, no grab
        // handle) so 3–4 results fit between the search and the keyboard.
        className={cn(
          "flex flex-col gap-0 rounded-t-3xl border-t p-0",
          searching ? "max-h-[var(--vvh,100dvh)]" : "max-h-[calc(var(--vvh,100dvh)*0.92)]",
          providerDesktopSheet,
        )}
        // The new-customer view owns the top row (back · title · Add); the
        // corner ✕ would sit on top of Add.
        hideClose={!!customerView}
      >
        {/* Grab handle — bottom-sheet affordance (not in search mode) */}
        {!searching && <div className="mx-auto mt-3 h-1.5 w-10 shrink-0 rounded-full bg-muted-foreground/20" />}

        {customerView ? (
          <NewCustomerView
            key={customerView.kind}
            kind={customerView.kind}
            initialName={customerView.name}
            initialPhone={customerView.phone}
            onBack={() => {
              // Nothing saved. New / complete → the search (query kept); edit →
              // the card, unchanged.
              setCustomerView(null);
            }}
            onCommit={(n, p) => {
              setName(n);
              setPhone(p);
              setCustomerQuery("");
              setCustomerView(null);
            }}
          />
        ) : (
        <>

        {/* ── Header + step indicator (fixed; content below scrolls) ── */}
        <div className="shrink-0 px-5 pt-3">
          <SheetHeader className="text-start">
            <div className="flex items-center gap-1">
              {compact && (
                <button
                  type="button"
                  onClick={handleBack}
                  aria-label={t("back")}
                  className="-ms-3 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-foreground/70 active:bg-foreground/[0.06]"
                >
                  <BackArrow className="h-5 w-5" />
                </button>
              )}
              <SheetTitle className="text-lg">
                {compact ? t("walkInCustomerInfo") : t("newBookingSheetTitle")}
                <BranchSuffix />
              </SheetTitle>
            </div>
            <SheetDescription className={cn("text-xs", compact && "sr-only")}>{t("newBookingSheetDesc")}</SheetDescription>
          </SheetHeader>

          {!compact && (
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
          )}
        </div>

        {/* ── Scrollable step body ── */}
        <div
          ref={bodyRef}
          className={cn("flex-1 overflow-y-auto overflow-x-hidden px-5 pb-5", searching ? "pt-2" : "pt-4")}
          onFocusCapture={(e) => {
            if (step === infoStep && isTextEntry(e.target)) setFocusedField(e.target.id || "field");
          }}
          // Re-read once focus has landed, so name → phone (Next) doesn't flicker.
          onBlurCapture={() => {
            setTimeout(() => {
              const el = document.activeElement;
              setFocusedField(
                bodyRef.current && isTextEntry(el) && bodyRef.current.contains(el) ? el.id || "field" : null,
              );
            }, 0);
          }}
        >
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
                  {/* eligibleStaff, not activeStaff — only members who perform
                      the chosen service (Phase 3). Identical lists for a
                      provider who has assigned nothing. */}
                  {eligibleStaff.map((member, i) => {
                    const selected = effectiveStaffId === member.id;
                    return (
                      <motion.button
                        key={member.id}
                        type="button"
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ ...SPRING, delay: i * 0.04 }}
                        onClick={() => {
                          if (member.id !== effectiveStaffId) {
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
                          ? chosenDayStatus === "staffOff"
                            ? t("walkInOverrideStaffOffNote").replace(
                                "{name}",
                                selectedStaff?.name ?? ""
                              )
                            : chosenDayStatus === "closed"
                              ? t("walkInOverrideClosedNote")
                              : t("walkInOverrideFullNote")
                          : staffHasOwnHours
                            ? // Since Phase 3 a member's non-working days dash
                              // too, so the month-level legend has to name that
                              // third reason — otherwise it contradicts the
                              // day-specific note directly above it.
                              t("walkInOverrideLegendStaff").replace(
                                "{name}",
                                selectedStaff?.name ?? ""
                              )
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
                        {/* "No times" is not one fact. A member who isn't working
                            that day is a different problem from a booked-out one,
                            and the fix differs too — pick another member vs pick
                            another day. */}
                        <p className="text-sm text-muted-foreground">
                          {chosenDayStatus === "staffOff"
                            ? t("walkInStaffOffDay").replace("{name}", selectedStaff?.name ?? "")
                            : t("walkInNoSlots")}
                        </p>
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
                className="space-y-4"
              >
                {!searching && (
                <>
                {/* ── 1. Booking summary (+ repeats), at the top — the labelled
                    card, with slightly tighter padding so the step still fits. ── */}
                <div className="space-y-2 rounded-2xl border border-border bg-muted/40 px-4 py-3">
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

                  {/* ── Repeats (recurring series) ──
                      Only for a slot-list time on an open day (ruling 3). The
                      row is a disclosure: it opens the options below it; the
                      choice itself lives in the options. */}
                  {repeatOffered && (
                    <div className="-mx-1">
                      <button
                        type="button"
                        onClick={() => setRepeatOpen((o) => !o)}
                        aria-expanded={repeatOpen}
                        aria-controls="walkin-repeat-panel"
                        className="flex min-h-11 w-full items-center justify-between gap-3 rounded-xl px-1 text-start transition-colors active:bg-muted/60"
                      >
                        <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                          <Repeat className="h-3.5 w-3.5" />
                          {t("seriesRepeatLabel")}
                        </span>
                        <span className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
                          <span className={cn("truncate", seriesActive && "text-accent")}>
                            {seriesActive
                              ? t("seriesRepeatWeeklyValue").replace("{n}", String(repeatCount))
                              : t("seriesRepeatNo")}
                          </span>
                          <ChevronDown
                            className={cn(
                              "h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200",
                              repeatOpen && "rotate-180",
                            )}
                          />
                        </span>
                      </button>

                      {repeatOpen && (
                        <div id="walkin-repeat-panel" className="space-y-3 px-1 pb-1 pt-2">
                          {/* None / weekly */}
                          <div role="radiogroup" aria-label={t("seriesRepeatLabel")} className="grid grid-cols-2 gap-1 rounded-xl bg-secondary p-1">
                            {[
                              { on: false, label: t("seriesOptionNone") },
                              { on: true, label: t("seriesOptionWeekly") },
                            ].map((opt) => {
                              const selected = repeatWeekly === opt.on;
                              return (
                                <button
                                  key={String(opt.on)}
                                  type="button"
                                  role="radio"
                                  aria-checked={selected}
                                  onClick={() => setRepeatWeekly(opt.on)}
                                  className={cn(
                                    "min-h-11 rounded-lg px-2 text-sm font-semibold transition-colors",
                                    selected ? "bg-background text-foreground shadow-sm" : "text-muted-foreground",
                                  )}
                                >
                                  {opt.label}
                                </button>
                              );
                            })}
                          </div>

                          {repeatWeekly && (
                            <>
                              {/* Count, 2–12, this appointment included */}
                              <div className="flex items-center justify-between gap-3">
                                <span className="min-w-0 text-xs text-muted-foreground">{t("seriesCountLabel")}</span>
                                <div className="flex shrink-0 items-center gap-1">
                                  <button
                                    type="button"
                                    onClick={() => setRepeatCount((c) => Math.max(SERIES_MIN_COUNT, c - 1))}
                                    disabled={repeatCount <= SERIES_MIN_COUNT}
                                    aria-label={t("seriesCountFewer")}
                                    className="flex h-11 w-11 items-center justify-center rounded-xl border border-border bg-card transition-transform active:scale-95 disabled:opacity-40"
                                  >
                                    <Minus className="h-4 w-4" />
                                  </button>
                                  <span className="w-8 text-center text-base font-bold tabular-nums" aria-live="polite">
                                    {repeatCount}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => setRepeatCount((c) => Math.min(SERIES_MAX_COUNT, c + 1))}
                                    disabled={repeatCount >= SERIES_MAX_COUNT}
                                    aria-label={t("seriesCountMore")}
                                    className="flex h-11 w-11 items-center justify-center rounded-xl border border-border bg-card transition-transform active:scale-95 disabled:opacity-40"
                                  >
                                    <Plus className="h-4 w-4" />
                                  </button>
                                </div>
                              </div>

                              {/* Every date, with its status, BEFORE saving */}
                              {series.isError ? (
                                <p className="text-xs text-destructive">{t("seriesLoadError")}</p>
                              ) : !seriesReady ? (
                                <p className="flex items-center gap-2 text-xs text-muted-foreground">
                                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground" />
                                  {t("seriesLoading")}
                                </p>
                              ) : (
                                <>
                                  <ul className="divide-y divide-border/60 rounded-xl border border-border bg-card">
                                    {series.preview.map((p) => {
                                      const ok = p.status === "available";
                                      return (
                                        <li key={p.key} className="flex min-h-10 items-center justify-between gap-3 px-3 py-1.5">
                                          <span className={cn("min-w-0 truncate text-sm", ok ? "font-medium" : "text-muted-foreground line-through")}>
                                            {format(p.date, "EEE, d MMM", { locale: dateFnsLocale })}
                                          </span>
                                          <span
                                            className={cn(
                                              "inline-flex max-w-[55%] shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold",
                                              ok ? "bg-accent/10 text-accent" : "bg-muted text-muted-foreground",
                                            )}
                                          >
                                            {ok && <Check className="h-3 w-3 shrink-0" />}
                                            <span className="truncate">{seriesStatusLabel(p.status)}</span>
                                          </span>
                                        </li>
                                      );
                                    })}
                                  </ul>
                                  <p className="text-xs font-semibold" aria-live="polite">
                                    {seriesAvailable === 0
                                      ? t("seriesNoneAvailable")
                                      : seriesSkipped === 0
                                        ? t("seriesSummaryNoSkip").replace("{n}", String(seriesAvailable))
                                        : (seriesAvailable === 1 ? t("seriesSummaryOne") : t("seriesSummary"))
                                            .replace("{n}", String(seriesAvailable))
                                            .replace("{m}", String(seriesSkipped))}
                                  </p>
                                  {seriesSkipped > 0 && (
                                    <p className="text-[11px] leading-relaxed text-muted-foreground">{t("seriesSkipNote")}</p>
                                  )}
                                </>
                              )}
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                  {!!service && service.price > 0 && (
                    <div className="flex items-center justify-between gap-3 border-t border-border/60 pt-2">
                      <span className="text-xs text-muted-foreground">{t("total")}</span>
                      <span className="text-lg font-bold text-accent tabular-nums">₪{service.price}</span>
                    </div>
                  )}
                </div>
                </>
                )}

                {/* ── 2. Customer: search (nothing listed until typing) + "New
                    customer", or the card once set; then WhatsApp consent.
                    New / edit open the new-customer view. Same name/phone
                    state and payload. ── */}
                <div className="space-y-2">
                  <CustomerPicker
                    name={name}
                    phone={phone}
                    initialQuery={customerQuery}
                    onPick={(n, p) => {
                      // Same fill as the old autocomplete's pick.
                      setName(n);
                      setPhone(p);
                      setCustomerQuery("");
                    }}
                    onClear={() => {
                      setName("");
                      setPhone("");
                      setCustomerQuery("");
                    }}
                    onNew={(q) => {
                      // What was typed carries over: a phone if it looks like
                      // one (kept exactly as typed), otherwise the name.
                      setCustomerQuery(q);
                      setCustomerView(
                        q && looksLikePhone(q)
                          ? { kind: "new", name: "", phone: q }
                          : { kind: "new", name: q, phone: "" },
                      );
                    }}
                    onEdit={() => setCustomerView({ kind: "edit", name, phone })}
                    onIncomplete={(n, p, q) => {
                      setCustomerQuery(q);
                      setCustomerView({ kind: "complete", name: n, phone: p });
                    }}
                  />
                  {whatsappConsentOffered && !searching && (
                    <div className="space-y-1">
                      {/* The whole row is the label, so the tap target is the
                          full width at 44px min height, not the 20px box. A
                          click on the box itself is not re-dispatched by the
                          label (interactive descendant), so it toggles once.
                          Never disabled: the provider may ask before typing
                          the number, and an invalid one is reported below. */}
                      <Label className="flex min-h-11 cursor-pointer items-center gap-3 py-2 text-sm font-normal leading-snug">
                        <Checkbox
                          checked={whatsappConsent}
                          onCheckedChange={(v) => setWhatsappConsent(v === true)}
                          aria-invalid={consentPhoneInvalid || undefined}
                          aria-describedby={consentPhoneInvalid ? "walkin-whatsapp-consent-error" : undefined}
                          className="h-5 w-5 rounded-[6px]"
                        />
                        <span className="flex-1 text-start">{t("walkInWhatsappConsent")}</span>
                      </Label>
                      {consentPhoneInvalid && (
                        <p
                          id="walkin-whatsapp-consent-error"
                          aria-live="polite"
                          className="ps-8 text-xs text-destructive"
                        >
                          {t("walkInWhatsappPhoneInvalid")}
                        </p>
                      )}
                    </div>
                  )}
                </div>

                {/* ── 3. Notes, collapsed to a link; open while it has text.
                    Hidden in search mode. ── */}
                {searching ? null : notesOpen || notes.trim() ? (
                  <Textarea
                    ref={notesRef}
                    id="walkin-notes"
                    aria-label={t("walkInNotes")}
                    // Done closes the keyboard (Shift+Enter still adds a line
                    // on a hardware keyboard), bringing the footer back.
                    enterKeyHint="done"
                    onKeyDown={(e) => {
                      if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
                      e.preventDefault();
                      e.currentTarget.blur();
                    }}
                    // Left empty: fold back to the link.
                    onBlur={() => { if (!notes.trim()) setNotesOpen(false); }}
                    rows={2}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder={t("walkInNotesPlaceholder")}
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => setNotesOpen(true)}
                    className="-ms-1 inline-flex min-h-11 items-center gap-1.5 rounded-xl px-1 text-sm font-semibold text-accent transition-colors active:bg-accent/10"
                  >
                    <Plus className="h-4 w-4" />
                    {t("nbAddNote")}
                  </button>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* ── Sticky footer: Back / Continue or Create ──
            Steps aside in compact mode (keyboard up in step 4); the header
            keeps a back control. Returns when the keyboard closes. */}
        {!compact && (
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
                  ) : seriesActive && seriesReady && seriesAvailable > 0 ? (
                    seriesAvailable === 1
                      ? t("seriesCreateBtnOne")
                      : t("seriesCreateBtn").replace("{n}", String(seriesAvailable))
                  ) : (
                    t("walkInCreate")
                  )}
                </Button>
              </motion.div>
            )}
          </div>
        </div>
        )}
        </>
        )}
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
            {pendingOffDayStatus === "staffOff"
              ? t("walkInOffDayConfirmStaffOff").replace("{name}", selectedStaff?.name ?? "")
              : pendingOffDayStatus === "closed"
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
