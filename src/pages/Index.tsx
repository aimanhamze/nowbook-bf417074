import { useEffect, useState } from "react";
import { SearchBar } from "@/components/home/SearchBar";
import { CategoryRow } from "@/components/home/CategoryRow";
import { ProviderCardVertical } from "@/components/home/ProviderCardVertical";
import { SectionLabel } from "@/components/ui/SectionLabel";
import { ForwardArrow } from "@/components/ui/directional-icon";
import { useAllProviders, useAllProviderSchedules } from "@/hooks/useAllProviders";
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
  const { schedulesByProviderId } = useAllProviderSchedules();

  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

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
    <div
      className="relative min-h-screen overflow-x-clip pb-32"
      style={{ background: "var(--bg-atmosphere)" }}
    >
      {/* Radial accent glows — anchored via logical insets so they stay on the
          headline/favorites side in both LTR and RTL. */}
      <div
        aria-hidden
        className="pointer-events-none absolute top-[-4rem] [inset-inline-end:-4rem] h-[26rem] w-[26rem] rounded-full blur-3xl opacity-60"
        style={{ background: "radial-gradient(circle, hsl(24 95% 78% / 0.55) 0%, transparent 65%)" }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute top-[28rem] [inset-inline-start:-6rem] h-[32rem] w-[32rem] rounded-full blur-3xl opacity-55"
        style={{ background: "radial-gradient(circle, hsl(265 60% 80% / 0.45) 0%, transparent 65%)" }}
      />

      <div className="relative">
        {/* ── Hero header ──────────────────────────────────────────────────── */}
        <header className="px-5 pt-16 pb-8">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          >
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-foreground/50 mb-3">
              {t("goodMorning")}
            </p>
            <h1 className="text-[2.5rem] leading-[1.05] tracking-tight font-extrabold text-balance">
              {t("findAppointment")}<br />
              <span className="text-accent font-black">{t("nextAppointment")}</span>
            </h1>
          </motion.div>
        </header>

        {/* ── Search bar ───────────────────────────────────────────────────── */}
        <div className="px-5 mb-12">
          <SearchBar onNearbyClick={() => navigate("/nearby")} />
        </div>

        {/* ── My Favorites — only when logged in with at least 1 favorite ─── */}
        {user && favoriteProviders.length > 0 && (
          <section className="px-5 mb-14">
            <div className="flex items-center justify-between mb-4">
              <SectionLabel>{t("myFavorites")}</SectionLabel>
              <button
                className="flex items-center gap-0.5 text-sm font-semibold text-accent"
                onClick={() => navigate("/favorites")}
              >
                {t("seeAll")}
                <ForwardArrow className="h-4 w-4" />
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
                  <div className="w-16 h-16 rounded-2xl overflow-hidden bg-gradient-to-br from-accent/30 via-accent/10 to-[hsl(265_45%_88%)] ring-1 ring-white/60 shadow-[0_6px_18px_-8px_rgba(120,70,30,0.25)] shrink-0">
                    <img
                      src={p.image}
                      alt={p.name["he"]}
                      className="w-full h-full object-cover"
                      loading="lazy"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                    />
                  </div>
                  <span className="text-[11px] font-medium text-foreground/75 text-center w-16 truncate leading-tight">
                    {p.name["he"]}
                  </span>
                </motion.button>
              ))}
            </div>
          </section>
        )}

        {/* ── Category chip rows ───────────────────────────────────────────── */}
        <section className="px-5 mb-14">
          <div className="mb-4">
            <SectionLabel>{t("beautyAndCosmetics")}</SectionLabel>
          </div>
          <CategoryRow filter={[...beautyCategories]} />
        </section>

        <section className="px-5 mb-14">
          <div className="mb-4">
            <SectionLabel>{t("healthProfessionals")}</SectionLabel>
          </div>
          <CategoryRow filter={[...healthCategories]} />
        </section>

        <section className="px-5 mb-14">
          <div className="mb-4">
            <SectionLabel>{t("fitnessStudio")}</SectionLabel>
          </div>
          <CategoryRow filter={[...fitnessCategories]} />
        </section>

        {/* ── Provider lists ───────────────────────────────────────────────── */}
        {beautyProviders.length > 0 && (
          <section className="px-5 mb-14">
            <div className="flex items-center justify-between mb-4">
              <SectionLabel>{t("beautyAndCosmetics")}</SectionLabel>
              <button
                className="flex items-center gap-0.5 text-sm font-semibold text-accent"
                onClick={() => navigate("/explore?group=beauty")}
              >
                {t("seeAll")}
                <ForwardArrow className="h-4 w-4" />
              </button>
            </div>
            <div className="scroll-rail gap-3 -mx-5 px-5 pb-2 [scroll-padding-inline-start:1.25rem] [scroll-padding-inline-end:1.25rem]">
              {beautyProviders.map((provider) => (
                <div
                  key={provider.id}
                  className="shrink-0 snap-start w-[150px]"
                >
                  <ProviderCardVertical
                    provider={provider}
                    schedule={schedulesByProviderId.get(provider.id)}
                    now={now}
                  />
                </div>
              ))}
            </div>
          </section>
        )}

        {healthProviders.length > 0 && (
          <section className="px-5 mb-14">
            <div className="flex items-center justify-between mb-4">
              <SectionLabel>{t("healthProfessionals")}</SectionLabel>
              <button
                className="flex items-center gap-0.5 text-sm font-semibold text-accent"
                onClick={() => navigate("/explore?group=health")}
              >
                {t("seeAll")}
                <ForwardArrow className="h-4 w-4" />
              </button>
            </div>
            <div className="scroll-rail gap-3 -mx-5 px-5 pb-2 [scroll-padding-inline-start:1.25rem] [scroll-padding-inline-end:1.25rem]">
              {healthProviders.map((provider) => (
                <div
                  key={provider.id}
                  className="shrink-0 snap-start w-[150px]"
                >
                  <ProviderCardVertical
                    provider={provider}
                    schedule={schedulesByProviderId.get(provider.id)}
                    now={now}
                  />
                </div>
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
                <ForwardArrow className="h-4 w-4" />
              </button>
            </div>
            <div className="scroll-rail gap-3 -mx-5 px-5 pb-2 [scroll-padding-inline-start:1.25rem] [scroll-padding-inline-end:1.25rem]">
              {fitnessProviders.map((provider) => (
                <div
                  key={provider.id}
                  className="shrink-0 snap-start w-[150px]"
                >
                  <ProviderCardVertical
                    provider={provider}
                    schedule={schedulesByProviderId.get(provider.id)}
                    now={now}
                  />
                </div>
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
    </div>
  );
};

export default Index;
