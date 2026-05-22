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

  return (
    <div className="glass-card rounded-2xl p-4">
      {/* Today row */}
      <div
        className={`flex items-center justify-between rounded-xl px-3 py-2.5 ${
          status.isOpen ? "bg-green-500/10" : "bg-muted/40"
        }`}
      >
        <span className="text-sm font-medium text-foreground">
          {t("today")} · {t(DOW_KEYS[todayDow])}
        </span>
        {status.todayHours ? (
          <span
            dir="ltr"
            className={`text-sm font-medium ${status.isOpen ? "text-green-700" : "text-muted-foreground"}`}
          >
            {status.todayHours.open} - {status.todayHours.close}
          </span>
        ) : (
          <span className="text-sm text-muted-foreground">
            {t("providerStatusClosed")}
          </span>
        )}
      </div>

      {/* Divider */}
      <div className="my-2 h-px w-full bg-border/60" />

      {/* Remaining 6 days */}
      <div className="flex flex-col">
        {orderedDows.slice(1).map(dow => {
          const hours = getRowHours(availability, dow);
          return (
            <div
              key={dow}
              className="flex items-center justify-between px-1 py-2"
            >
              <span className="text-sm text-muted-foreground">
                {t(DOW_KEYS[dow])}
              </span>
              {hours ? (
                <span dir="ltr" className="text-sm text-foreground">
                  {hours.open} - {hours.close}
                </span>
              ) : (
                <span className="text-sm text-muted-foreground">
                  {t("providerStatusClosed")}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
