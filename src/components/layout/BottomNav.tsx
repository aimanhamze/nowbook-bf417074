import { Home, Search, Calendar, Heart, User } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useLang } from "@/contexts/LangContext";

export function BottomNav() {
  const location = useLocation();
  const navigate = useNavigate();
  const { t } = useLang();

  const navItems = [
    { icon: Home, label: t("home"), path: "/" },
    { icon: Search, label: t("explore"), path: "/explore" },
    { icon: Calendar, label: t("bookings"), path: "/bookings" },
    { icon: Heart, label: t("favorites"), path: "/favorites" },
    { icon: User, label: t("profile"), path: "/profile" },
  ];

  // Hide BottomNav on provider detail and booking pages
  if (location.pathname.startsWith("/provider/")) {
    return null;
  }

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-border bg-card/80 backdrop-blur-xl">
      <div className="flex items-center justify-around py-2 px-2">
        {navItems.map(({ icon: Icon, label, path }) => {
          const isActive = location.pathname === path;
          return (
            <button
              key={path}
              onClick={() => navigate(path)}
              className={cn(
                "flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-xl transition-colors duration-200",
                "active:scale-95",
                isActive ? "text-accent" : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Icon className="h-5 w-5" strokeWidth={isActive ? 2.5 : 1.5} />
              <span className="text-[10px] font-medium">{label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
