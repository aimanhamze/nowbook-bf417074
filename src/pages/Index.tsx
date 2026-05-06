import { SearchBar } from "@/components/home/SearchBar";
import { CategoryRow } from "@/components/home/CategoryRow";
import { ProviderCard } from "@/components/home/ProviderCard";
import { SectionLabel } from "@/components/ui/SectionLabel";
import { useAllProviders } from "@/hooks/useAllProviders";
import { useFavorites } from "@/hooks/useFavorites";
import { beautyCategories, healthCategories, fitnessCategories } from "@/lib/mock-data";
import { motion } from "framer-motion";
import { useLang } from "@/contexts/LangContext";
import { useAuth } from "@/contexts/AuthContext";
import { Navigate, useNavigate } from "react-router-dom";
import { ChevronRight } from "lucide-react";
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
    <div className="min-h-screen pb-28">

      {/* ── Hero header ──────────────────────────────────────────────────── */}
      <header className="px-5 pt-14 pb-8 bg-gradient-to-b from-accent/[0.07] to-transparent rounded-b-[2rem]">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        >
          <p className="text-sm text-foreground/45 mb-1">{t("goodMorning")}</p>
          <h1 className="text-3xl font-extrabold leading-[1.15] tracking-tight">
            {t("findAppointment")}<br />
            <span className="text-accent font-black">{t("nextAppointment")}</span>
          </h1>
        </motion.div>
      </header>

      {/* ── Search bar ───────────────────────────────────────────────────── */}
      <div className="px-5 mb-10">
        <SearchBar onNearbyClick={() => navigate("/nearby")} />
      </div>

      {/* ── My Favorites — only when logged in with at least 1 favorite ─── */}
      {user && favoriteProviders.length > 0 && (
        <section className="px-5 mb-10">
          <div className="flex items-center justify-between mb-4">
            <SectionLabel>{t("myFavorites")}</SectionLabel>
            <button
              className="flex items-center gap-0.5 text-sm font-semibold text-accent"
              onClick={() => navigate("/favorites")}
            >
              {t("seeAll")}
              <ChevronRight className="h-4 w-4" />
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
                <div className="w-16 h-16 rounded-2xl overflow-hidden bg-gradient-to-br from-accent/20 to-accent/5 ring-1 ring-border/60 shadow-sm shrink-0">
                  <img
                    src={p.image}
                    alt={p.name["he"]}
                    className="w-full h-full object-cover"
                    loading="lazy"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                  />
                </div>
                <span className="text-[11px] font-semibold text-center w-16 truncate leading-tight">
                  {p.name["he"]}
                </span>
              </motion.button>
            ))}
          </div>
        </section>
      )}

      {/* ── Category chip rows ───────────────────────────────────────────── */}
      <section className="px-5 mb-10">
        <div className="mb-4">
          <SectionLabel>{t("beautyAndCosmetics")}</SectionLabel>
        </div>
        <CategoryRow filter={[...beautyCategories]} />
      </section>

      <section className="px-5 mb-10">
        <div className="mb-4">
          <SectionLabel>{t("healthProfessionals")}</SectionLabel>
        </div>
        <CategoryRow filter={[...healthCategories]} />
      </section>

      <section className="px-5 mb-10">
        <div className="mb-4">
          <SectionLabel>{t("fitnessStudio")}</SectionLabel>
        </div>
        <CategoryRow filter={[...fitnessCategories]} />
      </section>

      {/* ── Provider lists ───────────────────────────────────────────────── */}
      {beautyProviders.length > 0 && (
        <section className="px-5 mt-4 mb-10">
          <div className="flex items-center justify-between mb-4">
            <SectionLabel>{t("beautyAndCosmetics")}</SectionLabel>
            <button
              className="flex items-center gap-0.5 text-sm font-semibold text-accent"
              onClick={() => navigate("/explore?group=beauty")}
            >
              {t("seeAll")}
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
          <div className="flex flex-col gap-3">
            {beautyProviders.map((provider, i) => (
              <ProviderCard key={provider.id} provider={provider} index={i} />
            ))}
          </div>
        </section>
      )}

      {healthProviders.length > 0 && (
        <section className="px-5 mb-10">
          <div className="flex items-center justify-between mb-4">
            <SectionLabel>{t("healthProfessionals")}</SectionLabel>
            <button
              className="flex items-center gap-0.5 text-sm font-semibold text-accent"
              onClick={() => navigate("/explore?group=health")}
            >
              {t("seeAll")}
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
          <div className="flex flex-col gap-3">
            {healthProviders.map((provider, i) => (
              <ProviderCard key={provider.id} provider={provider} index={i} />
            ))}
          </div>
        </section>
      )}

      {fitnessProviders.length > 0 && (
        <section className="px-5">
          <div className="flex items-center justify-between mb-4">
            <SectionLabel>{t("fitnessStudio")}</SectionLabel>
            <button
              className="flex items-center gap-0.5 text-sm font-semibold text-accent"
              onClick={() => navigate("/explore?group=fitness")}
            >
              {t("seeAll")}
              <ChevronRight className="h-4 w-4" />
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
            <SectionLabel>{t("popularNearby")}</SectionLabel>
          </div>
        </section>
      )}
    </div>
  );
};

export default Index;
