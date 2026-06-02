import { useState, useEffect } from "react";
import { Briefcase, User, Clock, Bell, BellOff, Images } from "lucide-react";
import { BackArrow } from "@/components/ui/directional-icon";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { useLang } from "@/contexts/LangContext";
import { useAuth } from "@/contexts/AuthContext";
import { useProviderProfile } from "@/hooks/useProviderProfile";
import { ServicesTab } from "@/components/dashboard/ServicesTab";
import { BusinessProfileTab } from "@/components/dashboard/BusinessProfileTab";
import { AvailabilityTab } from "@/components/dashboard/AvailabilityTab";
import { PhotosTab } from "@/components/dashboard/PhotosTab";
import { Button } from "@/components/ui/button";
import { usePushSubscription } from "@/hooks/usePushSubscription";

const tabs = [
  { id: "profile", icon: User },
  { id: "availability", icon: Clock },
  { id: "services", icon: Briefcase },
  { id: "gallery", icon: Images },
] as const;

type TabId = typeof tabs[number]["id"];

const TAB_LABELS: Record<TabId, string> = {
  services: "manageServices",
  profile: "businessProfile",
  availability: "availability",
  gallery: "gallery",
};

export default function Dashboard() {
  const { t } = useLang();
  const { user, isProvider } = useAuth();
  const { profile, isLoading } = useProviderProfile();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<TabId>("profile");
  const { isSupported, isSubscribed, loading: pushLoading, subscribe, unsubscribe } = usePushSubscription();

  if (!user || !isProvider) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-5 gap-4">
        <p className="text-muted-foreground">{!user ? t("signInToManage") : t("providerOnly")}</p>
        <Button onClick={() => navigate(!user ? "/auth" : "/")}>{!user ? t("signInUp") : t("home")}</Button>
      </div>
    );
  }

  // If no profile yet, provider was not set up by admin
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
      <header className="px-5 pt-12 pb-2">
        <div className="flex items-center gap-3 mb-4">
          <button onClick={() => navigate(-1)} className="active:scale-95">
            <BackArrow className="h-5 w-5" />
          </button>
          <h1 className="text-xl font-bold flex-1">{t("providerDashboard")}</h1>
          {isSupported && (
            <button
              onClick={isSubscribed ? unsubscribe : subscribe}
              disabled={pushLoading}
              className={`p-2 rounded-xl transition-colors active:scale-95 ${
                isSubscribed ? "bg-accent/10 text-accent" : "bg-secondary text-muted-foreground"
              }`}
              title={isSubscribed ? t("notificationsActive") : t("enableNotifications")}
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
              <motion.button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                whileTap={{ scale: 0.92 }}
                className={`relative flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-medium transition-colors duration-200 ${
                  isActive ? "text-accent" : "text-muted-foreground"
                }`}
              >
                {isActive && (
                  <motion.div
                    layoutId="dashboardTabPill"
                    className="absolute inset-0 rounded-xl bg-card shadow-sm"
                    transition={{ type: "spring", stiffness: 380, damping: 32 }}
                  />
                )}
                <span className="relative flex items-center gap-1.5">
                  <motion.span
                    animate={{ scale: isActive ? 1.1 : 1 }}
                    transition={{ type: "spring", stiffness: 400, damping: 25 }}
                    className="inline-flex"
                  >
                    <Icon className="h-3.5 w-3.5" />
                  </motion.span>
                  <span className="hidden sm:inline">{t(TAB_LABELS[tab.id] as any)}</span>
                </span>
              </motion.button>
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
        {activeTab === "profile" && <BusinessProfileTab />}
        {activeTab === "availability" && <AvailabilityTab />}
        {activeTab === "services" && <ServicesTab />}
        {activeTab === "gallery" && <PhotosTab />}
      </motion.div>
    </div>
  );
}
