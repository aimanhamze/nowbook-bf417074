import { useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { CalendarCheck, CalendarClock, CalendarPlus, Clock, Info, UserRound, XCircle } from "lucide-react";
import { FaApple, FaGoogle } from "react-icons/fa6";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ForwardArrow } from "@/components/ui/directional-icon";
import { CancelBookingDialog } from "@/components/booking/CancelBookingDialog";
import { CustomerRescheduleSheet } from "@/components/booking/CustomerRescheduleSheet";
import { CallToCancelNotice, DateTile, StatusBadge } from "@/components/booking/BookingParts";
import { useAuth } from "@/contexts/AuthContext";
import { useLang } from "@/contexts/LangContext";
import { useCancelBooking } from "@/hooks/useCancelBooking";
import { useMyUpcomingAt, type UpcomingBooking } from "@/hooks/useMyUpcomingAt";
import { DEFAULT_CANCELLATION_HOURS, bookingActionState, isLinkedWalkin } from "@/lib/bookingActions";
import { bookingDuration } from "@/lib/bookingDuration";
import { buildIcs, googleCalendarUrl, openIcs, type CalendarEvent } from "@/lib/calendarExport";
import { isInstagramInAppBrowser } from "@/lib/inAppBrowser";
import type { Provider } from "@/lib/mock-data";

/**
 * "Your upcoming appointment" on the provider page.
 *
 * Customers come back through the same Instagram link they booked from, so the
 * booking meets them where they land. Renders NOTHING — no empty state — for a
 * visitor, a provider/admin, or a customer with no upcoming booking here.
 *
 * Every action is the shared implementation: useCancelBooking behind
 * CancelBookingDialog, CustomerRescheduleSheet, and bookingActionState for
 * which of them apply — the same as /bookings.
 */
export function UpcomingAppointmentCard({ provider }: { provider: Provider }) {
  const { data: upcoming = [] } = useMyUpcomingAt(provider.id);
  const next = upcoming[0];
  if (!next) return null;
  return <AppointmentCard booking={next} provider={provider} moreCount={upcoming.length - 1} />;
}

