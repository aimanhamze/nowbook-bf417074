import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Users, Store, CalendarDays, Star, TrendingUp, Bell } from "lucide-react";
import { useLang } from "@/contexts/LangContext";

export function AdminStats() {
  const { t } = useLang();

  const { data: stats, isLoading } = useQuery({
    queryKey: ["admin-stats"],
    queryFn: async () => {
      const [users, providers, bookings, reviews, services, notifications] = await Promise.all([
        supabase.from("profiles").select("id", { count: "exact", head: true }),
        supabase.from("provider_profiles").select("id", { count: "exact", head: true }),
        supabase.from("bookings").select("id, status, total_price"),
        supabase.from("reviews").select("id", { count: "exact", head: true }),
        supabase.from("provider_services").select("id", { count: "exact", head: true }),
        supabase.from("notifications").select("id", { count: "exact", head: true }),
      ]);

      const allBookings = bookings.data || [];
      const confirmedBookings = allBookings.filter((b) => b.status === "confirmed");
      const totalRevenue = confirmedBookings.reduce((sum, b) => sum + (b.total_price || 0), 0);

      return {
        users: users.count || 0,
        providers: providers.count || 0,
        totalBookings: allBookings.length,
        confirmedBookings: confirmedBookings.length,
        cancelledBookings: allBookings.filter((b) => b.status === "cancelled").length,
        reviews: reviews.count || 0,
        services: services.count || 0,
        notifications: notifications.count || 0,
        totalRevenue,
      };
    },
  });

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-24 rounded-2xl bg-muted animate-pulse" />
        ))}
      </div>
    );
  }

  const cards = [
    { label: t("statsUsers"), value: stats?.users, icon: Users, color: "text-blue-500" },
    { label: t("statsProviders"), value: stats?.providers, icon: Store, color: "text-emerald-500" },
    { label: t("statsTotalBookings"), value: stats?.totalBookings, icon: CalendarDays, color: "text-violet-500" },
    { label: t("statsConfirmedBookings"), value: stats?.confirmedBookings, icon: TrendingUp, color: "text-green-500" },
    { label: t("statsReviews"), value: stats?.reviews, icon: Star, color: "text-amber-500" },
    { label: t("statsNotifications"), value: stats?.notifications, icon: Bell, color: "text-rose-500" },
  ];

  return (
    <div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
        {cards.map((card) => (
          <div key={card.label} className="rounded-2xl border border-border bg-card p-4 flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <card.icon className={`h-4 w-4 ${card.color}`} />
              <span className="text-xs text-muted-foreground">{card.label}</span>
            </div>
            <span className="text-2xl font-bold">{card.value}</span>
          </div>
        ))}
      </div>

      <div className="rounded-2xl border border-border bg-card p-5">
        <h3 className="text-sm font-semibold mb-1">{t("statsTotalRevenue")}</h3>
        <p className="text-3xl font-bold text-accent">₪{stats?.totalRevenue?.toLocaleString()}</p>
        <p className="text-xs text-muted-foreground mt-1">
          {stats?.cancelledBookings} {t("statsCancelledBookings")}
        </p>
      </div>
    </div>
  );
}
