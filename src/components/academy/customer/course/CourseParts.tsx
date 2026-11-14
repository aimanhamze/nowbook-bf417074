import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { CalendarDays, Clock, ExternalLink, ListChecks, MapPin, Navigation, ShieldCheck, Video, Wallet } from "lucide-react";
import { useLang } from "@/contexts/LangContext";
import { InstructorAvatar } from "@/components/academy/InstructorAvatar";
import type { AcademyCourseRow, AcademyCourseSessionRow, AcademyInstructorRow } from "@/integrations/supabase/academyTypes";
import { courseSpan } from "@/lib/academyCustomer";
import type { SeatsMeter } from "@/lib/academyCourseView";
import { mostCommonTimeRange } from "@/lib/academySchedule";
import { compactDateRange } from "@/lib/compactDateRange";
import { dateFnsLocaleFor } from "@/lib/dateFnsLocale";
import { cn } from "@/lib/utils";
import { SeatsBar } from "../CourseCard";

/** A course-page section with its heading. */
export function CourseSection({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <section className={cn("mt-8", className)}>
      <h2 className="mb-3 text-[17px] font-bold">{title}</h2>
      {children}
    </section>
  );
}

export type ChipTone = "neutral" | "green" | "amber";

const CHIP_TONE: Record<ChipTone, string> = {
  neutral: "bg-secondary text-foreground/75",
  green: "bg-green-100 text-green-800",
  amber: "bg-amber-100 text-amber-900",
};

export function Chip({ tone = "neutral", children }: { tone?: ChipTone; children: ReactNode }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold", CHIP_TONE[tone])}>
      {children}
    </span>
  );
}

/** Dates · sessions · hours · location, two by two. Hours are the ones most sessions share. */
export function FactTiles({ course, sessions }: { course: AcademyCourseRow; sessions: AcademyCourseSessionRow[] }) {
  const { t, lang } = useLang();
  const locale = dateFnsLocaleFor(lang);
  const span = courseSpan(sessions);
  const hours = mostCommonTimeRange(sessions);
  const online = course.location_type === "online";
  const none = "—";

  return (
    <dl className="mt-5 grid grid-cols-2 gap-2.5">
      <Fact icon={<CalendarDays className="h-4 w-4" />} label={t("academyFactDates")}>
        {span.first && span.last ? compactDateRange(span.first.session_date, span.last.session_date, locale) : none}
      </Fact>
      <Fact icon={<ListChecks className="h-4 w-4" />} label={t("academySessionsTitle")}>
        <span className="tabular-nums">{span.count}</span>
      </Fact>
      <Fact icon={<Clock className="h-4 w-4" />} label={t("academyFactHours")}>
        {hours ? (
          <span dir="ltr" className="tabular-nums">
            {hours.start}–{hours.end}
          </span>
        ) : (
          none
        )}
      </Fact>
      <Fact icon={online ? <Video className="h-4 w-4" /> : <MapPin className="h-4 w-4" />} label={t("academyCourseLocation")}>
        {online ? (
          t("academyCourseOnline")
        ) : (
          <span dir="auto" className="line-clamp-2 ltr:text-left rtl:text-right">
            {course.address || none}
          </span>
        )}
      </Fact>
    </dl>
  );
}

function Fact({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="surface-soft min-w-0 rounded-2xl p-3.5">
      <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <span className="text-accent">{icon}</span>
        {label}
      </dt>
      <dd className="mt-1.5 text-[15px] font-bold leading-snug">{children}</dd>
    </div>
  );
}

/** "7 seats left" + "3 of 10 taken" + the bar. Rendered only when counts are known. */
export function SeatsCard({ meter }: { meter: SeatsMeter }) {
  const { t } = useLang();
  const headline =
    meter.free === 0
      ? t("academySeatsFull")
      : meter.free === 1
        ? t("academySeatsLeftOne")
        : t("academySeatsLeft").replace("{n}", String(meter.free));
  return (
    <div className="surface-soft mt-2.5 rounded-2xl p-4">
      <div className="flex items-baseline justify-between gap-3">
        <p className={cn("text-[15px] font-bold", meter.tone === "low" && "text-amber-800")}>{headline}</p>
        <p className="shrink-0 text-xs text-muted-foreground">
          {t("academySeatsTakenShort").replace("{taken}", String(meter.taken)).replace("{max}", String(meter.max))}
        </p>
      </div>
      <SeatsBar meter={meter} className="mt-3 h-2" />
    </div>
  );
}

