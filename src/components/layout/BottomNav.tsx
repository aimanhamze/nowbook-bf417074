import { Home, Search, Calendar, Heart, User, LayoutDashboard, Bell } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useLang } from "@/contexts/LangContext";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";

export function BottomNav() {
  const location = useLocation();
  const navigate = useNavigate();
  const { t } = useLang();
  const { isProvider, user } = useAuth();

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
        { icon: LayoutDashboard, label: t("providerDashboard"), path: "/dashboard" },
        { icon: Search, label: t("explore"), path: "/explore" },
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

  // Hide BottomNav on provider detail and booking pages
  if (location.pathname.startsWith("/provider/")) {
    return null;
  }

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-border bg-card/80 backdrop-blur-xl">
      <div className="flex items-center justify-around py-2 px-2">
        {navItems.map(({ icon: Icon, label, path, badge }) => {
          const isActive = location.pathname === path;
          return (
            <button
              key={path}
              onClick={() => navigate(path)}
              className={cn(
                "flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-xl transition-colors duration-200 relative",
                "active:scale-95",
                isActive ? "text-accent" : "text-muted-foreground hover:text-foreground"
              )}
            >
              <div className="relative">
                <Icon className="h-5 w-5" strokeWidth={isActive ? 2.5 : 1.5} />
                {badge && badge > 0 ? (
                  <span className="absolute -top-1.5 -right-2 min-w-[16px] h-4 px-1 flex items-center justify-center rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold">
                    {badge > 9 ? "9+" : badge}
                  </span>
                ) : null}
              </div>
              <span className="text-[10px] font-medium">{label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
