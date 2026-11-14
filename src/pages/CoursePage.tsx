import { useCallback, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { motion, useReducedMotion } from "framer-motion";
import { Share2 } from "lucide-react";
import { toast } from "sonner";
import { InstructorAvatar } from "@/components/academy/InstructorAvatar";
import { CourseImage } from "@/components/academy/customer/CourseCard";
import {
  Chip,
  CourseAbout,
  CourseSection,
  FactTiles,
  GoodToKnow,
  InstructorCard,
  SeatsCard,
  type ChipTone,
} from "@/components/academy/customer/course/CourseParts";
import { RegisterBar } from "@/components/academy/customer/course/RegisterBar";
import { SessionSchedule } from "@/components/academy/customer/course/SessionSchedule";
import { useCourseCatalogue } from "@/components/academy/customer/useCourseCatalogue";
import { useCourseRegisterAction } from "@/components/academy/customer/useCourseRegisterAction";
import { sectionTransition } from "@/components/dashboard/sectionTransition";
import { BackArrow } from "@/components/ui/directional-icon";
import { useLang } from "@/contexts/LangContext";
import { useProviderById } from "@/hooks/useAllProviders";
import { useKeyboardOpen } from "@/hooks/useKeyboardOpen";
import { useSmartBack } from "@/hooks/useSmartBack";
import { isAcademyCategory } from "@/lib/academyCategory";
import { courseDirectionsUrl } from "@/lib/academyCourseLinks";
import { seatsMeter } from "@/lib/academyCourseView";
import type { CourseCta } from "@/lib/academyCustomer";
import { looksLikeEmail } from "@/lib/customerLabel";
import type { TranslationKey } from "@/lib/translations";

/** The registration chip: open, full, or closed (started / no sessions yet). */
function registrationChip(cta: CourseCta): { key: TranslationKey; tone: ChipTone } {
  if (cta.kind === "full") return { key: "academySeatsFull", tone: "neutral" };
  if (cta.kind === "started" || cta.kind === "no_sessions") return { key: "academyBadgeClosed", tone: "neutral" };
  return { key: "academyRegistrationOpen", tone: "green" };
}

/**
 * One course, as a page of its own (/provider/:id/course/:courseId) — so it
 * can be shared, reloaded and left with Back. It reads the same cached
 * queries as the academy page (courses, seat counts, the visitor's own
 * registrations) and writes nothing on load; Register runs the existing flow.
 */
export default function CoursePage() {
  const { id: providerId, courseId } = useParams();
  const { t, lang } = useLang();
  const navigate = useNavigate();
  const reduceMotion = useReducedMotion();
  const keyboardOpen = useKeyboardOpen();
  const { isEntry } = useSmartBack();
  const { provider, isLoading: providerLoading } = useProviderById(providerId);
  const { courses, isLoading, error, seats, ctaFor } = useCourseCatalogue(providerId);
  const { register, pendingCourseId, signedIn } = useCourseRegisterAction(providerId ?? "");

  const academyUrl = `/provider/${providerId}`;
  // Opened from a shared link there is no page to go back to: the academy's
  // page is where this course lives, so Back goes there.
  const goBack = useCallback(() => {
    if (isEntry) navigate(academyUrl);
    else navigate(-1);
  }, [isEntry, navigate, academyUrl]);

  const item = courses.find((c) => c.course.id === courseId) ?? null;

  const share = useCallback(async () => {
    const url = window.location.href;
    if (navigator.share) {
      try {
        await navigator.share({ title: item?.course.name ?? "", url });
        return;
      } catch {
        // Cancelled, or sharing failed — copy the link instead.
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      toast.success(t("shareLinkCopied"));
    } catch {
      toast.error(t("academyErrGeneric"));
    }
  }, [item?.course.name, t]);

  const backButton = (
    <HeroButton onClick={goBack} label={t("back")}>
      <BackArrow variant="arrow" className="h-5 w-5" />
    </HeroButton>
  );

  if (isLoading || providerLoading) {
    return (
      <Shell start={backButton}>
        <div className="h-[220px] animate-pulse bg-secondary motion-reduce:animate-none" />
        <div className="space-y-3 px-5 pt-6">
          <div className="h-7 w-3/4 animate-pulse rounded-lg bg-secondary motion-reduce:animate-none" />
          <div className="h-5 w-1/2 animate-pulse rounded-lg bg-secondary motion-reduce:animate-none" />
          <div className="h-40 animate-pulse rounded-2xl bg-secondary motion-reduce:animate-none" />
        </div>
      </Shell>
    );
  }

  // Not an academy, an unknown course, or one that is no longer public.
  if (!item || !provider || !isAcademyCategory(provider.category)) {
    return (
      <Shell start={backButton}>
        <div className="flex min-h-screen flex-col items-center justify-center gap-5 px-6 text-center">
          <p className="text-muted-foreground">{t(error ? "academyCourseLoadFailed" : "academyCourseGone")}</p>
          <button
            type="button"
            onClick={() => navigate(provider ? academyUrl : "/", { replace: true })}
            className="inline-flex h-11 items-center justify-center rounded-2xl bg-accent px-6 text-sm font-semibold text-accent-foreground transition-transform active:scale-[0.98]"
          >
            {t(provider ? "academyBackToAcademy" : "backToHome")}
          </button>
        </div>
      </Shell>
    );
  }

  const { course, instructor, sessions } = item;
  const cta = ctaFor(item);
  const meter = seatsMeter(seats.get(course.id));
  const chip = registrationChip(cta);
  const confirmed = cta.kind === "registered" && cta.status === "confirmed";
  const closed = cta.kind === "started" || cta.kind === "no_sessions";
  // Never an email where a person's name goes.
  const instructorName = instructor && !looksLikeEmail(instructor.name) ? instructor.name : null;

  return (
    <Shell
      start={backButton}
      end={
        <HeroButton onClick={share} label={t("academyShareCourse")}>
          <Share2 className="h-5 w-5" />
        </HeroButton>
      }
    >
      <CourseImage url={course.image_url} className="h-[220px]" />

      <motion.main
        key={course.id}
        {...sectionTransition(!!reduceMotion)}
        className="relative -mt-7 rounded-t-[28px] bg-background px-5 pb-36 pt-6"
      >
        <div className="flex flex-wrap gap-2">
          <Chip>{t(course.location_type === "online" ? "academyChipOnline" : "academyChipInPerson")}</Chip>
          {cta.kind !== "registered" && <Chip tone={chip.tone}>{t(chip.key)}</Chip>}
        </div>

        <h1 dir="auto" className="mt-3 text-2xl font-bold leading-tight ltr:text-left rtl:text-right">
          {course.name}
        </h1>

        <div className="mt-4 flex items-center gap-3">
          {instructor && instructorName && (
            <>
              <InstructorAvatar id={instructor.id} name={instructorName} photoUrl={instructor.photo_url} />
              <div className="min-w-0 flex-1">
                <p className="text-xs text-muted-foreground">{t("academyLedBy")}</p>
                <p dir="auto" className="truncate text-sm font-semibold ltr:text-left rtl:text-right">
                  {instructorName}
                </p>
              </div>
            </>
          )}
          <button
            type="button"
            onClick={() => navigate(academyUrl)}
            className="ms-auto flex h-11 min-w-0 max-w-[45%] items-center rounded-xl text-xs font-medium text-muted-foreground underline-offset-4 hover:underline"
          >
            <span className="truncate">{provider.name[lang]}</span>
          </button>
        </div>

        <FactTiles course={course} sessions={sessions} />
        {/* Seats matter while a seat can still be taken — not once registration has closed. */}
        {meter && !closed && <SeatsCard meter={meter} />}

        {course.description?.trim() && (
          <CourseSection title={t("academyAboutCourse")}>
            <CourseAbout text={course.description.trim()} />
          </CourseSection>
        )}

        <CourseSection title={t("academyScheduleTitle")}>
          {sessions.length > 0 ? (
            <SessionSchedule sessions={sessions} />
          ) : (
            <p className="text-sm text-muted-foreground">{t("academyErrNoSessions")}</p>
          )}
        </CourseSection>

        {instructor && instructorName && (
          <CourseSection title={t("academyWhoTeaches")}>
            <InstructorCard instructor={instructor} name={instructorName} />
          </CourseSection>
        )}

        <CourseSection title={t("academyGoodToKnow")}>
          <GoodToKnow
            course={course}
            directionsUrl={courseDirectionsUrl(course, provider.socialLinks)}
            canSeeOnlineLink={confirmed}
          />
        </CourseSection>
      </motion.main>

      {!keyboardOpen && (
        <RegisterBar
          cta={cta}
          price={course.price}
          meter={meter}
          firstSession={sessions[0] ?? null}
          signedIn={signedIn}
          pending={pendingCourseId === course.id}
          onRegister={() => void register(course)}
        />
      )}
    </Shell>
  );
}

/** The page frame: the two round buttons stay put over the hero while the page scrolls. */
function Shell({ start, end, children }: { start: ReactNode; end?: ReactNode; children: ReactNode }) {
  return (
    <div className="relative min-h-screen overflow-x-clip bg-background">
      <div className="pointer-events-none fixed inset-x-0 top-0 z-40 flex items-center justify-between px-4 pt-[calc(env(safe-area-inset-top,0px)+0.75rem)]">
        <div className="pointer-events-auto">{start}</div>
        <div className="pointer-events-auto">{end}</div>
      </div>
      {children}
    </div>
  );
}

function HeroButton({ onClick, label, children }: { onClick: () => void; label: string; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="flex h-11 w-11 items-center justify-center rounded-full bg-white text-foreground shadow-[0_4px_16px_rgba(0,0,0,0.14)] ring-1 ring-black/5 transition-transform active:scale-95 motion-reduce:transition-none"
    >
      {children}
    </button>
  );
}
