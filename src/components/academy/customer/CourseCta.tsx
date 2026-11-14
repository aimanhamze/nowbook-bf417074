import { Loader2 } from "lucide-react";
import { useLang } from "@/contexts/LangContext";
import type { CourseCta as CourseCtaState } from "@/lib/academyCustomer";
import { cn } from "@/lib/utils";
import { RegistrationStatusBadge } from "./RegistrationStatusBadge";

interface Props {
  cta: CourseCtaState;
  signedIn: boolean;
  pending: boolean;
  onRegister: () => void;
  /** Wide button (detail sheet) vs. compact (card). */
  size?: "sm" | "lg";
}

/** The course's call to action: Register, a disabled reason, or the customer's status. */
export function CourseCta({ cta, signedIn, pending, onRegister, size = "sm" }: Props) {
  const { t } = useLang();

  if (cta.kind === "registered") {
    return (
      <div className={cn("flex flex-col gap-1.5", size === "lg" ? "items-stretch" : "items-end")}>
        <RegistrationStatusBadge status={cta.status} className={size === "lg" ? "self-start" : ""} />
        {cta.status === "pending" && (
          <p className={cn("text-[11px] leading-relaxed text-muted-foreground", size === "lg" ? "" : "max-w-[14rem] text-end")}>
            {t("academyPendingNote")}
          </p>
        )}
      </div>
    );
  }

  const disabledText =
    cta.kind === "full"
      ? t("academySeatsFull")
      : cta.kind === "started"
        ? t("academyErrCourseStarted")
        : cta.kind === "no_sessions"
          ? t("academyErrNoSessions")
          : null;

  if (disabledText) {
    return (
      <span
        className={cn(
          "rounded-xl bg-secondary px-3 py-2 text-center text-[11px] font-semibold text-muted-foreground",
          size === "lg" && "block w-full py-3 text-sm",
        )}
      >
        {disabledText}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={onRegister}
      disabled={pending}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-xl bg-accent font-semibold text-accent-foreground transition-transform active:scale-95 disabled:opacity-60",
        size === "lg" ? "w-full py-3.5 text-base" : "px-4 py-2 text-xs",
      )}
    >
      {pending && <Loader2 className="h-4 w-4 animate-spin" />}
      {signedIn ? t("academyRegister") : t("academyRegisterSignIn")}
    </button>
  );
}
