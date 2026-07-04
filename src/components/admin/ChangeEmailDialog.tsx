import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Copy, Check, AtSign } from "lucide-react";
import { toast } from "sonner";
import { useLang } from "@/contexts/LangContext";
import type { Tables } from "@/integrations/supabase/types";

// Lenient on purpose, mirroring the Edge Function's server-side check: providers
// log in with fake addresses like someone@ehjezly.com, so we only require a
// `local@domain.tld` shape. The server validates again — never trust this alone.
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface ChangeEmailDialogProps {
  provider: Tables<"provider_profiles"> | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ChangeEmailDialog({ provider, open, onOpenChange }: ChangeEmailDialogProps) {
  const { t, isRtl } = useLang();
  const [email, setEmail] = useState("");
  const [newEmail, setNewEmail] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const isValid = EMAIL_REGEX.test(email.trim());

  const changeMutation = useMutation({
    mutationFn: async () => {
      if (!provider) throw new Error("no-provider");
      const trimmed = email.trim();
      if (!EMAIL_REGEX.test(trimmed)) throw new Error("invalid-email");

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("no-session");

      const { data, error } = await supabase.functions.invoke("change-provider-email", {
        body: { userId: provider.user_id, newEmail: trimmed },
        headers: { Authorization: `Bearer ${session.access_token}` },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      // Prefer the server-confirmed email from the success body; fall back to input.
      return (data?.email as string) ?? trimmed;
    },
    onSuccess: (confirmedEmail) => {
      // Show the new email once — mirror ResetPasswordDialog's credential display.
      setNewEmail(confirmedEmail);
    },
    onError: (err: any) => {
      // Never surface the raw server error string — show our own translated message.
      const msg: string = err?.message ?? "";
      if (msg === "invalid-email") {
        toast.error(t("invalidEmail"));
      } else if (
        // The Edge Function returns the Hebrew "already registered" sentence for
        // duplicates; match it (or any "already"/"registered") → emailInUse.
        msg.includes("כבר רשום") ||
        msg.toLowerCase().includes("already") ||
        msg.toLowerCase().includes("registered")
      ) {
        toast.error(t("emailInUse"));
      } else {
        toast.error(t("changeEmailError"));
      }
    },
  });

  const handleCopy = () => {
    if (!newEmail) return;
    navigator.clipboard.writeText(newEmail);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleClose = (isOpen: boolean) => {
    if (!isOpen) {
      setEmail("");
      setNewEmail(null);
      setCopied(false);
      changeMutation.reset();
    }
    onOpenChange(isOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md" dir={isRtl ? "rtl" : "ltr"}>
        <DialogHeader>
          <DialogTitle>{t("changeEmail")}</DialogTitle>
        </DialogHeader>

        {newEmail ? (
          <div className="space-y-4 mt-2">
            <div className="rounded-xl bg-green-50 border border-green-200 p-4 space-y-2 text-sm">
              <p className="font-semibold text-green-700">✅ {t("changeEmailSuccess")}</p>
              <p className="text-muted-foreground">{provider?.business_name}</p>
              <div className="font-mono bg-white rounded-lg border p-3 space-y-1 text-xs">
                <p>
                  {t("newEmailReady")}{" "}
                  <span className="font-bold" dir="ltr">{newEmail}</span>
                </p>
              </div>
              <Button variant="outline" size="sm" className="w-full gap-2" onClick={handleCopy}>
                {copied ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? t("emailCopied") : t("copyEmail")}
              </Button>
            </div>
            <Button className="w-full" onClick={() => handleClose(false)}>{t("closeBtn")}</Button>
          </div>
        ) : (
          <div className="space-y-4 mt-2">
            <p className="text-sm text-muted-foreground">
              {t("changeEmailFor")} <span className="font-semibold text-foreground">{provider?.business_name}</span>
            </p>
            <div className="space-y-1.5">
              <Label>{t("newEmailLabel")}</Label>
              <Input
                type="email"
                dir="ltr"
                autoComplete="off"
                placeholder="provider@ehjezly.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <Button
              className="w-full gap-2"
              onClick={() => changeMutation.mutate()}
              disabled={!isValid || changeMutation.isPending}
            >
              <AtSign className="h-4 w-4" />
              {changeMutation.isPending ? t("changingEmail") : t("changeEmail")}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
