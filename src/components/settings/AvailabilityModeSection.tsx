import { CalendarDays } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useLang } from "@/contexts/LangContext";
import { useProviderProfile } from "@/hooks/useProviderProfile";
import { SettingsSection } from "@/components/settings/SettingsSection";
import { toast } from "sonner";

/**
 * Availability mode — weekly (default) vs monthly flat-default.
 *
 * Lives on the settings hub (/settings) next to staff management: both decide
 * how the calendar itself is shaped, which is a different question from the
 * booking rules (approval, lead time, window) that stay in Booking Settings.
 *
 * Every control saves immediately and reads straight from `profile.*` — no
 * react-hook-form, matching the rest of the provider settings surfaces.
 */
export function AvailabilityModeSection({ delay = 0 }: { delay?: number }) {
  const { t } = useLang();
  const { profile, updateAvailabilityMode, updateMonthlyDefaults } = useProviderProfile();

  // Monthly availability (Phase 1 columns; types.ts already regenerated). Default
  // 'weekly' keeps every existing provider on the fixed weekly pattern.
  const availabilityMode = profile?.availability_mode === "monthly" ? "monthly" : "weekly";
  const monthlyDefaultAvailable = profile?.monthly_default_available ?? true;
  const monthlyDefaultStart = (profile?.monthly_default_start ?? "09:00").slice(0, 5);
  const monthlyDefaultEnd = (profile?.monthly_default_end ?? "17:00").slice(0, 5);

  return (
    <SettingsSection
      icon={CalendarDays}
      title={t("availabilityModeLabel")}
      description={t("availabilityModeHelp")}
      delay={delay}
    >
      <Select
        value={availabilityMode}
        onValueChange={async (v) => {
          try {
            await updateAvailabilityMode.mutateAsync(v as "weekly" | "monthly");
            toast.success(t("profileSaved"));
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "Error");
          }
        }}
        disabled={updateAvailabilityMode.isPending}
      >
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="weekly">{t("availabilityModeWeekly")}</SelectItem>
          <SelectItem value="monthly">{t("availabilityModeMonthly")}</SelectItem>
        </SelectContent>
      </Select>

      {/* Flat-default controls — only relevant in monthly mode */}
      {availabilityMode === "monthly" && (
        <div className="space-y-4 pt-3 border-t border-border">
          <div className="flex items-start gap-3">
            <Switch
              checked={monthlyDefaultAvailable}
              onCheckedChange={async (next) => {
                try {
                  await updateMonthlyDefaults.mutateAsync({ monthly_default_available: next });
                  toast.success(t("profileSaved"));
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : "Error");
                }
              }}
              disabled={updateMonthlyDefaults.isPending}
            />
            <div className="flex-1">
              <Label className="text-sm font-medium">{t("monthlyDefaultAvailableLabel")}</Label>
              <p className="text-xs text-muted-foreground mt-1">{t("monthlyDefaultAvailableHelp")}</p>
            </div>
          </div>

          {/* Default hours — hidden when the default day is closed */}
          {monthlyDefaultAvailable && (
            <div>
              <Label>{t("monthlyDefaultHoursLabel")}</Label>
              <div className="flex items-center gap-1.5 mt-2">
                <Input
                  key={`monthly-start-${monthlyDefaultStart}`}
                  type="time"
                  className="h-9 text-sm flex-1"
                  defaultValue={monthlyDefaultStart}
                  onBlur={async (e) => {
                    try {
                      await updateMonthlyDefaults.mutateAsync({ monthly_default_start: e.target.value });
                      toast.success(t("profileSaved"));
                    } catch (err) {
                      toast.error(err instanceof Error ? err.message : "Error");
                    }
                  }}
                />
                <span className="text-xs text-muted-foreground">–</span>
                <Input
                  key={`monthly-end-${monthlyDefaultEnd}`}
                  type="time"
                  className="h-9 text-sm flex-1"
                  defaultValue={monthlyDefaultEnd}
                  onBlur={async (e) => {
                    try {
                      await updateMonthlyDefaults.mutateAsync({ monthly_default_end: e.target.value });
                      toast.success(t("profileSaved"));
                    } catch (err) {
                      toast.error(err instanceof Error ? err.message : "Error");
                    }
                  }}
                />
              </div>
            </div>
          )}
        </div>
      )}
    </SettingsSection>
  );
}
