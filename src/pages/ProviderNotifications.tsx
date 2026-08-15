import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { useLang } from "@/contexts/LangContext";
import { useAuth } from "@/contexts/AuthContext";
import { useProviderProfile } from "@/hooks/useProviderProfile";
import { BackArrow } from "@/components/ui/directional-icon";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { providerDesktopPage, providerDesktopColumn } from "@/components/layout/providerDesktop";

// Two options only: these are the two Meta-approved templates. There is no
// English template, and the DB CHECK constraint on
// provider_profiles.whatsapp_message_language rejects anything else.
const MESSAGE_LANGUAGES = ["he", "ar"] as const;
type MessageLanguage = typeof MESSAGE_LANGUAGES[number];

// Two lead times only, matching the CHECK constraint on
// provider_profiles.whatsapp_reminder_hours.
const REMINDER_LEAD_HOURS = [24, 1] as const;
type ReminderLeadHours = typeof REMINDER_LEAD_HOURS[number];

// Standalone provider settings page, reached from /profile. Deliberately NOT a
// sixth Dashboard tab: that tab bar is five flex-1 items whose labels are
// already hidden below `sm`, so a sixth would push a shipped, heavily-used RTL
// screen to icon-only on mobile.
//
// Route is /notification-settings, NOT /notifications — the latter is the
// customer's notification feed (Notifications.tsx).
export default function ProviderNotifications() {
  const { t } = useLang();
  const { user, isProvider } = useAuth();
  const navigate = useNavigate();
  const {
    profile,
    isLoading,
    updateWhatsAppConfirmEnabled,
    updateWhatsAppMessageLanguage,
    updateWhatsAppReminderEnabled,
    updateWhatsAppReminderHours,
  } = useProviderProfile();

  useEffect(() => {
    if (user && !isProvider) {
      navigate("/", { replace: true });
    }
  }, [user, isProvider, navigate]);

  if (!user || !isProvider) return null;

  // No profile yet — mirror the other provider pages' graceful guard.
  if (!isLoading && !profile) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-5 gap-4">
        <p className="text-muted-foreground text-center">{t("profileNotSetup")}</p>
        <Button onClick={() => navigate("/")}>{t("home")}</Button>
      </div>
    );
  }

  // Defaults mirror the column defaults, so the UI reads correctly during the
  // brief window before the profile query resolves.
  const confirmEnabled = profile?.whatsapp_confirm_enabled ?? false;
  const messageLanguage: MessageLanguage =
    profile?.whatsapp_message_language === "ar" ? "ar" : "he";

  const reminderEnabled = profile?.whatsapp_reminder_enabled ?? false;
  const reminderHours: ReminderLeadHours =
    profile?.whatsapp_reminder_hours === 1 ? 1 : 24;

  const languageLabel = (lang: MessageLanguage) =>
    lang === "ar" ? t("whatsappLanguageAr") : t("whatsappLanguageHe");

  const leadLabel = (hours: ReminderLeadHours) =>
    hours === 1 ? t("whatsappReminderLead1") : t("whatsappReminderLead24");

  return (
    <div className={`min-h-screen pb-24 ${providerDesktopPage}`}>
      <div className={providerDesktopColumn}>
        <header className="px-5 pt-12 pb-4">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate("/profile")} className="active:scale-95" aria-label={t("profile")}>
              <BackArrow className="h-5 w-5" />
            </button>
            <h1 className="text-xl font-bold flex-1">{t("notificationSettingsTitle")}</h1>
          </div>
        </header>

        {/* Every control saves immediately and reads straight from `profile.*` —
            same approach as BookingSettingsTab, so there is no form state to
            fall out of sync with the server. */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="px-5 space-y-4"
        >
          <div className="rounded-2xl border border-border bg-card p-4 space-y-4">
            {/* Master switch. Default OFF — a provider must opt in before a
                single message is sent on their behalf. */}
            <div className="flex items-start gap-3">
              <Switch
                checked={confirmEnabled}
                onCheckedChange={async (next) => {
                  try {
                    await updateWhatsAppConfirmEnabled.mutateAsync(next);
                    toast.success(t("profileSaved"));
                  } catch (err) {
                    toast.error(err instanceof Error ? err.message : "Error");
                  }
                }}
                disabled={updateWhatsAppConfirmEnabled.isPending}
              />
              <div className="flex-1">
                <Label className="text-sm font-medium">{t("whatsappConfirmLabel")}</Label>
                <p className="text-xs text-muted-foreground mt-1">{t("whatsappConfirmHelp")}</p>
              </div>
            </div>

          </div>

          {/* Reminders — a separate opt-in. A provider may want confirmations
              without reminders, or the reverse, so the two switches are
              independent. Default OFF. */}
          <div className="rounded-2xl border border-border bg-card p-4 space-y-4">
            <div className="flex items-start gap-3">
              <Switch
                checked={reminderEnabled}
                onCheckedChange={async (next) => {
                  try {
                    await updateWhatsAppReminderEnabled.mutateAsync(next);
                    toast.success(t("profileSaved"));
                  } catch (err) {
                    toast.error(err instanceof Error ? err.message : "Error");
                  }
                }}
                disabled={updateWhatsAppReminderEnabled.isPending}
              />
              <div className="flex-1">
                <Label className="text-sm font-medium">{t("whatsappReminderLabel")}</Label>
                <p className="text-xs text-muted-foreground mt-1">{t("whatsappReminderHelp")}</p>
              </div>
            </div>

            {/* Lead time. Shown only once reminders are on — with the switch
                off it governs nothing. */}
            {reminderEnabled && (
              <div className="pt-3 border-t border-border">
                <Label>{t("whatsappReminderLeadLabel")}</Label>
                <Select
                  value={String(reminderHours)}
                  onValueChange={async (v) => {
                    try {
                      await updateWhatsAppReminderHours.mutateAsync(Number(v) as ReminderLeadHours);
                      toast.success(t("profileSaved"));
                    } catch (err) {
                      toast.error(err instanceof Error ? err.message : "Error");
                    }
                  }}
                  disabled={updateWhatsAppReminderHours.isPending}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {REMINDER_LEAD_HOURS.map((hours) => (
                      <SelectItem key={hours} value={String(hours)}>
                        {leadLabel(hours)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-1">{t("whatsappReminderLeadHelp")}</p>
              </div>
            )}
          </div>

          {/* Message language — ONE setting governing every WhatsApp message,
              matching the single whatsapp_message_language column. It lived
              inside the confirmations card until reminders were added; left
              there, a provider who enabled only reminders would have had no way
              to reach it. Shown whenever EITHER feature is on, and hidden when
              both are off, since it then governs nothing. */}
          {(confirmEnabled || reminderEnabled) && (
            <div className="rounded-2xl border border-border bg-card p-4">
              <Label>{t("whatsappLanguageLabel")}</Label>
              <Select
                value={messageLanguage}
                onValueChange={async (v) => {
                  try {
                    await updateWhatsAppMessageLanguage.mutateAsync(v as MessageLanguage);
                    toast.success(t("profileSaved"));
                  } catch (err) {
                    toast.error(err instanceof Error ? err.message : "Error");
                  }
                }}
                disabled={updateWhatsAppMessageLanguage.isPending}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {MESSAGE_LANGUAGES.map((lang) => (
                    <SelectItem key={lang} value={lang}>
                      {languageLabel(lang)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">{t("whatsappLanguageHelp")}</p>
            </div>
          )}
        </motion.div>
      </div>
    </div>
  );
}
