import { format, parseISO } from "date-fns";
import { he } from "date-fns/locale";
import { CheckCircle2, XCircle, Phone, MessageCircle, Clock, CalendarDays, ClipboardList, StickyNote } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useLang } from "@/contexts/LangContext";
import { useProviderBookings, useApproveBooking, useRejectBooking, usePendingCount, type EnrichedBooking } from "@/hooks/useProviderBookings";
import { useProviderProfile } from "@/hooks/useProviderProfile";
import { DEFAULT_DEPOSIT_TEMPLATE } from "@/components/dashboard/BusinessProfileTab";

// Re-exported from the hooks module (relocated so BottomNav can consume the
// count without pulling this component's import graph). Kept here for existing
// importers of usePendingCount from "@/components/dashboard/PendingTab".
export { usePendingCount };

function toWhatsAppUrl(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("972")) return `https://wa.me/${digits}`;
  const local = digits.startsWith("0") ? digits.slice(1) : digits;
  return `https://wa.me/972${local}`;
}

function applyTemplate(template: string, vars: Record<string, string>): string {
  return Object.entries(vars).reduce((msg, [key, val]) => msg.replaceAll(`{${key}}`, val), template);
}

function resolveServiceLabel(booking: EnrichedBooking): string {
  if (booking.service_names.length > 0) return booking.service_names.join(", ");
  return booking.class_name || "שיעור";
}

function buildDepositMessage(booking: EnrichedBooking, template: string): string {
  const date = format(parseISO(booking.booking_date), "d בMMM", { locale: he });
  return applyTemplate(template, {
    customer_name: booking.customer_name || "לקוח יקר",
    service_name: resolveServiceLabel(booking),
    date,
    time: booking.booking_time,
    price: String(booking.total_price),
  });
}

// Fixed (non-editable) confirmation message sent after a booking is confirmed.
// Template comes from translations.ts in the provider's current app language.
function buildConfirmMessage(booking: EnrichedBooking, template: string, businessName: string): string {
  const date = format(parseISO(booking.booking_date), "d בMMM", { locale: he });
  return applyTemplate(template, {
    business: businessName,
    service: resolveServiceLabel(booking),
    date,
    time: booking.booking_time,
  });
}

