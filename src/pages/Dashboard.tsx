import { useState, useEffect } from "react";
import { Briefcase, Calendar, User, Clock, ChevronLeft, Bell, BellOff } from "lucide-react";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { useLang } from "@/contexts/LangContext";
import { useAuth } from "@/contexts/AuthContext";
import { useProviderProfile } from "@/hooks/useProviderProfile";
import { ServicesTab } from "@/components/dashboard/ServicesTab";
import { CalendarTab } from "@/components/dashboard/CalendarTab";
import { BusinessProfileTab } from "@/components/dashboard/BusinessProfileTab";
import { AvailabilityTab } from "@/components/dashboard/AvailabilityTab";
import { Button } from "@/components/ui/button";
import { usePushSubscription } from "@/hooks/usePushSubscription";

const tabs = [
  { id: "services", icon: Briefcase },
  { id: "calendar", icon: Calendar },
  { id: "profile", icon: User },
  { id: "availability", icon: Clock },
] as const;

type TabId = typeof tabs[number]["id"];

const TAB_LABELS: Record<TabId, string> = {
  services: "manageServices",
  calendar: "bookingsCalendar",
  profile: "businessProfile",
  availability: "availability",
};

export default function Dashboard() {
  const { t } = useLang();
  const { user } = useAuth();
  const { profile, isLoading } = useProviderProfile();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<TabId>("services");
  const { isSupported, isSubscribed, loading: pushLoading, subscribe, unsubscribe } = usePushSubscription();

  if (!user) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-5 gap-4">
        <p className="text-muted-foreground">{t("signInToManage")}</p>
        <Button onClick={() => navigate("/auth")}>{t("signInUp")}</Button>
      </div>
    );
  }

  // If no profile yet, show setup prompt (which is the BusinessProfileTab)
  if (!isLoading && !profile) {
    return (
      <div className="min-h-screen pb-24">
        <header className="px-5 pt-12 pb-4 flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="active:scale-95">
            <ChevronLeft className="h-5 w-5" />
          </button>
          <h1 className="text-xl font-bold">{t("setupBusiness")}</h1>
        </header>
        <div className="px-5">
          <BusinessProfileTab />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-24">
      <header className="px-5 pt-12 pb-2">
        <div className="flex items-center gap-3 mb-4">
          <button onClick={() => navigate(-1)} className="active:scale-95">
            <ChevronLeft className="h-5 w-5" />
          </button>
          <h1 className="text-xl font-bold flex-1">{t("providerDashboard")}</h1>
          {isSupported && (
            <button
              onClick={isSubscribed ? unsubscribe : subscribe}
              disabled={pushLoading}
              className={`p-2 rounded-xl transition-colors active:scale-95 ${
                isSubscribed ? "bg-accent/10 text-accent" : "bg-secondary text-muted-foreground"
              }`}
              title={isSubscribed ? "התראות פעילות" : "הפעל התראות"}
            >
              {isSubscribed ? <Bell className="h-5 w-5" /> : <BellOff className="h-5 w-5" />}
            </button>
          )}
        </div>

        {/* Tab bar */}
        <div className="flex gap-1 bg-secondary rounded-2xl p-1">
          {tabs.map(tab => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-medium transition-all duration-200 active:scale-[0.97] ${
                  isActive ? "bg-card shadow-sm text-foreground" : "text-muted-foreground"
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">{t(TAB_LABELS[tab.id] as any)}</span>
              </button>
            );
          })}
        </div>
      </header>

      <motion.div
        key={activeTab}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
        className="px-5 pt-4"
      >
        {activeTab === "services" && <ServicesTab />}
        {activeTab === "calendar" && <CalendarTab />}
        {activeTab === "profile" && <BusinessProfileTab />}
        {activeTab === "availability" && <AvailabilityTab />}
      </motion.div>
    </div>
  );
}
