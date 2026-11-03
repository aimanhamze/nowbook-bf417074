import { useEffect, useState } from "react";
import { Check, CalendarDays, MessageCircle, Sparkles } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useLang } from "@/contexts/LangContext";
import { cn } from "@/lib/utils";
import { TIME_WINDOWS, type TimeWindow } from "@/lib/waitlistDay";
import type { TranslationKey } from "@/lib/translations";

const WINDOW_LABEL: Record<TimeWindow, TranslationKey> = {
  morning: "waitlistMorning",
  afternoon: "waitlistAfternoon",
  evening: "waitlistEvening",
};
const WINDOW_HINT: Record<TimeWindow, TranslationKey> = {
  morning: "waitlistMorningHint",
  afternoon: "waitlistAfternoonHint",
  evening: "waitlistEveningHint",
};

export interface WaitlistJoinChoice {
  /** All three when "Any time" is chosen. */
  windows: TimeWindow[];
  /** null = "Anyone" (or a provider without staff). */
  staffId: string | null;
}

/**
 * The waiting-list join sheet. Service and date are read-only (they are the
 * customer's choices from the booking flow); the customer picks the time of
 * day and, for staff providers, a member or "Anyone". The WhatsApp line is the
 * consent: joining means agreeing to be messaged when a spot opens.
 *
 * Only windows in which a slot could exist that day are offered
 * (`availableWindows`, from the bookings-ignored slots). With a single
 * possible window, "Any time" would mean the same thing, so it is not shown.
 */
