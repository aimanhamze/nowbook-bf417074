import { useId, useState, type ComponentType, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
  BadgeCheck, CalendarClock, CalendarRange, CalendarX2, Check, Clock3, Hourglass,
  ListPlus, NotebookPen, Tag, Wallet,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ForwardArrow } from "@/components/ui/directional-icon";
import { providerDesktopSheet } from "@/components/layout/providerDesktop";
import { useLang } from "@/contexts/LangContext";
import { useProviderProfile } from "@/hooks/useProviderProfile";
import { usePlural } from "@/hooks/usePlural";
import { usePendingCount } from "@/components/dashboard/PendingTab";
import { useProviderWaitlistCounts } from "@/hooks/useProviderWaitlist";
import type { TranslationKey } from "@/lib/translations";
import { toast } from "sonner";

const LEAD_TIME_OPTIONS = [15, 30, 60, 120, 240, 1440] as const;
const BOOKING_WINDOW_OPTIONS = [3, 7, 14, 30, 60, 90] as const;
// Customer self-cancel cutoff in hours. 0 = always cancellable; range 0–72
// matches the DB CHECK constraint (20260622000001 migration).
const CANCELLATION_NOTICE_OPTIONS = [0, 1, 2, 3, 5, 12, 24, 48, 72] as const;
// Display granularity of the customer's available-times grid. Range mirrors the
// DB CHECK constraint (5,10,15,30,45,60) from the 20260630000001 +
// 20260712000001 migrations.
const SLOT_INTERVAL_OPTIONS = [5, 10, 15, 30, 45, 60] as const;

type Icon = ComponentType<{ className?: string }>;
type PickerId = "lead" | "window" | "cancel" | "spacing";

// Visual language shared with the dashboard setup hub (SetupHub.tsx): grouped
// glass lists, hairline dividers, a 40px accent icon tile, title + one line.
const LIST = "glass-card-md overflow-hidden rounded-3xl";
const DIVIDER = "border-t border-foreground/[0.07]";
const ROW =
  "flex min-h-[64px] w-full items-center gap-3 px-4 py-3 text-start transition-colors active:bg-foreground/[0.04]";

// OFF must read as "tappable, currently off", not as disabled: an outlined
// track (foreground/50 ≈ 3.3:1 on the card, meeting the 3:1 non-text minimum)
// with a solid knob. ON keeps the accent track. Only `disabled` (the shared
// Switch's opacity-50) looks pale. Scoped to this section via className —
// the shared ui/switch.tsx is untouched.
const SWITCH_OFF_VISIBLE =
  "data-[state=unchecked]:border-foreground/50 data-[state=unchecked]:bg-white " +
  "[&[data-state=unchecked]>span]:bg-foreground/60 [&[data-state=unchecked]>span]:shadow-none";

