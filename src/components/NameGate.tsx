import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useLang } from "@/contexts/LangContext";
import { toast } from "sonner";

/**
 * NameGate — forces CUSTOMERS to set a display name before using the app.
 *
 * Scoping (critical): the gate only ever engages for an authenticated user who
 * is NOT a provider and NOT an admin, and only once roles are resolved
 * (`roleLoading === false`). Providers/admins — whose `profiles.display_name`
 * is frequently empty because their identity lives in `provider_profiles` /
 * they are admin-created — are passed straight through and never gated.
 *
 * It wraps the whole route tree, so it covers BOTH:
 *   1. the post-OTP step (a new customer lands here and cannot skip it), and
 *   2. app-open enforcement (an existing name-less customer session is caught
 *      on next open, on whatever route they open).
 * Because every route renders inside the gate, there is no way to deep-link
 * past it (e.g. straight to /provider/:id/book) without first setting a name.
 */
function FullScreenLoader() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="w-8 h-8 rounded-full border-2 border-accent border-t-transparent animate-spin" />
    </div>
  );
}

// Mirrors Auth.tsx's e164ToLocal so the phone we backfill on first name-save is
// stored in the same local "05X-XXX-XXXX" shape the rest of the app writes.
function e164ToLocal(e164: string): string {
  const digits = e164.replace(/\D/g, "");
  const local = digits.startsWith("972") ? "0" + digits.slice(3) : digits;
  if (local.length === 10) return `${local.slice(0, 3)}-${local.slice(3, 6)}-${local.slice(6)}`;
  return local;
}

const EASE = [0.16, 1, 0.3, 1] as const;

function NameCompletionScreen({ userId, onSaved }: { userId: string; onSaved: () => void }) {
  const { t, isRtl } = useLang();
  const { signOut } = useAuth();
  const [displayName, setDisplayName] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    const name = displayName.trim();
    if (!name || saving) return;
    setSaving(true);

    // Reuse the existing name-save logic: update profiles.display_name, and
    // opportunistically backfill profiles.phone from auth.users.phone (OTP).
    const { data: { user } } = await supabase.auth.getUser();
    const updates: Record<string, string> = { display_name: name };
    if (user?.phone) updates.phone = e164ToLocal(user.phone);

    const { error } = await supabase
      .from("profiles")
      .update(updates)
      .eq("user_id", userId);

    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    // Releases the gate: it re-reads display_name and renders the app.
    onSaved();
  };

  return (
    <div
      dir={isRtl ? "rtl" : "ltr"}
      className="fixed inset-0 z-[60] flex flex-col items-center justify-center px-6"
      style={{ background: "linear-gradient(180deg, #FFE7CE 0%, #FFF2E4 30%, #FEFEFE 70%)" }}
    >
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: EASE }}
        className="relative w-full max-w-[420px] space-y-6 rounded-[28px] bg-white p-7 text-center shadow-[0_20px_50px_-20px_rgba(16,32,56,0.18),0_4px_12px_rgba(16,32,56,0.05)]"
      >
        <div className="space-y-2">
          <h1 className="text-2xl font-bold text-[#102038]">{t("nameGateTitle")}</h1>
          <p className="text-sm text-[#606068]">{t("nameGateSubtitle")}</p>
          <p className="text-xs text-[#606068]/80">{t("nameGateHint")}</p>
        </div>
        <input
          type="text"
          placeholder={t("nameGatePlaceholder")}
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
          autoFocus
          className="w-full rounded-2xl border border-transparent bg-[#F7F7F9] px-4 py-3 text-center text-sm text-[#102038] placeholder:text-[#606068]/60 transition-all duration-200 focus:outline-none focus:border-[#E76C29] focus:bg-white focus:ring-4 focus:ring-[#E76C29]/15"
        />
        <button
          onClick={handleSubmit}
          disabled={!displayName.trim() || saving}
          aria-busy={saving}
          className="relative flex w-full items-center justify-center gap-2 rounded-2xl bg-[#E76C29] py-3.5 text-sm font-bold text-white shadow-[0_10px_28px_rgba(231,108,41,0.35)] transition-all duration-200 hover:bg-[#D75F1E] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 disabled:shadow-none"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : t("nameGateSubmit")}
        </button>
        {/* Escape hatch — never trap a session. Logout clears the gate candidate. */}
        <button
          onClick={() => signOut()}
          className="mx-auto block py-1 text-xs text-[#606068] transition-colors hover:text-[#102038]"
        >
          {t("nameGateLogout")}
        </button>
      </motion.div>
    </div>
  );
}

export function NameGate({ children }: { children: React.ReactNode }) {
  const { user, isProvider, isAdmin, roleLoading } = useAuth();
  const queryClient = useQueryClient();

  // Only authenticated, role-resolved, non-provider, non-admin users are gated.
  const gateCandidate = !!user && !roleLoading && !isProvider && !isAdmin;

  const { data: profile, isLoading } = useQuery({
    queryKey: ["name-gate-profile", user?.id],
    enabled: gateCandidate,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles")
        .select("display_name")
        .eq("user_id", user!.id)
        .maybeSingle();
      return data ?? { display_name: null as string | null };
    },
  });

  // Logged out, or a provider/admin, or roles not yet known → never gate.
  if (!gateCandidate) return <>{children}</>;

  // Customer, but we don't yet know their name → hold the app (prevents any
  // deep-link to booking before the gate decision is made).
  if (isLoading || profile === undefined) return <FullScreenLoader />;

  const hasName = !!profile.display_name && profile.display_name.trim().length > 0;
  if (hasName) return <>{children}</>;

  return (
    <NameCompletionScreen
      userId={user!.id}
      onSaved={() => queryClient.invalidateQueries({ queryKey: ["name-gate-profile", user!.id] })}
    />
  );
}
