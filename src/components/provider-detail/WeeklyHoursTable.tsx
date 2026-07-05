import type { ProviderStatus, AvailabilityRow } from "@/lib/providerStatus";
import type { Lang } from "@/lib/translations";

const DOW_KEYS = [
  "sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday",
] as const;

function getRowHours(
  availability: AvailabilityRow[],
  dow: number,
): { open: string; close: string } | null {
  const row = availability.find(r => r.day_of_week === dow);
  if (!row || !row.is_available) return null;
  const open = row.start_time?.slice(0, 5) ?? null;
  const close = row.end_time?.slice(0, 5) ?? null;
  if (!open || !close) return null;
  return { open, close };
}

interface Props {
  availability: AvailabilityRow[];
  blockedDates: string[];
  status: ProviderStatus;
  lang: Lang;
  t: (key: string) => string;
}

export default function WeeklyHoursTable({ availability, status, t }: Props) {
  if (!status.hasSchedule) return null;

  const todayDow = new Date().getDay();

  // today first, then the remaining 6 days in order starting from tomorrow
  const orderedDows = Array.from({ length: 7 }, (_, i) => (todayDow + i) % 7);

  const closedPill = (
    <span className="rounded-full bg-muted/60 px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground">
      {t("providerStatusClosed")}
    </span>
  );

  return (
    <div className="glass-card rounded-2xl p-2">
      {/* Today row — elevated card with a live status dot and the day's
          hours as a badge, so "can I go now?" is answered at a glance. */}
      <div
        className={`flex items-center justify-between gap-3 rounded-xl px-3.5 py-3 ring-1 ring-inset ${
          status.isOpen
            ? "bg-green-500/10 ring-green-500/20"
            : "bg-muted/40 ring-black/5"
        }`}
      >
        <div className="flex items-center gap-2.5">
          <span aria-hidden className="relative flex h-2 w-2 shrink-0">
            {status.isOpen && (
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-500 opacity-60 motion-reduce:hidden" />
            )}
            <span
              className={`relative inline-flex h-2 w-2 rounded-full ${
                status.isOpen ? "bg-green-500" : "bg-muted-foreground/40"
              }`}
            />
          </span>
          <div className="flex flex-col">
            <span className="text-sm font-semibold text-foreground">
              {t("today")} · {t(DOW_KEYS[todayDow])}
            </span>
            <span
              className={`text-[11px] font-medium ${
                status.isOpen ? "text-green-700" : "text-muted-foreground"
              }`}
            >
              {t(status.isOpen ? "providerStatusOpen" : "providerStatusClosed")}
            </span>
          </div>
        </div>
        {status.todayHours ? (
          <span
            dir="ltr"
            className={`rounded-full bg-white/70 px-3 py-1 text-sm font-semibold tabular-nums ${
              status.isOpen ? "text-green-700" : "text-muted-foreground"
            }`}
          >
            {status.todayHours.open} - {status.todayHours.close}
          </span>
        ) : (
          closedPill
        )}
      </div>

      {/* Remaining 6 days — hairline-separated rows, tabular digits so the
          times align into a clean column, closed days as muted pills. */}
      <div className="flex flex-col divide-y divide-border/40 px-2 pt-1">
        {orderedDows.slice(1).map(dow => {
          const hours = getRowHours(availability, dow);
          return (
            <div key={dow} className="flex items-center justify-between px-1.5 py-2.5">
              <span
                className={`text-sm ${hours ? "font-medium text-foreground/80" : "text-muted-foreground"}`}
              >
                {t(DOW_KEYS[dow])}
              </span>
              {hours ? (
                <span dir="ltr" className="text-sm tabular-nums text-foreground">
                  {hours.open} - {hours.close}
                </span>
              ) : (
                closedPill
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
