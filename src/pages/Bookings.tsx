import { Calendar, Clock, Phone, Star, XCircle } from "lucide-react";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { useLang } from "@/contexts/LangContext";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAllProviders } from "@/hooks/useAllProviders";
import { useBookingReview } from "@/hooks/useReviews";
import ReviewForm from "@/components/reviews/ReviewForm";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { Tables } from "@/integrations/supabase/types";

const CANCELLATION_HOURS_THRESHOLD = 5;

const Bookings = () => {
  const navigate = useNavigate();
  const { lang, t } = useLang();
  const { user } = useAuth();
  const { providers: allProviders } = useAllProviders();

  const PAGE_SIZE = 20;
  const [page, setPage] = useState(0);

  const { data: bookingsData, isLoading } = useQuery({
    queryKey: ["bookings", user?.id, page],
    queryFn: async () => {
      if (!user) return { items: [], hasMore: false };
      const { data, error } = await supabase
        .from("bookings")
        .select("*")
        .eq("user_id", user.id)
        .in("status", ["confirmed", "pending", "cancelled"])
        .order("booking_date", { ascending: false })
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
      if (error) throw error;
      return { items: (data || []) as Tables<"bookings">[], hasMore: (data || []).length === PAGE_SIZE };
    },
    enabled: !!user,
  });

  const bookings = bookingsData?.items;
  const hasMore = bookingsData?.hasMore ?? false;

  const getProviderName = (providerId: string) => {
    const p = allProviders.find((p) => p.id === providerId);
    return p ? p.name[lang] : providerId;
  };

  const getServiceNames = (serviceIds: string[]) => {
    for (const provider of allProviders) {
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
            <BookingCard
            key={booking.id}
            booking={booking}
            index={i}
            getProviderName={getProviderName}
            getServiceNames={getServiceNames}
            providerPhone={allProviders.find((p) => p.id === booking.provider_id)?.phone ?? null}
          />
          ))}
          <div className="flex justify-between items-center pt-2 pb-4">
            <button
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              className="text-sm text-accent font-medium disabled:opacity-30 disabled:cursor-not-allowed"
            >
              ← {lang === "he" ? "הקודם" : lang === "ar" ? "السابق" : "Prev"}
            </button>
            <span className="text-xs text-muted-foreground">
              {lang === "he" ? `עמוד ${page + 1}` : lang === "ar" ? `صفحة ${page + 1}` : `Page ${page + 1}`}
            </span>
            <button
              disabled={!hasMore}
              onClick={() => setPage((p) => p + 1)}
              className="text-sm text-accent font-medium disabled:opacity-30 disabled:cursor-not-allowed"
            >
              {lang === "he" ? "הבא" : lang === "ar" ? "التالي" : "Next"} →
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

