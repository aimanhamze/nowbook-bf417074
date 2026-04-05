import { Heart } from "lucide-react";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { useLang } from "@/contexts/LangContext";
import { useFavorites } from "@/hooks/useFavorites";
import { useAllProviders } from "@/hooks/useAllProviders";
import { ProviderCard } from "@/components/home/ProviderCard";

const Favorites = () => {
  const navigate = useNavigate();
  const { t } = useLang();
  const { favoriteIds, isLoading: favLoading } = useFavorites();
  const { providers, isLoading: provLoading } = useAllProviders();

  const favoriteProviders = providers.filter((p) => favoriteIds.includes(p.id));
  const isLoading = favLoading || provLoading;

  if (isLoading) {
    return (
      <div className="min-h-screen pb-24">
        <header className="px-5 pt-12 pb-6">
          <h1 className="text-xl font-bold">{t("favorites")}</h1>
        </header>
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 rounded-full border-2 border-accent border-t-transparent animate-spin" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-24">
      <header className="px-5 pt-12 pb-6">
        <h1 className="text-xl font-bold">{t("favorites")}</h1>
      </header>

      {favoriteProviders.length > 0 ? (
        <section className="px-5">
          <motion.div
            className="flex flex-col gap-3"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3 }}
          >
            {favoriteProviders.map((p, i) => (
              <ProviderCard key={p.id} provider={p} index={i} />
            ))}
          </motion.div>
        </section>
      ) : (
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }} className="px-5 flex flex-col items-center justify-center py-20">
          <Heart className="h-12 w-12 text-muted-foreground/40 mb-4" />
          <p className="text-muted-foreground text-sm mb-1">{t("noFavoritesYet")}</p>
          <p className="text-xs text-muted-foreground mb-4">{t("tapHeart")}</p>
          <button onClick={() => navigate("/explore")} className="px-6 py-2.5 rounded-2xl bg-accent text-accent-foreground text-sm font-semibold active:scale-[0.98] transition-transform">
            {t("browseProviders")}
          </button>
        </motion.div>
      )}
    </div>
  );
};

export default Favorites;
