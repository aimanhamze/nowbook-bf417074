import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { CalendarDays, CalendarPlus, Clock, Hourglass, Info, UserRound } from "lucide-react";
import { FaApple, FaGoogle } from "react-icons/fa6";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { ForwardArrow } from "@/components/ui/directional-icon";
import { CancelBookingDialog } from "@/components/booking/CancelBookingDialog";
import { CustomerRescheduleSheet } from "@/components/booking/CustomerRescheduleSheet";
import { CallToCancelNotice, StatusBadge } from "@/components/booking/BookingParts";
import { useAuth } from "@/contexts/AuthContext";
import { useLang } from "@/contexts/LangContext";
import { useCancelBooking } from "@/hooks/useCancelBooking";
import { useMyUpcomingAt, type UpcomingBooking } from "@/hooks/useMyUpcomingAt";
import { DEFAULT_CANCELLATION_HOURS, bookingActionState, bookingDateTime, isLinkedWalkin } from "@/lib/bookingActions";
import { bookingDuration } from "@/lib/bookingDuration";
import { buildIcs, googleCalendarUrl, openIcs, type CalendarEvent } from "@/lib/calendarExport";
import { formatDuration } from "@/lib/formatDuration";
import { isInstagramInAppBrowser } from "@/lib/inAppBrowser";
import type { Provider } from "@/lib/mock-data";

const LOCALES: Record<string, string> = { he: "he-IL", ar: "ar", en: "en-US" };

/**
 * "Add to calendar" is hidden everywhere for now: .ics and Google both fail in
 * too many in-app browsers. It returns as a private, login-free calendar link;
 * flip this to bring the current menu back. calendarExport and inAppBrowser
 * stay in place for that.
 */
const SHOW_ADD_TO_CALENDAR = false;

/**
 * "Your upcoming appointment" on the provider page.
 *
 * Customers come back through the same Instagram link they booked from, so the
 * booking meets them where they land — as ONE slim row that opens a bottom
 * sheet with the details and actions. Renders NOTHING (no empty state) for a
 * visitor, a provider/admin, or a customer with no upcoming booking here.
 *
 * Every action is the shared implementation: useCancelBooking behind
 * CancelBookingDialog, CustomerRescheduleSheet, and bookingActionState for
 * which of them apply — the same as /bookings.
 */
export function UpcomingAppointmentCard({ provider }: { provider: Provider }) {
  const { t } = useLang();
  const { data: upcoming = [] } = useMyUpcomingAt(provider.id);
  const next = upcoming[0];
  if (!next) return null;
  const moreCount = upcoming.length - 1;

  return (
    <section className="mt-6 px-5" aria-labelledby="upcoming-appointment-title">
      <div className="mb-2 flex items-center justify-between gap-3 px-1">
        <h2 id="upcoming-appointment-title" className="text-[13px] font-semibold text-foreground/70">
          {t("yourUpcomingAppointment")}
        </h2>
        {moreCount > 0 && (
          // Visually a small link; the -my-3 keeps a 44px tap area without
          // adding height to the header line.
          <Link
            to="/bookings"
            className="-my-3 inline-flex min-h-11 items-center px-1 text-xs font-semibold text-accent"
          >
            {/* Isolate "+N" left-to-right: in an RTL line the leading "+"
                otherwise flips to the far side and reads "2+". */}
            {t(moreCount === 1 ? "moreUpcomingOne" : "moreUpcoming").replace("+{count}", `\u2066+${moreCount}\u2069`)}
          </Link>
        )}
      </div>
      <AppointmentRow booking={next} provider={provider} />
    </section>
  );
}

function DateChip({ booking }: { booking: UpcomingBooking }) {
  const { lang } = useLang();
  const locale = LOCALES[lang] ?? "en-US";
  const d = bookingDateTime(booking);
  return (
    <span className="flex h-12 w-11 shrink-0 flex-col items-center justify-center rounded-xl bg-accent/10 text-accent">
      <span className="text-[10px] font-medium leading-none">{d.toLocaleDateString(locale, { weekday: "short" })}</span>
      <span dir="ltr" className="my-0.5 text-lg font-bold leading-none tabular-nums">{d.toLocaleDateString(locale, { day: "numeric" })}</span>
      <span className="text-[10px] font-medium leading-none">{d.toLocaleDateString(locale, { month: "short" })}</span>
    </span>
  );
}

function StatusPill({ status }: { status: string }) {
  const { t } = useLang();
  const pending = status === "pending";
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
        pending ? "bg-amber-100 text-amber-800" : "bg-green-100 text-green-800"
      }`}
    >
      <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${pending ? "bg-amber-500" : "bg-green-500"}`} />
      {t(pending ? "pendingApproval" : "confirmed")}
    </span>
  );
}

function DetailRow({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-11 items-center gap-3 px-3.5 py-2.5">
      <span className="text-accent">{icon}</span>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="ms-auto min-w-0 truncate text-sm font-medium">{children}</dd>
    </div>
  );
}

