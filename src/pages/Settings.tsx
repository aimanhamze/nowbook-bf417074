import { useState } from "react";
import { Lock, KeyRound } from "lucide-react";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { BackArrow } from "@/components/ui/directional-icon";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { providerDesktopPage, providerDesktopColumn } from "@/components/layout/providerDesktop";
import { SettingsSection } from "@/components/settings/SettingsSection";
import { AvailabilityModeSection } from "@/components/settings/AvailabilityModeSection";
import { StaffSection } from "@/components/settings/StaffSection";
import { StaffPageLink } from "@/components/settings/StaffPageLink";
import { useLang } from "@/contexts/LangContext";
import { useAuth } from "@/contexts/AuthContext";
import { useProviderProfile } from "@/hooks/useProviderProfile";
import { supabase } from "@/integrations/supabase/client";

const MIN_PASSWORD_LENGTH = 6;

// Provider settings hub, grouped by who each setting affects:
//
//   Business — availability mode + staff. Both change what a CUSTOMER sees
//              when booking, so they belong together and lead the page.
//   Account  — the password. Private, no customer-facing consequence.
//
// The split is the page's organising idea, not decoration: it answers "will
// changing this show up in my booking page?" before the owner has to guess.
const Settings = () => {
  const { t } = useLang();
  const { user, isProvider } = useAuth();
  const { profile } = useProviderProfile();
  const navigate = useNavigate();

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const handleChangePassword = async () => {
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      toast.error(t("passwordTooShort"));
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error(t("passwordsDontMatch"));
      return;
    }
    if (!user?.email) {
      toast.error(t("passwordUpdateError"));
      return;
    }

    setLoading(true);
    try {
      // Re-authenticate to verify the current password — updateUser() alone
      // does NOT check it. signInWithPassword re-auths the same user (no sign-out).
      const { error: reauthError } = await supabase.auth.signInWithPassword({
        email: user.email,
        password: currentPassword,
      });
      if (reauthError) {
        // Distinguish a genuinely wrong password from a transient failure
        // (network, rate-limit). Supabase returns code "invalid_credentials"
        // (status 400) for a bad password; anything else is a verify failure.
        const code = (reauthError as { code?: string }).code;
        const isWrongPassword =
          code === "invalid_credentials" ||
          reauthError.message?.toLowerCase().includes("invalid login credentials");
        toast.error(isWrongPassword ? t("currentPasswordIncorrect") : t("couldNotVerifyPassword"));
        return;
      }

      const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
      if (updateError) {
        toast.error(updateError.message || t("passwordUpdateError"));
        return;
      }

      toast.success(t("passwordUpdatedSuccess"));
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("passwordUpdateError"));
    } finally {
      setLoading(false);
    }
  };

  return (
    // Provider surface: the soft warm gradient + single calm accent glow used
    // by Dashboard/Calendar/Notifications. Previously this page was flat white,
    // which made it read as an orphan next to every other provider screen.
    <div
      className={`relative min-h-screen overflow-x-clip pb-24 ${providerDesktopPage}`}
      style={{ background: "var(--bg-atmosphere-soft)" }}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute top-[-4rem] [inset-inline-end:-5rem] h-[22rem] w-[22rem] rounded-full blur-3xl opacity-45"
        style={{ background: "radial-gradient(circle, hsl(24 95% 80% / 0.34) 0%, transparent 65%)" }}
      />

      <div className={`relative ${providerDesktopColumn}`}>
        {/* The business name under the title answers "whose settings are
            these?" with data already in the cache — no invented copy. */}
        <header className="px-5 pt-12 pb-6 flex items-start gap-3">
          <button
            onClick={() => navigate("/profile")}
            className="-ms-1.5 mt-0.5 rounded-xl p-1.5 transition-colors hover:bg-secondary/60 active:scale-95"
            aria-label={t("profile")}
          >
            <BackArrow className="h-5 w-5" />
          </button>
          <div className="min-w-0">
            <h1 className="text-xl font-bold leading-tight">{t("settings")}</h1>
            {isProvider && profile?.business_name && (
              <p className="mt-1 truncate text-xs text-muted-foreground">{profile.business_name}</p>
            )}
          </div>
        </header>

        {isProvider ? (
          <div className="px-5 space-y-7">
            <div className="space-y-3">
              <h2 className="px-1 text-xs font-semibold text-muted-foreground/80">
                {t("settingsGroupBusiness")}
              </h2>
              <AvailabilityModeSection delay={0} />
              {/* New Staff page entry. The old inline section below stays until
                  the page is tested and merged, then comes out. */}
              <StaffPageLink delay={0.06} />
              <StaffSection delay={0.12} />
            </div>

            <div className="space-y-3">
              <h2 className="px-1 text-xs font-semibold text-muted-foreground/80">
                {t("settingsGroupAccount")}
              </h2>
              <SettingsSection
                icon={Lock}
                title={t("changePassword")}
                description={t("changePasswordDesc")}
                delay={0.12}
              >
                <div className="space-y-1.5">
                  <Label htmlFor="current-password">{t("currentPassword")}</Label>
                  <Input
                    id="current-password"
                    type="password"
                    dir="ltr"
                    autoComplete="current-password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="new-password">{t("newPassword")}</Label>
                  <Input
                    id="new-password"
                    type="password"
                    dir="ltr"
                    autoComplete="new-password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="confirm-password">{t("confirmNewPassword")}</Label>
                  <Input
                    id="confirm-password"
                    type="password"
                    dir="ltr"
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                  />
                </div>

                <Button
                  className="w-full gap-2"
                  onClick={handleChangePassword}
                  disabled={loading || !currentPassword || !newPassword || !confirmPassword}
                >
                  <KeyRound className="h-4 w-4" />
                  {loading ? t("updatingPassword") : t("updatePassword")}
                </Button>
              </SettingsSection>
            </div>
          </div>
        ) : (
          <div className="px-5">
            <p className="text-sm text-muted-foreground">{t("providerOnly")}</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default Settings;
