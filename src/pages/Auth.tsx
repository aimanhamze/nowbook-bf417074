import { useState, useRef, useEffect } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { useLang } from "@/contexts/LangContext";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { BackArrow } from "@/components/ui/directional-icon";
import { Loader2, Eye, EyeOff, Mail, Phone, Lock } from "lucide-react";
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

// ── Page-scoped design tokens (sampled from the reference mockup) ─────────────
// Hardcoded here on purpose so the /auth restyle never touches the global theme.

const EASE = [0.16, 1, 0.3, 1] as const;

/** Input: light #F7F7F9 fill, orange focus border + glow. RTL-safe. */
const FIELD =
  "w-full rounded-2xl border border-transparent bg-[#F7F7F9] px-4 py-3 text-sm text-[#102038] " +
  "placeholder:text-[#606068]/60 transition-all duration-200 focus:outline-none " +
  "focus:border-[#E76C29] focus:bg-white focus:ring-4 focus:ring-[#E76C29]/15";

/** Primary CTA: solid #E76C29 with orange glow + hover/press feedback. */
const PRIMARY_BTN =
  "relative flex w-full items-center justify-center gap-2 rounded-2xl bg-[#E76C29] py-3.5 text-sm " +
  "font-bold text-white shadow-[0_10px_28px_rgba(231,108,41,0.35)] transition-all duration-200 " +
  "hover:bg-[#D75F1E] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-4 " +
  "focus-visible:ring-[#E76C29]/30 disabled:cursor-not-allowed disabled:opacity-60 disabled:shadow-none";

const LABEL = "mb-1.5 block text-sm font-medium text-[#102038]";

/** Leading (RTL-right) field icon — decorative. */
function LeadingIcon({ children }: { children: React.ReactNode }) {
  return (
    <span className="pointer-events-none absolute inset-y-0 right-0 flex w-11 items-center justify-center text-[#606068]">
      {children}
    </span>
  );
}

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

/** DORAK wordmark — dark ink with a small orange accent on the "A". */
function Wordmark({ onTap }: { onTap: () => void }) {
  return (
    <span
      onClick={onTap}
      className="inline-block select-none text-lg font-extrabold tracking-[0.22em] text-[#102038]"
    >
      DOR<span className="text-[#E76C29]">A</span>K
    </span>
  );
}

/** Warm peach atmosphere: cream top-left, peach top-right, fading to near-white. */
function AuthBackground() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 overflow-hidden"
      style={{ background: "linear-gradient(180deg, #FFE7CE 0%, #FFF2E4 30%, #FEFEFE 70%)" }}
    >
      {/* cream glow — top-left */}
      <div
        className="absolute -left-24 -top-28 h-80 w-80 rounded-full blur-3xl"
        style={{ background: "radial-gradient(circle, rgba(254,235,218,0.9), transparent 70%)" }}
      />
      {/* peach glow — top-right */}
      <div
        className="absolute -right-24 -top-28 h-80 w-80 rounded-full blur-3xl"
        style={{ background: "radial-gradient(circle, rgba(255,207,158,0.8), transparent 70%)" }}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

type LoginMode = "email" | "phone";
type PhoneStep = "input" | "otp";

const OTP_COUNTDOWN = 60;

