import { useState, useMemo } from "react";
import { format, isSameDay, parseISO, isAfter, isBefore } from "date-fns";
import { Calendar as CalendarIcon, Clock, User } from "lucide-react";
import { motion } from "framer-motion";
import { Calendar } from "@/components/ui/calendar";
import { useLang } from "@/contexts/LangContext";
import { useProviderBookings } from "@/hooks/useProviderBookings";

export function CalendarTab() {
  const { t } = useLang();
  const { data: bookings = [], isLoading } = useProviderBookings();
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());

  const bookingsForDate = useMemo(() => {
    return bookings.filter(b => isSameDay(parseISO(b.booking_date), selectedDate))
      .sort((a, b) => a.booking_time.localeCompare(b.booking_time));
  }, [bookings, selectedDate]);

  const datesWithBookings = useMemo(() => {
    return bookings.map(b => parseISO(b.booking_date));
  }, [bookings]);

  const todayBookings = bookings.filter(b => isSameDay(parseISO(b.booking_date), new Date())).length;
  const upcomingBookings = bookings.filter(b => isAfter(parseISO(b.booking_date), new Date())).length;

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">{t("bookingsCalendar")}</h2>

      {/* Quick stats */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl border border-border bg-card p-3 text-center">
          <p className="text-2xl font-bold">{todayBookings}</p>
          <p className="text-xs text-muted-foreground">{t("today")}</p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-3 text-center">
          <p className="text-2xl font-bold">{upcomingBookings}</p>
          <p className="text-xs text-muted-foreground">{t("upcoming")}</p>
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
          modifiersStyles={{ hasBooking: { fontWeight: 700, textDecoration: "underline" } }}
        />
      </div>

      {/* Bookings for selected date */}
      <div>
        <h3 className="text-sm font-medium mb-2">
          {format(selectedDate, "EEEE, MMM d")}
        </h3>
        {isLoading ? (
          <div className="space-y-2">
            {[1, 2].map(i => <div key={i} className="h-14 rounded-xl bg-secondary animate-pulse" />)}
          </div>
        ) : bookingsForDate.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">{t("noUpcomingBookings")}</p>
        ) : (
          <div className="space-y-2">
            {bookingsForDate.map((bk, i) => (
              <motion.div
                key={bk.id}
                initial={{ opacity: 0, x: 8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.05 }}
                className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3"
              >
                <div className="flex items-center justify-center h-10 w-10 rounded-full bg-accent/20 text-accent">
                  <Clock className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{bk.booking_time}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {bk.service_ids.length} {bk.service_ids.length === 1 ? t("service") : t("serviceCount")} · ₪{bk.total_price}
                  </p>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full ${bk.status === "confirmed" ? "bg-green-100 text-green-700" : "bg-secondary text-muted-foreground"}`}>
                  {bk.status}
                </span>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
