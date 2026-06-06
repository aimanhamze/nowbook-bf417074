import { Home, Search, Calendar, Heart, User, LayoutDashboard, Bell, BarChart3 } from "lucide-react";
import { motion } from "framer-motion";
import { useLocation, useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useLang } from "@/contexts/LangContext";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { usePendingCount } from "@/hooks/useProviderBookings";

export function BottomNav() {
  const location = useLocation();
  const navigate = useNavigate();
  const { t } = useLang();
  const { isProvider, user } = useAuth();

  // Provider-only: count of bookings awaiting approval. Returns 0 (no fetch)
  // for customers/logged-out, so it's safe to call unconditionally here.
  const pendingCount = usePendingCount();

  const { data: unreadCount = 0 } = useQuery({
    queryKey: ["unread-notifications", user?.id],
    staleTime: 30 * 1000,
    queryFn: async () => {
      if (!user) return 0;
      const { count, error } = await supabase
        .from("notifications")
        .select("*", { count: "exact", head: true })
        .eq("user_id", user.id)
        .eq("is_read", false);
      if (error) return 0;
      return count || 0;
    },
    enabled: !!user,
    refetchInterval: 30000,
  });

  const navItems = isProvider
    ? [
        { icon: LayoutDashboard, label: t("dashboard"), path: "/dashboard" },
        { icon: BarChart3, label: t("statisticsTitle"), path: "/statistics" },
        { icon: Calendar, label: t("calendar"), path: "/calendar", badge: pendingCount },
        { icon: Bell, label: t("notificationsLabel"), path: "/notifications", badge: unreadCount },
        { icon: User, label: t("profile"), path: "/profile" },
      ]
    : [
        { icon: Home, label: t("home"), path: "/" },
        { icon: Search, label: t("explore"), path: "/explore" },
        { icon: Calendar, label: t("bookings"), path: "/bookings" },
        { icon: Bell, label: t("notificationsLabel"), path: "/notifications", badge: unreadCount },
        { icon: User, label: t("profile"), path: "/profile" },
      ];

  // Hide BottomNav on full-screen pages
  if (location.pathname.startsWith("/provider/") || location.pathname === "/nearby") {
    return null;
  }

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-border bg-card/80 backdrop-blur-xl">
      <div className="flex items-center justify-around py-2 px-2">
        {navItems.map(({ icon: Icon, label, path, badge }) => {
          const isActive = location.pathname === path;
          return (
            <motion.button
              key={path}
              onClick={() => navigate(path)}
              whileTap={{ scale: 0.92 }}
              className={cn(
                "flex flex-1 min-w-0 flex-col items-center gap-0.5 px-1 py-1.5 rounded-xl transition-colors duration-200 relative",
                isActive ? "text-accent" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {isActive && (
                <motion.div
                  layoutId="navPill"
                  className="absolute inset-0 rounded-xl bg-accent/10"
                  transition={{ type: "spring", stiffness: 380, damping: 32 }}
                />
              )}
              <div className="relative">
                <motion.div
                  animate={{ scale: isActive ? 1.1 : 1 }}
                  transition={{ type: "spring", stiffness: 400, damping: 25 }}
                >
                  <Icon className="h-5 w-5" strokeWidth={isActive ? 2.5 : 1.5} />
                </motion.div>
                {badge && badge > 0 ? (
                  <span className="absolute -top-1.5 -right-2 min-w-[16px] h-4 px-1 flex items-center justify-center rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold">
                    {badge > 9 ? "9+" : badge}
                  </span>
                ) : null}
              </div>
              <span className="max-w-full truncate text-[10px] font-medium">{label}</span>
            </motion.button>
          );
        })}
      </div>
    </nav>
  );
}
