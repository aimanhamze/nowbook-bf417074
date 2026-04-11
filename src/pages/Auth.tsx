import { useState, useRef } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { useLang } from "@/contexts/LangContext";
import { motion } from "framer-motion";
import { ChevronLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

const emailSchema = z.string().email();

const Auth = () => {
  const { t, isRtl } = useLang();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [showForgot, setShowForgot] = useState(false);
  const [resetEmail, setResetEmail] = useState("");

  const DEV_TEST_EMAIL = import.meta.env.VITE_DEV_TEST_EMAIL as string | undefined;
  const DEV_TEST_PASSWORD = import.meta.env.VITE_DEV_TEST_PASSWORD as string | undefined;

  const [showDevLogin, setShowDevLogin] = useState(false);
  const [devEmail, setDevEmail] = useState(DEV_TEST_EMAIL ?? "");
  const [devPassword, setDevPassword] = useState("");
  const logoTapCount = useRef(0);
  const logoTapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleLogoTap = () => {
    logoTapCount.current += 1;
    if (logoTapTimer.current) clearTimeout(logoTapTimer.current);
    if (logoTapCount.current >= 5) {
      logoTapCount.current = 0;
      setShowDevLogin((v) => !v);
      return;
    }
    logoTapTimer.current = setTimeout(() => { logoTapCount.current = 0; }, 2000);
  };

  const handleDevLogin = async () => {
    if (!devEmail.trim() || !devPassword.trim()) { toast.error("Enter email and password"); return; }
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email: devEmail, password: devPassword });
    setLoading(false);
    if (error) toast.error(error.message);
    else navigate("/");
  };

  const handleSignIn = async () => {
    if (!email.trim() || !password.trim()) { toast.error(t("phoneRequired")); return; }
    if (!emailSchema.safeParse(email.trim()).success) { toast.error(t("invalidEmail")); return; }
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) toast.error(error.message);
    else navigate("/");
  };

  const handleForgot = async () => {
    if (!resetEmail.trim()) { toast.error(t("invalidEmail")); return; }
    if (!emailSchema.safeParse(resetEmail.trim()).success) { toast.error(t("invalidEmail")); return; }
    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(resetEmail, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setLoading(false);
    if (error) toast.error(error.message);
    else toast.success("קישור איפוס נשלח לאימייל שלך");
  };

  const handleGoogleSignIn = async () => {
    setLoading(true);
    const { error } = await lovable.auth.signInWithOAuth("google", { redirect_uri: window.location.origin });
    setLoading(false);
    if (error) toast.error(error.message);
  };

  return (
    <div className="min-h-screen flex flex-col">
      <header className="px-5 pt-12 pb-4 flex items-center gap-3">
        <button onClick={() => navigate(-1)} className="p-1.5 rounded-xl hover:bg-secondary transition-colors active:scale-95">
          <ChevronLeft className={`h-5 w-5 ${isRtl ? "rotate-180" : ""}`} />
        </button>
        <h1 className="text-xl font-bold select-none" onClick={handleLogoTap}>{t("signIn")}</h1>
      </header>

      {showDevLogin && (
        <div className="mx-5 mb-2 p-4 rounded-xl border border-dashed border-yellow-400/60 bg-yellow-50/10 space-y-3">
          <p className="text-xs font-semibold text-yellow-500 uppercase tracking-wide">Dev Login</p>
          <input type="email" dir="ltr" placeholder="email@example.com" value={devEmail}
            onChange={(e) => setDevEmail(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
          <input type="password" dir="ltr" placeholder="password" value={devPassword}
            onChange={(e) => setDevPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleDevLogin()}
            className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
          <button onClick={handleDevLogin} disabled={loading}
            className="w-full py-2 rounded-lg bg-yellow-500 text-white font-medium text-sm hover:bg-yellow-600 transition-colors disabled:opacity-50">
            {loading ? "..." : "Sign in (dev)"}
          </button>
        </div>
      )}

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="flex-1 px-5 pt-8"
      >
        <div className="space-y-4 max-w-sm mx-auto">
          {!showForgot ? (
            <>
              <input type="email" dir="ltr" placeholder="email@example.com" value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-ring transition-shadow" />
              <input type="password" dir="ltr" placeholder={t("signIn")} value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSignIn()}
                className="w-full px-4 py-3 rounded-xl border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-ring transition-shadow" />
              <button onClick={handleSignIn} disabled={loading}
                className="w-full py-3 rounded-xl bg-primary text-primary-foreground font-medium text-sm hover:opacity-90 transition-opacity active:scale-[0.98] disabled:opacity-50">
                {loading ? "..." : t("signIn")}
              </button>
              <button onClick={() => setShowForgot(true)}
                className="w-full py-1 text-xs text-accent font-medium hover:underline">
                {t("signIn") === "Sign In" ? "Forgot password?" : "שכחתי סיסמה"}
              </button>
            </>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">הכנס את כתובת האימייל שלך לאיפוס הסיסמה</p>
              <input type="email" dir="ltr" placeholder="email@example.com" value={resetEmail}
                onChange={(e) => setResetEmail(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-ring transition-shadow" />
              <button onClick={handleForgot} disabled={loading}
                className="w-full py-3 rounded-xl bg-primary text-primary-foreground font-medium text-sm hover:opacity-90 transition-opacity active:scale-[0.98] disabled:opacity-50">
                {loading ? "..." : "שלח קישור איפוס"}
              </button>
              <button onClick={() => setShowForgot(false)}
                className="w-full py-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
                ← {t("signIn")}
              </button>
            </>
          )}

          <div className="flex items-center gap-3 py-4">
            <div className="flex-1 h-px bg-border" />
            <span className="text-xs text-muted-foreground">{t("orSignInWith")}</span>
            <div className="flex-1 h-px bg-border" />
          </div>

          <button onClick={handleGoogleSignIn} disabled={loading}
            className="w-full py-3 rounded-xl border border-border bg-card font-medium text-sm hover:bg-secondary/50 transition-colors active:scale-[0.98] flex items-center justify-center gap-2 disabled:opacity-50">
            <svg className="h-4 w-4" viewBox="0 0 24 24">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
            </svg>
            {t("signInWithGoogle")}
          </button>
        </div>
      </motion.div>
    </div>
  );
};

export default Auth;
