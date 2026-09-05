import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useLang } from "@/contexts/LangContext";
import { useProviderProfile } from "@/hooks/useProviderProfile";
import { toast } from "sonner";

// Raised by trg_enforce_staff_enable_no_future_bookings when flipping
// staff_enabled false→true while future confirmed/pending bookings exist.
const GUARD_TOKEN = "STAFF_ENABLE_BLOCKED_BY_FUTURE_BOOKINGS";

interface Props {
  /** Enabling with zero active members would show customers an empty picker. */
  activeCount: number;
  staffLoading: boolean;
}

/**
 * The customer-facing staff_enabled switch, at the top of the Staff page.
 *
 * Logic is lifted unchanged from StaffSection (settings): turning ON is gated on
 * at least one active member and on the DB trigger above; turning OFF is never
 * gated. The Switch is controlled by profile.staff_enabled from the query cache,
 * which only changes on success — so on failure it simply stays where it was.
 */
export function StaffModeBanner({ activeCount, staffLoading }: Props) {
  const { t } = useLang();
  const { profile, updateStaffEnabled } = useProviderProfile();

  const staffEnabled = profile?.staff_enabled ?? false;
  const enableBlockedNoStaff = !staffEnabled && activeCount === 0;

  const handleToggle = async (next: boolean) => {
    try {
      await updateStaffEnabled.mutateAsync(next);
      toast.success(t("profileSaved"));
    } catch (err) {
      // The thrown value is the PLAIN PostgREST response object, not an Error —
      // read the fields directly (see StaffSection for the supabase-js note).
      const e = (err ?? {}) as { message?: unknown; details?: unknown; hint?: unknown; code?: unknown };
      const haystack = [e.message, e.details, e.hint, e.code]
        .filter((v): v is string => typeof v === "string")
        .join(" | ");
      if (haystack.includes(GUARD_TOKEN)) {
        toast.error(t("staffEnableBlockedByFutureBookings"));
      } else {
        console.warn("staff_enabled toggle failed:", err);
        toast.error(typeof e.message === "string" && e.message ? e.message : "Error");
      }
    }
  };

  return (
    <section className="glass-card-md flex items-start gap-3 rounded-2xl p-3.5">
      <Switch
        checked={staffEnabled}
        onCheckedChange={handleToggle}
        disabled={updateStaffEnabled.isPending || enableBlockedNoStaff}
        aria-label={t("staffEnabledLabel")}
      />
      <div className="min-w-0 flex-1">
        <Label className="text-sm font-semibold">{t("staffEnabledLabel")}</Label>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{t("staffEnabledHelp")}</p>
        {enableBlockedNoStaff && !staffLoading && (
          <p className="mt-1 text-xs text-orange-600">{t("staffEnableRequiresStaff")}</p>
        )}
      </div>
    </section>
  );
}
