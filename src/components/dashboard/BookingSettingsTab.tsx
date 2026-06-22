import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
import { useLang } from "@/contexts/LangContext";
import { useProviderProfile } from "@/hooks/useProviderProfile";
import { usePendingCount } from "@/components/dashboard/PendingTab";
import { toast } from "sonner";

const LEAD_TIME_OPTIONS = [15, 30, 60, 120, 240, 1440] as const;
const BOOKING_WINDOW_OPTIONS = [3, 7, 14, 30, 60, 90] as const;
// Customer self-cancel cutoff in hours. 0 = always cancellable; range 0–72
// matches the DB CHECK constraint (20260622000001 migration).
const CANCELLATION_NOTICE_OPTIONS = [0, 1, 2, 3, 5, 12, 24, 48, 72] as const;

// All controls save immediately and read straight from `profile.*` — no
// react-hook-form, so the watch+setValue+reset combobox bug can't occur here.
export function BookingSettingsTab() {
  const { t } = useLang();
  const navigate = useNavigate();
  const {
    profile,
    updateBookingApproval,
    updateTreatmentNotesEnabled,
    updateShowPrices,
    updateDepositRequestEnabled,
    updateMinLeadTime,
    updateBookingWindow,
    updateCancellationNoticeHours,
  } = useProviderProfile();
  const pendingCount = usePendingCount();
  const [pendingGuardOpen, setPendingGuardOpen] = useState(false);

  const requiresApproval = profile?.requires_booking_approval ?? false;
  const treatmentNotesEnabled = profile?.treatment_notes_enabled ?? false;
  const showPrices = profile?.show_prices ?? true;
  // Cast: column added by 20260618000002 migration; types.ts regenerated after
  // apply (matches the booking_window_days cast below).
  const depositRequestEnabled =
    (profile as { deposit_request_enabled?: boolean } | null)?.deposit_request_enabled ?? false;
  const minLeadTime = profile?.min_lead_time_minutes ?? 15;
  const bookingWindow = (profile as { booking_window_days?: number } | null)?.booking_window_days ?? 14;
  // Cast: column added by 20260622000001 migration; types.ts regenerated after apply.
  const cancellationNoticeHours =
    (profile as { cancellation_notice_hours?: number } | null)?.cancellation_notice_hours ?? 5;

  const cancellationOptionLabel = (h: number) =>
    h === 0
      ? t("cancellationNoticeAlways")
      : t("cancellationNoticeHoursValue").replace("{n}", String(h));

  const handleApprovalToggle = async (next: boolean) => {
    if (!next && pendingCount > 0) {
      // Block turn-off until the provider resolves pending bookings.
      setPendingGuardOpen(true);
      return;
    }
    try {
      await updateBookingApproval.mutateAsync(next);
      toast.success(t("profileSaved"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error");
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-4"
    >
      <h2 className="text-lg font-semibold">{t("bookingSettingsTitle")}</h2>

      {/* Approval + treatment notes toggles */}
      <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
        <div className="flex items-start gap-3">
          <Switch
            checked={requiresApproval}
            onCheckedChange={handleApprovalToggle}
            disabled={updateBookingApproval.isPending}
          />
          <div className="flex-1">
            <Label className="text-sm font-medium">{t("requireApprovalLabel")}</Label>
            <p className="text-xs text-muted-foreground mt-1">{t("requireApprovalHelp")}</p>
          </div>
        </div>
        <div className="flex items-start gap-3 pt-3 border-t border-border">
          <Switch
            checked={treatmentNotesEnabled}
            onCheckedChange={async (next) => {
              try {
                await updateTreatmentNotesEnabled.mutateAsync(next);
                toast.success(t("profileSaved"));
              } catch (err) {
                toast.error(err instanceof Error ? err.message : "Error");
              }
            }}
            disabled={updateTreatmentNotesEnabled.isPending}
          />
          <div className="flex-1">
            <Label className="text-sm font-medium">{t("treatmentNotesEnabled")}</Label>
            <p className="text-xs text-muted-foreground mt-1">{t("treatmentNotes")}</p>
          </div>
        </div>
        <div className="flex items-start gap-3 pt-3 border-t border-border">
          <Switch
            checked={showPrices}
            onCheckedChange={async (next) => {
              try {
                await updateShowPrices.mutateAsync(next);
                toast.success(t("profileSaved"));
              } catch (err) {
                toast.error(err instanceof Error ? err.message : "Error");
              }
            }}
            disabled={updateShowPrices.isPending}
          />
          <div className="flex-1">
            <Label className="text-sm font-medium">{t("showPricesLabel")}</Label>
            <p className="text-xs text-muted-foreground mt-1">{t("showPricesHelp")}</p>
          </div>
        </div>
        <div className="flex items-start gap-3 pt-3 border-t border-border">
          <Switch
            checked={depositRequestEnabled}
            onCheckedChange={async (next) => {
              try {
                await updateDepositRequestEnabled.mutateAsync(next);
                toast.success(t("profileSaved"));
              } catch (err) {
                toast.error(err instanceof Error ? err.message : "Error");
              }
            }}
            disabled={updateDepositRequestEnabled.isPending}
          />
          <div className="flex-1">
            <Label className="text-sm font-medium">{t("depositRequestLabel")}</Label>
            <p className="text-xs text-muted-foreground mt-1">{t("depositRequestHelp")}</p>
          </div>
        </div>
      </div>

      {/* Scheduling policy selects */}
      <div className="rounded-2xl border border-border bg-card p-4 space-y-4">
        <div>
          <Label>{t("minLeadTimeLabel")}</Label>
          <Select
            value={String(minLeadTime)}
            onValueChange={async (v) => {
              try {
                await updateMinLeadTime.mutateAsync(Number(v));
                toast.success(t("profileSaved"));
              } catch (err) {
                toast.error(err instanceof Error ? err.message : "Error");
              }
            }}
            disabled={updateMinLeadTime.isPending}
          >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {LEAD_TIME_OPTIONS.map((minutes) => (
                <SelectItem key={minutes} value={String(minutes)}>
                  {t(`leadTime${minutes}` as Parameters<typeof t>[0])}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label>{t("bookingWindowLabel")}</Label>
          <Select
            value={String(bookingWindow)}
            onValueChange={async (v) => {
              try {
                await updateBookingWindow.mutateAsync(Number(v));
                toast.success(t("profileSaved"));
              } catch (err) {
                toast.error(err instanceof Error ? err.message : "Error");
              }
            }}
            disabled={updateBookingWindow.isPending}
          >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {BOOKING_WINDOW_OPTIONS.map((days) => (
                <SelectItem key={days} value={String(days)}>
                  {t(`bookingWindow${days}` as Parameters<typeof t>[0])}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label>{t("cancellationNoticeLabel")}</Label>
          <p className="text-xs text-muted-foreground mt-1 mb-2">{t("cancellationNoticeHelp")}</p>
          <Select
            value={String(cancellationNoticeHours)}
            onValueChange={async (v) => {
              try {
                await updateCancellationNoticeHours.mutateAsync(Number(v));
                toast.success(t("profileSaved"));
              } catch (err) {
                toast.error(err instanceof Error ? err.message : "Error");
              }
            }}
            disabled={updateCancellationNoticeHours.isPending}
          >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {CANCELLATION_NOTICE_OPTIONS.map((h) => (
                <SelectItem key={h} value={String(h)}>
                  {cancellationOptionLabel(h)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

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
