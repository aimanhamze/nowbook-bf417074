import { useState, useRef, useEffect } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { useLang } from "@/contexts/LangContext";
import { motion, AnimatePresence } from "framer-motion";
import { BackArrow } from "@/components/ui/directional-icon";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

const emailSchema = z.string().email();

// ── Phone formatting helpers ──────────────────────────────────────────────────

function formatPhoneDisplay(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 10);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
}

function toE164(display: string): string {
  const digits = display.replace(/\D/g, "");
  if (digits.startsWith("0")) return `+972${digits.slice(1)}`;
  if (digits.startsWith("972")) return `+${digits}`;
  return `+972${digits}`;
}

function isValidIsraeliPhone(display: string): boolean {
  const digits = display.replace(/\D/g, "");
  return /^0[5-9]\d{8}$/.test(digits);
}

// ─────────────────────────────────────────────────────────────────────────────

type LoginMode = "email" | "phone";
type PhoneStep = "input" | "otp";

const OTP_COUNTDOWN = 60;

const Auth = () => {
  const { t } = useLang();
  const navigate = useNavigate();

  // ── Shared ─────────────────────────────────────────────────────────────────
  const [loading, setLoading] = useState(false);
  const [loginMode, setLoginMode] = useState<LoginMode>("phone");

  // ── Email mode ─────────────────────────────────────────────────────────────
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showForgot, setShowForgot] = useState(false);
  const [resetEmail, setResetEmail] = useState("");

  // ── Phone mode ─────────────────────────────────────────────────────────────
  const [phone, setPhone] = useState("");
  const [phoneStep, setPhoneStep] = useState<PhoneStep>("input");
  const [otp, setOtp] = useState("");
  const [otpError, setOtpError] = useState("");
  const [countdown, setCountdown] = useState(0);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Welcome screen (first login, no display_name) ─────────────────────────
  const [showWelcome, setShowWelcome] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [welcomeLoading, setWelcomeLoading] = useState(false);

  // ── Dev login ──────────────────────────────────────────────────────────────
  const DEV_TEST_EMAIL = import.meta.env.VITE_DEV_TEST_EMAIL as string | undefined;
  const [showDevLogin, setShowDevLogin] = useState(false);
  const [devEmail, setDevEmail] = useState(DEV_TEST_EMAIL ?? "");
  const [devPassword, setDevPassword] = useState("");
  const logoTapCount = useRef(0);
  const logoTapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Countdown timer ────────────────────────────────────────────────────────
  useEffect(() => {
    if (countdown <= 0) {
      if (countdownRef.current) clearInterval(countdownRef.current);
      return;
    }
    countdownRef.current = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          clearInterval(countdownRef.current!);
          return 0;
        }
        return c - 1;
      });
    }, 1000);
    return () => { if (countdownRef.current) clearInterval(countdownRef.current); };
  }, [countdown]);

  // ── Helpers ────────────────────────────────────────────────────────────────

  const startCountdown = () => setCountdown(OTP_COUNTDOWN);

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

  /** After any successful auth, check display_name and route accordingly. */
  const afterAuth = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { navigate("/"); return; }

    const { data: profile } = await supabase
      .from("profiles")
      .select("display_name")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!profile?.display_name) {
      setShowWelcome(true);
    } else {
      navigate("/");
    }
  };

  // ── Email handlers ─────────────────────────────────────────────────────────

  const handleDevLogin = async () => {
    if (!devEmail.trim() || !devPassword.trim()) { toast.error("Enter email and password"); return; }
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email: devEmail, password: devPassword });
    setLoading(false);
    if (error) toast.error(error.message);
    else await afterAuth();
  };

  const handleSignIn = async () => {
    if (!email.trim() || !password.trim()) { toast.error(t("phoneRequired")); return; }
    if (!emailSchema.safeParse(email.trim()).success) { toast.error(t("invalidEmail")); return; }
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) toast.error(error.message);
    else await afterAuth();
  };

  const handleForgot = async () => {
    if (!resetEmail.trim() || !emailSchema.safeParse(resetEmail.trim()).success) {
      toast.error(t("invalidEmail")); return;
    }
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

  // ── Phone handlers ─────────────────────────────────────────────────────────

  const handlePhoneInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    setPhone(formatPhoneDisplay(e.target.value));
  };

  const handleSendOtp = async () => {
    if (!isValidIsraeliPhone(phone)) { toast.error(t("phoneRequired")); return; }
    setLoading(true);
    const e164 = toE164(phone);
    const { error } = await supabase.auth.signInWithOtp({ phone: e164 });
    setLoading(false);
    if (error) { toast.error(error.message); return; }
    toast.success(t("otpSent"));
    setOtp("");
    setOtpError("");
    setPhoneStep("otp");
    startCountdown();
  };

  const handleResendOtp = async () => {
    if (countdown > 0) return;
    await handleSendOtp();
  };

  const handleVerifyOtp = async () => {
    if (otp.length !== 6) { setOtpError(t("invalidOtp")); return; }
    setOtpError("");
    setLoading(true);
    const e164 = toE164(phone);
    const { error } = await supabase.auth.verifyOtp({ phone: e164, token: otp, type: "sms" });
    setLoading(false);
    if (error) { setOtpError(t("invalidOtp")); return; }
    await afterAuth();
  };

  const handleOtpChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value.replace(/\D/g, "").slice(0, 6);
    setOtp(val);
    if (otpError) setOtpError("");
  };

  const resetPhoneFlow = () => {
    setPhoneStep("input");
    setOtp("");
    setOtpError("");
    setCountdown(0);
  };

  // ── Welcome screen handler ─────────────────────────────────────────────────

  const handleWelcomeSubmit = async () => {
    const name = displayName.trim();
    if (!name) return;
    setWelcomeLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { error } = await supabase.from("profiles").update({ display_name: name }).eq("user_id", user.id);
      if (error) { toast.error(error.message); setWelcomeLoading(false); return; }
    }
    setWelcomeLoading(false);
    navigate("/");
  };

  // ── Welcome screen ─────────────────────────────────────────────────────────

  if (showWelcome) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-6">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45 }}
          className="w-full max-w-sm space-y-6 text-center"
        >
          <div className="space-y-2">
            <h1 className="text-2xl font-bold">ברוך הבא לדורק! 👋</h1>
            <p className="text-sm text-muted-foreground">איך קוראים לך?</p>
          </div>
          <input
            type="text"
            placeholder="השם שלי..."
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleWelcomeSubmit()}
            autoFocus
            className="w-full px-4 py-3 rounded-xl border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-ring transition-shadow text-center"
          />
          <button
            onClick={handleWelcomeSubmit}
            disabled={!displayName.trim() || welcomeLoading}
            className="w-full py-3 rounded-xl bg-primary text-primary-foreground font-semibold text-sm hover:opacity-90 transition-opacity active:scale-[0.98] disabled:opacity-50"
          >
            {welcomeLoading ? "..." : "בואו נתחיל"}
          </button>
        </motion.div>
      </div>
    );
  }

  // ── Main auth page ─────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen flex flex-col">
      <header className="px-5 pt-12 pb-4 flex items-center gap-3">
        <button onClick={() => navigate(-1)} className="p-1.5 rounded-xl hover:bg-secondary transition-colors active:scale-95">
          <BackArrow className="h-5 w-5" />
        </button>
        <h1 className="text-xl font-bold select-none" onClick={handleLogoTap}>{t("signIn")}</h1>
      </header>

      {/* Dev login panel */}
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
        className="flex-1 px-5 pt-6"
      >
        <div className="space-y-5 max-w-sm mx-auto">

          {/* ── Mode tabs ── */}
          <div className="flex rounded-xl border border-border overflow-hidden">
            <button
              onClick={() => { setLoginMode("phone"); setShowForgot(false); }}
              className={`flex-1 py-2.5 text-sm font-medium transition-colors ${loginMode === "phone" ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:bg-secondary/50"}`}
            >
              {t("phoneNumber")}
            </button>
            <button
              onClick={() => { setLoginMode("email"); setShowForgot(false); resetPhoneFlow(); }}
              className={`flex-1 py-2.5 text-sm font-medium transition-colors ${loginMode === "email" ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:bg-secondary/50"}`}
            >
              אימייל
            </button>
          </div>

          {/* ── Phone mode ── */}
          <AnimatePresence mode="wait">
            {loginMode === "phone" && (
              <motion.div
                key="phone"
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 12 }}
                transition={{ duration: 0.2 }}
                className="space-y-4"
              >
                {phoneStep === "input" ? (
                  <>
                    {/* Phone input with +972 prefix */}
                    <div className="flex rounded-xl border border-border overflow-hidden focus-within:ring-2 focus-within:ring-ring transition-shadow">
                      <span className="flex items-center px-3 bg-secondary/40 text-sm font-medium text-muted-foreground border-r border-border select-none">
                        🇮🇱 +972
                      </span>
                      <input
                        type="tel"
                        dir="ltr"
                        inputMode="numeric"
                        placeholder="05X-XXX-XXXX"
                        value={phone}
                        onChange={handlePhoneInput}
                        onKeyDown={(e) => e.key === "Enter" && handleSendOtp()}
                        className="flex-1 px-3 py-3 bg-card text-sm focus:outline-none"
                      />
                    </div>
                    <button
                      onClick={handleSendOtp}
                      disabled={loading}
                      className="w-full py-3 rounded-xl bg-primary text-primary-foreground font-medium text-sm hover:opacity-90 transition-opacity active:scale-[0.98] disabled:opacity-50"
                    >
                      {loading ? "..." : t("sendCode")}
                    </button>
                  </>
                ) : (
                  <>
                    {/* OTP step */}
                    <div className="text-center space-y-1">
                      <p className="text-sm text-muted-foreground">{t("enterOtp")}</p>
                      <p className="text-xs font-medium text-foreground">+972 {phone}</p>
                    </div>

                    {/* 6-digit OTP input */}
                    <input
                      type="text"
                      dir="ltr"
                      inputMode="numeric"
                      maxLength={6}
                      placeholder="● ● ● ● ● ●"
                      value={otp}
                      onChange={handleOtpChange}
                      onKeyDown={(e) => e.key === "Enter" && handleVerifyOtp()}
                      autoFocus
                      className={`w-full px-4 py-3 rounded-xl border text-center text-lg tracking-[0.4em] font-mono bg-card focus:outline-none focus:ring-2 focus:ring-ring transition-shadow ${otpError ? "border-destructive" : "border-border"}`}
                    />
                    {otpError && (
                      <p className="text-xs text-destructive text-center">{otpError}</p>
                    )}

                    <button
                      onClick={handleVerifyOtp}
                      disabled={loading || otp.length !== 6}
                      className="w-full py-3 rounded-xl bg-primary text-primary-foreground font-medium text-sm hover:opacity-90 transition-opacity active:scale-[0.98] disabled:opacity-50"
                    >
                      {loading ? "..." : t("verifyCode")}
                    </button>

                    {/* Countdown / resend */}
                    <div className="flex items-center justify-center gap-2 text-xs">
                      {countdown > 0 ? (
                        <span className="text-muted-foreground">
                          שלח שוב בעוד <span className="font-semibold tabular-nums">{countdown}</span> שניות
                        </span>
                      ) : (
                        <button
                          onClick={handleResendOtp}
                          disabled={loading}
                          className="text-primary font-medium hover:underline disabled:opacity-50"
                        >
                          שלח קוד מחדש
                        </button>
                      )}
                    </div>

                    {/* Back to phone input */}
                    <button
                      onClick={resetPhoneFlow}
                      className="w-full py-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
                    >
                      ← שנה מספר טלפון
                    </button>
                  </>
                )}
              </motion.div>
            )}

            {/* ── Email mode ── */}
            {loginMode === "email" && (
              <motion.div
                key="email"
                initial={{ opacity: 0, x: 12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -12 }}
                transition={{ duration: 0.2 }}
                className="space-y-4"
              >
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
              </motion.div>
            )}
          </AnimatePresence>

          {/* ── Google sign-in (always visible) ── */}
          {!showForgot && phoneStep === "input" && (
            <AnimatePresence>
              <motion.div
                key="google-section"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="space-y-4"
              >
                <div className="flex items-center gap-3 py-2">
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
              </motion.div>
            </AnimatePresence>
          )}

        </div>
      </motion.div>
    </div>
  );
};

export default Auth;
