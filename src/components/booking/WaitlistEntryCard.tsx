import { Link } from "react-router-dom";
import { parseISO } from "date-fns";
import { BellRing, UserRound } from "lucide-react";
import { useLang } from "@/contexts/LangContext";
import { WaitlistLeaveDialog } from "@/components/booking/WaitlistLeaveDialog";
import { entryWindows, useLeaveWaitlist, type WaitlistEntry } from "@/hooks/useWaitlist";
import { waitlistWindowsLabel } from "@/lib/waitlistDay";

const LOCALES: Record<string, string> = { he: "he-IL", ar: "ar", en: "en-US" };

/** Weekday / day / month tile for an entry date (yyyy-MM-dd). */
export function WaitlistDateChip({ entryDate }: { entryDate: string }) {
  const { lang } = useLang();
  const locale = LOCALES[lang] ?? "en-US";
  const d = parseISO(entryDate);
  return (
    <span className="flex h-12 w-11 shrink-0 flex-col items-center justify-center rounded-xl border border-dashed border-accent/50 bg-accent/[0.07] text-accent">
      <span className="text-[10px] font-medium leading-none">{d.toLocaleDateString(locale, { weekday: "short" })}</span>
      <span dir="ltr" className="my-0.5 text-lg font-bold leading-none tabular-nums">
        {d.toLocaleDateString(locale, { day: "numeric" })}
      </span>
      <span className="text-[10px] font-medium leading-none">{d.toLocaleDateString(locale, { month: "short" })}</span>
    </span>
  );
}

/**
 * One waiting-list entry on /bookings: provider (links to its page), service,
 * time windows and staff, with "Leave" behind a confirmation.
 */
export function WaitlistEntryCard({ entry, staffEnabled }: { entry: WaitlistEntry; staffEnabled: boolean }) {
  const { t } = useLang();
  const leave = useLeaveWaitlist();
  const providerName = entry.provider?.business_name ?? "";
  const windows = waitlistWindowsLabel(entryWindows(entry), t);
  // A named member always shows; "Anyone" only means something at a provider
  // that has staff.
  const staffLabel = entry.staff?.name ?? (staffEnabled ? t("waitlistAnyone") : null);

  return (
    <div className="glass-card-md flex items-center gap-3 rounded-2xl p-2.5 pe-1.5">
      <WaitlistDateChip entryDate={entry.entry_date} />
      <Link
        to={`/provider/${entry.provider_id}`}
        className="min-h-11 min-w-0 flex-1 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <span className="block truncate text-sm font-semibold leading-snug">{providerName}</span>
        {entry.service?.name && (
          <span className="block truncate text-xs text-foreground/80">{entry.service.name}</span>
        )}
        <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          <BellRing className="h-3 w-3 shrink-0" />
          <span className="truncate">{windows}</span>
          {staffLabel && (
            <>
              <span aria-hidden className="shrink-0">·</span>
              <UserRound className="h-3 w-3 shrink-0" />
              <span className="truncate">{staffLabel}</span>
            </>
          )}
        </span>
      </Link>
      <WaitlistLeaveDialog
        entryDate={entry.entry_date}
        providerName={providerName}
        onConfirm={() => leave.mutate(entry.id)}
        trigger={
          <button
            type="button"
            disabled={leave.isPending}
            className="inline-flex min-h-11 shrink-0 items-center rounded-xl px-3 text-sm font-semibold text-red-600 transition-transform active:scale-95 disabled:opacity-50"
          >
            {t("waitlistLeave")}
          </button>
        }
      />
    </div>
  );
}
