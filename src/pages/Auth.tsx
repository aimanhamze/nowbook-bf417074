import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { useLang } from "@/contexts/LangContext";
import { motion } from "framer-motion";
import { Phone, ChevronLeft, Mail } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";

type AuthMode = "phone" | "email";
type EmailView = "login" | "forgot";

const Auth = () => {
  const { t, isRtl } = useLang();
  const navigate = useNavigate();
  const [mode, setMode] = useState<AuthMode>("phone");
  const [phone, setPhone] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [otp, setOtp] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSendOtp = async () => {
    if (!phone.trim()) {
      toast.error(t("phoneRequired"));
      return;
    }
    setLoading(true);
    const formattedPhone = phone.startsWith("+") ? phone : `+${phone}`;
    const { error } = await supabase.auth.signInWithOtp({ phone: formattedPhone });
    setLoading(false);
    if (error) {
      toast.error(error.message);
    } else {
      setOtpSent(true);
      toast.success(t("otpSent"));
    }
  };

  const handleVerifyOtp = async () => {
    setLoading(true);
    const formattedPhone = phone.startsWith("+") ? phone : `+${phone}`;
    const { error } = await supabase.auth.verifyOtp({
      phone: formattedPhone,
      token: otp,
      type: "sms",
    });
    setLoading(false);
    if (error) {
      toast.error(t("invalidOtp"));
    } else {
      navigate("/");
    }
  };

  const handleEmailSignIn = async () => {
    if (!email.trim() || !password.trim()) {
      toast.error("נא למלא אימייל וסיסמא");
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) {
      toast.error(error.message);
    } else {
      navigate("/");
    }
  };

  const handleGoogleSignIn = async () => {
    setLoading(true);
    const { error } = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: window.location.origin,
    });
    setLoading(false);
    if (error) {
      toast.error(error.message);
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      <header className="px-5 pt-12 pb-4 flex items-center gap-3">
        <button onClick={() => navigate(-1)} className="p-1.5 rounded-xl hover:bg-secondary transition-colors active:scale-95">
          <ChevronLeft className={`h-5 w-5 ${isRtl ? "rotate-180" : ""}`} />
        </button>
        <h1 className="text-xl font-bold">{t("signIn")}</h1>
      </header>

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="flex-1 px-5 pt-8"
      >
        <div className="space-y-4 max-w-sm mx-auto">
          {/* Mode toggle */}
          <div className="flex rounded-xl border border-border overflow-hidden mb-4">
            <button
              onClick={() => setMode("phone")}
              className={`flex-1 py-2.5 text-sm font-medium transition-colors flex items-center justify-center gap-1.5 ${mode === "phone" ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground"}`}
            >
              <Phone className="h-4 w-4" />
              {t("phoneNumber")}
            </button>
            <button
              onClick={() => setMode("email")}
              className={`flex-1 py-2.5 text-sm font-medium transition-colors flex items-center justify-center gap-1.5 ${mode === "email" ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground"}`}
            >
              <Mail className="h-4 w-4" />
              אימייל
            </button>
          </div>

          {mode === "phone" ? (
            <>
              {!otpSent ? (
                <>
                  <input
                    type="tel"
                    dir="ltr"
                    placeholder="+972 50 123 4567"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="w-full px-4 py-3 rounded-xl border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-ring transition-shadow"
                  />
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
                  <p className="text-sm text-muted-foreground">{t("enterOtp")}</p>
                  <div className="flex justify-center" dir="ltr">
                    <InputOTP maxLength={6} value={otp} onChange={setOtp}>
                      <InputOTPGroup>
                        <InputOTPSlot index={0} />
                        <InputOTPSlot index={1} />
                        <InputOTPSlot index={2} />
                        <InputOTPSlot index={3} />
                        <InputOTPSlot index={4} />
                        <InputOTPSlot index={5} />
                      </InputOTPGroup>
                    </InputOTP>
                  </div>
                  <button
                    onClick={handleVerifyOtp}
                    disabled={loading || otp.length < 6}
                    className="w-full py-3 rounded-xl bg-primary text-primary-foreground font-medium text-sm hover:opacity-90 transition-opacity active:scale-[0.98] disabled:opacity-50"
                  >
                    {loading ? "..." : t("verifyCode")}
                  </button>
                  <button
                    onClick={() => { setOtpSent(false); setOtp(""); }}
                    className="w-full py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
                  >
                    ← {t("phoneNumber")}
                  </button>
                </>
              )}
            </>
          ) : (
            <>
              <input
                type="email"
                dir="ltr"
                placeholder="email@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-ring transition-shadow"
              />
              <input
                type="password"
                dir="ltr"
                placeholder="סיסמא"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-ring transition-shadow"
              />
              <button
                onClick={handleEmailSignIn}
                disabled={loading}
                className="w-full py-3 rounded-xl bg-primary text-primary-foreground font-medium text-sm hover:opacity-90 transition-opacity active:scale-[0.98] disabled:opacity-50"
              >
                {loading ? "..." : t("signIn")}
              </button>
            </>
          )}

          {/* Divider */}
          <div className="flex items-center gap-3 py-4">
            <div className="flex-1 h-px bg-border" />
            <span className="text-xs text-muted-foreground">{t("orSignInWith")}</span>
            <div className="flex-1 h-px bg-border" />
          </div>

          {/* Google */}
          <button
            onClick={handleGoogleSignIn}
            disabled={loading}
            className="w-full py-3 rounded-xl border border-border bg-card font-medium text-sm hover:bg-secondary/50 transition-colors active:scale-[0.98] flex items-center justify-center gap-2 disabled:opacity-50"
          >
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
