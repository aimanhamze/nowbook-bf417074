import { SearchBar } from "@/components/home/SearchBar";
import { CategoryRow } from "@/components/home/CategoryRow";
import { ProviderCard } from "@/components/home/ProviderCard";
import { useAllProviders } from "@/hooks/useAllProviders";
import { motion } from "framer-motion";
import { useLang } from "@/contexts/LangContext";
import { useAuth } from "@/contexts/AuthContext";
import { Navigate } from "react-router-dom";
import { MapPin } from "lucide-react";

const Index = () => {
  const { t, lang } = useLang();
  const { isProvider } = useAuth();
  const { providers } = useAllProviders();

  if (isProvider) {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <div className="min-h-screen pb-24 bg-background">
      {/* Wolt-style header */}
      <header className="sticky top-0 z-30 bg-accent px-5 pt-10 pb-5">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
        >
          <div className="flex items-center gap-2 mb-3">
            <MapPin className="h-4 w-4 text-accent-foreground/80" />
            <span className="text-xs font-medium text-accent-foreground/80">
              {lang === "he" ? "בקרבתך" : "Near you"}
            </span>
          </div>
          <h1 className="text-xl font-bold text-accent-foreground leading-tight mb-4">
            {t("findAppointment")}
          </h1>
          <SearchBar />
        </motion.div>
      </header>

      {/* Categories */}
      <section className="px-5 py-4">
        <CategoryRow />
      </section>

      {/* Provider Grid — Wolt-style 2 columns */}
      <section className="px-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-bold">{t("popularNearby")}</h2>
          <button
            className="text-xs text-accent font-semibold"
            onClick={() => {}}
          >
            {t("seeAll")}
          </button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {providers.map((provider, i) => (
            <ProviderCard key={provider.id} provider={provider} index={i} />
          ))}
        </div>
      </section>
    </div>
  );
};

export default Index;
