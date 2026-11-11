import { useState } from "react";
import { format } from "date-fns";
import { BellRing, Phone, UserRound } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { useLang } from "@/contexts/LangContext";
import { useProviderProfile } from "@/hooks/useProviderProfile";
import { useProviderWaitlistCounts, useProviderWaitlistDay, type ProviderWaitlistRow } from "@/hooks/useProviderWaitlist";
import {
  waitlistDateLabel,
  waitlistPhoneLabel,
  waitlistTelHref,
  waitlistWindowsLabel,
  type TimeWindow,
} from "@/lib/waitlistDay";

/**
 * "3 waiting" for one day, next to the calendar's day header; tapping it opens
 * that day's read-only waiting list. Renders nothing when the provider has the
 * waiting list off or nobody is waiting that day. Counts are the whole
 * branch's: the calendar's staff filter does not apply (v1) — the list shows
 * each entry's staff instead.
 */
export function WaitlistDayPill({ date, className }: { date: Date; className?: string }) {
  const { t, lang } = useLang();
  const { enabled, counts } = useProviderWaitlistCounts();
  const [open, setOpen] = useState(false);
  const key = format(date, "yyyy-MM-dd");
  const count = enabled ? counts.get(key) ?? 0 : 0;
  if (count === 0) return null;

  const label = count === 1 ? t("waitlistWaitingOne") : t("waitlistWaiting").replace("{count}", String(count));

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex min-h-11 items-center gap-1.5 rounded-full border border-dashed border-accent/50 bg-accent/[0.07] px-3 text-xs font-semibold text-accent",
            "transition-transform active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
            className,
          )}
        >
          <BellRing className="h-3.5 w-3.5 shrink-0" />
          {label}
        </button>
      </SheetTrigger>
      <SheetContent side="bottom" className="flex max-h-[85vh] flex-col gap-0 rounded-t-3xl border-t p-0">
        <div className="mx-auto mt-3 h-1.5 w-10 shrink-0 rounded-full bg-muted-foreground/20" />
        <div className="overflow-y-auto px-5 pb-[calc(env(safe-area-inset-bottom,0px)+1rem)] pt-3">
          <SheetHeader className="space-y-1 text-start">
            <SheetTitle className="text-lg leading-snug">{t("waitlistListTitle")}</SheetTitle>
            <SheetDescription className="text-xs">
              {waitlistDateLabel(key, lang)} · {label}
            </SheetDescription>
          </SheetHeader>
          <WaitlistDayList date={key} open={open} />
          <p className="mt-4 text-[11px] leading-relaxed text-muted-foreground">{t("waitlistListNote")}</p>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function WaitlistDayList({ date, open }: { date: string; open: boolean }) {
  const { t } = useLang();
  const { data, isLoading, isError } = useProviderWaitlistDay(date, open);

  if (isLoading) {
    return (
      <div className="mt-4 space-y-2">
        {[1, 2].map((i) => (
          <div key={i} className="h-[72px] animate-pulse rounded-2xl bg-secondary" />
        ))}
      </div>
    );
  }
  if (isError) return <p className="mt-4 text-sm text-muted-foreground">{t("waitlistListError")}</p>;
  if (!data || data.length === 0) return <p className="mt-4 text-sm text-muted-foreground">{t("waitlistListEmpty")}</p>;

  return (
    <ul className="mt-4 divide-y divide-border/60 rounded-2xl border border-border bg-card">
      {data.map((row) => (
        <WaitlistRowItem key={row.entry_id} row={row} />
      ))}
    </ul>
  );
}

function WaitlistRowItem({ row }: { row: ProviderWaitlistRow }) {
  const { t } = useLang();
  const { profile } = useProviderProfile();
  const staffEnabled = profile?.staff_enabled === true;
  const name = row.customer_name ?? t("waitlistUnknownCustomer");
  const windows: TimeWindow[] = [
    ...(row.wants_morning ? (["morning"] as const) : []),
    ...(row.wants_afternoon ? (["afternoon"] as const) : []),
    ...(row.wants_evening ? (["evening"] as const) : []),
  ];
  // A named member always shows; "Anyone" only means something with staff on.
  const staffLabel = row.staff_name ?? (staffEnabled ? t("waitlistAnyone") : null);
  const tel = waitlistTelHref(row.customer_phone);

  return (
    <li className="flex items-center gap-3 px-3.5 py-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{name}</p>
        {row.service_name && <p className="truncate text-xs text-foreground/80">{row.service_name}</p>}
        <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          <BellRing className="h-3 w-3 shrink-0" />
          <span className="truncate">{waitlistWindowsLabel(windows, t)}</span>
          {staffLabel && (
            <>
              <span aria-hidden className="shrink-0">·</span>
              <UserRound className="h-3 w-3 shrink-0" />
              <span className="truncate">{staffLabel}</span>
            </>
          )}
        </p>
        {row.customer_phone && (
          // The line keeps the page's direction (aligned with the lines above);
          // only the number itself is LTR.
          <p className="mt-0.5 text-xs text-muted-foreground">
            <span dir="ltr" className="tabular-nums">{waitlistPhoneLabel(row.customer_phone)}</span>
          </p>
        )}
      </div>
      {tel ? (
        <a
          href={tel}
          aria-label={t("waitlistCallAria").replace("{name}", name)}
          className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-xl bg-accent/10 px-3 text-sm font-semibold text-accent transition-transform active:scale-95"
        >
          <Phone className="h-4 w-4" />
          {t("waitlistCall")}
        </a>
      ) : (
        <span className="shrink-0 text-[11px] text-muted-foreground">{t("waitlistNoPhone")}</span>
      )}
    </li>
  );
}