function AppointmentRow({ booking, provider }: { booking: UpcomingBooking; provider: Provider }) {
  const { lang, t } = useLang();
  const { user } = useAuth();
  const cancelMutation = useCancelBooking();
  const [open, setOpen] = useState(false);

  const linkedWalkin = !!user && isLinkedWalkin(booking, user.id);
  const cancellationNoticeHours = provider.cancellationNoticeHours ?? DEFAULT_CANCELLATION_HOURS;
  const { canCancel, canCallToCancel, canReschedule } = bookingActionState({
    booking,
    linkedWalkin,
    cancellationNoticeHours,
    provider,
  });
  const isConfirmed = booking.status === "confirmed";
  // Pending: nothing is promised yet, so it must not land in a calendar.
  const showAddToCalendar = SHOW_ADD_TO_CALENDAR && isConfirmed;
  const hasActions = canReschedule || showAddToCalendar || canCancel;

  const services = provider.services.filter((s) => booking.service_ids.includes(s.id));
  const serviceNames = services.map((s) => s.name[lang]).join("، ") || provider.name[lang];
  const staffName = booking.staff?.name ?? null;
  const durationMinutes = bookingDuration(booking, provider.services);
  const longDate = bookingDateTime(booking).toLocaleDateString(LOCALES[lang] ?? "en-US", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  const calendarEvent: CalendarEvent = {
    uid: booking.id,
    title: `${serviceNames} — ${provider.name[lang]}`,
    date: booking.booking_date,
    time: booking.booking_time,
    durationMinutes,
    location: provider.address[lang] || undefined,
    description: staffName ? t("withStaff").replace("{name}", staffName) : undefined,
    url: `${window.location.origin}/provider/${provider.id}`,
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          type="button"
          aria-label={`${t("appointmentDetails")}: ${serviceNames}, ${longDate}, ${booking.booking_time}`}
          className="glass-card-md flex min-h-[68px] w-full items-center gap-3 rounded-2xl p-2.5 pe-3 text-start transition-transform active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <DateChip booking={booking} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold leading-snug">{serviceNames}</span>
            <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
              <span dir="ltr" className="shrink-0 font-medium tabular-nums text-foreground/80">{booking.booking_time}</span>
              {staffName && (
                <>
                  <span aria-hidden className="shrink-0">·</span>
                  <span className="truncate">{staffName}</span>
                </>
              )}
            </span>
          </span>
          <StatusPill status={booking.status} />
          <ForwardArrow className="h-4 w-4 shrink-0 text-muted-foreground/60" />
        </button>
      </SheetTrigger>

      <SheetContent side="bottom" className="flex max-h-[92vh] flex-col gap-0 rounded-t-3xl border-t p-0">
        <div className="mx-auto mt-3 h-1.5 w-10 shrink-0 rounded-full bg-muted-foreground/20" />
        <div className="overflow-y-auto px-5 pb-[calc(env(safe-area-inset-bottom,0px)+1rem)] pt-3">
          {/* pr-8 is physical on purpose: the shared sheet's close button sits
              at the physical right in every direction. */}
          <SheetHeader className="space-y-1 pr-8 text-start">
            <SheetTitle className="text-lg leading-snug">{serviceNames}</SheetTitle>
            <SheetDescription className="text-xs">{provider.name[lang]}</SheetDescription>
          </SheetHeader>

          <div className="mt-3 flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <StatusBadge status={booking.status} />
            {!isConfirmed && <span className="text-xs text-muted-foreground">{t("pendingApprovalNote")}</span>}
          </div>

          <dl className="mt-4 divide-y divide-border/60 rounded-2xl border border-border bg-muted/40">
            <DetailRow icon={<CalendarDays className="h-4 w-4" />} label={t("apptDate")}>{longDate}</DetailRow>
            <DetailRow icon={<Clock className="h-4 w-4" />} label={t("apptTime")}>
              <span dir="ltr" className="tabular-nums">{booking.booking_time}</span>
            </DetailRow>
            <DetailRow icon={<Hourglass className="h-4 w-4" />} label={t("duration")}>
              {formatDuration(durationMinutes, lang)}
            </DetailRow>
            {staffName && (
              <DetailRow icon={<UserRound className="h-4 w-4" />} label={t("apptWith")}>{staffName}</DetailRow>
            )}
          </dl>

          {canCallToCancel && (
            <CallToCancelNotice
              cancellationNoticeHours={cancellationNoticeHours}
              providerPhone={provider.phone}
              actionHeight="h-11"
            />
          )}

          {linkedWalkin && (
            <p className="mt-3 flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
              <Info className="mt-px h-3.5 w-3.5 shrink-0 text-accent" />
              <span>{t("bookedByProvider")}</span>
            </p>
          )}

          {hasActions && (
            <div className="mt-5 flex flex-col gap-2">
              {canReschedule && (
                <CustomerRescheduleSheet
                  booking={booking}
                  provider={provider}
                  trigger={
                    <button
                      type="button"
                      className="flex h-12 w-full items-center justify-center rounded-2xl bg-accent text-sm font-semibold text-accent-foreground shadow-[0_8px_24px_-10px_hsl(var(--accent)/0.6)] transition-transform active:scale-[0.98]"
                    >
                      {t("rescheduleBooking")}
                    </button>
                  }
                />
              )}
              {showAddToCalendar && (
                <AddToCalendarButton
                  event={calendarEvent}
                  className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl border border-border bg-background text-sm font-semibold transition-colors hover:bg-secondary active:scale-[0.98]"
                />
              )}
              {canCancel && (
                <CancelBookingDialog
                  booking={booking}
                  onConfirm={() =>
                    cancelMutation.mutate(
                      { booking, serviceName: serviceNames },
                      { onSuccess: () => setOpen(false) },
                    )
                  }
                  trigger={
                    <button
                      type="button"
                      disabled={cancelMutation.isPending}
                      className="flex h-11 w-full items-center justify-center rounded-2xl text-sm font-semibold text-red-600 transition-colors hover:bg-red-50 disabled:opacity-60"
                    >
                      {cancelMutation.isPending ? t("cancelling") : t("cancelBooking")}
                    </button>
                  }
                />
              )}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
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
          <CalendarPlus className="h-4 w-4 text-accent" />
          {t("addToCalendar")}
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" className="w-[--radix-popover-trigger-width] rounded-2xl p-1.5">
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
