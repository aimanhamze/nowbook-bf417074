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
import { Copy, Check, KeyRound } from "lucide-react";
import { toast } from "sonner";
import { useLang } from "@/contexts/LangContext";
import type { Tables } from "@/integrations/supabase/types";

const MIN_PASSWORD_LENGTH = 6;

interface ResetPasswordDialogProps {
  provider: Tables<"provider_profiles"> | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ResetPasswordDialog({ provider, open, onOpenChange }: ResetPasswordDialogProps) {
  const { t, isRtl } = useLang();
  const [password, setPassword] = useState("");
  const [resetPassword, setResetPassword] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const resetMutation = useMutation({
    mutationFn: async () => {
      if (!provider) throw new Error("no-provider");
      if (password.length < MIN_PASSWORD_LENGTH) throw new Error("too-short");

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("no-session");

      const { data, error } = await supabase.functions.invoke("reset-provider-password", {
        body: { userId: provider.user_id, newPassword: password },
        headers: { Authorization: `Bearer ${session.access_token}` },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return password;
    },
    onSuccess: (newPassword) => {
      // Show the password once — mirror CreateProviderDialog's credential display.
      setResetPassword(newPassword);
    },
    onError: (err: any) => {
      // Never surface the raw server error string — show our own translated message.
      if (err?.message === "too-short") {
        toast.error(t("passwordTooShort"));
      } else {
        toast.error(t("resetPasswordError"));
      }
    },
  });

  const handleCopy = () => {
    if (!resetPassword) return;
    navigator.clipboard.writeText(resetPassword);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleClose = (isOpen: boolean) => {
    if (!isOpen) {
      setPassword("");
      setResetPassword(null);
      setCopied(false);
      resetMutation.reset();
    }
    onOpenChange(isOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md" dir={isRtl ? "rtl" : "ltr"}>
        <DialogHeader>
          <DialogTitle>{t("resetPassword")}</DialogTitle>
        </DialogHeader>

        {resetPassword ? (
          <div className="space-y-4 mt-2">
            <div className="rounded-xl bg-green-50 border border-green-200 p-4 space-y-2 text-sm">
              <p className="font-semibold text-green-700">✅ {t("resetPasswordSuccess")}</p>
              <p className="text-muted-foreground">{provider?.business_name}</p>
              <div className="font-mono bg-white rounded-lg border p-3 space-y-1 text-xs">
                <p>
                  {t("newPasswordReady")}{" "}
                  <span className="font-bold" dir="ltr">{resetPassword}</span>
                </p>
              </div>
              <Button variant="outline" size="sm" className="w-full gap-2" onClick={handleCopy}>
                {copied ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? t("passwordCopied") : t("copyPassword")}
              </Button>
            </div>
            <Button className="w-full" onClick={() => handleClose(false)}>{t("closeBtn")}</Button>
          </div>
        ) : (
          <div className="space-y-4 mt-2">
            <p className="text-sm text-muted-foreground">
              {t("resetPasswordFor")} <span className="font-semibold text-foreground">{provider?.business_name}</span>
            </p>
            <div className="space-y-1.5">
              <Label>{t("newPassword")}</Label>
              <Input
                type="text"
                dir="ltr"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <Button
              className="w-full gap-2"
              onClick={() => resetMutation.mutate()}
              disabled={password.length < MIN_PASSWORD_LENGTH || resetMutation.isPending}
            >
              <KeyRound className="h-4 w-4" />
              {resetMutation.isPending ? t("resettingPassword") : t("resetPassword")}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
