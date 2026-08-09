import { useState, useMemo, useEffect, useRef, useCallback, createContext, useContext, type CSSProperties } from "react";
import { format, isSameDay, parseISO, isAfter, isToday, getDay, startOfWeek, addDays } from "date-fns";
import { he, ar, enUS } from "date-fns/locale";
import { Calendar as CalendarIcon, Clock, Phone, Banknote, XCircle, Trash2, Users, ChevronDown, ChevronUp, MessageCircle, CheckCircle2, Sparkles, Lock, CalendarClock, StickyNote, UserRound, MoonStar } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import { useLang } from "@/contexts/LangContext";
import { useProviderBookings, useCancelBooking, useDeleteBooking, useCancelGroupClass, useApproveBooking, useRejectBooking, useSaveTreatmentNote, type EnrichedBooking } from "@/hooks/useProviderBookings";
import { useProviderProfile } from "@/hooks/useProviderProfile";
import { useProviderServices } from "@/hooks/useProviderServices";
import { useProviderActiveStaff } from "@/hooks/useProviderStaff";
import { useProviderAvailability } from "@/hooks/useProviderAvailability";
import { useProviderClassSchedule, ClassScheduleEntry } from "@/hooks/useProviderClassSchedule";
import { BackArrow, ForwardArrow } from "@/components/ui/directional-icon";
import { NewBookingSheet } from "@/components/dashboard/NewBookingSheet";
import { RescheduleSheet } from "@/components/dashboard/RescheduleSheet";
import { DEFAULT_REMINDER_TEMPLATE } from "@/components/dashboard/BusinessProfileTab";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { assignOverlapColumns } from "@/lib/weeklyOverlap";
import { DEFAULT_SERVICE_COLOR, normalizeColor, withAlpha, darken } from "@/lib/serviceColors";
import {
  resolveDayHours,
  isOutsideDayWindow,
  type DateOverrideRow,
  type MonthlySettings,
  type WeeklyRow,
} from "@/lib/availabilityResolver";
import type { DayContentProps } from "react-day-picker";

function toWhatsAppUrl(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("972")) return `https://wa.me/${digits}`;
  const local = digits.startsWith("0") ? digits.slice(1) : digits;
  return `https://wa.me/972${local}`;
}

function applyTemplate(template: string, vars: Record<string, string>): string {
  return Object.entries(vars).reduce((msg, [key, val]) => msg.replaceAll(`{${key}}`, val), template);
}

function buildReminderMessage(booking: EnrichedBooking, template: string): string {
  const date = format(parseISO(booking.booking_date), "d בMMM", { locale: he });
  return applyTemplate(template, {
    customer_name: booking.customer_name || "לקוח יקר",
    service_name: booking.service_names.join(", "),
    date,
    time: booking.booking_time,
  });
}

// ── Service color coding ───────────────────────────────────────────────────
// A single resolver, provided by CalendarTab, answers "what color is this
// item?" for every view. It returns null whenever the provider's master switch
// (provider_profiles.service_colors_enabled) is off — and every consumer treats
// null as "render exactly as before", so the feature is invisible until opted
// into. Passed by context rather than props because the views nest three deep
// (CalendarTab → WeeklyView → Dialog → BookingCard).
type ItemColorResolver = (item: CalendarItem) => string | null;

const ItemColorContext = createContext<ItemColorResolver>(() => null);

function useItemColorResolver(): ItemColorResolver {
  return useContext(ItemColorContext);
}

// ── Out-of-hours marker ────────────────────────────────────────────────────
// Answers "does this booking sit outside the provider's hours for its day?".
// Purely DERIVED — no column, no migration: the day's window is re-resolved
// through the same shared resolveDayHours the slot pipeline uses, and the
// booking's time compared against it. A closed or blocked day resolves to null,
// which makes every booking on it out-of-hours, which is correct.
//
// Passed by context for the same reason the color resolver is: the views nest
// three deep and only CalendarTab holds the schedule inputs. The default
// returns false, so any consumer rendered outside the provider is unmarked
// rather than wrong.
type OutOfHoursResolver = (bookingDate: string, bookingTime: string) => boolean;

const OutOfHoursContext = createContext<OutOfHoursResolver>(() => false);

function useOutOfHours(): OutOfHoursResolver {
  return useContext(OutOfHoursContext);
}

// Small amber chip. Shown only when the marker fires, so calendars for
// providers who never book out of hours look exactly as they do today.
function OutOfHoursBadge() {
  const { t } = useLang();
  return (
    <Badge
      variant="outline"
      className="shrink-0 gap-1 border-amber-200 bg-amber-500/15 text-[10px] text-amber-700"
    >
      <MoonStar className="h-3 w-3" />
      {t("outOfHoursBadge")}
    </Badge>
  );
}

// Inline styles for a booking card: 4px accent edge on the leading side plus a
// very light tint of the same color. Logical border (not physical `left`) so
// the stripe hugs the start edge in RTL Hebrew/Arabic and LTR English alike.
function cardColorStyle(color: string | null, tinted: boolean): CSSProperties | undefined {
  if (!color) return undefined;
  return {
    borderInlineStartWidth: 4,
    borderInlineStartColor: color,
    ...(tinted ? { backgroundColor: withAlpha(color, 0.07) } : {}),
  };
}

const statusConfig: Record<string, { label: string; className: string }> = {
  confirmed: { label: "מאושר", className: "bg-emerald-500/15 text-emerald-700 border-emerald-200" },
  pending: { label: "ממתין", className: "bg-amber-500/15 text-amber-700 border-amber-200" },
  cancelled: { label: "בוטל", className: "bg-red-500/15 text-red-700 border-red-200" },
};

function TreatmentNoteBox({ booking }: { booking: EnrichedBooking }) {
  const { t } = useLang();
  const { mutate: saveNote, isPending } = useSaveTreatmentNote();
  const [note, setNote] = useState(booking.treatment_notes || "");
  const [showSaved, setShowSaved] = useState(false);
  const savedNote = useRef(booking.treatment_notes || "");

  const doSave = (value: string) => {
    saveNote({ bookingId: booking.id, note: value }, {
      onSuccess: () => {
        savedNote.current = value;
        setShowSaved(true);
        setTimeout(() => setShowSaved(false), 2000);
      },
      onError: (err) => toast.error(err instanceof Error ? err.message : "שגיאה בשמירה"),
    });
  };

  useEffect(() => {
    if (note === savedNote.current) return;
    const timer = setTimeout(() => doSave(note), 2000);
    return () => clearTimeout(timer);
  }, [note]);

  return (
    <div className="space-y-1.5 pt-2 border-t border-border/50">
      <textarea
        className="w-full text-xs rounded-lg border border-gray-200 bg-gray-50/80 p-2 resize-none text-foreground focus:outline-none focus:border-gray-300 placeholder:text-muted-foreground/40"
        rows={2}
        placeholder={t("treatmentNotesPlaceholder")}
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-emerald-600">
          {showSaved ? t("noteSaved") : ""}
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="text-[11px] h-7 px-2 text-muted-foreground hover:text-foreground"
          onClick={() => doSave(note)}
          disabled={isPending || note === savedNote.current}
        >
          {isPending ? "..." : t("saveNote")}
        </Button>
      </div>
    </div>
  );
}

