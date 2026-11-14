import { CalendarDays, Clock, ExternalLink, MapPin, Video } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useLang } from "@/contexts/LangContext";
import { InstructorAvatar } from "@/components/academy/InstructorAvatar";
import type { PublicCourse } from "@/hooks/usePublicCourses";
import type { CourseCta as CourseCtaState, SeatsState } from "@/lib/academyCustomer";
import { toTimeInput } from "@/lib/academySessions";
import { dateFnsLocaleFor } from "@/lib/dateFnsLocale";
import { CourseCta } from "./CourseCta";
import { SeatsBadge } from "./SeatsBadge";
import { formatCourseDate } from "./courseFormat";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: PublicCourse | null;
  seats: SeatsState;
  cta: CourseCtaState | null;
  signedIn: boolean;
  pending: boolean;
  onRegister: () => void;
}

/**
 * Everything about one course before committing: full description, every
 * session with its time range, the instructor's bio, the cancellation window,
 * and the same call to action as the card. An online course's link is shown
 * only once the customer's registration is confirmed.
 */
export function CourseDetailSheet({ open, onOpenChange, item, seats, cta, signedIn, pending, onRegister }: Props) {
  const { t, lang } = useLang();
  const locale = dateFnsLocaleFor(lang);
  if (!item) return null;
  const { course, instructor, sessions } = item;
  const confirmed = cta?.kind === "registered" && cta.status === "confirmed";

  const cancelPolicy =
    course.cancellation_hours > 0
      ? t("academyCancelPolicy").replace("{h}", String(course.cancellation_hours))
      : t("academyCancelPolicyAny");

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[calc(var(--vvh,100dvh)*0.92)] overflow-y-auto rounded-t-3xl">
        {course.image_url && (
          <img
            src={course.image_url}
            alt=""
            className="-mx-6 -mt-6 mb-4 h-44 w-[calc(100%+3rem)] max-w-none object-cover"
          />
        )}
        <SheetHeader className="text-start">
          <SheetTitle className="text-start text-xl">{course.name}</SheetTitle>
        </SheetHeader>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <SeatsBadge seats={seats} />
          {course.price != null && (
            <span className="text-sm font-semibold">
              {t("academyPriceAtVenue").replace("{p}", String(course.price))}
            </span>
          )}
        </div>

        <div className="mt-4 space-y-2 text-sm">
          <p className="flex items-start gap-2 text-muted-foreground">
            {course.location_type === "online" ? (
              <Video className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
            ) : (
              <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
            )}
            <span>{course.location_type === "online" ? t("academyCourseOnline") : course.address}</span>
          </p>
          {course.location_type === "online" &&
            (confirmed && course.online_url ? (
              <a
                href={course.online_url}
                target="_blank"
                rel="noopener noreferrer"
                dir="ltr"
                className="inline-flex items-center gap-1.5 text-sm font-semibold text-accent underline-offset-2 hover:underline"
              >
                <ExternalLink className="h-4 w-4" />
                {t("academyJoinLink")}
              </a>
            ) : (
              <p className="text-xs text-muted-foreground">{t("academyOnlineLinkAfterConfirm")}</p>
            ))}
          <p className="flex items-start gap-2 text-muted-foreground">
            <Clock className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
            <span>{cancelPolicy}</span>
          </p>
        </div>

        {course.description && (
          <p className="mt-4 whitespace-pre-line text-sm leading-7 text-foreground/85">{course.description}</p>
        )}

        <section className="mt-5">
          <h3 className="mb-2 flex items-center gap-1.5 text-sm font-bold">
            <CalendarDays className="h-4 w-4 text-accent" />
            {t("academySessionsTitle")}
            <span className="font-normal text-muted-foreground">({sessions.length})</span>
          </h3>
          {sessions.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("academyCourseNoSessions")}</p>
          ) : (
            <ul className="divide-y divide-border/60 rounded-2xl border border-border">
              {sessions.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm">
                  <span>{formatCourseDate(s.session_date, locale, "EEEE, d MMMM yyyy")}</span>
                  <span dir="ltr" className="shrink-0 tabular-nums text-muted-foreground">
                    {toTimeInput(s.start_time)}–{toTimeInput(s.end_time)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {instructor && (
          <section className="mt-5 rounded-2xl bg-secondary/50 p-4">
            <div className="flex items-center gap-3">
              <InstructorAvatar id={instructor.id} name={instructor.name} photoUrl={instructor.photo_url} />
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">{t("academyCourseInstructor")}</p>
                <p className="font-semibold">{instructor.name}</p>
              </div>
            </div>
            {instructor.bio && (
              <p className="mt-3 whitespace-pre-line text-sm leading-6 text-foreground/80">{instructor.bio}</p>
            )}
          </section>
        )}

        {cta && (
          <div className="sticky bottom-0 -mx-6 mt-5 border-t border-border/60 bg-background/95 px-6 pb-[calc(env(safe-area-inset-bottom,0px)+1rem)] pt-4 backdrop-blur">
            <CourseCta cta={cta} signedIn={signedIn} pending={pending} onRegister={onRegister} size="lg" />
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
