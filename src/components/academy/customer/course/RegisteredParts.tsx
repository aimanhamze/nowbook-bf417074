import { type ReactNode } from "react";
import { format, parseISO } from "date-fns";
import { ChevronDown, ExternalLink, Info, MapPin, MessageCircle, Navigation, ShieldCheck, Video } from "lucide-react";
import { useLang } from "@/contexts/LangContext";
import type { AcademyCourseRow, AcademyCourseSessionRow } from "@/integrations/supabase/academyTypes";
import type { CancelState } from "@/lib/academyCustomer";
import { toTimeInput } from "@/lib/academySessions";
import { dateFnsLocaleFor } from "@/lib/dateFnsLocale";
import { cn } from "@/lib/utils";
import { formatDeadline } from "../courseFormat";

interface NextSessionCardProps {
  /** null once every session has ended. */
  session: AcademyCourseSessionRow | null;
  course: AcademyCourseRow;
  directionsUrl: string | null;
  whatsAppUrl: string | null;
  /** Today's rule, unchanged: the join link is for a CONFIRMED registration only. */
  canSeeOnlineLink: boolean;
}

/**
 * The registered customer's next session — the one thing they came for, so
 * it is the one dark card on the page: a white date block, the day, the
 * hours, the place, and the two ways to act on it.
 */
export function NextSessionCard({ session, course, directionsUrl, whatsAppUrl, canSeeOnlineLink }: NextSessionCardProps) {
  const { t, lang } = useLang();
  const locale = dateFnsLocaleFor(lang);
  const online = course.location_type === "online";
  const joinUrl = online && canSeeOnlineLink ? course.online_url : null;
  const primary = online
    ? joinUrl && { href: joinUrl, label: t("academyJoinLink"), icon: <ExternalLink className="h-4 w-4" /> }
    : directionsUrl && { href: directionsUrl, label: t("academyNavigate"), icon: <Navigation className="h-4 w-4" /> };

  if (!session) {
    return (
      <div className="rounded-3xl bg-foreground p-5 text-background">
        <p className="text-base font-bold">{t("academyCourseEnded")}</p>
        {whatsAppUrl && (
          <div className="mt-4 flex">
            <CardAction href={whatsAppUrl} icon={<MessageCircle className="h-4 w-4" />} label={t("academyWhatsApp")} />
          </div>
        )}
      </div>
    );
  }

  const date = parseISO(session.session_date);
  return (
    <div className="rounded-3xl bg-foreground p-5 text-background">
      <div className="flex items-center gap-4">
        <div className="flex h-[68px] w-[60px] shrink-0 flex-col items-center justify-center rounded-2xl bg-background text-foreground">
          <span className="text-[11px] font-semibold text-accent">{format(date, "MMM", { locale })}</span>
          <span className="text-[26px] font-bold leading-none tabular-nums">{format(date, "d")}</span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-base font-bold">{format(date, "EEEE", { locale })}</p>
          <p dir="ltr" className="mt-0.5 text-[15px] font-medium tabular-nums text-background/85 rtl:text-right">
            {toTimeInput(session.start_time)}–{toTimeInput(session.end_time)}
          </p>
          <p className="mt-1.5 flex items-center gap-1.5 text-xs text-background/70">
            {online ? <Video className="h-3.5 w-3.5 shrink-0" /> : <MapPin className="h-3.5 w-3.5 shrink-0" />}
            <span dir="auto" className="min-w-0 truncate ltr:text-left rtl:text-right">
              {online ? t("academyCourseOnline") : course.address}
            </span>
          </p>
        </div>
      </div>

      {online && !joinUrl && <p className="mt-3 text-xs leading-relaxed text-background/70">{t("academyOnlineLinkAfterConfirm")}</p>}

      {(primary || whatsAppUrl) && (
        <div className="mt-4 flex gap-2.5">
          {primary && <CardAction href={primary.href} icon={primary.icon} label={primary.label} solid />}
          {whatsAppUrl && (
            <CardAction href={whatsAppUrl} icon={<MessageCircle className="h-4 w-4" />} label={t("academyWhatsApp")} />
          )}
        </div>
      )}
    </div>
  );
}

