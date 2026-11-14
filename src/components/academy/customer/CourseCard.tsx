import { useState } from "react";
import { BookOpen, CalendarDays, ChevronLeft, ChevronRight, MapPin, Video } from "lucide-react";
import { useLang } from "@/contexts/LangContext";
import { InstructorAvatar } from "@/components/academy/InstructorAvatar";
import type { PublicCourse } from "@/hooks/usePublicCourses";
import { courseSpan, type CourseCta, type SeatCounts } from "@/lib/academyCustomer";
import { courseBadge, nextSession, seatsMeter, type CourseBadge, type SeatsMeter } from "@/lib/academyCourseView";
import { jerusalemNow, toTimeInput } from "@/lib/academySessions";
import { compactDateRange } from "@/lib/compactDateRange";
import { looksLikeEmail } from "@/lib/customerLabel";
import { dateFnsLocaleFor } from "@/lib/dateFnsLocale";
import type { TranslationKey } from "@/lib/translations";
import { cn } from "@/lib/utils";
import { formatCourseDate } from "./courseFormat";

interface Props {
  item: PublicCourse;
  counts: SeatCounts | undefined;
  cta: CourseCta;
  onOpen: () => void;
}

const BADGE: Record<Exclude<CourseBadge, null>, { key: TranslationKey; cls: string }> = {
  registered: { key: "academyBadgeRegistered", cls: "bg-green-100 text-green-800" },
  pending: { key: "academyStatusPending", cls: "bg-amber-100 text-amber-900" },
  last_seat: { key: "academyBadgeLastSeat", cls: "bg-amber-100 text-amber-900" },
  full: { key: "academySeatsFull", cls: "bg-white/95 text-foreground/75" },
  closed: { key: "academyBadgeClosed", cls: "bg-white/95 text-foreground/75" },
};

/**
 * One course on the academy's page: image (or a tidy fallback) with a single
 * state badge, the name, who teaches it, when and where — and a footer that
 * answers the visitor's next question: seats + price + "details" before
 * registering, the next session after. The whole card is one button.
 */
export function CourseCard({ item, counts, cta, onOpen }: Props) {
  const { t, lang } = useLang();
  const locale = dateFnsLocaleFor(lang);
  const { course, instructor, sessions } = item;
  const span = courseSpan(sessions);
  const badge = courseBadge(cta, counts);
  const registered = cta.kind === "registered";
  const location = course.location_type === "online" ? t("academyCourseOnline") : course.address;
  const LocationIcon = course.location_type === "online" ? Video : MapPin;
  // Never an email where a person's name goes.
  const instructorName = instructor && !looksLikeEmail(instructor.name) ? instructor.name : null;
  const [withBefore, withAfter] = t("academyWithInstructor").split("{name}").map((part) => part.trim());

  return (
    <button
      type="button"
      onClick={onOpen}
      className="surface-soft block w-full overflow-hidden rounded-3xl text-start transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 active:scale-[0.99] motion-reduce:transition-none motion-reduce:active:scale-100"
    >
      <span className="relative block">
        <CourseImage url={course.image_url} className="h-[132px]" />
        {badge && (
          <span
            className={cn(
              "absolute start-3 top-3 rounded-full px-2.5 py-1 text-[11px] font-semibold shadow-[0_2px_8px_rgba(40,20,10,0.18)]",
              BADGE[badge].cls,
            )}
          >
            {t(BADGE[badge].key)}
          </span>
        )}
      </span>

      <span className="block px-4 pb-4 pt-3.5">
        <span dir="auto" className="line-clamp-2 block text-[17px] font-bold leading-snug ltr:text-left rtl:text-right">
          {course.name}
        </span>

        {instructor && instructorName && (
          <span className="mt-2 flex items-center gap-2 text-[13px] text-foreground/75">
            <InstructorAvatar
              id={instructor.id}
              name={instructorName}
              photoUrl={instructor.photo_url}
              className="!h-6 !w-6 !text-[11px]"
            />
            {/* The name carries its own direction, so a Latin name in an RTL
                card is cut at its end, not its start. */}
            <span className="flex min-w-0 gap-1">
              {withBefore && <span className="shrink-0">{withBefore}</span>}
              <span dir="auto" className="min-w-0 truncate ltr:text-left rtl:text-right">
                {instructorName}
              </span>
              {withAfter && <span className="shrink-0">{withAfter}</span>}
            </span>
          </span>
        )}

        {/* When · how many · where. Dates and count never shrink; a long
            address is what gets cut. */}
        <span className="mt-2.5 flex min-w-0 items-center gap-x-3 text-xs text-muted-foreground">
          {span.first && span.last ? (
            <>
              <span className="flex shrink-0 items-center gap-1">
                <CalendarDays className="h-3.5 w-3.5 shrink-0" />
                {compactDateRange(span.first.session_date, span.last.session_date, locale)}
              </span>
              <span className="shrink-0">{t("academyCourseSessionsCount").replace("{n}", String(span.count))}</span>
            </>
          ) : (
            <span className="shrink-0">{t("academyCourseNoSessions")}</span>
          )}
          {location && (
            <span className="flex min-w-0 items-center gap-1">
              <LocationIcon className="h-3.5 w-3.5 shrink-0" />
              <span dir="auto" className="min-w-0 truncate ltr:text-left rtl:text-right">
                {location}
              </span>
            </span>
          )}
        </span>

        {registered ? (
          <NextSessionStrip item={item} pending={cta.status === "pending"} />
        ) : (
          <OpenFooter price={course.price} meter={seatsMeter(counts)} canRegister={cta.kind === "register"} />
        )}
      </span>
    </button>
  );
}

