import { Calendar, Clock, Star } from "lucide-react";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { useLang } from "@/contexts/LangContext";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { providers } from "@/lib/mock-data";
import { useBookingReview } from "@/hooks/useReviews";
import ReviewForm from "@/components/reviews/ReviewForm";
import { useState } from "react";
import type { Tables } from "@/integrations/supabase/types";

const Bookings = () => {
  const navigate = useNavigate();
  const { lang, t } = useLang();
  const { user } = useAuth();

  const { data: bookings, isLoading } = useQuery({
    queryKey: ["bookings", user?.id],
    queryFn: async () => {
      if (!user) return [];
      const { data, error } = await supabase
        .from("bookings")
        .select("*")
        .eq("user_id", user.id)
        .order("booking_date", { ascending: false });
      if (error) throw error;
      return data as Tables<"bookings">[];
    },
    enabled: !!user,
  });

  const getProviderName = (providerId: string) => {
    const provider = providers.find((p) => p.id === providerId);
    return provider?.name[lang] || providerId;
  };

  const getServiceNames = (serviceIds: string[]) => {
    for (const provider of providers) {
      const matched = provider.services.filter((s) => serviceIds.includes(s.id));
      if (matched.length > 0) return matched.map((s) => s.name[lang]).join("، ");
    }
    return serviceIds.join(", ");
  };

  const hasBookings = bookings && bookings.length > 0;

  return (
    <div className="min-h-screen pb-24">
      <header className="px-5 pt-12 pb-6">
        <h1 className="text-xl font-bold">{t("myBookings")}</h1>
      </header>

      {!user ? (
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }} className="px-5 flex flex-col items-center justify-center py-20">
          <Calendar className="h-12 w-12 text-muted-foreground/40 mb-4" />
          <p className="text-muted-foreground text-sm mb-1">{t("signInToManage")}</p>
          <button onClick={() => navigate("/auth")} className="mt-4 px-6 py-2.5 rounded-2xl bg-accent text-accent-foreground text-sm font-semibold active:scale-[0.98] transition-transform">
            {t("signIn")}
          </button>
        </motion.div>
      ) : isLoading ? (
        <div className="px-5 space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-24 rounded-2xl bg-secondary animate-pulse" />
          ))}
        </div>
      ) : !hasBookings ? (
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }} className="px-5 flex flex-col items-center justify-center py-20">
          <Calendar className="h-12 w-12 text-muted-foreground/40 mb-4" />
          <p className="text-muted-foreground text-sm mb-1">{t("noBookingsYet")}</p>
          <p className="text-xs text-muted-foreground mb-4">{t("bookFirstAppointment")}</p>
          <button onClick={() => navigate("/explore")} className="px-6 py-2.5 rounded-2xl bg-accent text-accent-foreground text-sm font-semibold active:scale-[0.98] transition-transform">
            {t("exploreServices")}
          </button>
        </motion.div>
      ) : (
        <div className="px-5 space-y-3">
          {bookings.map((booking, i) => (
            <motion.div
              key={booking.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.06, duration: 0.3 }}
              className="rounded-2xl border border-border bg-card p-4 space-y-2"
            >
              <div className="flex justify-between items-start">
                <p className="font-semibold text-sm">{getProviderName(booking.provider_id)}</p>
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                  booking.status === "confirmed" ? "bg-green-100 text-green-700" : "bg-secondary text-muted-foreground"
                }`}>
                  {booking.status}
                </span>
              </div>
              <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                <Calendar className="h-3 w-3" />
                {booking.booking_date} — {booking.booking_time}
              </p>
              <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                <Clock className="h-3 w-3" />
                {getServiceNames(booking.service_ids)}
              </p>
              <div className="flex justify-end">
                <span className="text-sm font-bold">₪{booking.total_price}</span>
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
};

export default Bookings;