/** The description, folded to four lines when it is longer than that. */
export function CourseAbout({ text }: { text: string }) {
  const { t } = useLang();
  const ref = useRef<HTMLParagraphElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);

  // Measured while clamped: only a text that is really cut gets the toggle.
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && !expanded) setOverflows(el.scrollHeight > el.clientHeight + 1);
  }, [text, expanded]);

  return (
    <div>
      <p
        ref={ref}
        dir="auto"
        className={cn(
          "whitespace-pre-line text-sm leading-7 text-foreground/85 ltr:text-left rtl:text-right",
          !expanded && "line-clamp-4",
        )}
      >
        {text}
      </p>
      {(overflows || expanded) && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="-ms-2 mt-1 flex h-11 items-center px-2 text-sm font-semibold text-accent"
        >
          {t(expanded ? "showLess" : "readMore")}
        </button>
      )}
    </div>
  );
}

export function InstructorCard({ instructor, name }: { instructor: AcademyInstructorRow; name: string }) {
  return (
    <div className="surface-soft rounded-2xl p-4">
      <div className="flex items-center gap-3.5">
        <InstructorAvatar id={instructor.id} name={name} photoUrl={instructor.photo_url} size="lg" />
        <p dir="auto" className="min-w-0 text-base font-bold leading-snug ltr:text-left rtl:text-right">
          {name}
        </p>
      </div>
      {instructor.bio?.trim() && (
        <p dir="auto" className="mt-3 whitespace-pre-line text-sm leading-7 text-foreground/80 ltr:text-left rtl:text-right">
          {instructor.bio}
        </p>
      )}
    </div>
  );
}

interface GoodToKnowProps {
  course: AcademyCourseRow;
  /** Maps / Waze link for a physical course; null hides the button. */
  directionsUrl: string | null;
  /** Today's rule, unchanged: the join link is for a CONFIRMED registration only. */
  canSeeOnlineLink: boolean;
}

/** Where it happens (with directions or the join link), the cancellation rule, and how payment works. */
export function GoodToKnow({ course, directionsUrl, canSeeOnlineLink }: GoodToKnowProps) {
  const { t } = useLang();
  const online = course.location_type === "online";
  const cancel =
    course.cancellation_hours > 0
      ? t("academyCancelFree").replace("{h}", String(course.cancellation_hours))
      : t("academyCancelFreeAny");

  return (
    <div className="surface-soft divide-y divide-border/60 rounded-2xl">
      <InfoRow icon={online ? <Video className="h-[18px] w-[18px]" /> : <MapPin className="h-[18px] w-[18px]" />}>
        {online ? (
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">{t("academyCourseOnline")}</p>
            {canSeeOnlineLink && course.online_url ? (
              <a
                href={course.online_url}
                target="_blank"
                rel="noopener noreferrer"
                className="-ms-1 mt-0.5 inline-flex h-11 items-center gap-1.5 px-1 text-sm font-semibold text-accent"
              >
                <ExternalLink className="h-4 w-4" />
                {t("academyJoinLink")}
              </a>
            ) : (
              <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{t("academyOnlineLinkAfterConfirm")}</p>
            )}
          </div>
        ) : (
          <>
            <p dir="auto" className="min-w-0 flex-1 text-sm font-medium leading-snug ltr:text-left rtl:text-right">
              {course.address}
            </p>
            {directionsUrl && (
              <a
                href={directionsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-xl bg-accent/10 px-3.5 text-sm font-semibold text-accent"
              >
                <Navigation className="h-4 w-4" />
                {t("academyNavigate")}
              </a>
            )}
          </>
        )}
      </InfoRow>
      <InfoRow icon={<ShieldCheck className="h-[18px] w-[18px]" />}>
        <p className="min-w-0 flex-1 text-sm leading-snug">{cancel}</p>
      </InfoRow>
      {course.price != null && (
        <InfoRow icon={<Wallet className="h-[18px] w-[18px]" />}>
          <p className="min-w-0 flex-1 text-sm leading-snug">{t("academyPayAtVenue")}</p>
        </InfoRow>
      )}
    </div>
  );
}

export function InfoRow({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-h-[56px] items-center gap-3 px-4 py-2.5">
      <span className="shrink-0 text-accent">{icon}</span>
      {children}
    </div>
  );
}
