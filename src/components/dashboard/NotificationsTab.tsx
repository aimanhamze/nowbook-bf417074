import { motion } from "framer-motion";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useLang } from "@/contexts/LangContext";
import { useProviderProfile } from "@/hooks/useProviderProfile";
import { toast } from "sonner";

// Two options only: these are the two Meta-approved templates. There is no
// English template, and the DB CHECK constraint on
// provider_profiles.whatsapp_message_language rejects anything else.
const MESSAGE_LANGUAGES = ["he", "ar"] as const;
type MessageLanguage = typeof MESSAGE_LANGUAGES[number];

// Every control saves immediately and reads straight from `profile.*` — same
// approach as BookingSettingsTab, so no react-hook-form state to fall out of
// sync with the server.
export function NotificationsTab() {
  const { t } = useLang();
  const { profile, updateWhatsAppConfirmEnabled, updateWhatsAppMessageLanguage } =
    useProviderProfile();

  // Defaults mirror the column defaults, so the UI reads correctly for the
  // brief window before the profile query resolves.
  const confirmEnabled = profile?.whatsapp_confirm_enabled ?? false;
  const messageLanguage: MessageLanguage =
    profile?.whatsapp_message_language === "ar" ? "ar" : "he";

  const languageLabel = (lang: MessageLanguage) =>
    lang === "ar" ? t("whatsappLanguageAr") : t("whatsappLanguageHe");

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-4"
    >
      <h2 className="text-lg font-semibold">{t("notificationsTabTitle")}</h2>

      <div className="rounded-2xl border border-border bg-card p-4 space-y-4">
        {/* Master switch. Default OFF — a provider must opt in before a single
            message is sent on their behalf. */}
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

        {/* Language picker. Shown only once the feature is on: with the switch
            off it controls nothing, and an active-looking control that does
            nothing is worse than no control. */}
        {confirmEnabled && (
          <div className="pt-3 border-t border-border">
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
      </div>
    </motion.div>
  );
}