/** The course photo, or — without one, or if it fails to load — a soft surface with the course icon. */
export function CourseImage({ url, className }: { url: string | null; className?: string }) {
  const [failed, setFailed] = useState(false);
  if (url && !failed) {
    return (
      <img
        src={url}
        alt=""
        loading="lazy"
        onError={() => setFailed(true)}
        className={cn("block w-full bg-secondary object-cover", className)}
      />
    );
  }
  return (
    <span
      aria-hidden
      className={cn(
        "flex w-full items-center justify-center bg-gradient-to-br from-accent/15 via-secondary to-secondary/50",
        className,
      )}
    >
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/70 text-accent">
        <BookOpen className="h-7 w-7" strokeWidth={1.75} />
      </span>
    </span>
  );
}

const METER_FILL: Record<SeatsMeter["tone"], string> = {
  ok: "bg-green-500",
  low: "bg-amber-500",
  full: "bg-foreground/30",
};

/** The thin "N of M seats taken" bar. Fills from the reading direction's start. */
export function SeatsBar({ meter, className }: { meter: SeatsMeter; className?: string }) {
  return (
    <span aria-hidden className={cn("block h-1.5 overflow-hidden rounded-full bg-foreground/10", className)}>
      <span className={cn("block h-full rounded-full", METER_FILL[meter.tone])} style={{ width: `${meter.percent}%` }} />
    </span>
  );
}

function OpenFooter({ price, meter, canRegister }: { price: number | null; meter: SeatsMeter | null; canRegister: boolean }) {
  const { t } = useLang();
  return (
    <>
      {meter && (
        <span className="mt-3.5 block">
          <SeatsBar meter={meter} />
          <span className="mt-1.5 block text-xs text-muted-foreground">
            {t("academySeatsTakenOf").replace("{taken}", String(meter.taken)).replace("{max}", String(meter.max))}
          </span>
        </span>
      )}
      <span className="mt-3.5 flex items-center justify-between gap-3">
        {price != null ? (
          <span dir="ltr" className="flex items-baseline gap-0.5">
            <span className="text-sm font-medium text-muted-foreground">₪</span>
            <span className="text-[22px] font-bold leading-none tabular-nums">{price}</span>
          </span>
        ) : (
          <span />
        )}
        <span
          className={cn(
            "inline-flex h-11 items-center justify-center rounded-2xl px-5 text-sm font-semibold",
            canRegister
              ? "bg-accent text-accent-foreground shadow-[0_8px_20px_-10px_hsl(var(--accent)/0.7)]"
              : "bg-secondary text-foreground/80",
          )}
        >
          {t(canRegister ? "academyDetailsAndRegister" : "academyCourseDetails")}
        </span>
      </span>
    </>
  );
}

function NextSessionStrip({ item, pending }: { item: PublicCourse; pending: boolean }) {
  const { t, lang, isRtl } = useLang();
  const locale = dateFnsLocaleFor(lang);
  const next = nextSession(item.sessions, jerusalemNow());
  const Chevron = isRtl ? ChevronLeft : ChevronRight;
  return (
    <span
      className={cn(
        "mt-3.5 flex min-h-[52px] items-center gap-3 rounded-2xl px-3.5 py-2.5",
        pending ? "bg-amber-50 text-amber-950" : "bg-green-50 text-green-950",
      )}
    >
      <span className="min-w-0 flex-1">
        {next ? (
          <>
            <span className={cn("block text-[11px] font-semibold", pending ? "text-amber-800" : "text-green-800")}>
              {t("academyNextSession")}
            </span>
            <span className="mt-0.5 flex flex-wrap items-baseline gap-x-1.5 text-sm font-semibold">
              <span>{formatCourseDate(next.session_date, locale, "EEEE, d MMM")}</span>
              <span aria-hidden>·</span>
              <span dir="ltr" className="tabular-nums">
                {toTimeInput(next.start_time)}
              </span>
            </span>
          </>
        ) : (
          <span className="block text-sm font-semibold">{t("academyCourseEnded")}</span>
        )}
      </span>
      <Chevron className={cn("h-4 w-4 shrink-0", pending ? "text-amber-700" : "text-green-700")} />
    </span>
  );
}
