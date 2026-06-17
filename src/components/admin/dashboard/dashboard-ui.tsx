import { AlertTriangle } from "lucide-react";
import { useLang } from "@/contexts/LangContext";
import type { TranslationKey } from "@/lib/translations";
import type { AdminBookingRow } from "@/hooks/useAdminDashboard";

// ── Shared building blocks for the admin control-room dashboard ──────────────
// Warm/orange brand identity, rounded-2xl cards, RTL-first (logical props only).

export const CARD = "rounded-2xl border border-border bg-card";

// Section wrapper with a title + optional count chip and right-aligned action.
export function SectionCard({
  title,
  count,
  highlight,
  children,
}: {
  title: string;
  count?: number;
  highlight?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className={`${CARD} p-4`}>
      <div className="flex items-center gap-2 mb-3">
        <h2 className="text-sm font-bold">{title}</h2>
        {count !== undefined && (
          <span
            className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${
              highlight && count > 0
                ? "bg-amber-100 text-amber-700"
                : "bg-secondary text-secondary-foreground"
            }`}
          >
            {count}
          </span>
        )}
      </div>
      {children}
    </section>
  );
}

const STATUS_STYLES: Record<string, { key: TranslationKey; cls: string }> = {
  pending: { key: "badgePending", cls: "bg-amber-100 text-amber-700 ring-1 ring-amber-300" },
  confirmed: { key: "badgeConfirmed", cls: "bg-emerald-100 text-emerald-700" },
  cancelled: { key: "badgeCancelled", cls: "bg-rose-100 text-rose-600" },
  completed: { key: "badgeCompleted", cls: "bg-blue-100 text-blue-700" },
};

export function StatusBadge({ status }: { status: string }) {
  const { t } = useLang();
  const s = STATUS_STYLES[status] ?? {
    key: undefined as unknown as TranslationKey,
    cls: "bg-secondary text-secondary-foreground",
  };
  return (
    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${s.cls}`}>
      {s.key ? t(s.key) : status}
    </span>
  );
}

// "HH:MM:SS" → "HH:MM"
export function fmtTime(time: string) {
  return time?.slice(0, 5) ?? "";
}
// "YYYY-MM-DD" → "DD/MM" (calendar-order, direction-neutral)
export function fmtDayMonth(date: string) {
  const [, m, d] = date.split("-");
  return `${d}/${m}`;
}

// One operational booking row: provider · service · customer + date/time + status.
export function BookingRow({ row, showDate }: { row: AdminBookingRow; showDate?: boolean }) {
  const { t } = useLang();
  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-border/60 last:border-0">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold truncate">{row.business_name}</p>
        <p className="text-xs text-muted-foreground truncate">
          {row.service_name || "—"}
          {" · "}
          {row.customer_name || t("dashCustomer")}
        </p>
      </div>
      <div className="flex flex-col items-end gap-1 shrink-0">
        <span className="text-xs font-medium tabular-nums">
          {showDate ? `${fmtDayMonth(row.booking_date)} · ` : ""}
          {fmtTime(row.booking_time)}
        </span>
        <StatusBadge status={row.status} />
      </div>
    </div>
  );
}

export function ListSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-12 rounded-xl bg-muted animate-pulse" />
      ))}
    </div>
  );
}

export function EmptyState({ message }: { message: string }) {
  return (
    <div className="py-6 text-center">
      <p className="text-xs text-muted-foreground">{message}</p>
    </div>
  );
}

// Graceful per-section error (e.g. RPC raised 42501) — never a broken page.
export function ErrorState() {
  const { t } = useLang();
  return (
    <div className="py-6 flex flex-col items-center gap-1.5 text-center">
      <AlertTriangle className="h-4 w-4 text-muted-foreground" />
      <p className="text-xs text-muted-foreground">{t("dashLoadError")}</p>
    </div>
  );
}
