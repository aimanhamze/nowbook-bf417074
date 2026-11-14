import { Loader2 } from "lucide-react";
import { useLang } from "@/contexts/LangContext";
import type { AcademyCourseSessionRow } from "@/integrations/supabase/academyTypes";
import type { CourseCta } from "@/lib/academyCustomer";
import type { SeatsMeter } from "@/lib/academyCourseView";
import { dateFnsLocaleFor } from "@/lib/dateFnsLocale";
import type { TranslationKey } from "@/lib/translations";
import { RegistrationStatusBadge } from "../RegistrationStatusBadge";
import { formatCourseDate } from "../courseFormat";

interface Props {
  cta: CourseCta;
  price: number | null;
  meter: SeatsMeter | null;
  firstSession: Pick<AcademyCourseSessionRow, "session_date"> | null;
  signedIn: boolean;
  pending: boolean;
  onRegister: () => void;
}

/** Why the button is off, in the button's own words. */
const CLOSED_LABEL: Partial<Record<CourseCta["kind"], TranslationKey>> = {
  full: "academySeatsFull",
  started: "academyBadgeClosed",
  no_sessions: "academyBadgeClosed",
};

/**
 * The course page's pinned bar: what it costs (or how many seats are left)
 * and when it starts, beside the one action — Register. The button runs the
 * existing registration flow; a course that cannot be joined shows a disabled
 * button that says why.
 */
export function RegisterBar({ cta, price, meter, firstSession, signedIn, pending, onRegister }: Props) {
  const { t, lang } = useLang();
  const locale = dateFnsLocaleFor(lang);
  const closedKey = CLOSED_LABEL[cta.kind];

  const headline =
    price != null ? (
      <span dir="ltr" className="inline-flex items-baseline gap-0.5">
        <span className="text-sm font-medium text-muted-foreground">₪</span>
        <span className="text-[22px] font-bold leading-none tabular-nums">{price}</span>
      </span>
    ) : meter && meter.free > 0 ? (
      <span className="text-[15px] font-bold">
        {meter.free === 1 ? t("academySeatsLeftOne") : t("academySeatsLeft").replace("{n}", String(meter.free))}
      </span>
    ) : null;

  // A course that has already started has no "starts on" to promise.
  const starts = !firstSession
    ? t("academyCourseNoSessions")
    : cta.kind === "started"
      ? null
      : t("academyStartsOn").replace("{d}", formatCourseDate(firstSession.session_date, locale));

  return (
    <div className="fixed inset-x-0 bottom-0 z-50">
      <div className="border-t border-white/40 bg-white/85 px-5 pb-[calc(env(safe-area-inset-bottom,0px)+0.75rem)] pt-3 backdrop-blur-xl">
        <div className="mx-auto flex max-w-2xl items-center gap-4">
          <div className="min-w-0 flex-1">
            {headline && <p className="truncate">{headline}</p>}
            {starts && <p className="mt-0.5 truncate text-xs text-muted-foreground">{starts}</p>}
          </div>

          {cta.kind === "registered" ? (
            <RegistrationStatusBadge status={cta.status} className="shrink-0" />
          ) : closedKey ? (
            <button
              type="button"
              disabled
              className="h-12 shrink-0 rounded-2xl bg-secondary px-6 text-[15px] font-semibold text-muted-foreground"
            >
              {t(closedKey)}
            </button>
          ) : (
            <button
              type="button"
              onClick={onRegister}
              disabled={pending}
              className="inline-flex h-12 shrink-0 items-center justify-center gap-2 rounded-2xl bg-accent px-6 text-[15px] font-semibold text-accent-foreground shadow-[0_8px_24px_-8px_hsl(var(--accent)/0.55)] transition-transform active:scale-[0.98] disabled:opacity-60 motion-reduce:transition-none"
            >
              {pending && <Loader2 className="h-4 w-4 animate-spin" />}
              {signedIn ? t("academyRegisterForCourse") : t("academyRegisterSignIn")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
