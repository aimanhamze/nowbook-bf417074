import { format, parseISO } from "date-fns";
import { he } from "date-fns/locale";
import { CheckCircle2, XCircle, Phone, MessageCircle, Clock, CalendarDays, ClipboardList } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useLang } from "@/contexts/LangContext";
import { useProviderBookings, useApproveBooking, useRejectBooking, type EnrichedBooking } from "@/hooks/useProviderBookings";

function toWhatsAppUrl(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("972")) return `https://wa.me/${digits}`;
  const local = digits.startsWith("0") ? digits.slice(1) : digits;
  return `https://wa.me/972${local}`;
}

function buildDepositMessage(booking: EnrichedBooking): string {
  const date = format(parseISO(booking.booking_date), "d בMMM", { locale: he });
  const name = booking.customer_name || "לקוח יקר";
  const service = booking.service_names.join(", ");
  return `שלום ${name} 😊\nקיבלנו את בקשת התור שלך:\n📅 תאריך: ${date}\n⏰ שעה: ${booking.booking_time}\n💇 שירות: ${service}\nלאישור התור נבקש מקדמה של ₪${booking.total_price}.\nנשמח לשמוע ממך! 🙏`;
}

function PendingCard({ booking, index }: { booking: EnrichedBooking; index: number }) {
  const approveBooking = useApproveBooking();
  const rejectBooking = useRejectBooking();

  const initials = booking.customer_name
    ? booking.customer_name.split(" ").map((w) => w[0]).join("").slice(0, 2)
    : "?";

  const formattedDate = format(parseISO(booking.booking_date), "EEE, d בMMM", { locale: he });

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ delay: index * 0.04, duration: 0.25 }}
      className="rounded-2xl border border-amber-200 bg-amber-50/60 p-4 space-y-3"
    >
      {/* Customer row */}
      <div className="flex items-center gap-3">
        <Avatar className="h-10 w-10 border-2 border-amber-200">
          <AvatarImage src={booking.customer_avatar || undefined} />
          <AvatarFallback className="bg-amber-100 text-amber-700 text-sm font-bold">{initials}</AvatarFallback>
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
        <span className="text-xs font-bold text-amber-600">₪{booking.total_price}</span>
      </div>

      {/* Service chips */}
      <div className="flex flex-wrap gap-1">
        {booking.service_names.map((name, i) => (
          <span key={i} className="text-[11px] px-2.5 py-1 rounded-full bg-amber-100 text-amber-800 font-medium">{name}</span>
        ))}
      </div>

      {/* Date + time */}
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5" />{formattedDate}</span>
        <span className="flex items-center gap-1"><Clock className="h-3.5 w-3.5" />{booking.booking_time}</span>
      </div>

      {/* Approve / Reject */}
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          className="flex-1 text-xs h-9 text-emerald-700 border-emerald-300 bg-white hover:bg-emerald-50"
          onClick={() => approveBooking.mutate(booking.id, {
            onSuccess: () => toast.success("התור אושר בהצלחה ✅"),
            onError: () => toast.error("שגיאה באישור התור"),
          })}
          disabled={approveBooking.isPending || rejectBooking.isPending}
        >
          <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
          {approveBooking.isPending ? "מאשר..." : "אשר תור"}
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="flex-1 text-xs h-9 text-red-600 border-red-200 bg-white hover:bg-red-50"
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

      {/* WhatsApp deposit request */}
      {booking.customer_phone && (
        <a
          href={`${toWhatsAppUrl(booking.customer_phone)}?text=${encodeURIComponent(buildDepositMessage(booking))}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-1.5 w-full text-xs h-9 rounded-md border border-emerald-300 bg-white text-emerald-700 hover:bg-emerald-50 transition-colors font-medium"
        >
          <MessageCircle className="h-3.5 w-3.5" />
          בקשת מקדמה 💰
        </a>
      )}
    </motion.div>
  );
}

export function PendingTab() {
  const { t } = useLang();
  const { data: bookings = [], isLoading } = useProviderBookings();

  const pending = bookings
    .filter((b) => b.status === "pending")
    .sort((a, b) =>
      a.booking_date.localeCompare(b.booking_date) || a.booking_time.localeCompare(b.booking_time)
    );

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2].map((i) => (
          <div key={i} className="h-40 rounded-2xl bg-secondary animate-pulse" />
        ))}
      </div>
    );
  }

  if (pending.length === 0) {
    return (
      <div className="text-center py-16 rounded-2xl border border-dashed border-border">
        <ClipboardList className="h-10 w-10 text-muted-foreground/30 mx-auto mb-2" />
        <p className="text-sm text-muted-foreground">{t("noPendingBookings")}</p>
      </div>
    );
  }

  return (
    <AnimatePresence mode="popLayout">
      <div className="space-y-3">
        {pending.map((booking, i) => (
          <PendingCard key={booking.id} booking={booking} index={i} />
        ))}
      </div>
    </AnimatePresence>
  );
}

export function usePendingCount() {
  const { data: bookings = [] } = useProviderBookings();
  return bookings.filter((b) => b.status === "pending").length;
}
