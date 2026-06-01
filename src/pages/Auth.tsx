import { useState, useRef, useEffect } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { useLang } from "@/contexts/LangContext";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { BackArrow } from "@/components/ui/directional-icon";
import { Loader2, Eye, EyeOff } from "lucide-react";
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

function e164ToLocal(e164: string): string {
  const digits = e164.replace(/\D/g, "");
  const local = digits.startsWith("972") ? "0" + digits.slice(3) : digits;
  if (local.length === 10) return `${local.slice(0, 3)}-${local.slice(3, 6)}-${local.slice(6)}`;
  return local;
}

function isValidIsraeliPhone(display: string): boolean {
  const digits = display.replace(/\D/g, "");
  return /^0[5-9]\d{8}$/.test(digits);
}

// ── Presentational primitives (visual only) ──────────────────────────────────

const EASE = [0.16, 1, 0.3, 1] as const;

/** Shared input styling: refined border, accent focus glow, RTL-safe. */
const FIELD =
  "w-full rounded-2xl border border-border bg-white/70 px-4 py-3 text-sm text-foreground " +
  "placeholder:text-muted-foreground/60 transition-all duration-200 focus:outline-none " +
  "focus:border-accent focus:bg-white focus:ring-4 focus:ring-accent/15";

/** Solid accent CTA with glow + press feedback. */
const PRIMARY_BTN =
  "relative flex w-full items-center justify-center gap-2 rounded-2xl bg-accent py-3.5 text-sm " +
  "font-semibold text-accent-foreground shadow-[0_8px_22px_-10px_hsl(24_80%_55%/0.7)] " +
  "transition-all duration-200 hover:brightness-[1.05] hover:shadow-[0_12px_28px_-10px_hsl(24_80%_55%/0.8)] " +
  "active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 disabled:shadow-none";

const LABEL = "mb-1.5 block text-xs font-medium text-muted-foreground";

function Spinner() {
  return <Loader2 className="h-4 w-4 animate-spin" aria-hidden />;
}

function GoogleLogo() {
  return (
    <svg className="h-[18px] w-[18px]" viewBox="0 0 24 24" aria-hidden>
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  );
}

/** Soft, light background atmosphere — gentle warm→lavender wash + blurred blobs. */
function AuthBackground() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 overflow-hidden bg-gradient-to-b from-[hsl(24_70%_97%)] via-background to-[hsl(265_40%_97%)]"
    >
      <div className="absolute -right-20 -top-24 h-72 w-72 rounded-full bg-accent/15 blur-3xl" />
      <div className="absolute -left-24 top-1/3 h-72 w-72 rounded-full bg-[hsl(265_50%_80%)]/30 blur-3xl" />
      <div className="absolute -bottom-10 right-1/4 h-64 w-64 rounded-full bg-[hsl(24_90%_85%)]/30 blur-3xl" />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

type LoginMode = "email" | "phone";
type PhoneStep = "input" | "otp";

const OTP_COUNTDOWN = 60;