// All controls save immediately and read straight from `profile.*` — no
// react-hook-form, so the watch+setValue+reset combobox bug can't occur here.
// Every mutation writes to the ACTIVE branch (useProviderProfile targets
// profile.id), unchanged by this layout.
export function BookingSettingsTab() {
  const { t, isRtl } = useLang();
  const pl = usePlural();
  const navigate = useNavigate();
  const {
    profile,
    updateBookingApproval,
    updateTreatmentNotesEnabled,
    updateShowPrices,
    updateAllowCustomerReschedule,
    updateDepositRequestEnabled,
    updateMinLeadTime,
    updateBookingWindow,
    updateCancellationNoticeHours,
    updateSlotInterval,
    updateWaitlistEnabled,
  } = useProviderProfile();
  const { fetchTotal: fetchWaitlistTotal } = useProviderWaitlistCounts();
  const [waitlistChecking, setWaitlistChecking] = useState(false);
  // How many were waiting when the turn-off confirmation opened; null = closed.
  const [waitlistOffCount, setWaitlistOffCount] = useState<number | null>(null);
  const pendingCount = usePendingCount();
  const [pendingGuardOpen, setPendingGuardOpen] = useState(false);
  const [picker, setPicker] = useState<PickerId | null>(null);

  const requiresApproval = profile?.requires_booking_approval ?? false;
  const treatmentNotesEnabled = profile?.treatment_notes_enabled ?? false;
  const showPrices = profile?.show_prices ?? true;
  // Cast: column added by 20261003000001 migration; types.ts regenerated after apply.
  const allowCustomerReschedule =
    (profile as { allow_customer_reschedule?: boolean } | null)?.allow_customer_reschedule ?? false;
  // Class bookings have fixed times, so the reschedule toggle means nothing to
  // a studio -- the DB trigger rejects their customers' reschedules regardless.
  const isFitnessStudio = profile?.category === "fitness_studio";
  // Cast: column added by 20260618000002 migration; types.ts regenerated after
  // apply (matches the booking_window_days cast below).
  const depositRequestEnabled =
    (profile as { deposit_request_enabled?: boolean } | null)?.deposit_request_enabled ?? false;
  const minLeadTime = profile?.min_lead_time_minutes ?? 15;
  const bookingWindow = (profile as { booking_window_days?: number } | null)?.booking_window_days ?? 14;
  // Cast: column added by 20260622000001 migration; types.ts regenerated after apply.
  const cancellationNoticeHours =
    (profile as { cancellation_notice_hours?: number } | null)?.cancellation_notice_hours ?? 5;
  // Cast: column added by 20260630000001 migration; types.ts regenerated after apply.
  const slotInterval =
    (profile as { slot_interval_minutes?: number } | null)?.slot_interval_minutes ?? 15;
  // Cast: column added by 20261017000001 migration; types.ts regenerated after apply.
  const waitlistEnabled =
    (profile as { waitlist_enabled?: boolean } | null)?.waitlist_enabled ?? false;

  // One save path for every control: translated toast either way, never the
  // raw error text. Controls are driven by the cached profile, which only
  // changes on success, so a failed save leaves them where they were.
  const save = async (run: () => Promise<unknown>) => {
    try {
      await run();
      toast.success(t("bsSaved"));
      return true;
    } catch {
      toast.error(t("bsSaveError"));
      return false;
    }
  };

  const saveWaitlistEnabled = (next: boolean) => save(() => updateWaitlistEnabled.mutateAsync(next));
  // Turning OFF with people waiting removes them (silently, by the DB
  // trigger) — confirm first. With nobody waiting, or turning ON, save now.
  const handleWaitlistToggle = async (next: boolean) => {
    if (updateWaitlistEnabled.isPending || waitlistChecking) return;
    if (!next) {
      let waiting: number;
      setWaitlistChecking(true);
      try {
        waiting = await fetchWaitlistTotal();
      } catch {
        // Can't tell whether anyone would be removed: don't guess, don't save.
        toast.error(t("bsSaveError"));
        return;
      } finally {
        setWaitlistChecking(false);
      }
      if (waiting > 0) {
        setWaitlistOffCount(waiting);
        return;
      }
    }
    await saveWaitlistEnabled(next);
  };

  const handleApprovalToggle = async (next: boolean) => {
    if (updateBookingApproval.isPending) return;
    if (!next && pendingCount > 0) {
      // Block turn-off until the provider resolves pending bookings.
      setPendingGuardOpen(true);
      return;
    }
    await save(() => updateBookingApproval.mutateAsync(next));
  };

  // A plain switch: ignore taps while its own save is in flight (instead of
  // greying it out — a pale switch reads as unavailable).
  const toggle = (m: { isPending: boolean; mutateAsync: (v: boolean) => Promise<unknown> }) =>
    (next: boolean) => {
      if (m.isPending) return;
      void save(() => m.mutateAsync(next));
    };

  // ── Value rows: current value text + the options their sheet offers ────────
  const leadLabel = (m: number) => t(`leadTime${m}` as TranslationKey);
  const windowShort = (d: number) => pl("bsDays", d);
  const windowOption = (d: number) => t(`bookingWindow${d}` as TranslationKey);
  const cancelShort = (h: number) => (h === 0 ? t("bsCancelAlwaysShort") : pl("bsHours", h));
  const cancelOption = (h: number) => (h === 0 ? t("cancellationNoticeAlways") : pl("bsHours", h));
  const minutes = (m: number) => pl("bsMinutes", m);

  const pickers: Record<PickerId, {
    title: string;
    value: number;
    options: readonly number[];
    label: (v: number) => string;
    mutation: { isPending: boolean; mutateAsync: (v: number) => Promise<unknown> };
  }> = {
    lead: { title: t("bsLeadTitle"), value: minLeadTime, options: LEAD_TIME_OPTIONS, label: leadLabel, mutation: updateMinLeadTime },
    window: { title: t("bsWindowTitle"), value: bookingWindow, options: BOOKING_WINDOW_OPTIONS, label: windowOption, mutation: updateBookingWindow },
    cancel: { title: t("bsCancelTitle"), value: cancellationNoticeHours, options: CANCELLATION_NOTICE_OPTIONS, label: cancelOption, mutation: updateCancellationNoticeHours },
    spacing: { title: t("bsSpacingTitle"), value: slotInterval, options: SLOT_INTERVAL_OPTIONS, label: minutes, mutation: updateSlotInterval },
  };
  const open = picker ? pickers[picker] : null;

  const choose = async (v: number) => {
    if (!open || open.mutation.isPending) return;
    if (v === open.value) {
      setPicker(null);
      return;
    }
    if (await save(() => open.mutation.mutateAsync(v))) setPicker(null);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6"
    >
      <h2 className="text-lg font-semibold">{t("bookingSettingsTitle")}</h2>

      <Group title={t("bsGroupBookings")}>
        <SwitchRow
          icon={BadgeCheck}
          title={t("bsApprovalTitle")}
          description={t(requiresApproval ? "bsApprovalOn" : "bsApprovalOff")}
          checked={requiresApproval}
          onChange={handleApprovalToggle}
        />
        <ValueRow icon={Hourglass} title={t("bsLeadTitle")} description={t("bsLeadDesc")}
          value={leadLabel(minLeadTime)} onOpen={() => setPicker("lead")} />
        <ValueRow icon={CalendarRange} title={t("bsWindowTitle")} description={t("bsWindowDesc")}
          value={windowShort(bookingWindow)} onOpen={() => setPicker("window")} />
        <ValueRow icon={CalendarX2} title={t("bsCancelTitle")} description={t("bsCancelDesc")}
          value={cancelShort(cancellationNoticeHours)} onOpen={() => setPicker("cancel")} />
        <ValueRow icon={Clock3} title={t("bsSpacingTitle")} description={t("bsSpacingDesc")}
          value={minutes(slotInterval)} onOpen={() => setPicker("spacing")} />
      </Group>

      <Group title={t("bsGroupCustomers")}>
        {!isFitnessStudio && (
          <SwitchRow
            icon={CalendarClock}
            title={t("bsRescheduleTitle")}
            description={t(allowCustomerReschedule ? "bsRescheduleOn" : "bsRescheduleOff")}
            checked={allowCustomerReschedule}
            onChange={toggle(updateAllowCustomerReschedule)}
          />
        )}
        <SwitchRow
          icon={Tag}
          title={t("bsPricesTitle")}
          description={t(showPrices ? "bsPricesOn" : "bsPricesOff")}
          checked={showPrices}
          onChange={toggle(updateShowPrices)}
        />
        {/* Waiting list — private services only, so never for a fitness
            studio (its customers book classes, which have no waiting list). */}
        {!isFitnessStudio && (
          <SwitchRow
            icon={ListPlus}
            title={t("bsWaitlistTitle")}
            description={t(waitlistEnabled ? "bsWaitlistOn" : "bsWaitlistOff")}
            checked={waitlistEnabled}
            onChange={handleWaitlistToggle}
          />
        )}
      </Group>

      <Group title={t("bsGroupTools")}>
        <SwitchRow
          icon={NotebookPen}
          title={t("bsNotesTitle")}
          description={t("bsNotesDesc")}
          checked={treatmentNotesEnabled}
          onChange={toggle(updateTreatmentNotesEnabled)}
        />
        <SwitchRow
          icon={Wallet}
          title={t("bsDepositTitle")}
          description={t("bsDepositDesc")}
          checked={depositRequestEnabled}
          onChange={toggle(updateDepositRequestEnabled)}
        />
      </Group>

      {/* Value picker — same options as the old dropdowns; choosing saves. */}
      <Sheet open={picker !== null} onOpenChange={(o) => !o && setPicker(null)}>
        <SheetContent
          side="bottom"
          dir={isRtl ? "rtl" : "ltr"}
          aria-describedby={undefined}
          className={`rounded-t-3xl pb-[max(1.5rem,env(safe-area-inset-bottom))] ${providerDesktopSheet}`}
        >
          {open && (
            <>
              <SheetHeader className="text-start">
                <SheetTitle>{open.title}</SheetTitle>
              </SheetHeader>
              <ul className="mt-4 space-y-1" role="radiogroup" aria-label={open.title}>
                {open.options.map((v) => {
                  const selected = v === open.value;
                  return (
                    <li key={v}>
                      <button
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        onClick={() => void choose(v)}
                        className={`flex min-h-12 w-full items-center justify-between gap-3 rounded-2xl px-4 text-start text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                          selected ? "bg-accent/10 font-semibold text-foreground" : "active:bg-foreground/[0.04]"
                        }`}
                      >
                        <span>{open.label(v)}</span>
                        {selected && <Check className="h-4 w-4 shrink-0 text-accent" strokeWidth={3} />}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </SheetContent>
      </Sheet>

      {/* Waiting-list turn-off confirmation — only when someone is waiting */}
      <AlertDialog open={waitlistOffCount !== null} onOpenChange={(o) => !o && setWaitlistOffCount(null)}>
        <AlertDialogContent className="w-[calc(100%-2rem)] max-w-sm rounded-3xl">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("waitlistOffConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {waitlistOffCount === 1
                ? t("waitlistOffConfirmBodyOne")
                : t("waitlistOffConfirmBody").replace("{count}", String(waitlistOffCount ?? 0))}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:space-x-0">
            <AlertDialogCancel type="button" className="mt-0 h-11 rounded-2xl">{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              type="button"
              onClick={() => void saveWaitlistEnabled(false)}
              className="h-11 rounded-2xl bg-red-600 text-white hover:bg-red-700"
            >
              {t("waitlistOffConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Pending-guard dialog — coupled to the require-approval turn-off */}
      <AlertDialog open={pendingGuardOpen} onOpenChange={setPendingGuardOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("cannotDisableApprovalTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("cannotDisableApprovalBody").replace("{count}", String(pendingCount))}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel type="button">{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              type="button"
              onClick={() => navigate("/calendar", { state: { tab: "pending" } })}
            >
              {t("goToPendingTab")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </motion.div>
  );
}

/** A titled glass list. Children are rows; the first gets no divider. */
function Group({ title, children }: { title: string; children: ReactNode }) {
  const rows = (Array.isArray(children) ? children : [children]).filter(Boolean);
  return (
    <section className="space-y-2">
      <h3 className="px-1 text-xs font-semibold text-foreground/60">{title}</h3>
      <ul className={LIST}>
        {rows.map((row, i) => (
          <li key={i} className={i > 0 ? DIVIDER : undefined}>{row}</li>
        ))}
      </ul>
    </section>
  );
}

function RowText({ title, description }: { title: string; description: string }) {
  return (
    <span className="min-w-0 flex-1">
      <span className="block text-sm font-semibold leading-snug">{title}</span>
      <span className="mt-0.5 line-clamp-2 text-xs leading-snug text-foreground/70">{description}</span>
    </span>
  );
}

function IconTile({ icon: Icon }: { icon: Icon }) {
  return (
    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent">
      <Icon className="h-[18px] w-[18px]" />
    </span>
  );
}

/** The whole row is the switch's label, so the 64px row is the tap target. */
function SwitchRow({
  icon, title, description, checked, onChange,
}: {
  icon: Icon;
  title: string;
  description: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  const id = useId();
  return (
    <label htmlFor={id} className={`${ROW} cursor-pointer`}>
      <IconTile icon={icon} />
      <RowText title={title} description={description} />
      <Switch id={id} checked={checked} onCheckedChange={onChange} className={SWITCH_OFF_VISIBLE} />
    </label>
  );
}

function ValueRow({
  icon, title, description, value, onOpen,
}: {
  icon: Icon;
  title: string;
  description: string;
  value: string;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-haspopup="dialog"
      className={`${ROW} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent`}
    >
      <IconTile icon={icon} />
      <RowText title={title} description={description} />
      <span className="shrink-0 text-sm font-medium text-foreground/70">{value}</span>
      <ForwardArrow className="h-4 w-4 shrink-0 text-foreground/40" />
    </button>
  );
}
