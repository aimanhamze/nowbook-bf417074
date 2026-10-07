import { useCallback } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useLang } from "@/contexts/LangContext";
import { checkLiveSession } from "@/lib/liveSession";
import { saveRedirectAfterLogin } from "@/lib/redirectAfterLogin";
import type { TranslationKey } from "@/lib/translations";

interface DeadSessionOptions {
  /** Shown instead of the default "session ended" message. */
  message?: TranslationKey;
  /** Where to return after login; defaults to the current location. */
  redirectPath?: string;
  /** Runs before sign-out — e.g. to save a draft while the user id is known. */
  onDead?: () => void;
}

/**
 * Wraps checkLiveSession() with the customer-facing handling, so every write
 * path reacts to a missing session the same way:
 *
 *  - offline → translated "connection problem" toast; nothing is signed out
 *    and the caller keeps whatever the customer entered.
 *  - dead    → remember where they were, sign out locally, translated "sign in
 *    again" toast. The SIGNED_OUT event makes ProtectedRoute send them to
 *    /auth, and /auth returns them here afterwards.
 */
export function useLiveSessionGuard() {
  const { user } = useAuth();
  const { t } = useLang();

  const endDeadSession = useCallback(
    async (opts: DeadSessionOptions = {}) => {
      opts.onDead?.();
      saveRedirectAfterLogin(opts.redirectPath);
      // Local scope: the server session is already gone or unreachable, and a
      // global sign-out would call the server and could fail before clearing
      // storage.
      await supabase.auth.signOut({ scope: "local" });
      toast.error(t(opts.message ?? "sessionEndedMessage"));
    },
    [t],
  );

  /** Resolves true when the write may be sent. On false, the customer has
   *  already been told why — the caller just stops. */
  const ensureLiveSession = useCallback(
    async (opts: DeadSessionOptions = {}): Promise<boolean> => {
      if (!user) {
        await endDeadSession(opts);
        return false;
      }
      const status = await checkLiveSession(supabase.auth, user.id);
      if (status === "ok") return true;
      if (status === "offline") {
        toast.error(t("sessionOfflineMessage"));
        return false;
      }
      await endDeadSession(opts);
      return false;
    },
    [user, t, endDeadSession],
  );

  return { ensureLiveSession, endDeadSession };
}
