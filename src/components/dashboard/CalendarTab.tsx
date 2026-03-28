import { useState, useMemo } from "react";
import { format, isSameDay, parseISO, isAfter, isToday } from "date-fns";
import { he } from "date-fns/locale";
import { Calendar as CalendarIcon, Clock, User, Phone, Banknote, XCircle, Trash2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Calendar } from "@/components/ui/calendar";
import { useLang } from "@/contexts/LangContext";
import { useProviderBookings, useCancelBooking, useDeleteBooking, type EnrichedBooking } from "@/hooks/useProviderBookings";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

const statusConfig: Record<string, { label: string; className: string }> = {
  confirmed: { label: "מאושר", className: "bg-emerald-500/15 text-emerald-700 border-emerald-200" },
  pending: { label: "ממתין", className: "bg-amber-500/15 text-amber-700 border-amber-200" },
  cancelled: { label: "בוטל", className: "bg-red-500/15 text-red-700 border-red-200" },
};

function BookingCard({ booking, index }: { booking: EnrichedBooking; index: number }) {
  const initials = booking.customer_name
    ? booking.customer_name.split(" ").map((w) => w[0]).join("").slice(0, 2)
    : "?";

  const status = statusConfig[booking.status] || statusConfig.confirmed;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ delay: index * 0.04, duration: 0.25 }}
      className="rounded-2xl border border-border bg-card p-4 space-y-3"
    >
      {/* Header: customer + status */}
      <div className="flex items-center gap-3">
        <Avatar className="h-10 w-10 border-2 border-accent/20">
          <AvatarImage src={booking.customer_avatar || undefined} />
          <AvatarFallback className="bg-accent/10 text-accent text-sm font-bold">
            {initials}
          </AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold truncate">
            {booking.customer_name || "לקוח אנונימי"}
          </p>
          {booking.customer_phone && (
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <Phone className="h-3 w-3" />
              {booking.customer_phone}
            </p>
          )}
        </div>
        <Badge variant="outline" className={`text-[10px] shrink-0 ${status.className}`}>
          {status.label}
        </Badge>
      </div>

      {/* Details row */}
      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <Clock className="h-3.5 w-3.5" />
          {booking.booking_time}
        </span>
        <span className="flex items-center gap-1">
          <Banknote className="h-3.5 w-3.5" />
          ₪{booking.total_price}
        </span>
      </div>

      {/* Services */}
      <div className="flex flex-wrap gap-1.5">
        {booking.service_names.map((name, i) => (
          <span
            key={i}
            className="text-[11px] px-2.5 py-1 rounded-full bg-secondary text-secondary-foreground"
          >
            {name}
          </span>
        ))}
      </div>
    </motion.div>
  );
}

export function CalendarTab() {
  const { t } = useLang();
  const { data: bookings = [], isLoading } = useProviderBookings();
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());

  const bookingsForDate = useMemo(() => {
    return bookings
      .filter((b) => isSameDay(parseISO(b.booking_date), selectedDate))
      .sort((a, b) => a.booking_time.localeCompare(b.booking_time));
  }, [bookings, selectedDate]);

  const datesWithBookings = useMemo(() => {
    return bookings.map((b) => parseISO(b.booking_date));
  }, [bookings]);

  const todayBookings = bookings.filter((b) =>
    isToday(parseISO(b.booking_date))
  ).length;

  const upcomingBookings = bookings.filter((b) =>
    isAfter(parseISO(b.booking_date), new Date())
  ).length;

  const todayRevenue = bookings
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
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold">
            {isSelectedToday ? "📅 תורים להיום" : format(selectedDate, "EEEE, d בMMMM", { locale: he })}
          </h3>
          <span className="text-xs text-muted-foreground">
            {bookingsForDate.length} {bookingsForDate.length === 1 ? "תור" : "תורים"}
          </span>
        </div>

        {isLoading ? (
          <div className="space-y-3">
            {[1, 2].map((i) => (
              <div key={i} className="h-28 rounded-2xl bg-secondary animate-pulse" />
            ))}
          </div>
        ) : bookingsForDate.length === 0 ? (
          <div className="text-center py-12 rounded-2xl border border-dashed border-border">
            <CalendarIcon className="h-10 w-10 text-muted-foreground/30 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">{t("noUpcomingBookings")}</p>
          </div>
        ) : (
          <AnimatePresence mode="popLayout">
            <div className="space-y-3">
              {bookingsForDate.map((bk, i) => (
                <BookingCard key={bk.id} booking={bk} index={i} />
              ))}
            </div>
          </AnimatePresence>
        )}
      </div>
    </div>
  );
}
