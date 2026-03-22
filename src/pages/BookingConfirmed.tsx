import { useLocation, useNavigate } from "react-router-dom";
import { CheckCircle2, Calendar, ArrowRight } from "lucide-react";
import { motion } from "framer-motion";

const BookingConfirmed = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const state = location.state as {
    provider: string;
    services: string[];
    date: string;
    time: string;
    total: number;
  } | null;

  if (!state) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-muted-foreground">No booking data found</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-5">
      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        className="text-center mb-8"
      >
        <CheckCircle2 className="h-16 w-16 text-accent mx-auto mb-4" />
        <h1 className="text-2xl font-bold mb-1">Booking Confirmed!</h1>
        <p className="text-sm text-muted-foreground">You're all set</p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2, duration: 0.5 }}
        className="w-full max-w-sm rounded-2xl border border-border bg-card p-5 space-y-3"
      >
        <div>
          <p className="text-xs text-muted-foreground">Provider</p>
          <p className="font-semibold">{state.provider}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Date & Time</p>
          <p className="font-semibold flex items-center gap-1.5">
            <Calendar className="h-4 w-4 text-accent" />
            {state.date} at {state.time}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Services</p>
          <p className="text-sm">{state.services.join(", ")}</p>
        </div>
        <div className="border-t border-border pt-3 flex justify-between items-center">
          <span className="text-sm text-muted-foreground">Total</span>
          <span className="text-lg font-bold">${state.total}</span>
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.4 }}
        className="mt-8 flex flex-col gap-3 w-full max-w-sm"
      >
        <button
          onClick={() => navigate("/bookings")}
          className="w-full py-3 rounded-2xl bg-accent text-accent-foreground text-sm font-semibold flex items-center justify-center gap-2 active:scale-[0.98] transition-transform"
        >
          View My Bookings <ArrowRight className="h-4 w-4" />
        </button>
        <button
          onClick={() => navigate("/")}
          className="w-full py-3 rounded-2xl bg-secondary text-secondary-foreground text-sm font-semibold active:scale-[0.98] transition-transform"
        >
          Back to Home
        </button>
      </motion.div>
    </div>
  );
};

export default BookingConfirmed;