function AppointmentCard({ booking, provider, moreCount }: { booking: UpcomingBooking; provider: Provider; moreCount: number }) {
  const { lang, t } = useLang();
  const { user } = useAuth();
  const cancelMutation = useCancelBooking();

  const linkedWalkin = !!user && isLinkedWalkin(booking, user.id);
  const cancellationNoticeHours = provider.cancellationNoticeHours ?? DEFAULT_CANCELLATION_HOURS;
  const { canCancel, canCallToCancel, canReschedule } = bookingActionState({
    booking,
    linkedWalkin,
    cancellationNoticeHours,
    provider,
  });

  const services = provider.services.filter((s) => booking.service_ids.includes(s.id));
  const serviceNames = services.map((s) => s.name[lang]).join("، ") || provider.name[lang];
  const staffName = booking.staff?.name ?? null;

  const calendarEvent: CalendarEvent = {
    uid: booking.id,
    title: `${serviceNames} — ${provider.name[lang]}`,
    date: booking.booking_date,
    time: booking.booking_time,
    durationMinutes: bookingDuration(booking, provider.services),
    location: provider.address[lang] || undefined,
    description: staffName ? t("withStaff").replace("{name}", staffName) : undefined,
    url: `${window.location.origin}/provider/${provider.id}`,
  };

  const actionClass =
    "flex h-14 min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-2xl px-1 text-[11px] font-semibold leading-tight transition-colors active:scale-[0.98] disabled:opacity-60";

  return (
    <motion.section
      className="mt-6 px-5"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.15, ease: [0.16, 1, 0.3, 1] }}
      aria-labelledby="upcoming-appointment-title"
    >
      <div className="glass-card-md rounded-3xl p-4 ring-1 ring-accent/30">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 id="upcoming-appointment-title" className="flex min-w-0 items-center gap-1.5 text-xs font-semibold text-accent">
            <CalendarCheck className="h-4 w-4 shrink-0" />
            <span className="truncate">{t("yourUpcomingAppointment")}</span>
          </h2>
          <StatusBadge status={booking.status} />
        </div>

        <div className="flex gap-3.5">
          <DateTile booking={booking} variant="upcoming" isNext />
          <div className="flex min-w-0 flex-1 flex-col justify-center gap-1">
            <p className="truncate text-[15px] font-bold leading-tight">{serviceNames}</p>
            <p className="inline-flex items-center gap-1.5 text-xs font-medium text-foreground/70">
              <Clock className="h-3.5 w-3.5 shrink-0 text-accent" />
              <span dir="ltr" className="tabular-nums">{booking.booking_time}</span>
            </p>
            {staffName && (
              <p className="flex items-center gap-1 truncate text-xs font-medium text-foreground/70">
                <UserRound className="h-3 w-3 shrink-0 text-accent" />
                <span className="truncate">{t("withStaff").replace("{name}", staffName)}</span>
              </p>
            )}
          </div>
        </div>

        {booking.status === "pending" && (
          <p className="mt-3 flex items-start gap-2 rounded-xl border border-amber-300/70 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900">
            <Clock className="mt-px h-3.5 w-3.5 shrink-0 text-amber-600" />
            <span>{t("pendingApprovalNote")}</span>
          </p>
        )}

        {canCallToCancel && (
          <CallToCancelNotice
            cancellationNoticeHours={cancellationNoticeHours}
            providerPhone={provider.phone}
            actionHeight="h-11"
          />
        )}

        {linkedWalkin && (
          <div className="mt-3 flex items-start gap-2 border-t border-border/40 pt-3 text-xs leading-relaxed text-muted-foreground">
            <Info className="mt-px h-3.5 w-3.5 shrink-0 text-accent" />
            <span>{t("bookedByProvider")}</span>
          </div>
        )}

        <div className="mt-3 flex gap-2 border-t border-border/40 pt-3">
          {canCancel && (
            <CancelBookingDialog
              booking={booking}
              onConfirm={() => cancelMutation.mutate({ booking, serviceName: serviceNames })}
              trigger={
                <button
                  type="button"
                  disabled={cancelMutation.isPending}
                  className={`${actionClass} bg-red-50 text-red-600 ring-1 ring-inset ring-red-200 hover:bg-red-100`}
                >
                  <XCircle className="h-4 w-4" />
                  <span className="max-w-full truncate">
                    {cancelMutation.isPending ? t("cancelling") : t("cancelBooking")}
                  </span>
                </button>
              }
            />
          )}
          {canReschedule && (
            <CustomerRescheduleSheet
              booking={booking}
              provider={provider}
              trigger={
                <button
                  type="button"
                  className={`${actionClass} bg-secondary/70 text-foreground ring-1 ring-inset ring-border hover:bg-secondary`}
                >
                  <CalendarClock className="h-4 w-4 text-accent" />
                  <span className="max-w-full truncate">{t("rescheduleBooking")}</span>
                </button>
              }
            />
          )}
          <AddToCalendarButton event={calendarEvent} className={`${actionClass} bg-accent/10 text-accent ring-1 ring-inset ring-accent/25 hover:bg-accent/15`} />
        </div>

        {moreCount > 0 && (
          <Link
            to="/bookings"
            className="mt-2 flex h-11 items-center justify-center gap-1 rounded-xl text-xs font-semibold text-accent transition-colors hover:bg-accent/5"
          >
            {t("moreUpcoming").replace("{count}", String(moreCount))}
            <ForwardArrow className="h-3.5 w-3.5" />
          </Link>
        )}
      </div>
    </motion.section>
  );
}

/**
 * The calendar menu: .ics (Apple/Outlook/any app) or Google Calendar.
 * Inside Instagram's in-app browser neither is expected to work (no download
 * hand-off; a separate, signed-out Google cookie jar), so the popover tells
 * the customer how to open the page in their real browser instead. Pending a
 * device test — if either option works there, drop the message.
 */
function AddToCalendarButton({ event, className }: { event: CalendarEvent; className: string }) {
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  const inInstagram = isInstagramInAppBrowser();

  const itemClass =
    "flex h-11 w-full items-center gap-3 rounded-xl px-3 text-start text-sm font-medium transition-colors hover:bg-secondary active:bg-secondary";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className={className}>
          <CalendarPlus className="h-4 w-4" />
          <span className="max-w-full truncate">{t("addToCalendar")}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 rounded-2xl p-1.5">
        {inInstagram ? (
          <p className="flex items-start gap-2 p-2.5 text-sm leading-relaxed">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
            <span>{t("openInBrowserForCalendar")}</span>
          </p>
        ) : (
          <div className="flex flex-col">
            <button
              type="button"
              className={itemClass}
              onClick={() => {
                openIcs(buildIcs(event), "appointment.ics");
                setOpen(false);
              }}
            >
              <FaApple className="h-4 w-4 shrink-0" />
              {t("calendarApple")}
            </button>
            <a
              href={googleCalendarUrl(event)}
              target="_blank"
              rel="noopener noreferrer"
              className={itemClass}
              onClick={() => setOpen(false)}
            >
              <FaGoogle className="h-4 w-4 shrink-0" />
              {t("calendarGoogle")}
            </a>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
