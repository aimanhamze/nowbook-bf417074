import { User, Settings, LogIn, LogOut, Bell, BellOff, HelpCircle, Globe, Star, QrCode, Users, Loader2 } from "lucide-react";
import { ForwardArrow } from "@/components/ui/directional-icon";
import { motion } from "framer-motion";
import { useLang } from "@/contexts/LangContext";
import { useAuth } from "@/contexts/AuthContext";
import { providerDesktopPage, providerDesktopColumn } from "@/components/layout/providerDesktop";
import { useNavigate } from "react-router-dom";
import { usePushSubscription } from "@/hooks/usePushSubscription";
import { useProviderProfile } from "@/hooks/useProviderProfile";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

const Profile = () => {
  const { lang, setLang, t } = useLang();
  const { user, signOut, isProvider, isAdmin } = useAuth();
  // Shared page: only providers get the desktop column frame; customers and
  // admins keep the page exactly as-is at every width.
  const providerView = isProvider && !isAdmin;
  const navigate = useNavigate();
  const { isSupported, isSubscribed, loading: pushLoading, subscribe, unsubscribe } = usePushSubscription();
  // Existing cached hook; gated internally by `enabled: !!user`. Only its data
  // is consumed when isProvider is true, so the customer view is unaffected.
  const { profile: providerProfile, isLoading: providerLoading } = useProviderProfile();

  const handleSignInOut = async () => {
    if (user) {
      await signOut();
    } else {
      navigate("/auth");
    }
  };

  const handlePushToggle = () => {
    if (isSubscribed) {
      unsubscribe();
    } else {
      subscribe();
    }
  };

  const menuItems = [
    { icon: user ? LogOut : LogIn, label: user ? t("signOut") : t("signInUp"), action: handleSignInOut, danger: !!user },
    ...(user && isProvider ? [{ icon: QrCode, label: t("myQrCode"), action: () => navigate("/qr-code") }] : []),
    ...(user && isProvider ? [{ icon: Star, label: t("myReviews"), action: () => navigate("/reviews") }] : []),
    ...(user && isProvider ? [{ icon: Users, label: t("myCustomers"), action: () => navigate("/customers") }] : []),
    ...(user && isSupported ? [{
      icon: isSubscribed ? Bell : BellOff,
      label: isSubscribed ? t("pushNotificationsOn") : t("enablePushNotifications"),
      action: handlePushToggle,
      loading: pushLoading,
    }] : []),
    ...(user && isProvider ? [{ icon: Settings, label: t("settings"), action: () => navigate("/settings") }] : []),
    { icon: HelpCircle, label: t("helpSupport") },
  ];

  const { data: profileData } = useQuery({
    queryKey: ["user-profile", user?.id],
    queryFn: async () => {
      if (!user) return null;
      const { data } = await supabase
        .from("profiles")
        .select("display_name, avatar_url")
        .eq("user_id", user.id)
        .single();
      return data;
    },
    enabled: !!user,
  });

  const customerName = profileData?.display_name || user?.user_metadata?.full_name || t("guest");
  // Provider name comes from the reliable (NOT NULL) business_name. While the
  // provider profile is still loading, fall back to the customer name rather
  // than flashing an empty line.
  const displayName = user
    ? (isProvider ? (providerProfile?.business_name || customerName) : customerName)
    : t("guest");
  const subtitle = user
    ? (isProvider ? (user.email || "") : (user.phone || user.email || ""))
    : t("signInToManage");
  const photoUrl = user
    ? (isProvider ? providerProfile?.avatar_image : profileData?.avatar_url)
    : null;
  // Avoid a flash of the fallback name before the provider profile resolves.
  const nameLoading = !!user && isProvider && providerLoading;

  return (
    <div
      className={`relative min-h-screen overflow-x-clip pb-24 ${providerView ? providerDesktopPage : ""}`}
      style={{ background: "var(--bg-atmosphere)" }}
    >
      {/* Radial accent glows — matched to Home. Anchored via logical insets so
          they stay on the same visual side in both LTR and RTL. */}
      <div
        aria-hidden
        className="pointer-events-none absolute top-[-4rem] [inset-inline-end:-5rem] h-[24rem] w-[24rem] rounded-full blur-3xl opacity-55"
        style={{ background: "radial-gradient(circle, hsl(24 95% 78% / 0.5) 0%, transparent 65%)" }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute top-[22rem] [inset-inline-start:-6rem] h-[28rem] w-[28rem] rounded-full blur-3xl opacity-45"
        style={{ background: "radial-gradient(circle, hsl(265 60% 80% / 0.4) 0%, transparent 65%)" }}
      />

      <div className={`relative ${providerView ? providerDesktopColumn : ""}`}>
        <header className="px-5 pt-12 pb-5">
          <h1 className="text-xl font-bold">{t("profile")}</h1>
        </header>

        {/* Identity hero — premium glass surface with accent-ringed avatar */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          className="px-5 mb-6"
        >
          <div className="glass-card rounded-2xl p-5 flex items-center gap-4">
            <div className="w-[72px] h-[72px] rounded-full ring-2 ring-accent/30 ring-offset-2 ring-offset-white/40 bg-accent/15 flex items-center justify-center shrink-0 overflow-hidden">
              {photoUrl ? (
                <img src={photoUrl} alt={displayName} className="w-full h-full object-cover" />
              ) : (
                <User className="h-8 w-8 text-accent" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              {nameLoading ? (
                <div className="h-6 w-32 rounded bg-muted animate-pulse" />
              ) : (
                <p className="text-lg font-bold text-foreground truncate leading-tight">{displayName}</p>
              )}
              <p className="text-xs text-muted-foreground truncate mt-1">{subtitle}</p>
            </div>
          </div>
        </motion.div>

        {/* Language Switcher */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.08, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          className="px-5 mb-4"
        >
          <div className="glass-card-md rounded-2xl p-4">
            <div className="flex items-center gap-2.5 mb-3">
              <Globe className="h-4 w-4 text-accent" />
              <span className="text-sm font-semibold">{t("language")}</span>
            </div>
            <div className="flex gap-2">
              {([["he", "עברית"], ["ar", "العربية"], ["en", "English"]] as const).map(([code, label]) => (
                <button
                  key={code}
                  onClick={() => setLang(code)}
                  className={`flex-1 py-2.5 rounded-xl text-sm font-medium transition-all active:scale-[0.97] ${
                    lang === code
                      ? "bg-accent text-accent-foreground shadow-[0_8px_20px_-8px_hsl(24_80%_55%_/_0.6)]"
                      : "bg-white/50 text-foreground/70 hover:bg-white/70"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </motion.div>

        {/* Menu list */}
        <div className="px-5">
          <div className="glass-card-md rounded-2xl overflow-hidden">
            {menuItems.map(({ icon: Icon, label, action, loading, danger }, i) => (
              <motion.button
                key={label}
                onClick={action}
                disabled={loading}
                initial={{ opacity: 0, x: 12 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.16 + i * 0.06, duration: 0.3 }}
                className="flex items-center justify-between gap-3 w-full px-3.5 py-3 text-sm hover:bg-white/40 transition-colors active:scale-[0.99] border-b border-border/50 last:border-0 disabled:opacity-50"
              >
                <span className="flex items-center gap-3 min-w-0">
                  <span
                    className={`flex items-center justify-center h-9 w-9 rounded-xl shrink-0 ${
                      danger ? "bg-destructive/10 text-destructive" : "bg-accent/10 text-accent"
                    }`}
                  >
                    {loading ? (
                      <Loader2 className="h-[18px] w-[18px] animate-spin" />
                    ) : (
                      <Icon className="h-[18px] w-[18px]" />
                    )}
                  </span>
                  <span className="min-w-0 truncate font-medium text-foreground">{label}</span>
                </span>
                <ForwardArrow className="h-4 w-4 text-muted-foreground/70 shrink-0" />
              </motion.button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Profile;