function CardAction({ href, icon, label, solid }: { href: string; icon: ReactNode; label: string; solid?: boolean }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "inline-flex h-11 min-w-0 flex-1 items-center justify-center gap-2 rounded-2xl px-3 text-sm font-semibold transition-transform active:scale-[0.98] motion-reduce:transition-none",
        solid ? "bg-accent text-accent-foreground" : "bg-background/15 text-background",
      )}
    >
      {icon}
      <span className="truncate">{label}</span>
    </a>
  );
}

/**
 * How far the course has run: one segment per session — ended, next, still
 * to come. This is the schedule's progress; attendance is not tracked.
 */
export function CourseProgress({ total, ended }: { total: number; ended: number }) {
  const { t } = useLang();
  return (
    <div className="surface-soft rounded-2xl p-4">
      <p className="text-[15px] font-bold">
        {t("academyProgressCount").replace("{done}", String(ended)).replace("{total}", String(total))}
      </p>
      <div aria-hidden className={cn("mt-3 flex", total > 40 ? "gap-px" : "gap-[3px]")}>
        {Array.from({ length: total }, (_, i) => (
          <span
            key={i}
            className={cn(
              "h-2 min-w-0 flex-1 rounded-full",
              i < ended ? "bg-green-500" : i === ended ? "bg-accent" : "bg-foreground/10",
            )}
          />
        ))}
      </div>
    </div>
  );
}

interface RegistrationCardProps {
  cancelState: CancelState;
  cancelling: boolean;
  onCancel: () => void;
  /** WhatsApp or phone link to the academy; null hides "contact the academy". */
  contactUrl: string | null;
  detailsOpen: boolean;
  onToggleDetails: () => void;
}

/**
 * What the customer can still do about their registration, in plain words:
 * cancel while the window is open, otherwise why not and who to talk to —
 * and a row that opens the course's description and instructor.
 */
export function RegistrationCard({ cancelState, cancelling, onCancel, contactUrl, detailsOpen, onToggleDetails }: RegistrationCardProps) {
  const { t, lang } = useLang();
  const locale = dateFnsLocaleFor(lang);

  const rule =
    cancelState.kind === "open"
      ? cancelState.deadline
        ? t("academyCancelUntil").replace("{d}", formatDeadline(cancelState.deadline, locale))
        : t("academyCancelFreeAny")
      : cancelState.kind === "window_closed"
        ? t("academyCancelWindowPassed").replace("{d}", formatDeadline(cancelState.deadline, locale))
        : t("academyCourseStartedNote");

  return (
    <div className="surface-soft divide-y divide-border/60 rounded-2xl">
      <div className="px-4 py-3.5">
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 h-[18px] w-[18px] shrink-0 text-accent" />
          <p className="min-w-0 flex-1 text-sm leading-relaxed">{rule}</p>
        </div>
        {cancelState.kind === "open" ? (
          <button
            type="button"
            onClick={onCancel}
            disabled={cancelling}
            className="ms-[30px] mt-1 flex h-11 items-center text-sm font-semibold text-destructive disabled:opacity-50"
          >
            {t("academyCancelRegistration")}
          </button>
        ) : (
          contactUrl && (
            <a
              href={contactUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="ms-[30px] mt-1 inline-flex h-11 items-center gap-1.5 text-sm font-semibold text-accent"
            >
              <MessageCircle className="h-4 w-4" />
              {t("academyContactAcademy")}
            </a>
          )
        )}
      </div>
      <button
        type="button"
        onClick={onToggleDetails}
        aria-expanded={detailsOpen}
        className="flex min-h-[56px] w-full items-center gap-3 px-4 py-2.5 text-start"
      >
        <Info className="h-[18px] w-[18px] shrink-0 text-accent" />
        <span className="min-w-0 flex-1 text-sm font-medium">{t("academyCourseAndInstructorDetails")}</span>
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 text-foreground/40 transition-transform motion-reduce:transition-none",
            detailsOpen && "rotate-180",
          )}
        />
      </button>
    </div>
  );
}
