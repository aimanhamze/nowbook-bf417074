import { SearchBar } from "@/components/home/SearchBar";
import { CategoryRow } from "@/components/home/CategoryRow";
import { ProviderCard } from "@/components/home/ProviderCard";
import { useAllProviders } from "@/hooks/useAllProviders";
import { useFavorites } from "@/hooks/useFavorites";
import { beautyCategories, healthCategories, fitnessCategories } from "@/lib/mock-data";
import { motion } from "framer-motion";
import { useLang } from "@/contexts/LangContext";
import { useAuth } from "@/contexts/AuthContext";
import { Navigate, useNavigate } from "react-router-dom";
import type { Provider } from "@/lib/mock-data";

const MAX_FAVORITES_SHOWN = 10;

function sortFavoritesFirst(providers: Provider[], favoriteIds: string[]): Provider[] {
  return [...providers].sort((a, b) => {
    const aFav = favoriteIds.includes(a.id) ? 1 : 0;
    const bFav = favoriteIds.includes(b.id) ? 1 : 0;
    return bFav - aFav;
  });
}

const Index = () => {
  const { t } = useLang();
  const { isProvider, isAdmin, user } = useAuth();
  const navigate = useNavigate();
  const { providers } = useAllProviders();
  const { favoriteIds } = useFavorites();

  if (isAdmin) {
    return <Navigate to="/admin" replace />;
  }

  if (isProvider) {
    return <Navigate to="/dashboard" replace />;
  }

  const favoriteProviders = providers
    .filter((p) => favoriteIds.includes(p.id))
    .slice(0, MAX_FAVORITES_SHOWN);

  const beautyProviders = sortFavoritesFirst(
    providers.filter((p) => (beautyCategories as readonly string[]).includes(p.category)),
    favoriteIds
  );
  const healthProviders = sortFavoritesFirst(
    providers.filter((p) => (healthCategories as readonly string[]).includes(p.category)),
    favoriteIds
  );
  const fitnessProviders = sortFavoritesFirst(
    providers.filter((p) => (fitnessCategories as readonly string[]).includes(p.category)),
    favoriteIds
  );

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

      {/* My Favorites — only when logged in with at least 1 favorite */}
      {user && favoriteProviders.length > 0 && (
        <section className="px-5 mb-8">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              {t("myFavorites")} ⭐
            </h2>
            <button
              className="text-xs text-accent font-semibold"
              onClick={() => navigate("/favorites")}
            >
              {t("seeAll")}
            </button>
          </div>
          <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-none -mx-1.5 px-1.5">
            {favoriteProviders.map((p, i) => (
              <motion.button
                key={p.id}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: i * 0.05, duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                onClick={() => navigate(`/provider/${p.id}`)}
                className="flex flex-col items-center gap-1.5 min-w-[72px] active:scale-95 transition-transform"
              >
                <div className="w-14 h-14 rounded-2xl overflow-hidden bg-gradient-to-br from-accent/20 to-accent/5 border border-border/50 shrink-0">
                  <img
                    src={p.image}
                    alt={p.name["he"]}
                    className="w-full h-full object-cover"
                    loading="lazy"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                  />
                </div>
                <span className="text-[11px] font-medium text-center w-16 truncate leading-tight">
                  {p.name["he"]}
                </span>
              </motion.button>
            ))}
          </div>
        </section>
      )}

      {/* Beauty & Cosmetics */}
      <section className="px-5 mb-8">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
          {t("beautyAndCosmetics")}
        </h2>
        <CategoryRow filter={[...beautyCategories]} />
      </section>

      {/* Health & Medical */}
      <section className="px-5 mb-8">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
          {t("healthProfessionals")}
        </h2>
        <CategoryRow filter={[...healthCategories]} />
      </section>

      {/* Fitness & Sports */}
      <section className="px-5 mb-8">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
          🏋️ {t("fitnessStudio")}
        </h2>
        <CategoryRow filter={[...fitnessCategories]} />
      </section>

      {/* Popular nearby - beauty */}
      {beautyProviders.length > 0 && (
        <section className="px-5 mb-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold">{t("beautyAndCosmetics")}</h2>
            <button
              className="text-xs text-accent font-semibold"
              onClick={() => navigate("/explore?group=beauty")}
            >
              {t("seeAll")}
            </button>
          </div>
          <div className="flex flex-col gap-3">
            {beautyProviders.map((provider, i) => (
              <ProviderCard key={provider.id} provider={provider} index={i} />
            ))}
          </div>
        </section>
      )}

      {/* Popular nearby - health */}
      {healthProviders.length > 0 && (
        <section className="px-5 mb-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold">{t("healthProfessionals")}</h2>
            <button
              className="text-xs text-accent font-semibold"
              onClick={() => navigate("/explore?group=health")}
            >
              {t("seeAll")}
            </button>
          </div>
          <div className="flex flex-col gap-3">
            {healthProviders.map((provider, i) => (
              <ProviderCard key={provider.id} provider={provider} index={i} />
            ))}
          </div>
        </section>
      )}

      {/* Fitness providers */}
      {fitnessProviders.length > 0 && (
        <section className="px-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold">🏋️ {t("fitnessStudio")}</h2>
            <button
              className="text-xs text-accent font-semibold"
              onClick={() => navigate("/explore?group=fitness")}
            >
              {t("seeAll")}
            </button>
          </div>
          <div className="flex flex-col gap-3">
            {fitnessProviders.map((provider, i) => (
              <ProviderCard key={provider.id} provider={provider} index={i} />
            ))}
          </div>
        </section>
      )}

      {/* Fallback if no providers at all */}
      {providers.length === 0 && (
        <section className="px-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold">{t("popularNearby")}</h2>
          </div>
        </section>
      )}
    </div>
  );
};

export default Index;
