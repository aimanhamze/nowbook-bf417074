import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { BookOpen, CalendarDays, MapPin, Video, XCircle } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { CallToCancelNotice } from "@/components/booking/BookingParts";
import { useLang } from "@/contexts/LangContext";
import {
  useCancelCourseRegistration,
  useMyCourseRegistrations,
  type MyCourseRegistration,
} from "@/hooks/usePublicCourses";
import type { Provider } from "@/lib/mock-data";
import { courseCancelState, courseSpan } from "@/lib/academyCustomer";
import { academyErrorMessage } from "@/lib/academyErrors";
import { deliverCoursePush } from "@/lib/academyPushDelivery";
import { jerusalemNow } from "@/lib/academySessions";
import { dateFnsLocaleFor } from "@/lib/dateFnsLocale";
import { RegistrationStatusBadge } from "./RegistrationStatusBadge";
import { formatCourseDate, formatDeadline } from "./courseFormat";
import { coursePageUrl } from "./useCourseRegisterAction";

const ACTIVE = new Set(["pending", "confirmed"]);

/**
 * "My courses" on /bookings: every course registration of the signed-in
 * customer, active ones first. Pending / confirmed rows can be cancelled
 * through cancel_course_registration while the window is open; once it has
 * passed (or the course started) the row offers WhatsApp / Call to the
 * provider instead, like a late booking cancel. Renders nothing for a customer
 * who never registered.
 */
export function MyCoursesSection({ providers }: { providers: Provider[] }) {
  const { t } = useLang();
  const { registrations } = useMyCourseRegistrations();
  const cancel = useCancelCourseRegistration();
  const [confirmId, setConfirmId] = useState<string | null>(null);

  if (registrations.length === 0) return null;

  const sorted = [...registrations].sort((a, b) => {
    const aActive = ACTIVE.has(a.registration.status) ? 0 : 1;
    const bActive = ACTIVE.has(b.registration.status) ? 0 : 1;
    if (aActive !== bActive) return aActive - bActive;
    return b.registration.created_at.localeCompare(a.registration.created_at);
  });

  const onConfirmCancel = async () => {
    if (!confirmId) return;
    const item = registrations.find((r) => r.registration.id === confirmId);
    try {
      await cancel.mutateAsync(confirmId);
      toast.success(t("academyCancelledToast"));
      // The RPC wrote the provider's in-app row; this only delivers it.
      if (item) {
        deliverCoursePush("cancelled_by_customer", {
          courseName: item.course?.name ?? "",
          providerId: item.registration.provider_id,
          customerUserId: item.registration.user_id,
        });
      }
    } catch (err) {
      toast.error(academyErrorMessage(err, t));
    } finally {
      setConfirmId(null);
    }
  };

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
            onCancel={() => setConfirmId(item.registration.id)}
            cancelling={cancel.isPending && cancel.variables === item.registration.id}
          />
        ))}
      </div>

      <AlertDialog open={confirmId !== null} onOpenChange={(open) => !open && setConfirmId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("academyCancelConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("academyCancelConfirmBody")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={cancel.isPending}
              onClick={(e) => {
                e.preventDefault();
                void onConfirmCancel();
              }}
            >
              {t("academyCancelRegistration")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

function MyCourseCard({
  item,
  provider,
  onCancel,
  cancelling,
}: {
  item: MyCourseRegistration;
  provider: Provider | null;
  onCancel: () => void;
  cancelling: boolean;
}) {
  const { t, lang } = useLang();
  const navigate = useNavigate();
  const locale = dateFnsLocaleFor(lang);
  const { registration, course, sessions } = item;
  const span = courseSpan(sessions);
  const active = ACTIVE.has(registration.status);
  const cancelState = active && course ? courseCancelState(span.first, course.cancellation_hours, jerusalemNow()) : null;
  const providerName = provider?.name[lang] ?? "";

  const dates =
    span.first && span.last
      ? span.first.session_date === span.last.session_date
        ? formatCourseDate(span.first.session_date, locale)
        : `${formatCourseDate(span.first.session_date, locale)} – ${formatCourseDate(span.last.session_date, locale)}`
      : null;

  return (
    <article className={`surface-soft rounded-2xl p-3.5 ${active ? "" : "opacity-75"}`}>
      <button
        type="button"
        onClick={() => course && navigate(coursePageUrl(registration.provider_id, course.id))}
        className="flex w-full items-start gap-3 text-start"
        disabled={!course}
      >
        <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-accent/10 text-accent">
          {course?.image_url ? (
            <img src={course.image_url} alt="" loading="lazy" className="h-full w-full object-cover" />
          ) : (
            <BookOpen className="h-5 w-5" />
          )}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex items-start justify-between gap-2">
            <span className="line-clamp-2 text-sm font-semibold">{course?.name ?? t("academyCoursesSection")}</span>
            <RegistrationStatusBadge status={registration.status} className="shrink-0" />
          </span>
          {providerName && <span className="text-xs text-muted-foreground">{providerName}</span>}
          {dates && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <CalendarDays className="h-3.5 w-3.5 shrink-0" />
              <span>
                {dates} · {t("academyCourseSessionsCount").replace("{n}", String(span.count))}
              </span>
            </span>
          )}
          {course && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              {course.location_type === "online" ? (
                <Video className="h-3.5 w-3.5 shrink-0" />
              ) : (
                <MapPin className="h-3.5 w-3.5 shrink-0" />
              )}
              <span className="truncate">
                {course.location_type === "online" ? t("academyCourseOnline") : course.address}
              </span>
            </span>
          )}
        </span>
      </button>

      {registration.status === "pending" && (
        <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">{t("academyPendingNote")}</p>
      )}

      {cancelState?.kind === "open" && (
        <div className="mt-3 flex items-center justify-between gap-3 border-t border-border/40 pt-3">
          <span className="text-[11px] text-muted-foreground">
            {cancelState.deadline
              ? t("academyCancelUntil").replace("{d}", formatDeadline(cancelState.deadline, locale))
              : t("academyCancelPolicyAny")}
          </span>
          <button
            type="button"
            onClick={onCancel}
            disabled={cancelling}
            className="inline-flex shrink-0 items-center gap-1 rounded-xl border border-destructive/30 px-3 py-1.5 text-xs font-semibold text-destructive transition-colors hover:bg-destructive/5 disabled:opacity-50"
          >
            <XCircle className="h-3.5 w-3.5" />
            {t("academyCancelRegistration")}
          </button>
        </div>
      )}

      {cancelState?.kind === "window_closed" && (
        <CallToCancelNotice
          cancellationNoticeHours={course?.cancellation_hours ?? 0}
          providerPhone={provider?.phone ?? null}
          message={t("academyCancelWindowPassed").replace("{d}", formatDeadline(cancelState.deadline, locale))}
        />
      )}

      {cancelState?.kind === "started" && (
        <CallToCancelNotice
          cancellationNoticeHours={course?.cancellation_hours ?? 0}
          providerPhone={provider?.phone ?? null}
          message={t("academyCourseStartedNote")}
        />
      )}
    </article>
  );
}
