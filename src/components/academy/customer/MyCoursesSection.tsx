import { useNavigate } from "react-router-dom";
import { BookOpen } from "lucide-react";
import { ForwardArrow } from "@/components/ui/directional-icon";
import { useLang } from "@/contexts/LangContext";
import { useMyCourseRegistrations, type MyCourseRegistration } from "@/hooks/usePublicCourses";
import type { Provider } from "@/lib/mock-data";
import { nextSession } from "@/lib/academyCourseView";
import { jerusalemNow, toTimeInput } from "@/lib/academySessions";
import { dateFnsLocaleFor } from "@/lib/dateFnsLocale";
import { RegistrationStatusBadge } from "./RegistrationStatusBadge";
import { formatCourseDate } from "./courseFormat";
import { coursePageUrl } from "./useCourseRegisterAction";

const ACTIVE = new Set(["pending", "confirmed"]);

/**
 * "My courses" on /bookings: every course registration of the signed-in
 * customer, active ones first. Each is one card — the course, the academy,
 * the status and the next session — that opens the course page, where the
 * registration is managed (cancelling included). Renders nothing for a
 * customer who never registered.
 */
export function MyCoursesSection({ providers }: { providers: Provider[] }) {
  const { t } = useLang();
  const { registrations } = useMyCourseRegistrations();

  if (registrations.length === 0) return null;

  const sorted = [...registrations].sort((a, b) => {
    const aActive = ACTIVE.has(a.registration.status) ? 0 : 1;
    const bActive = ACTIVE.has(b.registration.status) ? 0 : 1;
    if (aActive !== bActive) return aActive - bActive;
    return b.registration.created_at.localeCompare(a.registration.created_at);
  });

  return (
    <section className="mb-5 px-5" aria-labelledby="my-courses-title">
      <h2 id="my-courses-title" className="mb-2 text-sm font-bold">
        {t("academyMyCourses")}
      </h2>
      <div className="flex flex-col gap-2">
        {sorted.map((item) => (
          <MyCourseCard
            key={item.registration.id}
            item={item}
            provider={providers.find((p) => p.id === item.registration.provider_id) ?? null}
          />
        ))}
      </div>
    </section>
  );
}

function MyCourseCard({ item, provider }: { item: MyCourseRegistration; provider: Provider | null }) {
  const { t, lang } = useLang();
  const navigate = useNavigate();
  const locale = dateFnsLocaleFor(lang);
  const { registration, course, sessions } = item;
  const active = ACTIVE.has(registration.status);
  const providerName = provider?.name[lang] ?? "";
  const next = active ? nextSession(sessions, jerusalemNow()) : null;

  return (
    <button
      type="button"
      // A course that is no longer public (deactivated, hidden branch) has no page to open.
      disabled={!course}
      onClick={() => course && navigate(coursePageUrl(registration.provider_id, course.id))}
      className={`surface-soft flex min-h-[76px] w-full items-center gap-3 rounded-2xl p-3 text-start transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent enabled:active:scale-[0.99] motion-reduce:transition-none ${
        active ? "" : "opacity-75"
      }`}
    >
      <span className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-accent/10 text-accent">
        {course?.image_url ? (
          <img src={course.image_url} alt="" loading="lazy" className="h-full w-full object-cover" />
        ) : (
          <BookOpen className="h-6 w-6" />
        )}
      </span>

      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex items-start justify-between gap-2">
          <span dir="auto" className="line-clamp-2 text-sm font-semibold leading-snug ltr:text-left rtl:text-right">
            {course?.name ?? t("academyCoursesSection")}
          </span>
          <RegistrationStatusBadge status={registration.status} className="shrink-0" />
        </span>
        {providerName && <span className="truncate text-xs text-muted-foreground">{providerName}</span>}
        {active && sessions.length > 0 && (
          <span className="flex flex-wrap items-baseline gap-x-1.5 text-xs text-foreground/80">
            {next ? (
              <>
                <span className="text-muted-foreground">{t("academyNextSession")}</span>
                <span className="font-medium">{formatCourseDate(next.session_date, locale)}</span>
                <span aria-hidden>·</span>
                <span dir="ltr" className="font-medium tabular-nums">
                  {toTimeInput(next.start_time)}
                </span>
              </>
            ) : (
              <span className="text-muted-foreground">{t("academyCourseEnded")}</span>
            )}
          </span>
        )}
      </span>

      {course && <ForwardArrow className="h-4 w-4 shrink-0 text-foreground/40" />}
    </button>
  );
}
