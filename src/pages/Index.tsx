import { SearchBar } from "@/components/home/SearchBar";
import { CategoryRow } from "@/components/home/CategoryRow";
import { ProviderCard } from "@/components/home/ProviderCard";
import { useAllProviders } from "@/hooks/useAllProviders";
import { motion } from "framer-motion";
import { useLang } from "@/contexts/LangContext";
import { useAuth } from "@/contexts/AuthContext";
import { Navigate } from "react-router-dom";

const Index = () => {
  const { t } = useLang();
  const { isProvider } = useAuth();
  const { providers } = useAllProviders();

  // Providers see their dashboard as home
  if (isProvider) {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <div className="min-h-screen pb-24">
      <header className="px-5 pt-12 pb-6">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        >
          <p className="text-sm text-muted-foreground mb-1">{t("goodMorning")}</p>
          <h1 className="text-2xl font-bold leading-tight">
            {t("findAppointment")}<br />
            <span className="text-accent">{t("nextAppointment")}</span>
          </h1>
        </motion.div>
      </header>

      <div className="px-5 mb-6">
        <SearchBar />
      </div>

      <section className="px-5 mb-8">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
          {t("browseByCategory")}
        </h2>
        <CategoryRow />
      </section>

      <section className="px-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold">{t("popularNearby")}</h2>
          <button className="text-xs text-accent font-semibold">{t("seeAll")}</button>
        </div>
        <div className="flex flex-col gap-3">
          {providers.map((provider, i) => (
            <ProviderCard key={provider.id} provider={provider} index={i} />
          ))}
        </div>
      </section>
    </div>
  );
};

export default Index;
