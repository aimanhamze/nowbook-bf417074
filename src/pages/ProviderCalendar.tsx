import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useLang } from "@/contexts/LangContext";
import { useAuth } from "@/contexts/AuthContext";
import { CalendarTab } from "@/components/dashboard/CalendarTab";
import { PendingTab, usePendingCount } from "@/components/dashboard/PendingTab";
import { useProviderProfile } from "@/hooks/useProviderProfile";
import { BackArrow } from "@/components/ui/directional-icon";
import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";

type TabId = "calendar" | "pending";

export default function ProviderCalendar() {
  const { t } = useLang();
  const { user, isProvider } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { profile, isLoading } = useProviderProfile();
  const pendingCount = usePendingCount();
  const requiresApproval = profile?.requires_booking_approval ?? false;
  const showPendingTab = requiresApproval || pendingCount > 0;

  // Accept location.state.tab === "pending" from the BusinessProfileTab guard dialog.
  const initialTab: TabId =
    (location.state as { tab?: string } | null)?.tab === "pending" ? "pending" : "calendar";
  const [activeTab, setActiveTab] = useState<TabId>(initialTab);

  // If the Pending tab gets hidden while active, fall back to calendar.
  useEffect(() => {
    if (activeTab === "pending" && !showPendingTab) {
      setActiveTab("calendar");
    }
  }, [activeTab, showPendingTab]);

  useEffect(() => {
    if (user && !isProvider) {
      navigate("/", { replace: true });
    }
  }, [user, isProvider, navigate]);

  if (!user || !isProvider) return null;

  // If no profile yet, provider was not set up by admin. Mirrors Dashboard's
  // guard so the new /calendar landing degrades gracefully for the no-profile
  // edge case (manually-granted role, or a failed create-provider insert).
  if (!isLoading && !profile) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-5 gap-4">
        <p className="text-muted-foreground text-center">{t("profileNotSetup")}</p>
        <Button onClick={() => navigate("/")}>{t("home")}</Button>
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-24">
      <header className="px-5 pt-12 pb-4">
        <div className="flex items-center gap-3 mb-4">
          <button onClick={() => navigate(-1)} className="active:scale-95">
            <BackArrow className="h-5 w-5" />
          </button>
          <h1 className="text-xl font-bold flex-1">{t("bookingsCalendar")}</h1>
        </div>

        {/* Tab bar — Pending tab is hidden when the provider doesn't require approval AND no stale pending bookings exist */}
        {showPendingTab ? (
          <div className="flex gap-1 bg-secondary rounded-2xl p-1">
            <button
              onClick={() => setActiveTab("calendar")}
              className={`flex-1 py-2.5 rounded-xl text-xs font-medium transition-all duration-200 active:scale-[0.97] ${
                activeTab === "calendar" ? "bg-card shadow-sm text-foreground" : "text-muted-foreground"
              }`}
            >
              {t("bookingsCalendar")}
            </button>
            <button
              onClick={() => setActiveTab("pending")}
              className={`flex-1 py-2.5 rounded-xl text-xs font-medium transition-all duration-200 active:scale-[0.97] flex items-center justify-center gap-1.5 ${
                activeTab === "pending" ? "bg-card shadow-sm text-foreground" : "text-muted-foreground"
              }`}
            >
              {t("pendingTab")}
              {pendingCount > 0 && (
                <span className="inline-flex items-center justify-center h-4 min-w-4 px-1 rounded-full bg-red-500 text-white text-[10px] font-bold leading-none">
                  {pendingCount}
                </span>
              )}
            </button>
          </div>
        ) : null}
      </header>

      <motion.div
        key={activeTab}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
        className="px-5"
      >
        {activeTab === "calendar" ? <CalendarTab /> : <PendingTab />}
      </motion.div>
    </div>
  );
}
