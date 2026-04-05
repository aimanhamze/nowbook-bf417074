import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { motion } from "framer-motion";

const ResetPassword = () => {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // Check for recovery token in URL hash
    const hash = window.location.hash;
    if (hash.includes("type=recovery")) {
      setReady(true);
    } else {
      // Also listen for PASSWORD_RECOVERY event
      const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
        if (event === "PASSWORD_RECOVERY") {
          setReady(true);
        }
      });
      return () => subscription.unsubscribe();
    }
  }, []);

  const handleReset = async () => {
    if (password.length < 6) {
      toast.error("הסיסמה חייבת להכיל לפחות 6 תווים");
      return;
    }
    if (password !== confirmPassword) {
      toast.error("הסיסמאות לא תואמות");
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (error) {
      toast.error(error.message);
    } else {
      toast.success("הסיסמה עודכנה בהצלחה!");
      navigate("/");
    }
  };

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center px-5">
        <div className="text-center">
          <p className="text-muted-foreground text-sm">טוען...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-5">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-sm space-y-4"
      >
        <h1 className="text-xl font-bold text-center mb-6">איפוס סיסמה</h1>
        <input
          type="password"
          dir="ltr"
          placeholder="סיסמה חדשה"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full px-4 py-3 rounded-xl border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-ring transition-shadow"
        />
        <input
          type="password"
          dir="ltr"
          placeholder="אימות סיסמה"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          className="w-full px-4 py-3 rounded-xl border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-ring transition-shadow"
        />
        <button
          onClick={handleReset}
          disabled={loading}
          className="w-full py-3 rounded-xl bg-primary text-primary-foreground font-medium text-sm hover:opacity-90 transition-opacity active:scale-[0.98] disabled:opacity-50"
        >
          {loading ? "..." : "עדכן סיסמה"}
        </button>
      </motion.div>
    </div>
  );
};

export default ResetPassword;