export function WaitlistJoinSheet({
  open,
  onOpenChange,
  serviceName,
  dateLabel,
  availableWindows,
  staffOptions,
  defaultStaffId,
  submitting,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  serviceName: string;
  dateLabel: string;
  availableWindows: readonly TimeWindow[];
  /** null = the provider has no staff step; the field is not shown. */
  staffOptions: { id: string; name: string }[] | null;
  defaultStaffId: string | null;
  submitting: boolean;
  onSubmit: (choice: WaitlistJoinChoice) => void;
}) {
  const { t } = useLang();
  const [selected, setSelected] = useState<Set<TimeWindow>>(() => new Set(availableWindows));
  const [staffId, setStaffId] = useState<string | null>(defaultStaffId);

  // Every opening starts from "Any time" and the member the customer browsed.
  useEffect(() => {
    if (open) {
      setSelected(new Set(availableWindows));
      setStaffId(defaultStaffId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const offered = TIME_WINDOWS.filter((w) => availableWindows.includes(w));
  const anyTime = offered.length > 0 && offered.every((w) => selected.has(w));
  const showAnyTime = offered.length > 1;

  const toggle = (w: TimeWindow) =>
    setSelected((prev) => {
      // From "Any time", tapping one window means "just this one".
      if (anyTime && showAnyTime) return new Set([w]);
      const next = new Set(prev);
      if (next.has(w)) next.delete(w);
      else next.add(w);
      return next;
    });

  const submit = () => {
    if (selected.size === 0 || submitting) return;
    onSubmit({ windows: anyTime ? [...TIME_WINDOWS] : offered.filter((w) => selected.has(w)), staffId });
  };

  const chip = (isOn: boolean) =>
    cn(
      "inline-flex min-h-11 items-center gap-1.5 rounded-2xl border px-3.5 py-2 text-sm font-semibold transition-all active:scale-95",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50",
      isOn
        ? "border-transparent bg-accent text-accent-foreground shadow-[0_4px_12px_-4px_hsl(var(--accent)/0.4)]"
        : "border-border bg-card text-foreground hover:bg-secondary",
    );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="flex max-h-[92vh] flex-col gap-0 rounded-t-3xl border-t p-0">
        <div className="mx-auto mt-3 h-1.5 w-10 shrink-0 rounded-full bg-muted-foreground/20" />
        <div className="overflow-y-auto px-5 pb-[calc(env(safe-area-inset-bottom,0px)+1rem)] pt-3">
          {/* pr-8 is physical on purpose: the shared sheet's close button sits
              at the physical right in every direction (separate ticket). */}
          <SheetHeader className="space-y-1 pr-8 text-start">
            <SheetTitle className="text-lg leading-snug">{t("waitlistSheetTitle")}</SheetTitle>
            <SheetDescription className="text-xs">{t("waitlistDayFullSub")}</SheetDescription>
          </SheetHeader>

          <dl className="mt-4 divide-y divide-border/60 rounded-2xl border border-border bg-muted/40">
            <div className="flex min-h-11 items-center gap-3 px-3.5 py-2.5">
              <Sparkles className="h-4 w-4 shrink-0 text-accent" />
              <dt className="text-xs text-muted-foreground">{t("waitlistService")}</dt>
              <dd className="ms-auto min-w-0 truncate text-sm font-medium">{serviceName}</dd>
            </div>
            <div className="flex min-h-11 items-center gap-3 px-3.5 py-2.5">
              <CalendarDays className="h-4 w-4 shrink-0 text-accent" />
              <dt className="text-xs text-muted-foreground">{t("waitlistDate")}</dt>
              <dd className="ms-auto min-w-0 truncate text-sm font-medium">{dateLabel}</dd>
            </div>
          </dl>

          <fieldset className="mt-5">
            <legend className="mb-2 text-sm font-semibold">{t("waitlistWhen")}</legend>
            <div className="flex flex-wrap gap-2">
              {showAnyTime && (
                <button
                  type="button"
                  aria-pressed={anyTime}
                  onClick={() => setSelected(new Set(offered))}
                  className={chip(anyTime)}
                >
                  {anyTime && <Check className="h-4 w-4" />}
                  {t("waitlistAnyTime")}
                </button>
              )}
              {offered.map((w) => {
                const isOn = selected.has(w) && !(anyTime && showAnyTime);
                return (
                  <button key={w} type="button" aria-pressed={isOn} onClick={() => toggle(w)} className={chip(isOn)}>
                    {isOn && <Check className="h-4 w-4" />}
                    <span>{t(WINDOW_LABEL[w])}</span>
                    {/* dir="auto": "עד 12:00" / "قبل 12:00" lead with a
                        letter and read RTL; a bare "12:00–17:00" has none,
                        resolves LTR and keeps its order (forced RTL would
                        flip it to 17:00–12:00). */}
                    <span
                      dir="auto"
                      className={cn("text-[11px] font-medium", isOn ? "text-accent-foreground/80" : "text-muted-foreground")}
                    >
                      {t(WINDOW_HINT[w])}
                    </span>
                  </button>
                );
              })}
            </div>
          </fieldset>

          {staffOptions && staffOptions.length > 0 && (
            <fieldset className="mt-5">
              <legend className="mb-2 text-sm font-semibold">{t("waitlistStaff")}</legend>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  aria-pressed={staffId === null}
                  onClick={() => setStaffId(null)}
                  className={chip(staffId === null)}
                >
                  {staffId === null && <Check className="h-4 w-4" />}
                  {t("waitlistAnyone")}
                </button>
                {staffOptions.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    aria-pressed={staffId === s.id}
                    onClick={() => setStaffId(s.id)}
                    className={chip(staffId === s.id)}
                  >
                    {staffId === s.id && <Check className="h-4 w-4" />}
                    <span className="max-w-[10rem] truncate">{s.name}</span>
                  </button>
                ))}
              </div>
            </fieldset>
          )}

          <p className="mt-5 flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
            <MessageCircle className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
            {t("waitlistConsent")}
          </p>

          <button
            type="button"
            onClick={submit}
            disabled={selected.size === 0 || submitting}
            className="mt-4 inline-flex h-12 w-full items-center justify-center rounded-2xl bg-accent text-sm font-semibold text-accent-foreground shadow-[0_8px_20px_-8px_hsl(var(--accent)/0.6)] transition-transform active:scale-[0.98] disabled:opacity-50"
          >
            {submitting ? (
              <span className="h-5 w-5 animate-spin rounded-full border-2 border-accent-foreground border-t-transparent" />
            ) : (
              t("waitlistJoin")
            )}
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
