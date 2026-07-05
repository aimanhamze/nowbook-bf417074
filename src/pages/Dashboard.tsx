import { useState, useEffect } from "react";
import { Briefcase, User, Clock, Bell, BellOff, Images, SlidersHorizontal } from "lucide-react";
import { BackArrow } from "@/components/ui/directional-icon";
import { motion } from "framer-motion";
import { useLocation, useNavigate } from "react-router-dom";
import { useLang } from "@/contexts/LangContext";
import { useAuth } from "@/contexts/AuthContext";
import { useProviderProfile } from "@/hooks/useProviderProfile";
import { ServicesTab } from "@/components/dashboard/ServicesTab";
import { BusinessProfileTab } from "@/components/dashboard/BusinessProfileTab";
import { BookingSettingsTab } from "@/components/dashboard/BookingSettingsTab";
import { AvailabilityTab } from "@/components/dashboard/AvailabilityTab";
import { PhotosTab } from "@/components/dashboard/PhotosTab";
import { Button } from "@/components/ui/button";
import { usePushSubscription } from "@/hooks/usePushSubscription";
import { providerDesktopPage, providerDesktopColumn } from "@/components/layout/providerDesktop";

const tabs = [
  { id: "profile", icon: User },
  { id: "booking", icon: SlidersHorizontal },
  { id: "availability", icon: Clock },
  { id: "services", icon: Briefcase },
  { id: "gallery", icon: Images },
] as const;

type TabId = typeof tabs[number]["id"];

const TAB_LABELS: Record<TabId, string> = {
  services: "manageServices",
  profile: "businessProfile",
  booking: "bookingSettingsTitle",
  availability: "availability",
  gallery: "gallery",
};

export default function Dashboard() {
  const { t } = useLang();
  const { user, isProvider } = useAuth();
  const { profile, isLoading } = useProviderProfile();
  const navigate = useNavigate();
  const location = useLocation();
  // Allow deep-linking to a specific tab via navigation state, e.g.
  // navigate("/dashboard", { state: { tab: "services" } }). Falls back to the
  // default "profile" tab for a plain visit or an unrecognized id.
  const requestedTab = (location.state as { tab?: string } | null)?.tab;
  const initialTab: TabId = tabs.some(tab => tab.id === requestedTab)
    ? (requestedTab as TabId)
    : "profile";
  const [activeTab, setActiveTab] = useState<TabId>(initialTab);
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
    // Dashboard-only background: a softer, lighter take on the customer
    // atmosphere — gentler saturation, higher lightness, fading to near white.
    // Inline so the shared --bg-atmosphere (customer view) stays untouched.
    <div
      className={`relative min-h-screen overflow-x-clip pb-24 ${providerDesktopPage}`}
      style={{ background: "var(--bg-atmosphere-soft)" }}
    >
      {/* Subtle accent glow — softened/lightened for the dashboard so the page
          reads calmer. Anchored via a logical inset to stay RTL/LTR-correct. */}
      <div
        aria-hidden
        className="pointer-events-none absolute top-[-4rem] [inset-inline-end:-5rem] h-[22rem] w-[22rem] rounded-full blur-3xl opacity-45"
        style={{ background: "radial-gradient(circle, hsl(24 95% 80% / 0.34) 0%, transparent 65%)" }}
      />

      <div className={`relative ${providerDesktopColumn}`}>
        <header className="px-5 pt-12 pb-3">
          <div className="mb-5 flex items-center gap-3">
            <button
              onClick={() => navigate(-1)}
              className="-ms-1.5 rounded-xl p-1.5 transition-colors hover:bg-secondary/60 active:scale-95"
              aria-label={t("back")}
            >
              <BackArrow className="h-5 w-5" />
            </button>
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-2xl font-extrabold leading-tight">{t("providerDashboard")}</h1>
              {profile?.business_name && (
                <p className="mt-0.5 truncate text-xs text-muted-foreground">{profile.business_name}</p>
              )}
            </div>
            {isSupported && (
              <button
                onClick={isSubscribed ? unsubscribe : subscribe}
                disabled={pushLoading}
                className={`shrink-0 rounded-xl p-2.5 transition-colors active:scale-95 ${
                  isSubscribed ? "bg-accent/10 text-accent" : "bg-secondary text-muted-foreground hover:text-foreground"
                }`}
                title={isSubscribed ? t("notificationsActive") : t("enableNotifications")}
                aria-label={isSubscribed ? t("notificationsActive") : t("enableNotifications")}
              >
                {isSubscribed ? <Bell className="h-5 w-5" /> : <BellOff className="h-5 w-5" />}
              </button>
            )}
          </div>

          {/* Tab bar — segmented control */}
          <div className="flex gap-1 rounded-2xl border border-border/40 bg-secondary/80 p-1 backdrop-blur-sm">
            {tabs.map(tab => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              const label = t(TAB_LABELS[tab.id] as any);
              return (
                <motion.button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  whileTap={{ scale: 0.92 }}
                  aria-label={label}
                  aria-pressed={isActive}
                  className={`relative flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2.5 text-xs font-semibold transition-colors duration-200 ${
                    isActive ? "text-accent" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {isActive && (
                    <motion.div
                      layoutId="dashboardTabPill"
                      className="absolute inset-0 rounded-xl bg-card shadow-[0_2px_8px_-2px_hsl(var(--accent)/0.25)] ring-1 ring-border/50"
                      transition={{ type: "spring", stiffness: 380, damping: 32 }}
                    />
                  )}
                  <span className="relative flex items-center gap-1.5">
                    <motion.span
                      animate={{ scale: isActive ? 1.1 : 1 }}
                      transition={{ type: "spring", stiffness: 400, damping: 25 }}
                      className="inline-flex"
                    >
                      <Icon className="h-4 w-4" />
                    </motion.span>
                    <span className="hidden sm:inline">{label}</span>
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
          className="px-5 pt-5"
        >
          {activeTab === "profile" && <BusinessProfileTab />}
          {activeTab === "booking" && <BookingSettingsTab />}
          {activeTab === "availability" && <AvailabilityTab />}
          {activeTab === "services" && <ServicesTab />}
          {activeTab === "gallery" && <PhotosTab />}
        </motion.div>
      </div>
    </div>
  );
}