function PendingCard({ booking, index, depositTemplate, depositEnabled, businessName }: { booking: EnrichedBooking; index: number; depositTemplate: string; depositEnabled: boolean; businessName: string }) {
  const { t } = useLang();
  const approveBooking = useApproveBooking();
  const rejectBooking = useRejectBooking();

  const initials = booking.customer_name
    ? booking.customer_name.split(" ").map((w) => w[0]).join("").slice(0, 2)
    : "?";

  const formattedDate = format(parseISO(booking.booking_date), "EEE, d בMMM", { locale: he });

  // Pre-built wa.me confirmation link (null when the customer has no phone).
  const confirmWhatsAppUrl = booking.customer_phone
    ? `${toWhatsAppUrl(booking.customer_phone)}?text=${encodeURIComponent(
        buildConfirmMessage(booking, t("confirmWhatsappMessage"), businessName)
      )}`
    : null;

  // Fire the DB confirmation (status→confirmed + customer notification — the
  // source of truth). Runs in the SAME synchronous tap as the WhatsApp open
  // below, so it always happens whether or not WhatsApp opens. Guard prevents a
  // double-confirm if the button is tapped twice before the card disappears.
  const handleConfirm = () => {
    if (approveBooking.isPending || rejectBooking.isPending) return;
    approveBooking.mutate(booking.id, {
      onSuccess: () => toast.success("התור אושר בהצלחה ✅"),
      onError: (err: unknown) => toast.error(err instanceof Error ? err.message : "שגיאה באישור התור"),
    });
  };

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
        {booking.total_price > 0 && (
          <span className="text-xs font-bold text-amber-600">₪{booking.total_price}</span>
        )}
      </div>

      {/* Service / class chips */}
      <div className="flex flex-wrap gap-1">
        {booking.service_names.length > 0
          ? booking.service_names.map((name, i) => (
              <span key={i} className="text-[11px] px-2.5 py-1 rounded-full bg-amber-100 text-amber-800 font-medium">{name}</span>
            ))
          : booking.class_name
          ? <span className="text-[11px] px-2.5 py-1 rounded-full bg-amber-100 text-amber-800 font-medium">{booking.class_name}</span>
          : null
        }
      </div>

      {/* Date + time */}
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5" />{formattedDate}</span>
        <span className="flex items-center gap-1"><Clock className="h-3.5 w-3.5" />{booking.booking_time}</span>
      </div>

      {/* Customer note — what the customer wrote when booking (if any) */}
      {booking.customer_notes && (
        <div className="rounded-lg border border-amber-200 bg-white/60 p-2.5">
          <div className="flex items-start gap-1.5">
            <StickyNote className="h-3.5 w-3.5 text-amber-600 shrink-0 mt-0.5" />
            <p className="text-xs text-foreground/80 whitespace-pre-wrap break-words min-w-0">
              <span className="font-medium text-amber-700">{t("customerWrote")}: </span>
              {booking.customer_notes}
            </p>
          </div>
        </div>
      )}

      {/* Approve / Reject */}
      <div className="flex gap-2">
        {confirmWhatsAppUrl ? (
          // iOS Safari suppresses window.open()/navigation that runs AFTER an
          // await (the old onSuccess callback lost the user-gesture chain, so it
          // only worked on lenient Android). Here the WhatsApp link opens via a
          // real <a> navigation — exactly like the working deposit button below —
          // synchronously within the tap, while handleConfirm fires the DB
          // confirmation in the same gesture. So WhatsApp opens on iOS too, and
          // the booking is confirmed regardless of the popup.
          <Button
            asChild
            variant="outline"
            size="sm"
            className="flex-1 text-xs h-9 text-emerald-700 border-emerald-300 bg-white hover:bg-emerald-50"
          >
            <a
              href={confirmWhatsAppUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={handleConfirm}
            >
              <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
              {approveBooking.isPending ? "מאשר..." : "אשר תור"}
            </a>
          </Button>
        ) : (
          // No phone → confirm only, no WhatsApp.
          <Button
            variant="outline"
            size="sm"
            className="flex-1 text-xs h-9 text-emerald-700 border-emerald-300 bg-white hover:bg-emerald-50"
            onClick={handleConfirm}
            disabled={approveBooking.isPending || rejectBooking.isPending}
          >
            <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
            {approveBooking.isPending ? "מאשר..." : "אשר תור"}
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          className="flex-1 text-xs h-9 text-red-600 border-red-200 bg-white hover:bg-red-50"
          onClick={() => rejectBooking.mutate(booking.id, {
            onSuccess: () => toast.success("התור נדחה"),
            onError: (err: unknown) => toast.error(err instanceof Error ? err.message : "שגיאה בדחיית התור"),
          })}
          disabled={approveBooking.isPending || rejectBooking.isPending}
        >
          <XCircle className="h-3.5 w-3.5 mr-1" />
          {rejectBooking.isPending ? "דוחה..." : "דחה תור"}
        </Button>
      </div>

      {/* WhatsApp deposit request — only when the provider opted in */}
      {depositEnabled && booking.customer_phone && (
        <a
          href={`${toWhatsAppUrl(booking.customer_phone)}?text=${encodeURIComponent(buildDepositMessage(booking, depositTemplate))}`}
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
  const { profile } = useProviderProfile();
  const depositTemplate = profile?.deposit_message_template || DEFAULT_DEPOSIT_TEMPLATE;
  // Cast: column added by 20260618000002 migration; types.ts regenerated after
  // apply. Default false → deposit button hidden until the provider opts in.
  const depositEnabled =
    (profile as { deposit_request_enabled?: boolean } | null)?.deposit_request_enabled ?? false;

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
          <PendingCard key={booking.id} booking={booking} index={i} depositTemplate={depositTemplate} depositEnabled={depositEnabled} businessName={profile?.business_name ?? ""} />
        ))}
      </div>
    </AnimatePresence>
  );
}