const Auth = () => {
  const { t } = useLang();
  const navigate = useNavigate();
  const reduceMotion = useReducedMotion();

  // ── Shared ─────────────────────────────────────────────────────────────────
  const [loading, setLoading] = useState(false);
  const [loginMode, setLoginMode] = useState<LoginMode>("phone");

  // ── Email mode ─────────────────────────────────────────────────────────────
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
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
      .select("display_name, phone")
      .eq("user_id", user.id)
      .maybeSingle();

    // Sync phone from auth to profiles if not already stored
    if (user.phone && !profile?.phone) {
      await supabase
        .from("profiles")
        .update({ phone: e164ToLocal(user.phone) })
        .eq("user_id", user.id);
    }

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
      const updates: Record<string, string> = { display_name: name };
      if (user.phone) updates.phone = e164ToLocal(user.phone);
      const { error } = await supabase.from("profiles").update(updates).eq("user_id", user.id);
      if (error) { toast.error(error.message); setWelcomeLoading(false); return; }
    }
    setWelcomeLoading(false);
    navigate("/");
  };

  // ── Motion presets (respect prefers-reduced-motion) ─────────────────────────

  const cardEntrance = reduceMotion
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, transition: { duration: 0.2 } }
    : {
        initial: { opacity: 0, y: 22, scale: 0.985 },
        animate: { opacity: 1, y: 0, scale: 1 },
        transition: { duration: 0.5, ease: EASE },
      };

  const slideX = reduceMotion ? 0 : 12;

  // ── Welcome screen ─────────────────────────────────────────────────────────

  if (showWelcome) {
    return (
      <div className="relative flex min-h-screen flex-col items-center justify-center px-6">
        <AuthBackground />
        <motion.div
          initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 24, scale: 0.985 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: reduceMotion ? 0.2 : 0.5, ease: EASE }}
          className="relative w-full max-w-sm space-y-6 rounded-3xl border border-white/60 bg-white/80 p-7 text-center shadow-[0_1px_2px_rgba(40,20,10,0.04),0_24px_60px_-28px_rgba(120,70,30,0.28)] backdrop-blur-xl"
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
            className={`${FIELD} text-center`}
          />
          <button
            onClick={handleWelcomeSubmit}
            disabled={!displayName.trim() || welcomeLoading}
            aria-busy={welcomeLoading}
            className={PRIMARY_BTN}
          >
            {welcomeLoading ? <Spinner /> : "בואו נתחיל"}
          </button>
        </motion.div>
      </div>
    );
  }

  // ── Main auth page ─────────────────────────────────────────────────────────

  return (
    <div className="relative flex min-h-screen flex-col">
      <AuthBackground />

      <header className="relative px-5 pb-2 pt-12">
        <div className="mx-auto flex max-w-sm items-center gap-3">
          <button
            onClick={() => navigate(-1)}
            aria-label="חזרה"
            className="rounded-xl p-1.5 text-foreground/80 transition-all hover:bg-white/60 hover:text-foreground active:scale-95"
          >
            <BackArrow className="h-5 w-5" />
          </button>
          <h1 className="select-none text-xl font-bold tracking-tight" onClick={handleLogoTap}>
            {t("signIn")}
          </h1>
        </div>
      </header>

      <main className="relative flex flex-1 items-start justify-center px-5 pb-10 pt-3">
        <motion.div {...cardEntrance} className="w-full max-w-sm">
          {/* Dev login panel */}
          {showDevLogin && (
            <div className="mb-4 space-y-3 rounded-2xl border border-dashed border-yellow-400/60 bg-yellow-50/40 p-4 backdrop-blur-sm">
              <p className="text-xs font-semibold uppercase tracking-wide text-yellow-600">Dev Login</p>
              <input type="email" dir="ltr" placeholder="email@example.com" value={devEmail}
                onChange={(e) => setDevEmail(e.target.value)}
                className={FIELD} />
              <input type="password" dir="ltr" placeholder="password" value={devPassword}
                onChange={(e) => setDevPassword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleDevLogin()}
                className={FIELD} />
              <button onClick={handleDevLogin} disabled={loading} aria-busy={loading}
                className="flex w-full items-center justify-center gap-2 rounded-2xl bg-yellow-500 py-2.5 text-sm font-medium text-white transition-colors hover:bg-yellow-600 disabled:opacity-50">
                {loading ? <Spinner /> : "Sign in (dev)"}
              </button>
            </div>
          )}

          {/* Refined form card */}
          <div className="rounded-3xl border border-white/60 bg-white/80 p-6 shadow-[0_1px_2px_rgba(40,20,10,0.04),0_24px_60px_-28px_rgba(120,70,30,0.28)] backdrop-blur-xl sm:p-7">
            <div className="space-y-5">

              {/* ── Mode tabs (sliding indicator) ── */}
              <div className="relative grid grid-cols-2 gap-1 rounded-2xl border border-border/70 bg-secondary/60 p-1">
                {([
                  { mode: "phone" as const, label: t("phoneNumber"), onClick: () => { setLoginMode("phone"); setShowForgot(false); } },
                  { mode: "email" as const, label: "אימייל", onClick: () => { setLoginMode("email"); setShowForgot(false); resetPhoneFlow(); } },
                ]).map((tab) => {
                  const active = loginMode === tab.mode;
                  return (
                    <button
                      key={tab.mode}
                      onClick={tab.onClick}
                      aria-pressed={active}
                      className={`relative z-10 rounded-xl py-2.5 text-sm font-medium transition-colors duration-200 ${active ? "font-semibold text-accent" : "text-muted-foreground hover:text-foreground"}`}
                    >
                      {active && (
                        <motion.span
                          layoutId="authTabIndicator"
                          transition={reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 380, damping: 32 }}
                          className="absolute inset-0 -z-10 rounded-xl border border-accent/20 bg-accent/10 shadow-[0_1px_2px_rgba(40,20,10,0.06),0_6px_16px_-10px_rgba(120,70,30,0.25)]"
                        />
                      )}
                      {tab.label}
                    </button>
                  );
                })}
              </div>

              {/* ── Phone mode ── */}
              <AnimatePresence mode="wait">
                {loginMode === "phone" && (
                  <motion.div
                    key="phone"
                    initial={{ opacity: 0, x: -slideX }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: slideX }}
                    transition={{ duration: 0.2, ease: EASE }}
                    className="space-y-4"
                  >
                    {phoneStep === "input" ? (
                      <>
                        {/* Phone input with +972 prefix */}
                        <div>
                          <label htmlFor="auth-phone" className={LABEL}>{t("phoneNumber")}</label>
                          <div dir="ltr" className="flex items-stretch overflow-hidden rounded-2xl border border-border bg-white/70 transition-all duration-200 focus-within:border-accent focus-within:bg-white focus-within:ring-4 focus-within:ring-accent/15">
                            <span className="flex select-none items-center gap-1 border-e border-border bg-secondary/70 px-3 text-sm font-semibold text-foreground/80">
                              🇮🇱 +972
                            </span>
                            <input
                              id="auth-phone"
                              type="tel"
                              dir="ltr"
                              inputMode="numeric"
                              placeholder="05X-XXX-XXXX"
                              value={phone}
                              onChange={handlePhoneInput}
                              onKeyDown={(e) => e.key === "Enter" && handleSendOtp()}
                              className="flex-1 bg-transparent px-3 py-3 text-sm placeholder:text-muted-foreground/60 focus:outline-none"
                            />
                          </div>
                        </div>
                        <button onClick={handleSendOtp} disabled={loading} aria-busy={loading} className={PRIMARY_BTN}>
                          {loading ? <Spinner /> : t("sendCode")}
                        </button>
                      </>
                    ) : (
                      <>
                        {/* OTP step */}
                        <div className="space-y-1 text-center">
                          <p className="text-sm text-muted-foreground">{t("enterOtp")}</p>
                          <p className="text-xs font-medium text-foreground" dir="ltr">+972 {phone}</p>
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
                          aria-invalid={!!otpError}
                          className={`w-full rounded-2xl border bg-white/70 px-4 py-3 text-center font-mono text-lg tracking-[0.4em] transition-all duration-200 focus:outline-none focus:bg-white focus:ring-4 ${otpError ? "border-destructive focus:border-destructive focus:ring-destructive/15" : "border-border focus:border-accent focus:ring-accent/15"}`}
                        />
                        {otpError && (
                          <p className="text-center text-xs text-destructive">{otpError}</p>
                        )}

                        <button onClick={handleVerifyOtp} disabled={loading || otp.length !== 6} aria-busy={loading} className={PRIMARY_BTN}>
                          {loading ? <Spinner /> : t("verifyCode")}
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
                              className="font-medium text-accent transition-colors hover:text-accent/80 hover:underline disabled:opacity-50"
                            >
                              שלח קוד מחדש
                            </button>
                          )}
                        </div>

                        {/* Back to phone input */}
                        <button
                          onClick={resetPhoneFlow}
                          className="w-full py-2 text-xs text-muted-foreground transition-colors hover:text-foreground"
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
                    initial={{ opacity: 0, x: slideX }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -slideX }}
                    transition={{ duration: 0.2, ease: EASE }}
                    className="space-y-4"
                  >
                    {!showForgot ? (
                      <>
                        <div>
                          <label htmlFor="auth-email" className={LABEL}>אימייל</label>
                          <input id="auth-email" type="email" dir="ltr" placeholder="email@example.com" value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            className={FIELD} />
                        </div>
                        <div>
                          <label htmlFor="auth-password" className={LABEL}>סיסמה</label>
                          <div className="relative">
                            <input id="auth-password" type={showPassword ? "text" : "password"} dir="ltr" placeholder={t("signIn")} value={password}
                              onChange={(e) => setPassword(e.target.value)}
                              onKeyDown={(e) => e.key === "Enter" && handleSignIn()}
                              className={`${FIELD} pr-11`} />
                            <button
                              type="button"
                              onClick={() => setShowPassword((v) => !v)}
                              aria-label={showPassword ? "הסתר סיסמה" : "הצג סיסמה"}
                              aria-pressed={showPassword}
                              tabIndex={-1}
                              className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-2xl text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:text-accent"
                            >
                              {showPassword ? <EyeOff className="h-[18px] w-[18px]" /> : <Eye className="h-[18px] w-[18px]" />}
                            </button>
                          </div>
                        </div>
                        <button onClick={handleSignIn} disabled={loading} aria-busy={loading} className={PRIMARY_BTN}>
                          {loading ? <Spinner /> : t("signIn")}
                        </button>
                        <button onClick={() => setShowForgot(true)}
                          className="w-full py-1 text-xs font-medium text-accent transition-colors hover:text-accent/80 hover:underline">
                          {t("signIn") === "Sign In" ? "Forgot password?" : "שכחתי סיסמה"}
                        </button>
                      </>
                    ) : (
                      <>
                        <p className="text-sm text-muted-foreground">הכנס את כתובת האימייל שלך לאיפוס הסיסמה</p>
                        <div>
                          <label htmlFor="auth-reset-email" className={LABEL}>אימייל</label>
                          <input id="auth-reset-email" type="email" dir="ltr" placeholder="email@example.com" value={resetEmail}
                            onChange={(e) => setResetEmail(e.target.value)}
                            className={FIELD} />
                        </div>
                        <button onClick={handleForgot} disabled={loading} aria-busy={loading} className={PRIMARY_BTN}>
                          {loading ? <Spinner /> : "שלח קישור איפוס"}
                        </button>
                        <button onClick={() => setShowForgot(false)}
                          className="w-full py-2 text-sm text-muted-foreground transition-colors hover:text-foreground">
                          ← {t("signIn")}
                        </button>
                      </>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>

              {/* ── Google sign-in (always visible) ── */}
              {!showForgot && phoneStep === "input" && (
                <motion.div
                  key="google-section"
                  initial={reduceMotion ? false : { opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.2 }}
                  className="space-y-4"
                >
                  <div className="flex items-center gap-3 py-1">
                    <div className="h-px flex-1 bg-border" />
                    <span className="text-xs text-muted-foreground">{t("orSignInWith")}</span>
                    <div className="h-px flex-1 bg-border" />
                  </div>

                  <button onClick={handleGoogleSignIn} disabled={loading} aria-busy={loading}
                    className="group flex w-full items-center justify-center gap-2.5 rounded-2xl border border-border bg-white/70 py-3.5 text-sm font-medium text-foreground transition-all duration-200 hover:border-border hover:bg-white hover:shadow-md active:scale-[0.98] disabled:opacity-60">
                    <span className="transition-transform duration-200 group-hover:scale-110">
                      <GoogleLogo />
                    </span>
                    {t("signInWithGoogle")}
                  </button>
                </motion.div>
              )}

            </div>
          </div>
        </motion.div>
      </main>
    </div>
  );
};

export default Auth;