function BookingCard({ booking, index, getProviderName, getServiceNames, providerPhone }: {
  booking: Tables<"bookings">;
  index: number;
  getProviderName: (id: string) => string;
  getServiceNames: (ids: string[]) => string;
  providerPhone: string | null;
}) {
  const { t } = useLang();
  const [showReviewForm, setShowReviewForm] = useState(false);
  const { data: existingReview } = useBookingReview(booking.id);

  const queryClient = useQueryClient();
  const bookingDateTime = new Date(`${booking.booking_date}T${booking.booking_time}:00`);
  const now = new Date();
  const isPast = bookingDateTime < now;
  const hoursUntilBooking = (bookingDateTime.getTime() - now.getTime()) / (1000 * 60 * 60);
  const isActive = !isPast && (booking.status === "confirmed" || booking.status === "pending");
  const canCancel = isActive && hoursUntilBooking > CANCELLATION_HOURS_THRESHOLD;
  const canCallToCancel = isActive && hoursUntilBooking <= CANCELLATION_HOURS_THRESHOLD;
  const canReview = isPast && booking.status === "confirmed" && !existingReview;

  const cancelMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("bookings")
        .update({ status: "cancelled" })
        .eq("id", booking.id);
      if (error) throw error;

      // Save cancellation notification for the customer
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await supabase.from("notifications").insert({
          user_id: user.id,
          title: "ביטלת תור ❌",
          body: `התור בתאריך ${booking.booking_date} בשעה ${booking.booking_time} בוטל`,
          url: `/provider/${booking.provider_id}`,
          type: "booking_cancelled",
        });
        queryClient.invalidateQueries({ queryKey: ["unread-notifications"] });
        queryClient.invalidateQueries({ queryKey: ["notifications"] });
      }

      // Notify provider about customer cancellation
      const { data: providerProfile } = await supabase
        .from("provider_profiles")
        .select("user_id")
        .eq("id", booking.provider_id)
        .single();
      if (providerProfile?.user_id) {
        await supabase.from("notifications").insert({
          user_id: providerProfile.user_id,
          title: "תור בוטל ❌",
          body: `לקוח ביטל תור בתאריך ${booking.booking_date} בשעה ${booking.booking_time}`,
          url: "/dashboard",
          type: "booking_cancelled",
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bookings"] });
      toast.success(t("bookingCancelled"));
    },
    onError: () => toast.error(t("errorCancelBooking")),
  });

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.06, duration: 0.3 }}
      className="space-y-2"
    >
      <div className="rounded-2xl border border-border bg-card p-4 space-y-2">
        <div className="flex justify-between items-start">
          <p className="font-semibold text-sm">{getProviderName(booking.provider_id)}</p>
          <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
            booking.status === "confirmed" ? "bg-green-100 text-green-700" :
            booking.status === "cancelled" ? "bg-red-100 text-red-700" :
            booking.status === "pending" ? "bg-amber-100 text-amber-700" :
            "bg-secondary text-muted-foreground"
          }`}>
            {booking.status === "confirmed" ? `${t("confirmed")} ✅` :
             booking.status === "cancelled" ? `${t("cancelled")} ❌` :
             booking.status === "pending" ? `${t("pendingApproval")} 🟡` :
             booking.status}
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
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-2">
            {canReview ? (
              <button
                onClick={() => setShowReviewForm(!showReviewForm)}
                className="text-xs font-medium text-accent flex items-center gap-1"
              >
                <Star className="h-3 w-3" />
                {t("leaveReview")}
              </button>
            ) : existingReview ? (
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <Star className="h-3 w-3 fill-accent text-accent" />
                {t("reviewed")}
              </span>
            ) : null}
            {canCancel && (
              <Button
                variant="outline"
                size="sm"
                className="text-[11px] h-7 px-2.5 text-red-600 border-red-200 hover:bg-red-50"
                onClick={() => cancelMutation.mutate()}
                disabled={cancelMutation.isPending}
              >
                <XCircle className="h-3 w-3 mr-1" />
                {cancelMutation.isPending ? t("cancelling") : t("cancelBooking")}
              </Button>
            )}
            {canCallToCancel && (
              <div className="flex items-center gap-1.5">
                {providerPhone && (
                  <a
                    href={`tel:${providerPhone}`}
                    className="inline-flex items-center gap-1 text-[11px] h-7 px-2.5 rounded-md border border-orange-300 bg-orange-50 text-orange-700 font-medium hover:bg-orange-100 transition-colors"
                  >
                    <Phone className="h-3 w-3" />
                    {t("callToCancel")}
                  </a>
                )}
                {providerPhone && (
                  <a
                    href={`https://wa.me/972${providerPhone.replace(/^0/, "").replace(/\D/g, "")}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[11px] h-7 px-2.5 rounded-md border border-green-300 bg-green-50 text-green-700 font-medium hover:bg-green-100 transition-colors"
                  >
                    WhatsApp
                  </a>
                )}
              </div>
            )}
          </div>
          <span className="text-sm font-bold">₪{booking.total_price}</span>
        </div>
      </div>

      {canCallToCancel && (
        <div className="rounded-xl border border-orange-200 bg-orange-50 px-3 py-2 text-xs text-orange-700">
          {t("cancellationBlocked")}
        </div>
      )}

      {showReviewForm && (
        <ReviewForm
          bookingId={booking.id}
          providerId={booking.provider_id}
          onSubmitted={() => setShowReviewForm(false)}
        />
      )}
    </motion.div>
  );
}

export default Bookings;
