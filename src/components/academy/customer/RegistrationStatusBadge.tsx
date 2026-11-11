import { CheckCircle2, Clock, XCircle, Ban } from "lucide-react";
import { useLang } from "@/contexts/LangContext";
import type { CourseRegistrationStatus } from "@/integrations/supabase/academyTypes";
import { cn } from "@/lib/utils";

const STYLE: Record<CourseRegistrationStatus, { cls: string; Icon: typeof Clock; key: "academyStatusPending" | "academyStatusConfirmed" | "academyStatusRejected" | "academyStatusCancelled" }> = {
  pending: { cls: "bg-amber-100 text-amber-800", Icon: Clock, key: "academyStatusPending" },
  confirmed: { cls: "bg-green-100 text-green-700", Icon: CheckCircle2, key: "academyStatusConfirmed" },
  rejected: { cls: "bg-red-100 text-red-700", Icon: XCircle, key: "academyStatusRejected" },
  cancelled: { cls: "bg-secondary text-muted-foreground", Icon: Ban, key: "academyStatusCancelled" },
};

/** Pill for a course registration's status, same palette as booking statuses. */
export function RegistrationStatusBadge({ status, className }: { status: CourseRegistrationStatus; className?: string }) {
  const { t } = useLang();
  const { cls, Icon, key } = STYLE[status];
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold", cls, className)}>
      <Icon className="h-3.5 w-3.5" />
      {t(key)}
    </span>
  );
}
