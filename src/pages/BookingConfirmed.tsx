import { useLocation, useNavigate } from "react-router-dom";
import { CheckCircle2, Users } from "lucide-react";
import { ForwardArrow } from "@/components/ui/directional-icon";
import { motion } from "framer-motion";
import { useLang } from "@/contexts/LangContext";

const SPRING = { ease: [0.16, 1, 0.3, 1] } as const;

const BookingConfirmed = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { t } = useLang();
  const state = location.state as {
    provider: string;
    services: string[];
    date: string;
    time: string;
    total: number;
    isGroup?: boolean;
    participantCount?: number;
  } | null;

  if (!state) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-muted-foreground">{t("noBookingData")}</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-5 py-12 bg-gradient-to-b from-accent/[0.07] via-transparent to-transparent">

      {/* ── Success affordance ── */}
      {/* 0ms: checkmark scales in; 200ms: ripple blooms and dissipates */}
      <div className="relative flex items-center justify-center mb-5">
        <motion.div
          className="absolute w-28 h-28 rounded-full border border-accent/20"
          initial={{ scale: 0.7, opacity: 0.6 }}
          animate={{ scale: 1.1, opacity: 0 }}
          transition={{ delay: 0.2, duration: 0.6, ...SPRING }}
        />
        <motion.div
          className="w-20 h-20 rounded-full bg-accent/10 flex items-center justify-center shadow-[0_8px_32px_-8px_hsl(var(--accent)/0.4)]"
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.6, ...SPRING }}
        >
          <CheckCircle2 className="h-10 w-10 text-accent" />
        </motion.div>
      </div>

      {/* ── Headlines — 400ms ── */}
      <motion.div
        className="text-center mb-8"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4, duration: 0.5, ...SPRING }}
      >
        <h1 className="text-3xl font-black tracking-tight mb-1">{t("bookingConfirmed")}</h1>
        <p className="text-sm text-muted-foreground">{t("youreAllSet")}</p>
      </motion.div>

      {/* ── Summary card — 600ms ── */}
      <motion.div
        className="w-full max-w-sm space-y-3"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.6, duration: 0.5, ...SPRING }}
      >
        {/* Zone A — Booking hero */}
        <div className="rounded-3xl bg-card p-6 shadow-[0_10px_40px_-12px_rgba(0,0,0,0.12)] text-center">
          <p className="text-xs font-semibold text-accent uppercase tracking-widest mb-2">
            {state.provider}
          </p>
          <p className="text-3xl font-black tracking-tight mb-1 text-balance">
            {state.date}
          </p>
          <p className="text-2xl font-bold text-foreground/70" dir="ltr">
            {state.time}
          </p>
        </div>

        {/* Zone B — Service + price */}
        <div className="rounded-2xl border border-border/60 bg-card p-5 space-y-3">
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1.5">
              {t("services")}
            </p>
            {state.services.map((svc, i) => (
              <p key={i} className="text-sm font-medium text-foreground/80">{svc}</p>
            ))}
          </div>
          <div className="h-px bg-border/40" />
          <div className="flex items-baseline justify-between">
            <p className="text-xs text-muted-foreground">{t("total")}</p>
            <p className="text-3xl font-black text-accent">₪{state.total}</p>
          </div>
        </div>

        {/* Group notice */}
        {state.isGroup && state.participantCount !== undefined && (
          <div className="p-3 rounded-xl bg-secondary border border-border/60 flex items-center gap-2 text-sm text-foreground/70">
            <Users className="h-4 w-4 text-accent shrink-0" />
            <p className="font-medium">
              {t("joinedClass")} · {state.participantCount} {t("classParticipants")}
            </p>
          </div>
        )}
      </motion.div>

      {/* ── CTAs — primary 800ms, secondary 900ms ── */}
      <div className="mt-6 flex flex-col gap-3 w-full max-w-sm">
        <motion.button
          onClick={() => navigate("/bookings")}
          className="w-full py-4 rounded-2xl bg-accent text-accent-foreground text-base font-semibold shadow-[0_8px_24px_-8px_hsl(var(--accent)/0.55)] flex items-center justify-center gap-2 active:scale-[0.98] transition-transform"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.8, duration: 0.4, ...SPRING }}
        >
          {t("viewMyBookings")} <ForwardArrow variant="arrow" className="h-4 w-4" />
        </motion.button>
        <motion.button
          onClick={() => navigate("/")}
          className="w-full py-3 rounded-2xl border border-border/60 text-sm font-medium text-foreground/70 active:scale-[0.98] transition-transform"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.9, duration: 0.4, ...SPRING }}
        >
          {t("backToHome")}
        </motion.button>
      </div>
    </div>
  );
};

export default BookingConfirmed;
