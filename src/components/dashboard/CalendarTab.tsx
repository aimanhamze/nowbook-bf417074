import { useState, useMemo, useEffect, useRef } from "react";
import { format, isSameDay, parseISO, isAfter, isToday } from "date-fns";
import { he } from "date-fns/locale";
import { Calendar as CalendarIcon, Clock, Phone, Banknote, XCircle, Trash2, Users, ChevronDown, ChevronUp, MessageCircle, CheckCircle2, Sparkles } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { Calendar } from "@/components/ui/calendar";
import { useLang } from "@/contexts/LangContext";
import { useProviderBookings, useCancelBooking, useDeleteBooking, useCancelGroupClass, useApproveBooking, useRejectBooking, useSaveTreatmentNote, type EnrichedBooking } from "@/hooks/useProviderBookings";
import { useProviderProfile } from "@/hooks/useProviderProfile";
import { useProviderServices } from "@/hooks/useProviderServices";
import { ForwardArrow } from "@/components/ui/directional-icon";
import { NewBookingSheet } from "@/components/dashboard/NewBookingSheet";
import { DEFAULT_REMINDER_TEMPLATE } from "@/components/dashboard/BusinessProfileTab";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

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

function BookingCard({ booking, index }: { booking: EnrichedBooking; index: number }) {
  const cancelBooking = useCancelBooking();
  const deleteBooking = useDeleteBooking();
  const approveBooking = useApproveBooking();
  const rejectBooking = useRejectBooking();
  const { profile } = useProviderProfile();
  const reminderTemplate = profile?.reminder_message_template || DEFAULT_REMINDER_TEMPLATE;

  const initials = booking.customer_name
    ? booking.customer_name.split(" ").map((w) => w[0]).join("").slice(0, 2)
    : "?";

  const status = statusConfig[booking.status] || statusConfig.confirmed;
  const isCancelled = booking.status === "cancelled";
  const isPending = booking.status === "pending";
  const isConfirmed = booking.status === "confirmed";

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ delay: index * 0.04, duration: 0.25 }}
      className="rounded-2xl border border-border bg-card p-4 space-y-3"
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
        <Badge variant="outline" className={`text-[10px] shrink-0 ${status.className}`}>
          {status.label}
        </Badge>
      </div>

      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1"><Clock className="h-3.5 w-3.5" />{booking.booking_time}</span>
        <span className="flex items-center gap-1"><Banknote className="h-3.5 w-3.5" />₪{booking.total_price}</span>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {booking.service_names.map((name, i) => (
          <span key={i} className="text-[11px] px-2.5 py-1 rounded-full bg-secondary text-secondary-foreground">{name}</span>
        ))}
      </div>

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

function GroupClassCard({ time, bookings, serviceName, maxCapacity, index }: {
  time: string;
  bookings: EnrichedBooking[];
  serviceName: string;
  maxCapacity: number;
  index: number;
}) {
  const { t } = useLang();
  const [expanded, setExpanded] = useState(false);
  const cancelBooking = useCancelBooking();
  const cancelGroupClass = useCancelGroupClass();

  const activeBookings = bookings.filter(b => b.status !== 'cancelled');
  const bookedCount = activeBookings.length;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ delay: index * 0.04, duration: 0.25 }}
      className="rounded-2xl border border-blue-200 bg-card p-4 space-y-3"
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-700">
              <Users className="h-3.5 w-3.5" /> {t("groupClass")}
            </span>
            <Badge className="bg-blue-100 text-blue-700 border-blue-200 text-[10px] px-1.5">
              {bookedCount}/{maxCapacity} {t("classSlots")}
            </Badge>
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

type CalendarItem =
  | { type: 'private'; booking: EnrichedBooking }
  | { type: 'group'; time: string; bookings: EnrichedBooking[]; maxCapacity: number; serviceName: string };

export function CalendarTab() {
  const { t } = useLang();
  const navigate = useNavigate();
  const { data: bookings = [], isLoading } = useProviderBookings();
  const { services, isLoading: servicesLoading } = useProviderServices();
  // A provider with no services yet can never have bookings. Once services are
  // confirmed empty (not merely still loading), show a getting-started card
  // instead of the bare "no bookings" empty state. Gating on the resolved load
  // avoids flashing the setup card at established providers mid-fetch.
  const noServices = !servicesLoading && services.length === 0;
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());

  const bookingsForDate = useMemo(() => {
    return bookings
      .filter((b) => isSameDay(parseISO(b.booking_date), selectedDate))
      .sort((a, b) => a.booking_time.localeCompare(b.booking_time));
  }, [bookings, selectedDate]);

  // Build calendar items: group "group" bookings by time+service, keep private bookings separate
  const calendarItems = useMemo((): CalendarItem[] => {
    const items: CalendarItem[] = [];
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
        serviceName: grpBookings[0].service_names[0] || t("groupClass"),
      });
    }

    return items.sort((a, b) => {
      const timeA = a.type === 'private' ? a.booking.booking_time : a.time;
      const timeB = b.type === 'private' ? b.booking.booking_time : b.time;
      return timeA.localeCompare(timeB);
    });
  }, [bookingsForDate, t]);

  const datesWithBookings = useMemo(() => bookings.map((b) => parseISO(b.booking_date)), [bookings]);

  const activeBookings = bookings.filter(b => b.status !== 'cancelled');
  const todayBookings = activeBookings.filter((b) => isToday(parseISO(b.booking_date))).length;
  const upcomingBookings = activeBookings.filter((b) => isAfter(parseISO(b.booking_date), new Date())).length;
  const todayRevenue = activeBookings
    .filter((b) => isToday(parseISO(b.booking_date)) && b.status === "confirmed")
    .reduce((sum, b) => sum + b.total_price, 0);

  const isSelectedToday = isToday(selectedDate);

  return (
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

      {/* Calendar */}
      <div className="rounded-2xl border border-border bg-card p-2">
        <Calendar
          mode="single"
          selected={selectedDate}
          onSelect={(d) => d && setSelectedDate(d)}
          className="pointer-events-auto"
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
            {isSelectedToday ? "📅 תורים להיום" : format(selectedDate, "EEEE, d בMMMM", { locale: he })}
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

        {isLoading ? (
          <div className="space-y-3">
            {[1, 2].map((i) => (
              <div key={i} className="h-28 rounded-2xl bg-secondary animate-pulse" />
            ))}
          </div>
        ) : noServices ? (
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
        ) : calendarItems.length === 0 ? (
          <div className="text-center py-12 rounded-2xl border border-dashed border-border">
            <CalendarIcon className="h-10 w-10 text-muted-foreground/30 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">{t("noUpcomingBookings")}</p>
          </div>
        ) : (
          <AnimatePresence mode="popLayout">
            <div className="space-y-3">
              {calendarItems.map((item, i) =>
                item.type === 'group' ? (
                  <GroupClassCard
                    key={`group-${item.time}-${item.serviceName}`}
                    time={item.time}
                    bookings={item.bookings}
                    serviceName={item.serviceName}
                    maxCapacity={item.maxCapacity}
                    index={i}
                  />
                ) : (
                  <BookingCard key={item.booking.id} booking={item.booking} index={i} />
                )
              )}
            </div>
          </AnimatePresence>
        )}
      </div>
    </div>
  );
}
