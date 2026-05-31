import { useState } from "react";
import { Lock, KeyRound } from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { BackArrow } from "@/components/ui/directional-icon";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useLang } from "@/contexts/LangContext";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

const MIN_PASSWORD_LENGTH = 6;

const Settings = () => {
  const { t } = useLang();
  const { user, isProvider } = useAuth();
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
    <div className="min-h-screen pb-24">
      <header className="px-5 pt-12 pb-6 flex items-center gap-3">
        <button
          onClick={() => navigate("/profile")}
          className="p-1.5 -ml-1.5 rounded-lg hover:bg-secondary transition-colors"
          aria-label={t("profile")}
        >
          <BackArrow className="h-5 w-5" />
        </button>
        <h1 className="text-xl font-bold">{t("settings")}</h1>
      </header>

      {isProvider ? (
        <div className="px-5">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
            className="rounded-2xl border border-border bg-card p-4"
          >
            <div className="flex items-center gap-3 mb-1">
              <Lock className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">{t("changePassword")}</span>
            </div>
            <p className="text-xs text-muted-foreground mb-4">{t("changePasswordDesc")}</p>

            <div className="space-y-4">
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
            </div>
          </motion.div>
        </div>
      ) : (
        <div className="px-5">
          <p className="text-sm text-muted-foreground">{t("providerOnly")}</p>
        </div>
      )}
    </div>
  );
};

export default Settings;
