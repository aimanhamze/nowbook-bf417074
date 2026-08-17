import { createContext, useContext, useState, useEffect, useRef, useCallback, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useLang } from "@/contexts/LangContext";
import { isDeadSessionError } from "@/lib/sessionHealth";
import type { User, Session } from "@supabase/supabase-js";

/** Minimum gap between network session checks, so tab-switching does not add a
 *  round-trip per focus event. */
const SESSION_CHECK_THROTTLE_MS = 60_000;

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  isProvider: boolean;
  isAdmin: boolean;
  /** True until the current user's roles have been resolved. Gating logic should
   *  wait for this to be false so a provider/admin is never treated as a customer. */
  roleLoading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  // Safe: App.tsx nests AuthProvider inside LangProvider.
  const { t } = useLang();
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [isProvider, setIsProvider] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  // Starts true: while there is a user whose roles are still unknown, consumers
  // must not assume "customer". Reset to false explicitly when there is no user.
  const [roleLoading, setRoleLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setIsProvider(false);
      setIsAdmin(false);
      setRoleLoading(false);
      return;
    }
    setRoleLoading(true);
    supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .then(({ data }) => {
        const roles = (data || []).map((r) => r.role);
        setIsProvider(roles.includes("provider"));
        setIsAdmin(roles.includes("admin"));
        setRoleLoading(false);
      });
  }, [user?.id]);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setSession(session);
        setUser(session?.user ?? null);
        if (!session?.user) setLoading(false);
      }
    );

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (!session?.user) setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (user && !roleLoading) {
      setLoading(false);
    }
  }, [user, roleLoading]);

  // ── Dead-session detector ──────────────────────────────────────────────────
  // A Supabase access token can be signature-valid, unexpired and correctly
  // roled while the session behind it no longer exists. Nothing already in this
  // context can notice: getSession() reads localStorage and returns the stale
  // token happily, and onAuthStateChange only fires on LOCAL events — a
  // server-side session deletion emits nothing.
  //
  // getUser() is the network, session-aware check: the same question every
  // Edge Function asks via getUser(token). Until it runs, the user keeps
  // working normally against RLS (which only verifies the signature) while
  // every Edge Function call fails, and the refresh at expiry will fail too.
  //
  // Runs on mount and on tab focus, throttled. This does NOT catch a session
  // that dies mid-visit — a user can still hit one failed action before the
  // next focus. Accepted deliberately; checking before every mutation is a far
  // larger change.
  const lastCheckRef = useRef(0);

  const verifySessionAlive = useCallback(async () => {
    // Nothing to verify when logged out, and never check twice in quick
    // succession.
    if (!supabase.auth) return;
    const now = Date.now();
    if (now - lastCheckRef.current < SESSION_CHECK_THROTTLE_MS) return;
    lastCheckRef.current = now;

    const { data: { session: local } } = await supabase.auth.getSession();
    if (!local) return;

    const { error } = await supabase.auth.getUser();

    // ONLY a documented dead-session code signs anyone out. Every other
    // outcome — above all a transport failure while offline — is ignored, so a
    // network blip can never log a working user out.
    if (!isDeadSessionError(error)) return;

    // scope: "local" on purpose. A global sign-out calls the server to revoke a
    // session that no longer exists, which can itself fail and leave storage
    // populated. Local scope clears storage unconditionally; onAuthStateChange
    // then fires SIGNED_OUT and ProtectedRoute redirects through the normal
    // path.
    await supabase.auth.signOut({ scope: "local" });
    toast.error(t("sessionEndedMessage"));
  }, [t]);

  useEffect(() => {
    // Mount check, plus every time the tab regains focus.
    void verifySessionAlive();

    const onFocus = () => { void verifySessionAlive(); };
    const onVisibility = () => {
      if (document.visibilityState === "visible") void verifySessionAlive();
    };

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [verifySessionAlive]);

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider value={{ user, session, loading, isProvider, isAdmin, roleLoading, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
