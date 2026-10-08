import { Clock, MessageCircle, Phone } from "lucide-react";
import { useLang } from "@/contexts/LangContext";
import type { Tables } from "@/integrations/supabase/types";
import { bookingDateTime } from "@/lib/bookingActions";
import { cn } from "@/lib/utils";

/**
 * Pieces of the customer booking card shared by /bookings and the
 * provider-page appointment card, so the two read as one design.
 */

const LOCALES: Record<string, string> = { he: "he-IL", ar: "ar", en: "en-US" };

// Same phone → wa.me formatting used by the provider dashboard (CalendarTab /
// PendingTab): keep numbers already in 972 form, otherwise drop a leading 0 and
// prefix the Israel country code. Mirrored here so customer + provider links
// build identical URLs.
function toWhatsAppUrl(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("972")) return `https://wa.me/${digits}`;
  const local = digits.startsWith("0") ? digits.slice(1) : digits;
  return `https://wa.me/972${local}`;
}

export function StatusBadge({ status }: { status: string }) {
  const { t } = useLang();
  const map: Record<string, { dot: string; cls: string; label: string }> = {
    confirmed: { dot: "bg-green-500", cls: "bg-green-50 text-green-700 ring-green-600/20", label: t("confirmed") },
    pending: { dot: "bg-amber-500", cls: "bg-amber-50 text-amber-700 ring-amber-600/20", label: t("pendingApproval") },
    cancelled: { dot: "bg-red-400", cls: "bg-red-50 text-red-600 ring-red-500/20", label: t("cancelled") },
  };
  const s = map[status] ?? { dot: "bg-muted-foreground", cls: "bg-secondary text-muted-foreground ring-border", label: status };
  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ring-inset ${s.cls}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
}

export function DateTile({ booking, variant, isNext }: { booking: Tables<"bookings">; variant: "upcoming" | "history"; isNext: boolean }) {
  const { lang } = useLang();
  const locale = LOCALES[lang] ?? "en-US";
  const d = bookingDateTime(booking);
  const weekday = d.toLocaleDateString(locale, { weekday: "short" });
  const day = d.toLocaleDateString(locale, { day: "numeric" });
  const month = d.toLocaleDateString(locale, { month: "short" });

  const tone = isNext
    ? "bg-accent text-accent-foreground shadow-[0_8px_18px_-10px_hsl(var(--accent)/0.7)]"
    : variant === "upcoming"
      ? "bg-accent/10 text-accent"
      : "bg-secondary/80 text-muted-foreground";

  return (
    <div className={`flex h-[60px] w-[54px] shrink-0 flex-col items-center justify-center rounded-2xl ${tone}`}>
      <span className="text-[10px] font-medium uppercase leading-none opacity-80">{weekday}</span>
      <span dir="ltr" className="text-xl font-bold leading-tight tabular-nums">{day}</span>
      <span className="text-[10px] font-medium uppercase leading-none opacity-80">{month}</span>
    </div>
  );
}

/** Inside the provider's cutoff — can no longer self-cancel. One grouped unit:
 *  explain why (amber timing notice) → how to reach the provider (matched
 *  WhatsApp + Call buttons). `actionHeight` lets a roomier card use 44px. */
export function CallToCancelNotice({
  cancellationNoticeHours,
  providerPhone,
  actionHeight = "h-9",
}: {
  cancellationNoticeHours: number;
  providerPhone: string | null;
  actionHeight?: string;
}) {
  const { t } = useLang();
  return (
    <div className="mt-3 space-y-2.5 border-t border-border/40 pt-3">
      <div className="flex items-start gap-2 rounded-xl border border-amber-300/70 bg-amber-100/80 px-3 py-2.5 text-xs leading-relaxed text-amber-900">
        <Clock className="mt-px h-4 w-4 shrink-0 text-amber-600" />
        <span>{t("cancellationBlocked").replace("{hours}", String(cancellationNoticeHours))}</span>
      </div>
      {providerPhone && (
        <div className="flex items-stretch gap-2">
          <a
            href={toWhatsAppUrl(providerPhone)}
            target="_blank"
            rel="noopener noreferrer"
            className={cn("inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-green-600 text-xs font-semibold text-white shadow-[0_6px_14px_-8px_rgba(22,163,74,0.8)] transition-colors hover:bg-green-700", actionHeight)}
          >
            <MessageCircle className="h-4 w-4" />
            WhatsApp
          </a>
          <a
            href={`tel:${providerPhone}`}
            className={cn("inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-accent text-xs font-semibold text-accent-foreground shadow-[0_6px_14px_-8px_hsl(var(--accent)/0.8)] transition-opacity hover:opacity-90", actionHeight)}
          >
            <Phone className="h-4 w-4" />
            {t("call")}
          </a>
        </div>
      )}
    </div>
  );
}