// Temporarily hidden: Google OAuth currently returns a 404. Flip back to true
// once the OAuth redirect is fixed to restore the "Sign in with Google" button.
const SHOW_GOOGLE_SIGNIN = false;

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

  /** After any successful auth, mirror phone and enter the app.
   *  Requiring a display name is handled centrally by <NameGate>, which gates
   *  customers only (never providers/admins) — so we do NOT show a name screen
   *  here. */
  const afterAuth = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { navigate("/"); return; }

    const { data: profile } = await supabase
      .from("profiles")
      .select("phone")
      .eq("user_id", user.id)
      .maybeSingle();

    // Sync phone from auth to profiles if not already stored
    if (user.phone && !profile?.phone) {
      await supabase
        .from("profiles")
        .update({ phone: e164ToLocal(user.phone) })
        .eq("user_id", user.id);
    }

    navigate("/");
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

  // ── Motion presets (respect prefers-reduced-motion) ─────────────────────────

  const cardEntrance = reduceMotion
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, transition: { duration: 0.2 } }
    : {
        initial: { opacity: 0, y: 18 },
        animate: { opacity: 1, y: 0 },
        transition: { duration: 0.5, ease: EASE },
      };

  const slideX = reduceMotion ? 0 : 10;

  // ── Main auth page ─────────────────────────────────────────────────────────

  const tabs = [
    { mode: "email" as const, label: "אימייל", Icon: Mail, onClick: () => { setLoginMode("email"); setShowForgot(false); resetPhoneFlow(); } },
    { mode: "phone" as const, label: t("phoneNumber"), Icon: Phone, onClick: () => { setLoginMode("phone"); setShowForgot(false); } },
  ];

  return (
    <div className="relative flex min-h-screen flex-col">
      <AuthBackground />

      {/* Back control — floats in the start corner, keeps the layout centered */}
      <button
        onClick={() => navigate(-1)}
        aria-label="חזרה"
        className="absolute start-4 top-4 z-10 rounded-xl p-2 text-[#102038]/70 transition-all hover:bg-white/70 hover:text-[#102038] active:scale-95"
      >
        <BackArrow className="h-5 w-5" />
      </button>

      <main className="relative flex flex-1 flex-col items-center justify-start px-5 pb-12 pt-14">
        <motion.div {...cardEntrance} className="w-full max-w-[420px]">

          {/* Dev login panel */}
          {showDevLogin && (
            <div className="mb-4 space-y-3 rounded-2xl border border-dashed border-yellow-400/60 bg-yellow-50/60 p-4">
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

          {/* Wordmark + heading + subtitle */}
          <div className="mb-6 text-center">
            <Wordmark onTap={handleLogoTap} />
            <h1 className="mt-4 text-[30px] font-bold leading-tight text-[#102038]">{t("signIn")}</h1>
            <p className="mt-1.5 text-sm text-[#606068]">שמחים לראות אותך שוב</p>
            <div className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-[#E76C29]" />
          </div>

          {/* Form card */}
          <div className="rounded-[28px] bg-white p-6 shadow-[0_20px_50px_-20px_rgba(16,32,56,0.18),0_4px_12px_rgba(16,32,56,0.05)] sm:p-7">
            <div className="space-y-5">

              {/* ── Mode tabs (sliding pill) ── */}
              <div className="relative grid grid-cols-2 gap-1 rounded-2xl bg-[#F2F2F5] p-1">
                {tabs.map((tab) => {
                  const active = loginMode === tab.mode;
                  return (
                    <button
                      key={tab.mode}
                      onClick={tab.onClick}
                      aria-pressed={active}
                      className={`relative z-10 flex items-center justify-center gap-2 rounded-[14px] py-2.5 text-sm font-medium transition-colors duration-200 focus-visible:outline-none ${active ? "text-[#E76C29]" : "text-[#606068] hover:text-[#102038]"}`}
                    >
                      {active && (
                        <motion.span
                          layoutId="authTabIndicator"
                          transition={reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 380, damping: 32 }}
                          className="absolute inset-0 -z-10 rounded-[14px] bg-white shadow-[0_2px_8px_rgba(16,32,56,0.10)]"
                        />
                      )}
                      <tab.Icon className="h-4 w-4" aria-hidden />
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
                        {/* Phone input with +972 prefix (chip on the left) */}
                        <div>
                          <label htmlFor="auth-phone" className={LABEL}>{t("phoneNumber")}</label>
                          <div dir="ltr" className="flex items-stretch overflow-hidden rounded-2xl border border-transparent bg-[#F7F7F9] transition-all duration-200 focus-within:border-[#E76C29] focus-within:bg-white focus-within:ring-4 focus-within:ring-[#E76C29]/15">
                            <span className="flex select-none items-center gap-1 border-e border-[#E6E6EA] px-3 text-sm font-semibold text-[#102038]">
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
                              className="flex-1 bg-transparent px-3 py-3 text-sm text-[#102038] placeholder:text-[#606068]/60 focus:outline-none"
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
                          <p className="text-sm text-[#606068]">{t("enterOtp")}</p>
                          <p className="text-xs font-medium text-[#102038]" dir="ltr">+972 {phone}</p>
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
                          className={`w-full rounded-2xl border bg-[#F7F7F9] px-4 py-3 text-center font-mono text-lg tracking-[0.4em] text-[#102038] transition-all duration-200 focus:outline-none focus:bg-white focus:ring-4 ${otpError ? "border-destructive focus:border-destructive focus:ring-destructive/15" : "border-transparent focus:border-[#E76C29] focus:ring-[#E76C29]/15"}`}
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
                            <span className="text-[#606068]">
                              שלח שוב בעוד <span className="font-semibold tabular-nums">{countdown}</span> שניות
                            </span>
                          ) : (
                            <button
                              onClick={handleResendOtp}
                              disabled={loading}
                              className="font-medium text-[#E76C29] transition-colors hover:text-[#D75F1E] hover:underline disabled:opacity-50"
                            >
                              שלח קוד מחדש
                            </button>
                          )}
                        </div>

                        {/* Back to phone input */}
                        <button
                          onClick={resetPhoneFlow}
                          className="w-full py-2 text-xs text-[#606068] transition-colors hover:text-[#102038]"
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
                          <div className="relative">
                            <input id="auth-email" type="email" dir="ltr" placeholder="email@example.com" value={email}
                              onChange={(e) => setEmail(e.target.value)}
                              className={`${FIELD} pr-11`} />
                            <LeadingIcon><Mail className="h-[18px] w-[18px]" /></LeadingIcon>
                          </div>
                        </div>
                        <div>
                          <label htmlFor="auth-password" className={LABEL}>סיסמה</label>
                          <div className="relative">
                            <input id="auth-password" type={showPassword ? "text" : "password"} dir="ltr" placeholder="הכנס סיסמה" value={password}
                              onChange={(e) => setPassword(e.target.value)}
                              onKeyDown={(e) => e.key === "Enter" && handleSignIn()}
                              className={`${FIELD} pl-11 pr-11`} />
                            <LeadingIcon><Lock className="h-[18px] w-[18px]" /></LeadingIcon>
                            <button
                              type="button"
                              onClick={() => setShowPassword((v) => !v)}
                              aria-label={showPassword ? "הסתר סיסמה" : "הצג סיסמה"}
                              aria-pressed={showPassword}
                              tabIndex={-1}
                              className="absolute inset-y-0 left-0 flex w-11 items-center justify-center rounded-l-2xl text-[#606068] transition-colors hover:text-[#102038] focus-visible:text-[#E76C29] focus-visible:outline-none"
                            >
                              {showPassword ? <EyeOff className="h-[18px] w-[18px]" /> : <Eye className="h-[18px] w-[18px]" />}
                            </button>
                          </div>
                        </div>
                        <button onClick={handleSignIn} disabled={loading} aria-busy={loading} className={PRIMARY_BTN}>
                          {loading ? <Spinner /> : t("signIn")}
                        </button>
                        <button onClick={() => setShowForgot(true)}
                          className="mx-auto block py-1 text-sm font-medium text-[#E76C29] transition-colors hover:text-[#D75F1E] hover:underline">
                          {t("signIn") === "Sign In" ? "Forgot password?" : "שכחתי סיסמה"}
                        </button>
                      </>
                    ) : (
                      <>
                        <p className="text-sm text-[#606068]">הכנס את כתובת האימייל שלך לאיפוס הסיסמה</p>
                        <div>
                          <label htmlFor="auth-reset-email" className={LABEL}>אימייל</label>
                          <div className="relative">
                            <input id="auth-reset-email" type="email" dir="ltr" placeholder="email@example.com" value={resetEmail}
                              onChange={(e) => setResetEmail(e.target.value)}
                              className={`${FIELD} pr-11`} />
                            <LeadingIcon><Mail className="h-[18px] w-[18px]" /></LeadingIcon>
                          </div>
                        </div>
                        <button onClick={handleForgot} disabled={loading} aria-busy={loading} className={PRIMARY_BTN}>
                          {loading ? <Spinner /> : "שלח קישור איפוס"}
                        </button>
                        <button onClick={() => setShowForgot(false)}
                          className="w-full py-2 text-sm text-[#606068] transition-colors hover:text-[#102038]">
                          ← {t("signIn")}
                        </button>
                      </>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>

              {/* ── Google sign-in (always visible) ── */}
              {SHOW_GOOGLE_SIGNIN && !showForgot && phoneStep === "input" && (
                <motion.div
                  key="google-section"
                  initial={reduceMotion ? false : { opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.2 }}
                  className="space-y-4"
                >
                  <div className="flex items-center gap-3 py-1">
                    <div className="h-px flex-1 bg-[#E6E6EA]" />
                    <span className="text-xs text-[#606068]">{t("orSignInWith")}</span>
                    <div className="h-px flex-1 bg-[#E6E6EA]" />
                  </div>

                  <button onClick={handleGoogleSignIn} disabled={loading} aria-busy={loading}
                    className="group flex w-full items-center justify-center gap-2.5 rounded-2xl border border-[#E6E6EA] bg-white py-3.5 text-sm font-medium text-[#102038] transition-all duration-200 hover:bg-[#F7F7F9] hover:shadow-md active:scale-[0.98] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#E76C29]/15 disabled:opacity-60">
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