function BookingCard({ booking, index, color = null }: { booking: EnrichedBooking; index: number; color?: string | null }) {
  const { t } = useLang();
  const cancelBooking = useCancelBooking();
  const deleteBooking = useDeleteBooking();
  const approveBooking = useApproveBooking();
  const rejectBooking = useRejectBooking();
  const { profile } = useProviderProfile();
  const reminderTemplate = profile?.reminder_message_template || DEFAULT_REMINDER_TEMPLATE;
  const outOfHours = useOutOfHours()(booking.booking_date, booking.booking_time);

  const initials = booking.customer_name
    ? booking.customer_name.split(" ").map((w) => w[0]).join("").slice(0, 2)
    : "?";

  const status = statusConfig[booking.status] || statusConfig.confirmed;
  const isCancelled = booking.status === "cancelled";
  const isPending = booking.status === "pending";
  const isConfirmed = booking.status === "confirmed";
  // A confirmed booking whose start time has passed is treated as completed:
  // grayed out with a "הושלם" badge. Cancelled/pending keep their own state.
  const isCompleted = isConfirmed && new Date(`${booking.booking_date}T${booking.booking_time}`).getTime() < Date.now();

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ delay: index * 0.04, duration: 0.25 }}
      className={cn("rounded-2xl border border-border bg-card p-4 space-y-3", isCompleted && "grayscale-[0.3] opacity-90 bg-muted/15")}
      // Completed bookings keep their gray wash — only the edge is tinted, so
      // "past" still reads as past even with colors on.
      style={cardColorStyle(color, !isCompleted)}
    >
      <div className="flex items-center gap-3">
        <Avatar className="h-10 w-10 border-2 border-accent/20">
          <AvatarImage src={booking.customer_avatar || undefined} />
          <AvatarFallback className="bg-accent/10 text-accent text-sm font-bold">{initials}</AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold truncate">
            {booking.customer_name || booking.customer_phone || "לקוח אנונימי"}
          </p>
          {booking.customer_phone && (
            <div className="flex items-center gap-2 mt-0.5">
              <a
                href={`tel:${booking.customer_phone}`}
                className="text-xs text-muted-foreground flex items-center gap-1 hover:text-foreground transition-colors"
              >
                <Phone className="h-3 w-3" />
                {booking.customer_phone}
              </a>
              <a
                href={toWhatsAppUrl(booking.customer_phone)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-emerald-600 flex items-center gap-0.5 hover:text-emerald-700 transition-colors"
              >
                <MessageCircle className="h-3 w-3" />
                WhatsApp
              </a>
            </div>
          )}
        </div>
        <Badge variant="outline" className={`text-[10px] shrink-0 ${isCompleted ? "bg-muted text-muted-foreground border-border" : status.className}`}>
          {isCompleted ? t("completed") : status.label}
        </Badge>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
        <span className="flex items-center gap-1"><Clock className="h-3.5 w-3.5" />{booking.booking_time}</span>
        <span className="flex items-center gap-1"><Banknote className="h-3.5 w-3.5" />₪{booking.total_price}</span>
        {/* Derived, never stored — see OutOfHoursContext. */}
        {outOfHours && <OutOfHoursBadge />}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {booking.service_names.map((name, i) => (
          <span key={i} className="text-[11px] px-2.5 py-1 rounded-full bg-secondary text-secondary-foreground">{name}</span>
        ))}
        {/* Multi-staff: who serves this booking. Absent when staff_id is NULL
            (non-staff providers, group/class, legacy) — card unchanged. */}
        {booking.staff_name && (
          <span className="inline-flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-full bg-accent/10 text-accent font-medium">
            <UserRound className="h-3 w-3" />
            {booking.staff_name}
          </span>
        )}
      </div>

      {/* Customer note — what the customer wrote when booking (if any) */}
      {booking.customer_notes && (
        <div className="rounded-lg border border-accent/20 bg-accent/5 p-2.5">
          <div className="flex items-start gap-1.5">
            <StickyNote className="h-3.5 w-3.5 text-accent shrink-0 mt-0.5" />
            <p className="text-xs text-foreground/80 whitespace-pre-wrap break-words min-w-0">
              <span className="font-medium text-accent">{t("customerWrote")}: </span>
              {booking.customer_notes}
            </p>
          </div>
        </div>
      )}

      {/* Approve / Reject row for pending bookings */}
      {isPending && (
        <div className="flex gap-2">
          <Button
            variant="outline" size="sm"
            className="flex-1 text-xs h-8 text-emerald-700 border-emerald-300 hover:bg-emerald-50"
            onClick={() => approveBooking.mutate(booking.id, {
              onSuccess: () => toast.success("התור אושר ✅"),
              onError: () => toast.error("שגיאה באישור התור"),
            })}
            disabled={approveBooking.isPending || rejectBooking.isPending}
          >
            <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
            {approveBooking.isPending ? "מאשר..." : "אשר תור"}
          </Button>
          <Button
            variant="outline" size="sm"
            className="flex-1 text-xs h-8 text-red-600 border-red-200 hover:bg-red-50"
            onClick={() => rejectBooking.mutate(booking.id, {
              onSuccess: () => toast.success("התור נדחה"),
              onError: () => toast.error("שגיאה בדחיית התור"),
            })}
            disabled={approveBooking.isPending || rejectBooking.isPending}
          >
            <XCircle className="h-3.5 w-3.5 mr-1" />
            {rejectBooking.isPending ? "דוחה..." : "דחה תור"}
          </Button>
        </div>
      )}

      {/* Reschedule — confirmed, not-yet-started bookings only */}
      {isConfirmed && !isCompleted && (
        <RescheduleSheet
          booking={booking}
          trigger={
            <Button variant="outline" size="sm" className="w-full text-xs h-8 text-accent border-accent/30 hover:bg-accent/5">
              <CalendarClock className="h-3.5 w-3.5 mr-1" />
              {t("reschedule")}
            </Button>
          }
        />
      )}

      <div className="flex gap-2 pt-1">
        {!isCancelled && !isPending && (
          <Button variant="outline" size="sm" className="flex-1 text-xs h-8 text-amber-600 border-amber-200 hover:bg-amber-50"
            onClick={() => cancelBooking.mutate(booking.id, {
              onSuccess: () => toast.success("התור בוטל בהצלחה"),
              onError: () => toast.error("שגיאה בביטול התור"),
            })}
            disabled={cancelBooking.isPending}
          >
            <XCircle className="h-3.5 w-3.5 mr-1" />
            {cancelBooking.isPending ? "מבטל..." : "בטל תור"}
          </Button>
        )}
        <Button variant="outline" size="sm"
          className={`${isCancelled || isPending ? 'flex-1' : ''} text-xs h-8 text-red-600 border-red-200 hover:bg-red-50`}
          onClick={() => deleteBooking.mutate(booking.id, {
            onSuccess: () => toast.success("התור נמחק"),
            onError: () => toast.error("שגיאה במחיקת התור"),
          })}
          disabled={deleteBooking.isPending}
        >
          <Trash2 className="h-3.5 w-3.5 mr-1" />
          {deleteBooking.isPending ? "מוחק..." : "מחק"}
        </Button>
      </div>

      {/* WhatsApp reminder — confirmed bookings only */}
      {isConfirmed && booking.customer_phone && (
        <a
          href={`${toWhatsAppUrl(booking.customer_phone)}?text=${encodeURIComponent(buildReminderMessage(booking, reminderTemplate))}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-1.5 w-full text-xs h-8 rounded-md border border-emerald-300 bg-white text-emerald-700 hover:bg-emerald-50 transition-colors font-medium"
        >
          <MessageCircle className="h-3.5 w-3.5" />
          שלח תזכורת 🔔
        </a>
      )}

      {/* Treatment notes — confirmed bookings, only when feature is enabled */}
      {isConfirmed && profile?.treatment_notes_enabled && (
        <TreatmentNoteBox booking={booking} />
      )}
    </motion.div>
  );
}

function GroupClassCard({ time, bookings, serviceName, maxCapacity, index, color = null }: {
  time: string;
  bookings: EnrichedBooking[];
  serviceName: string;
  maxCapacity: number;
  index: number;
  color?: string | null;
}) {
  const { t } = useLang();
  const [expanded, setExpanded] = useState(false);
  const cancelBooking = useCancelBooking();
  const cancelGroupClass = useCancelGroupClass();

  const activeBookings = bookings.filter(b => b.status !== 'cancelled');
  const bookedCount = activeBookings.length;
  // Every booking in the group shares one date+time, so the first one answers
  // for the whole card.
  const outOfHours = useOutOfHours()(bookings[0]?.booking_date ?? "", time);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ delay: index * 0.04, duration: 0.25 }}
      className="rounded-2xl border border-blue-200 bg-card p-4 space-y-3"
      style={cardColorStyle(color, true)}
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-700">
              <Users className="h-3.5 w-3.5" /> {t("groupClass")}
            </span>
            <Badge className="bg-blue-100 text-blue-700 border-blue-200 text-[10px] px-1.5">
              {bookedCount}/{maxCapacity} {t("classSlots")}
            </Badge>
            {outOfHours && <OutOfHoursBadge />}
          </div>
          <p className="font-semibold text-sm truncate">{serviceName}</p>
          <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
            <Clock className="h-3 w-3" /> {time}
          </p>
        </div>
        <button onClick={() => setExpanded(v => !v)} className="p-1.5 rounded-lg hover:bg-secondary transition-colors ml-2">
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
      </div>

      {/* Participant list */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="space-y-2 overflow-hidden"
          >
            {bookings.map((b) => {
              const initials = b.customer_name
                ? b.customer_name.split(" ").map(w => w[0]).join("").slice(0, 2)
                : "?";
              const isCancelled = b.status === 'cancelled';
              return (
                <div key={b.id} className={`flex items-center gap-3 py-2 border-t border-border ${isCancelled ? 'opacity-50' : ''}`}>
                  <Avatar className="h-8 w-8">
                    <AvatarImage src={b.customer_avatar || undefined} />
                    <AvatarFallback className="bg-accent/10 text-accent text-xs font-bold">{initials}</AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">
                      {b.customer_name || b.customer_phone || "לקוח אנונימי"}
                    </p>
                    {b.customer_phone && (
                      <div className="flex items-center gap-2 mt-0.5">
                        <a
                          href={`tel:${b.customer_phone}`}
                          className="text-xs text-muted-foreground flex items-center gap-1 hover:text-foreground transition-colors"
                        >
                          <Phone className="h-3 w-3" />
                          {b.customer_phone}
                        </a>
                        <a
                          href={toWhatsAppUrl(b.customer_phone)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-emerald-600 flex items-center gap-0.5 hover:text-emerald-700 transition-colors"
                        >
                          <MessageCircle className="h-3 w-3" />
                          WhatsApp
                        </a>
                      </div>
                    )}
                  </div>
                  {isCancelled ? (
                    <span className="text-[10px] text-red-500 font-medium">בוטל</span>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-xs h-7 px-2 text-amber-600 border-amber-200 shrink-0"
                      onClick={() => cancelBooking.mutate(b.id, {
                        onSuccess: () => toast.success("משתתף הוסר מהשיעור"),
                        onError: () => toast.error("שגיאה בביטול"),
                      })}
                      disabled={cancelBooking.isPending}
                    >
                      <XCircle className="h-3 w-3 mr-1" /> הסר
                    </Button>
                  )}
                </div>
              );
            })}

            {activeBookings.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                className="w-full text-xs h-8 text-red-600 border-red-200 hover:bg-red-50 mt-2"
                onClick={() => cancelGroupClass.mutate(activeBookings.map(b => b.id), {
                  onSuccess: () => toast.success("השיעור בוטל"),
                  onError: () => toast.error("שגיאה בביטול השיעור"),
                })}
                disabled={cancelGroupClass.isPending}
              >
                <XCircle className="h-3.5 w-3.5 mr-1" />
                {cancelGroupClass.isPending ? "מבטל..." : t("cancelEntireClass")}
              </Button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function ClassSlotCard({ classEntry, bookings, index, reminderTemplate, color = null }: {
  classEntry: ClassScheduleEntry;
  bookings: EnrichedBooking[];
  index: number;
  reminderTemplate: string;
  color?: string | null;
}) {
  const { t } = useLang();
  const [expanded, setExpanded] = useState(false);
  const cancelBooking = useCancelBooking();
  const isGroup = classEntry.class_type === 'group';

  const activeBookings = bookings.filter(b => b.status !== 'cancelled');
  const bookedCount = activeBookings.length;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ delay: index * 0.04, duration: 0.25 }}
      className="rounded-2xl border border-accent/30 bg-card p-4 space-y-3"
      style={cardColorStyle(color, true)}
    >
      <div className="flex items-center justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className={`inline-flex items-center gap-1 text-[11px] font-semibold ${isGroup ? 'text-accent' : 'text-muted-foreground'}`}>
              {isGroup ? <Users className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
              {isGroup ? t("groupClass") : t("privateService")}
            </span>
            <Badge className={`text-[10px] px-1.5 ${bookedCount >= classEntry.max_capacity ? 'bg-red-100 text-red-700 border-red-200' : 'bg-accent/10 text-accent border-accent/20'}`}>
              {bookedCount}/{classEntry.max_capacity} {t("classSlots")}
            </Badge>
          </div>
          <p className="font-semibold text-sm truncate">{classEntry.class_name}</p>
          <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
            <Clock className="h-3 w-3" /> {classEntry.start_time.slice(0, 5)} · {classEntry.duration_minutes} {t("min")}
          </p>
        </div>
        <button
          onClick={() => setExpanded(v => !v)}
          className="p-1.5 rounded-lg hover:bg-secondary transition-colors ml-2"
        >
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
      </div>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="space-y-2 overflow-hidden"
          >
            {activeBookings.length === 0 ? (
              <p className="text-xs text-muted-foreground pt-2 border-t border-border/50">אין משתתפים רשומים עדיין</p>
            ) : (
              activeBookings.map((b) => {
                const initials = b.customer_name
                  ? b.customer_name.split(" ").map(w => w[0]).join("").slice(0, 2)
                  : "?";
                return (
                  <div key={b.id} className="flex items-center gap-3 py-2 border-t border-border">
                    <Avatar className="h-8 w-8">
                      <AvatarImage src={b.customer_avatar || undefined} />
                      <AvatarFallback className="bg-accent/10 text-accent text-xs font-bold">{initials}</AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{b.customer_name || b.customer_phone || "לקוח אנונימי"}</p>
                      {b.customer_phone && (
                        <div className="flex items-center gap-2 mt-0.5">
                          <a href={`tel:${b.customer_phone}`} className="text-xs text-muted-foreground flex items-center gap-1 hover:text-foreground transition-colors">
                            <Phone className="h-3 w-3" />{b.customer_phone}
                          </a>
                          <a href={toWhatsAppUrl(b.customer_phone)} target="_blank" rel="noopener noreferrer" className="text-xs text-emerald-600 flex items-center gap-0.5 hover:text-emerald-700 transition-colors">
                            <MessageCircle className="h-3 w-3" />WhatsApp
                          </a>
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Badge variant="outline" className={`text-[10px] ${statusConfig[b.status]?.className || ''}`}>
                        {statusConfig[b.status]?.label || b.status}
                      </Badge>
                      {b.status === 'confirmed' && b.customer_phone && (
                        <a
                          href={`${toWhatsAppUrl(b.customer_phone)}?text=${encodeURIComponent(
                            applyTemplate(reminderTemplate, {
                              customer_name: b.customer_name || "לקוח יקר",
                              service_name: classEntry.class_name,
                              date: format(parseISO(b.booking_date), "d בMMM", { locale: he }),
                              time: b.booking_time,
                            })
                          )}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-1 rounded-md border border-emerald-300 text-emerald-700 hover:bg-emerald-50 transition-colors"
                        >
                          <MessageCircle className="h-3 w-3" />
                          תזכורת
                        </a>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-xs h-7 px-2 text-amber-600 border-amber-200"
                        onClick={() => cancelBooking.mutate(b.id, {
                          onSuccess: () => toast.success("משתתף הוסר מהשיעור"),
                          onError: () => toast.error("שגיאה בביטול"),
                        })}
                        disabled={cancelBooking.isPending}
                      >
                        <XCircle className="h-3 w-3 mr-1" /> הסר
                      </Button>
                    </div>
                  </div>
                );
              })
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

type CalendarItem =
  | { type: 'private'; booking: EnrichedBooking }
  | { type: 'group'; time: string; bookings: EnrichedBooking[]; maxCapacity: number; serviceName: string }
  | { type: 'class_slot'; classEntry: ClassScheduleEntry; bookings: EnrichedBooking[] };

type ViewMode = 'daily' | 'weekly' | 'monthly';

// Build the ordered list of calendar items (private bookings, grouped classes, or
// fitness class slots) for a single date. Shared by every view mode so the daily,
// weekly and monthly screens all render bookings identically.
function buildCalendarItems(
  date: Date,
  bookings: EnrichedBooking[],
  schedule: ClassScheduleEntry[],
  isFitnessStudio: boolean,
  groupLabel: string,
): CalendarItem[] {
  const bookingsForDate = bookings
    .filter((b) => isSameDay(parseISO(b.booking_date), date))
    .sort((a, b) => a.booking_time.localeCompare(b.booking_time));

  const items: CalendarItem[] = [];

  if (isFitnessStudio) {
    const dayOfWeek = getDay(date);
    const dateStr = format(date, "yyyy-MM-dd");
    const classesForDay = schedule.filter(c => c.day_of_week === dayOfWeek && c.is_active);

    for (const classEntry of classesForDay) {
      const classBookings = bookings.filter(
        b => b.class_schedule_id === classEntry.id && b.booking_date === dateStr
      );
      items.push({ type: 'class_slot', classEntry, bookings: classBookings });
    }

    const orphanBookings = bookingsForDate.filter(b => !b.class_schedule_id);
    for (const b of orphanBookings) {
      items.push({ type: 'private', booking: b });
    }

    return items.sort((a, b) => {
      const timeA = a.type === 'class_slot' ? a.classEntry.start_time : a.type === 'private' ? a.booking.booking_time : '';
      const timeB = b.type === 'class_slot' ? b.classEntry.start_time : b.type === 'private' ? b.booking.booking_time : '';
      return timeA.localeCompare(timeB);
    });
  }

  const groupMap = new Map<string, EnrichedBooking[]>();

  for (const b of bookingsForDate) {
    if (b.is_group_service) {
      const key = `${b.booking_time}::${b.service_ids[0]}`;
      if (!groupMap.has(key)) groupMap.set(key, []);
      groupMap.get(key)!.push(b);
    } else {
      items.push({ type: 'private', booking: b });
    }
  }

  for (const [, grpBookings] of groupMap) {
    items.push({
      type: 'group',
      time: grpBookings[0].booking_time,
      bookings: grpBookings,
      maxCapacity: grpBookings[0].service_capacity,
      serviceName: grpBookings[0].service_names[0] || groupLabel,
    });
  }

  return items.sort((a, b) => {
    const timeA = a.type === 'private' ? a.booking.booking_time : a.type === 'group' ? a.time : '';
    const timeB = b.type === 'private' ? b.booking.booking_time : b.type === 'group' ? b.time : '';
    return timeA.localeCompare(timeB);
  });
}

// Normalised HH:MM start time for an item — used to slot items onto the daily timeline.
function itemTime(item: CalendarItem): string {
  if (item.type === 'private') return item.booking.booking_time.slice(0, 5);
  if (item.type === 'group') return item.time.slice(0, 5);
  return item.classEntry.start_time.slice(0, 5);
}

function timeToMin(t: string): number {
  const [h, m] = t.slice(0, 5).split(":").map(Number);
  return h * 60 + m;
}

function minToTime(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

// Slot labels from start (inclusive) to end (exclusive), stepping by the
// provider's configured interval so the timeline matches the customer flow.
function generateSlots(start: string, end: string, stepMinutes: number): string[] {
  const s = timeToMin(start);
  const e = timeToMin(end);
  const step = stepMinutes > 0 ? stepMinutes : 15;
  const out: string[] = [];
  for (let t = s; t < e; t += step) out.push(minToTime(t));
  return out;
}

// Renders a list of calendar items using the existing card components. Shared by all views.
function CalendarItemsList({ items, reminderTemplate }: { items: CalendarItem[]; reminderTemplate: string }) {
  const colorOf = useItemColorResolver();
  return (
    <AnimatePresence mode="popLayout">
      <div className="space-y-3">
        {items.map((item, i) =>
          item.type === 'class_slot' ? (
            <ClassSlotCard
              key={`slot-${item.classEntry.id}`}
              classEntry={item.classEntry}
              bookings={item.bookings}
              index={i}
              reminderTemplate={reminderTemplate}
              color={colorOf(item)}
            />
          ) : item.type === 'group' ? (
            <GroupClassCard
              key={`group-${item.time}-${item.serviceName}`}
              time={item.time}
              bookings={item.bookings}
              serviceName={item.serviceName}
              maxCapacity={item.maxCapacity}
              index={i}
              color={colorOf(item)}
            />
          ) : (
            <BookingCard key={item.booking.id} booking={item.booking} index={i} color={colorOf(item)} />
          )
        )}
      </div>
    </AnimatePresence>
  );
}

function NoServicesCard() {
  const { t } = useLang();
  const navigate = useNavigate();
  return (
    <div className="text-center py-10 px-5 rounded-2xl border border-accent/30 bg-accent/5">
      <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-accent/10">
        <Sparkles className="h-6 w-6 text-accent" />
      </div>
      <p className="text-sm font-medium text-foreground">{t("setupToTakeBookings")}</p>
      <Button
        className="mt-4 gap-1.5"
        onClick={() => navigate("/dashboard", { state: { tab: "services" } })}
      >
        {t("setupAddServicesCta")}
        <ForwardArrow className="h-4 w-4" />
      </Button>
    </div>
  );
}

// Shared prev/next navigation header used by the daily and weekly views.
function NavHeader({ title, prevLabel, nextLabel, onPrev, onNext, selectedDate, showNewBooking }: {
  title: string;
  prevLabel: string;
  nextLabel: string;
  onPrev: () => void;
  onNext: () => void;
  selectedDate: Date;
  showNewBooking: boolean;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <Button variant="outline" size="sm" className="h-8 px-2 text-xs gap-1 shrink-0" onClick={onPrev}>
          <BackArrow className="h-3.5 w-3.5" />
          {prevLabel}
        </Button>
        <h3 className="text-sm font-semibold text-center min-w-0 truncate flex-1">{title}</h3>
        <Button variant="outline" size="sm" className="h-8 px-2 text-xs gap-1 shrink-0" onClick={onNext}>
          {nextLabel}
          <ForwardArrow className="h-3.5 w-3.5" />
        </Button>
      </div>
      {showNewBooking && (
        <div className="flex justify-end">
          <NewBookingSheet selectedDate={selectedDate} />
        </div>
      )}
    </div>
  );
}

// Display metadata for a booking block on the week grid.
function blockInfo(item: CalendarItem): { time: string; name: string; sub: string; cls: string } {
  if (item.type === 'group') {
    const active = item.bookings.filter((b) => b.status !== 'cancelled').length;
    return {
      time: item.time.slice(0, 5),
      name: item.serviceName,
      sub: `${active}/${item.maxCapacity}`,
      cls: "bg-blue-500/15 border-blue-300 text-blue-800",
    };
  }
  if (item.type === 'class_slot') {
    const active = item.bookings.filter((b) => b.status !== 'cancelled').length;
    return {
      time: item.classEntry.start_time.slice(0, 5),
      name: item.classEntry.class_name,
      sub: `${active}/${item.classEntry.max_capacity}`,
      cls: "bg-accent/15 border-accent/30 text-accent",
    };
  }
  const b = item.booking;
  const cls = b.status === 'pending'
    ? "bg-amber-500/15 border-amber-300 text-amber-800"
    : b.status === 'cancelled'
      ? "bg-red-500/10 border-red-200 text-red-700 line-through"
      : "bg-emerald-500/15 border-emerald-300 text-emerald-800";
  return {
    time: b.booking_time.slice(0, 5),
    name: b.customer_name || b.customer_phone || "לקוח",
    // Weekly-grid blocks are tiny — the staff name rides in the sub line
    // after the services (only present when the booking has one).
    sub: b.staff_name
      ? `${b.service_names.join(", ")} · ${b.staff_name}`
      : b.service_names.join(", "),
    cls,
  };
}

// True weekly calendar grid: 7 day columns (Sun–Sat) × hourly time axis, with each
// booking placed as a block by its start time and service duration. Scrolls
// horizontally on narrow screens. Full booking actions stay in daily/monthly views.
function WeeklyView({ selectedDate, bookings, schedule, isFitnessStudio, reminderTemplate, noServices, onPrev, onNext }: {
  selectedDate: Date;
  bookings: EnrichedBooking[];
  schedule: ClassScheduleEntry[];
  isFitnessStudio: boolean;
  reminderTemplate: string;
  noServices: boolean;
  onPrev: () => void;
  onNext: () => void;
}) {
  const { t, lang } = useLang();
  const dateFnsLocale = lang === "he" ? he : lang === "ar" ? ar : enUS;
  const { availability } = useProviderAvailability();
  const { services } = useProviderServices();
  const colorOf = useItemColorResolver();
  const outOfHoursOf = useOutOfHours();
  const [selected, setSelected] = useState<CalendarItem | null>(null);

  const weekStart = startOfWeek(selectedDate, { weekStartsOn: 0 });
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const weekEnd = days[6];
  const title = `${format(weekStart, "d MMM", { locale: dateFnsLocale })} – ${format(weekEnd, "d MMM", { locale: dateFnsLocale })}`;

  const durationMap = new Map(services.map((s) => [s.id, s.duration]));
  const itemDuration = (it: CalendarItem): number => {
    if (it.type === 'class_slot') return it.classEntry.duration_minutes || 15;
    const ids = it.type === 'private' ? it.booking.service_ids : it.bookings[0].service_ids;
    const total = (ids || []).reduce((sum, id) => sum + (durationMap.get(id) ?? 0), 0);
    return total > 0 ? total : 15;
  };
  const rowKey = (item: CalendarItem): string =>
    item.type === 'private' ? item.booking.id
    : item.type === 'group' ? `group-${item.time}-${item.serviceName}`
    : `slot-${item.classEntry.id}`;

  // Per-day item lists for the whole week.
  const itemsByDay = days.map((day) => buildCalendarItems(day, bookings, schedule, isFitnessStudio, t("groupClass")));

  // Side-by-side layout for time-overlapping items (simultaneous staff
  // bookings, parallel services, legacy double-books). Items that overlap
  // nothing get { col: 0, cols: 1 } → full column width, geometrically
  // identical to the previous constant inset — so days without overlaps
  // render exactly as before.
  const layoutByDay = itemsByDay.map((items) =>
    assignOverlapColumns(
      items.map((it) => {
        const start = timeToMin(itemTime(it));
        return { start, end: start + itemDuration(it) };
      }),
    ),
  );
  // Widest concurrency this week — used to widen day columns so sub-columns
  // stay readable (the grid already scrolls horizontally).
  const weekMaxCols = Math.max(1, ...layoutByDay.flat().map((s) => s.cols));

  // Vertical window: span the provider's available hours, widened to include any
  // booking that falls outside them. Snap to whole hours for clean grid lines.
  let minStart = 24 * 60;
  let maxEnd = 0;
  for (const a of availability) {
    if (!a.is_available) continue;
    minStart = Math.min(minStart, timeToMin(a.start_time));
    maxEnd = Math.max(maxEnd, timeToMin(a.end_time));
  }
  for (const items of itemsByDay) {
    for (const it of items) {
      const s = timeToMin(itemTime(it));
      minStart = Math.min(minStart, s);
      maxEnd = Math.max(maxEnd, s + itemDuration(it));
    }
  }
  if (minStart >= maxEnd) { minStart = 8 * 60; maxEnd = 20 * 60; } // no data → default 08:00–20:00
  const startHour = Math.floor(minStart / 60);
  const endHour = Math.ceil(maxEnd / 60);
  const windowStart = startHour * 60;
  const hourCount = endHour - startHour;

  const HOUR_H = 60; // px per hour
  const pxPerMin = HOUR_H / 60;
  const gridHeight = hourCount * HOUR_H;
  const hours = Array.from({ length: hourCount + 1 }, (_, i) => startHour + i);

  const GUTTER = 40;
  // Base day-column width, widened when bookings run side by side so each
  // sub-column keeps enough room for its label. weekMaxCols is 1 whenever
  // nothing overlaps → exactly the old 112px.
  const COL_MIN = 112 + (weekMaxCols - 1) * 48;
  const gridTemplateColumns = `${GUTTER}px repeat(7, minmax(${COL_MIN}px, 1fr))`;
  const minWidth = GUTTER + 7 * COL_MIN;

  return (
    <div className="space-y-4">
      <NavHeader
        title={title}
        prevLabel={t("previousWeek")}
        nextLabel={t("nextWeek")}
        onPrev={onPrev}
        onNext={onNext}
        selectedDate={selectedDate}
        showNewBooking={!noServices}
      />

      {noServices ? (
        <NoServicesCard />
      ) : (
        <div className="rounded-2xl border border-border bg-card overflow-x-auto">
          <div style={{ minWidth }}>
            {/* Day headers */}
            <div className="grid border-b border-border" style={{ gridTemplateColumns }}>
              <div className="border-e border-border" />
              {days.map((day) => {
                const highlight = isToday(day);
                return (
                  <div
                    key={day.toISOString()}
                    className={cn(
                      "text-center py-1.5 border-e border-border last:border-e-0",
                      highlight && "bg-accent/10",
                    )}
                  >
                    <p className={cn("text-[11px] font-semibold leading-tight", highlight ? "text-accent" : "text-foreground")}>
                      {format(day, "EEE", { locale: dateFnsLocale })}
                    </p>
                    <p className="text-[10px] text-muted-foreground leading-tight">{format(day, "d/M")}</p>
                  </div>
                );
              })}
            </div>

            {/* Time grid */}
            <div className="grid" style={{ gridTemplateColumns }}>
              {/* Hour gutter */}
              <div className="relative border-e border-border" style={{ height: gridHeight }}>
                {hours.map((h, i) => (
                  <span
                    key={h}
                    className="absolute right-1 -translate-y-1/2 text-[9px] tabular-nums text-muted-foreground/70"
                    style={{ top: i * HOUR_H }}
                  >
                    {/* LABEL ONLY. maxEnd (and therefore `hours`) must keep its
                        raw value — clamping it would re-clip late bookings out
                        of the grid. A booking ending after midnight pushes
                        endHour past 24, which without this printed "25:00". */}
                    {String(h % 24).padStart(2, "0")}:00
                  </span>
                ))}
              </div>

              {/* Day columns */}
              {days.map((day, di) => {
                const highlight = isToday(day);
                return (
                  <div
                    key={day.toISOString()}
                    className={cn("relative border-e border-border last:border-e-0", highlight && "bg-accent/[0.04]")}
                    style={{ height: gridHeight }}
                  >
                    {/* Hour lines */}
                    {hours.slice(1).map((h, i) => (
                      <div
                        key={h}
                        className="absolute inset-x-0 border-t border-border/40"
                        style={{ top: (i + 1) * HOUR_H }}
                      />
                    ))}
                    {/* Booking blocks */}
                    {itemsByDay[di].map((it, ii) => {
                      const start = timeToMin(itemTime(it));
                      const top = (start - windowStart) * pxPerMin;
                      const height = Math.max(itemDuration(it) * pxPerMin - 2, 15);
                      const info = blockInfo(it);
                      // Horizontal placement: sub-column within the item's
                      // overlap cluster. { col: 0, cols: 1 } (no overlap)
                      // yields insetInlineStart 2px + width 100% - 4px — the
                      // exact geometry the old `inset-x-0.5` class produced.
                      // Logical property → sub-column 0 hugs the start edge in
                      // RTL and LTR alike, no branching.
                      const { col, cols } = layoutByDay[di][ii];
                      // Past (not cancelled) → grayed "completed" look.
                      const isCancelled = it.type === 'private' && it.booking.status === 'cancelled';
                      const isPast = !isCancelled && new Date(`${format(day, "yyyy-MM-dd")}T${itemTime(it)}`).getTime() < Date.now();
                      // Service color, when enabled, replaces the status palette
                      // on the chip: light fill + darker text of the same hue.
                      // The gray "past" treatment still wins, so completed
                      // bookings stay visually done.
                      const color = isPast ? null : colorOf(it);
                      // Derived out-of-hours mark. Scheduled fitness classes are
                      // excluded: their times come from the class schedule, not
                      // from a booking, so flagging them would be noise.
                      const isOutOfHours =
                        it.type !== 'class_slot' &&
                        outOfHoursOf(format(day, "yyyy-MM-dd"), itemTime(it));
                      return (
                        <button
                          key={rowKey(it)}
                          type="button"
                          onClick={() => setSelected(it)}
                          className={cn(
                            "absolute rounded-md border px-1 py-0.5 overflow-hidden text-start",
                            "transition-shadow hover:shadow-md hover:z-10 focus:outline-none focus:ring-2 focus:ring-accent/40",
                            isPast
                              ? "bg-muted/60 border-border/70 text-muted-foreground"
                              : color
                                ? isCancelled && "line-through opacity-70"
                                : info.cls,
                          )}
                          style={{
                            top,
                            height,
                            insetInlineStart: `calc(${(col / cols) * 100}% + 2px)`,
                            width: `calc(${100 / cols}% - 4px)`,
                            ...(color
                              ? {
                                  backgroundColor: withAlpha(color, 0.18),
                                  borderColor: withAlpha(color, 0.55),
                                  color: darken(color, 0.45),
                                }
                              : {}),
                          }}
                          title={`${info.time} ${info.name}${isOutOfHours ? ` · ${t("outOfHoursBadge")}` : ""}`}
                        >
                          <p className="flex items-center gap-0.5 text-[9px] font-semibold leading-tight">
                            {/* The block is ~9px tall of text — an icon is all
                                that fits; the full label rides in the tooltip
                                and on the card in the tap-through dialog. */}
                            {isOutOfHours && <MoonStar className="h-2.5 w-2.5 shrink-0" />}
                            {/* min-w-0 so the flex item may shrink below its
                                content width — without it `truncate` never
                                ellipsises inside a flex row. */}
                            <span className="min-w-0 truncate">{info.time} {info.name}</span>
                          </p>
                          {height > 26 && info.sub && (
                            <p className="text-[8px] leading-tight truncate opacity-80">{info.sub}</p>
                          )}
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Tapping a block opens the full booking card with all actions. */}
      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="max-w-sm p-4 gap-3">
          <DialogHeader>
            <DialogTitle className="text-sm">
              {selected && format(
                selected.type === 'private' ? parseISO(selected.booking.booking_date) : selectedDate,
                "EEEE, d MMM",
                { locale: dateFnsLocale },
              )}
            </DialogTitle>
          </DialogHeader>
          {selected && (
            selected.type === 'class_slot' ? (
              <ClassSlotCard classEntry={selected.classEntry} bookings={selected.bookings} index={0} reminderTemplate={reminderTemplate} color={colorOf(selected)} />
            ) : selected.type === 'group' ? (
              <GroupClassCard time={selected.time} bookings={selected.bookings} serviceName={selected.serviceName} maxCapacity={selected.maxCapacity} index={0} color={colorOf(selected)} />
            ) : (
              <BookingCard booking={selected.booking} index={0} color={colorOf(selected)} />
            )
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DailyView({ selectedDate, bookings, schedule, isFitnessStudio, reminderTemplate, slotInterval, noServices, onPrev, onNext }: {
  selectedDate: Date;
  bookings: EnrichedBooking[];
  schedule: ClassScheduleEntry[];
  isFitnessStudio: boolean;
  reminderTemplate: string;
  slotInterval: number;
  noServices: boolean;
  onPrev: () => void;
  onNext: () => void;
}) {
  const { t, lang } = useLang();
  const dateFnsLocale = lang === "he" ? he : lang === "ar" ? ar : enUS;
  const { availability } = useProviderAvailability();
  const { services } = useProviderServices();

  const items = buildCalendarItems(selectedDate, bookings, schedule, isFitnessStudio, t("groupClass"));

  // Timeline window comes from the provider's weekly schedule for this weekday;
  // fall back to a sensible default so the timeline still renders when unset.
  const dayAvail = availability.find((a) => a.day_of_week === getDay(selectedDate) && a.is_available);
  const startTime = dayAvail?.start_time ?? "09:00";
  const endTime = dayAvail?.end_time ?? "21:00";

  // Union of the generated 15-min grid and any actual booking times, so a booking
  // that falls outside the availability window (or off-grid) is never hidden.
  const itemsByTime = new Map<string, CalendarItem[]>();
  for (const it of items) {
    const key = itemTime(it);
    if (!itemsByTime.has(key)) itemsByTime.set(key, []);
    itemsByTime.get(key)!.push(it);
  }
  const rowTimes = Array.from(new Set<string>([...generateSlots(startTime, endTime, slotInterval), ...itemsByTime.keys()])).sort();

  // A booking occupies every slot from its start until start + total service
  // duration, so slots mid-service render as "continuation" rather than "פנוי".
  const durationMap = new Map(services.map((s) => [s.id, s.duration]));
  const itemDuration = (it: CalendarItem): number => {
    if (it.type === 'class_slot') return it.classEntry.duration_minutes || 15;
    const ids = it.type === 'private' ? it.booking.service_ids : it.bookings[0].service_ids;
    const total = (ids || []).reduce((sum, id) => sum + (durationMap.get(id) ?? 0), 0);
    return total > 0 ? total : 15;
  };
  // start (inclusive) → start + total duration (exclusive). The end minute is the
  // first free slot: a 13:00 booking of 30 min occupies 13:00 + 13:15, and 13:30
  // is free again.
  const intervals = items.map((it) => {
    const start = timeToMin(itemTime(it));
    return { start, end: start + itemDuration(it) };
  });

  const title = format(selectedDate, "EEEE, d MMM", { locale: dateFnsLocale });

  return (
    <div className="space-y-4">
      <NavHeader
        title={title}
        prevLabel={t("previousDay")}
        nextLabel={t("nextDay")}
        onPrev={onPrev}
        onNext={onNext}
        selectedDate={selectedDate}
        showNewBooking={!noServices}
      />

      {noServices ? (
        <NoServicesCard />
      ) : (
        <div className="space-y-2">
          {rowTimes.map((time) => {
            const rowItems = itemsByTime.get(time);
            if (rowItems && rowItems.length > 0) {
              return (
                <div key={time} className="flex gap-2">
                  <span className="text-[11px] font-medium text-muted-foreground/70 tabular-nums pt-4 w-10 shrink-0">{time}</span>
                  <div className="flex-1 min-w-0">
                    <CalendarItemsList items={rowItems} reminderTemplate={reminderTemplate} />
                  </div>
                </div>
              );
            }
            // Slot falls inside an ongoing service (start <= slot < end). These
            // mid-service slots render nothing at all — the booking's card and
            // actions live on its first slot, and only truly free slots show פנוי.
            const slotMin = timeToMin(time);
            const covering = intervals.some((iv) => slotMin >= iv.start && slotMin < iv.end);
            if (covering) return null;
            return (
              <div key={time} className="flex items-center gap-2">
                <span className="text-[11px] font-medium text-muted-foreground/70 tabular-nums w-10 shrink-0">{time}</span>
                <div className="flex-1 rounded-xl border border-dashed border-border/60 bg-secondary/20 px-3 py-2">
                  <span className="text-xs text-muted-foreground/50">{t("freeSlot")}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const VIEW_MODE_KEY = "provider-calendar-view-mode";

export function CalendarTab() {
  const { t, lang } = useLang();
  const dateFnsLocale = lang === "he" ? he : lang === "ar" ? ar : enUS;
  const { data: bookings = [], isLoading } = useProviderBookings();
  const { services, isLoading: servicesLoading } = useProviderServices();
  const { profile } = useProviderProfile();
  const { schedule } = useProviderClassSchedule();
  // Schedule inputs for the DERIVED out-of-hours marker (see OutOfHoursContext).
  // Same query keys WeeklyView/DailyView already mount, so React Query dedupes
  // to a single fetch in those views.
  const { availability, blockedDates, dateOverrides } = useProviderAvailability();
  const isFitnessStudio = profile?.category === 'fitness_studio';
  const reminderTemplate = profile?.reminder_message_template || DEFAULT_REMINDER_TEMPLATE;
  // Display granularity for the daily timeline — same source of truth the customer
  // booking flow reads (provider_profiles.slot_interval_minutes), so both match.
  const slotInterval = (profile as { slot_interval_minutes?: number } | undefined)?.slot_interval_minutes || 15;
  // A provider with no services yet can never have bookings. Once services are
  // confirmed empty (not merely still loading), show a getting-started card
  // instead of the bare "no bookings" empty state. Gating on the resolved load
  // avoids flashing the setup card at established providers mid-fetch.
  // fitness_studio providers use class schedule, not provider_services — never show the setup card for them
  const noServices = !servicesLoading && services.length === 0 && !isFitnessStudio;
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());

  // ── Multi-staff filter (Phase 6, display only) ──
  // Options come from the ACTIVE staff list (you don't filter by a deactivated
  // member); names ON bookings resolve from the full set inside
  // useProviderBookings. The staff query is enabled-gated on staff_enabled, so
  // non-staff providers fire nothing and never see the control.
  const staffEnabled = profile?.staff_enabled === true;
  const { activeStaff } = useProviderActiveStaff(profile?.id, staffEnabled);
  const [staffFilter, setStaffFilter] = useState<string>("all");
  // If the filtered member disappears from the active list (deactivated in
  // another tab), fall back to "all" rather than showing an empty calendar.
  const effectiveStaffFilter =
    staffFilter !== "all" && !activeStaff.some((s) => s.id === staffFilter)
      ? "all"
      : staffFilter;
  const showStaffFilter = staffEnabled && activeStaff.length > 0;
  // Everything below (stats, all three views, dates-with-bookings) renders from
  // the filtered list. "All" is the default and shows everyone — including
  // NULL-staff bookings (group/class/legacy), which belong to no one member and
  // are therefore hidden when a specific member is selected.
  const visibleBookings = useMemo(
    () =>
      effectiveStaffFilter === "all"
        ? bookings
        : bookings.filter((b) => b.staff_id === effectiveStaffFilter),
    [bookings, effectiveStaffFilter],
  );

  // Selected view mode persists across sessions. Defaults to the monthly view so
  // existing providers see the unchanged layout on first upgrade.
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    const saved = typeof window !== "undefined" ? localStorage.getItem(VIEW_MODE_KEY) : null;
    return saved === "daily" || saved === "weekly" || saved === "monthly" ? saved : "monthly";
  });
  useEffect(() => {
    localStorage.setItem(VIEW_MODE_KEY, viewMode);
  }, [viewMode]);

  // Monthly view items for the selected date (unchanged behaviour; with the
  // staff filter on "all" — every non-staff provider — visibleBookings IS the
  // full bookings array).
  const calendarItems = useMemo(
    () => buildCalendarItems(selectedDate, visibleBookings, schedule, isFitnessStudio, t("groupClass")),
    [selectedDate, visibleBookings, schedule, isFitnessStudio, t],
  );

  const datesWithBookings = useMemo(() => visibleBookings.map((b) => parseISO(b.booking_date)), [visibleBookings]);

  // ── Service color coding ──
  // Off by default: while service_colors_enabled is false every resolver below
  // returns null / an empty map and all three views render exactly as before.
  const colorsEnabled = profile?.service_colors_enabled ?? false;
  const serviceColorMap = useMemo(
    () => new Map(services.map((s) => [s.id, normalizeColor(s.color)])),
    [services],
  );
  const classColorMap = useMemo(
    () => new Map(schedule.map((c) => [c.id, normalizeColor(c.color)])),
    [schedule],
  );
  // A booking's color comes from its class (fitness) or its FIRST service — a
  // multi-service booking is one card, so it gets one color. Services deleted
  // since the booking was made are absent from the map and fall back to the
  // same orange the DB defaults to.
  const bookingColor = useCallback(
    (b: EnrichedBooking): string => {
      if (b.class_schedule_id) return classColorMap.get(b.class_schedule_id) ?? DEFAULT_SERVICE_COLOR;
      const firstServiceId = b.service_ids?.[0];
      return (firstServiceId && serviceColorMap.get(firstServiceId)) || DEFAULT_SERVICE_COLOR;
    },
    [classColorMap, serviceColorMap],
  );
  const colorOf = useCallback<ItemColorResolver>(
    (item) => {
      if (!colorsEnabled) return null;
      if (item.type === 'class_slot') {
        return classColorMap.get(item.classEntry.id) ?? normalizeColor(item.classEntry.color);
      }
      return bookingColor(item.type === 'private' ? item.booking : item.bookings[0]);
    },
    [colorsEnabled, classColorMap, bookingColor],
  );

  // Monthly view: distinct service colors per calendar day, rendered as dots
  // under the date. Capped at 4 so a busy day doesn't overflow the cell.
  const dotColorsByDate = useMemo(() => {
    const map = new Map<string, string[]>();
    if (!colorsEnabled) return map;
    for (const b of visibleBookings) {
      if (b.status === 'cancelled') continue;
      const color = bookingColor(b);
      const existing = map.get(b.booking_date);
      if (!existing) {
        map.set(b.booking_date, [color]);
      } else if (existing.length < 4 && !existing.includes(color)) {
        existing.push(color);
      }
    }
    return map;
  }, [colorsEnabled, visibleBookings, bookingColor]);

  // Custom day cell (number + dots) only while colors are on — otherwise the
  // Calendar keeps react-day-picker's stock DayContent.
  const calendarComponents = useMemo(() => {
    if (!colorsEnabled) return undefined;
    const DayWithDots = ({ date }: DayContentProps) => {
      const colors = dotColorsByDate.get(format(date, "yyyy-MM-dd")) ?? [];
      return (
        <span className="relative flex h-full w-full items-center justify-center">
          {/* Same locale-formatted numeral react-day-picker renders by default */}
          <span>{format(date, "d", { locale: dateFnsLocale })}</span>
          {colors.length > 0 && (
            <span className="absolute bottom-0.5 left-1/2 flex -translate-x-1/2 gap-0.5">
              {colors.map((c) => (
                <span key={c} className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: c }} />
              ))}
            </span>
          )}
        </span>
      );
    };
    return { DayContent: DayWithDots };
  }, [colorsEnabled, dotColorsByDate, dateFnsLocale]);

  // ── Derived out-of-hours marker ──
  // Adapters onto resolveDayHours' signature: blocked dates arrive as rows (it
  // wants "YYYY-MM-DD" strings) and overrides as select("*") rows (a superset of
  // DateOverrideRow). Weekly rows already match. Monthly settings resolve
  // weekly-by-default, identically to useAllProviders.ts:453-459, so the marker
  // and the slot pipeline can never disagree about which branch applies.
  const blockedDateStrs = useMemo(
    () => blockedDates.map((b) => b.blocked_date),
    [blockedDates],
  );
  const monthlySettings = useMemo<MonthlySettings>(
    () => ({
      availability_mode: profile?.availability_mode === "monthly" ? "monthly" : "weekly",
      monthly_default_available: profile?.monthly_default_available ?? true,
      monthly_default_start: profile?.monthly_default_start ?? "09:00",
      monthly_default_end: profile?.monthly_default_end ?? "17:00",
    }),
    [profile],
  );
  const outOfHoursOf = useCallback<OutOfHoursResolver>(
    (bookingDate, bookingTime) => {
      if (!bookingDate || !bookingTime) return false;
      // While the schedule is still loading, `availability` is [] — which the
      // weekly branch reads as "closed", flagging every booking. Stay quiet
      // until there is something to compare against.
      if (availability.length === 0 && monthlySettings.availability_mode !== "monthly") return false;
      const window = resolveDayHours(
        parseISO(bookingDate),
        monthlySettings,
        availability as WeeklyRow[],
        blockedDateStrs,
        dateOverrides as DateOverrideRow[],
      );
      return isOutsideDayWindow(window, bookingTime);
    },
    [availability, monthlySettings, blockedDateStrs, dateOverrides],
  );

  const activeBookings = visibleBookings.filter(b => b.status !== 'cancelled');
  const todayBookings = activeBookings.filter((b) => isToday(parseISO(b.booking_date))).length;
  const upcomingBookings = activeBookings.filter((b) => isAfter(parseISO(b.booking_date), new Date())).length;
  const todayRevenue = activeBookings
    .filter((b) => isToday(parseISO(b.booking_date)) && b.status === "confirmed")
    .reduce((sum, b) => sum + b.total_price, 0);

  const isSelectedToday = isToday(selectedDate);

  const viewTabs: { mode: ViewMode; label: string }[] = [
    { mode: "daily", label: t("dailyView") },
    { mode: "weekly", label: t("weeklyView") },
    { mode: "monthly", label: t("monthlyView") },
  ];

  return (
    <ItemColorContext.Provider value={colorOf}>
    <OutOfHoursContext.Provider value={outOfHoursOf}>
    <div className="space-y-5">
      {/* Stats row */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-2xl border border-border bg-card p-3 text-center space-y-0.5">
          <p className="text-2xl font-bold text-foreground">{todayBookings}</p>
          <p className="text-[11px] text-muted-foreground">{t("today")}</p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-3 text-center space-y-0.5">
          <p className="text-2xl font-bold text-foreground">{upcomingBookings}</p>
          <p className="text-[11px] text-muted-foreground">{t("upcoming")}</p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-3 text-center space-y-0.5">
          <p className="text-2xl font-bold text-accent">₪{todayRevenue}</p>
          <p className="text-[11px] text-muted-foreground">הכנסות היום</p>
        </div>
      </div>

      {/* Staff filter — only for staff-enabled providers with active staff.
          Horizontal chip row: "All staff" + one chip per active member (with
          the same initial-letter tile the pickers use). Filters every view. */}
      {showStaffFilter && (
        <div className="flex gap-2 overflow-x-auto pb-1 -mb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <button
            type="button"
            onClick={() => setStaffFilter("all")}
            className={cn(
              "flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-2 text-xs font-semibold transition-all active:scale-95",
              effectiveStaffFilter === "all"
                ? "border-transparent bg-accent text-accent-foreground shadow-sm"
                : "border-border bg-card text-muted-foreground hover:border-accent/40"
            )}
          >
            <Users className="h-3.5 w-3.5" />
            {t("allStaff")}
          </button>
          {activeStaff.map((member) => {
            const selected = effectiveStaffFilter === member.id;
            return (
              <button
                key={member.id}
                type="button"
                onClick={() => setStaffFilter(member.id)}
                className={cn(
                  "flex shrink-0 items-center gap-1.5 rounded-full border py-1.5 ps-1.5 pe-3.5 text-xs font-semibold transition-all active:scale-95",
                  selected
                    ? "border-transparent bg-accent text-accent-foreground shadow-sm"
                    : "border-border bg-card text-muted-foreground hover:border-accent/40"
                )}
              >
                <span
                  className={cn(
                    "flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-black",
                    selected ? "bg-accent-foreground/20 text-accent-foreground" : "bg-accent/10 text-accent"
                  )}
                >
                  {member.name.trim().charAt(0)}
                </span>
                {member.name}
              </button>
            );
          })}
        </div>
      )}

      {/* View mode toggle */}
      <div className="grid grid-cols-3 gap-1 rounded-2xl border border-border bg-card p-1">
        {viewTabs.map(({ mode, label }) => (
          <button
            key={mode}
            onClick={() => setViewMode(mode)}
            className={cn(
              "py-2 rounded-xl text-sm font-medium transition-colors",
              viewMode === mode
                ? "bg-accent text-accent-foreground shadow-sm"
                : "text-muted-foreground hover:bg-secondary",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2].map((i) => (
            <div key={i} className="h-28 rounded-2xl bg-secondary animate-pulse" />
          ))}
        </div>
      ) : viewMode === "weekly" ? (
        <WeeklyView
          selectedDate={selectedDate}
          bookings={visibleBookings}
          schedule={schedule}
          isFitnessStudio={isFitnessStudio}
          reminderTemplate={reminderTemplate}
          noServices={noServices}
          onPrev={() => setSelectedDate((d) => addDays(d, -7))}
          onNext={() => setSelectedDate((d) => addDays(d, 7))}
        />
      ) : viewMode === "daily" ? (
        <DailyView
          selectedDate={selectedDate}
          bookings={visibleBookings}
          schedule={schedule}
          isFitnessStudio={isFitnessStudio}
          reminderTemplate={reminderTemplate}
          slotInterval={slotInterval}
          noServices={noServices}
          onPrev={() => setSelectedDate((d) => addDays(d, -1))}
          onNext={() => setSelectedDate((d) => addDays(d, 1))}
        />
      ) : (
        <>
          {/* Monthly calendar */}
          <div className="rounded-2xl border border-border bg-card p-2">
            <Calendar
              mode="single"
              selected={selectedDate}
              onSelect={(d) => d && setSelectedDate(d)}
              locale={dateFnsLocale}
              className="pointer-events-auto"
              components={calendarComponents}
              modifiers={{ hasBooking: datesWithBookings }}
              modifiersStyles={{
                hasBooking: {
                  fontWeight: 700,
                  textDecoration: "underline",
                  textDecorationColor: "hsl(var(--accent))",
                  textUnderlineOffset: "3px",
                },
              }}
            />
          </div>

          {/* Bookings for selected date */}
          <div>
            <div className="flex items-center justify-between mb-3 gap-2">
              <h3 className="text-sm font-semibold min-w-0 truncate">
                {isSelectedToday ? "📅 תורים להיום" : format(selectedDate, "EEEE, d MMM", { locale: dateFnsLocale })}
              </h3>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-xs text-muted-foreground">
                  {calendarItems.length} {calendarItems.length === 1 ? "תור" : "תורים"}
                </span>
                {/* Hide the walk-in trigger until the provider has at least one
                    service — otherwise the sheet dead-ends on an empty step 1. The
                    getting-started card below is the single CTA in that state. */}
                {!noServices && <NewBookingSheet selectedDate={selectedDate} />}
              </div>
            </div>

            {noServices ? (
              <NoServicesCard />
            ) : calendarItems.length === 0 ? (
              <div className="text-center py-12 rounded-2xl border border-dashed border-border">
                <CalendarIcon className="h-10 w-10 text-muted-foreground/30 mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">
                  {isFitnessStudio ? "אין שיעורים ביום זה" : t("noUpcomingBookings")}
                </p>
              </div>
            ) : (
              <CalendarItemsList items={calendarItems} reminderTemplate={reminderTemplate} />
            )}
          </div>
        </>
      )}
    </div>
    </OutOfHoursContext.Provider>
    </ItemColorContext.Provider>
  );
}
