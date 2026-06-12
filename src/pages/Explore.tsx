import { useSearchParams } from "react-router-dom";
import { LayoutGrid, Search, SlidersHorizontal } from "lucide-react";
import { categories, categoryNames, beautyCategories, healthCategories, fitnessCategories } from "@/lib/mock-data";
import { categoryIcons } from "@/lib/categoryIcons";
import { CategoryChip } from "@/components/CategoryChip";
import { useAllProviders, useAllProviderSchedules } from "@/hooks/useAllProviders";
import { useFavorites } from "@/hooks/useFavorites";
import { ProviderCardGrid } from "@/components/home/ProviderCardGrid";
import { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { useLang } from "@/contexts/LangContext";

const Explore = () => {
  const [searchParams] = useSearchParams();
  const initialCategory = searchParams.get("category") || "";
  const group = searchParams.get("group") || "";
  const [activeCategory, setActiveCategory] = useState(initialCategory);
  const [query, setQuery] = useState(searchParams.get("q") || "");
  const [debouncedQuery, setDebouncedQuery] = useState(query);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { lang, t } = useLang();
  const { providers } = useAllProviders();
  const { schedulesByProviderId } = useAllProviderSchedules();
  const { favoriteIds } = useFavorites();

  // Live clock for open/closed badges; tick once a minute (same pattern as Home).
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  // Sync activeCategory when URL param changes (e.g. from "See All")
  useEffect(() => {
    setActiveCategory(searchParams.get("category") || "");
  }, [searchParams]);

  // 300ms search debounce
  useEffect(() => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => setDebouncedQuery(query), 300);
    return () => { if (debounceTimer.current) clearTimeout(debounceTimer.current); };
  }, [query]);

  // Determine group filter from URL param
  const groupCategories: string[] | null = group === "beauty"
    ? [...beautyCategories]
    : group === "health"
    ? [...healthCategories]
    : group === "fitness"
    ? [...fitnessCategories]
    : null;

  const PAGE_SIZE = 12;
  const [providerPage, setProviderPage] = useState(0);

  // Reset page when filters change
  useEffect(() => {
    setProviderPage(0);
  }, [debouncedQuery, activeCategory, group]);

  const filtered = providers
    .filter((p) => {
      const matchesGroup = !groupCategories || groupCategories.includes(p.category);
      const matchesCategory = !activeCategory || p.category === activeCategory;
      const matchesQuery =
        !debouncedQuery ||
        p.name[lang].toLowerCase().includes(debouncedQuery.toLowerCase()) ||
        (categoryNames[p.category]?.[lang] || "").toLowerCase().includes(debouncedQuery.toLowerCase());
      return matchesGroup && matchesCategory && matchesQuery;
    })
    .sort((a, b) => {
      const aFav = favoriteIds.includes(a.id) ? 1 : 0;
      const bFav = favoriteIds.includes(b.id) ? 1 : 0;
      return bFav - aFav;
    });

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const pagedProviders = filtered.slice(providerPage * PAGE_SIZE, (providerPage + 1) * PAGE_SIZE);

  return (
    <div
      className="relative min-h-screen overflow-x-clip pb-24"
      style={{ background: "var(--bg-atmosphere)" }}
    >
      {/* Radial accent glows — same atmosphere as Home. Anchored via logical
          insets so they stay on the same side in both LTR and RTL. */}
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
      <header className="px-5 pt-12 pb-4">
        <h1 className="text-xl font-bold mb-4">{t("explore")}</h1>
        <div className="flex items-center gap-2">
          <div className="flex-1 flex items-center gap-3 glass-card rounded-2xl px-4 py-3 transition-shadow focus-within:ring-1 focus-within:ring-accent/30">
            <Search className="h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              placeholder={t("search")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
          <button className="glass-card p-3 rounded-2xl active:scale-95 transition-transform">
            <SlidersHorizontal className="h-4 w-4" />
          </button>
        </div>
      </header>

      {/* Same chip + row behavior as Home's categories row (shared component,
          proximity snap, dir-aware scroll); chips act as filters here. */}
      <div className="flex gap-2 px-5 mb-6 overflow-x-auto pb-1 scrollbar-none [scroll-snap-type:x_proximity] [scroll-padding-inline-start:1.25rem]">
        <CategoryChip
          icon={LayoutGrid}
          label={t("all")}
          selected={!activeCategory}
          onClick={() => setActiveCategory("")}
        />
        {categories.map((cat) => (
          <CategoryChip
            key={cat.id}
            icon={categoryIcons[cat.id]}
            label={categoryNames[cat.id][lang]}
            selected={cat.id === activeCategory}
            onClick={() => setActiveCategory(cat.id === activeCategory ? "" : cat.id)}
          />
        ))}
      </div>

      <section className="px-5">
        <p className="text-xs text-muted-foreground mb-3">
          {filtered.length} {filtered.length !== 1 ? t("providersFound") : t("providerFound")}
        </p>
        {filtered.length > 0 ? (
          <>
            <motion.div
              className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.3 }}
            >
              {pagedProviders.map((p) => (
                <ProviderCardGrid
                  key={p.id}
                  provider={p}
                  schedule={schedulesByProviderId.get(p.id)}
                  now={now}
                />
              ))}
            </motion.div>
            {totalPages > 1 && (
              <div className="flex justify-between items-center pt-4 pb-2">
                <button
                  disabled={providerPage === 0}
                  onClick={() => setProviderPage((p) => Math.max(0, p - 1))}
                  className="text-sm text-accent font-medium disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  ← {t("prev")}
                </button>
                <span className="text-xs text-muted-foreground">
                  {providerPage + 1} / {totalPages}
                </span>
                <button
                  disabled={providerPage >= totalPages - 1}
                  onClick={() => setProviderPage((p) => p + 1)}
                  className="text-sm text-accent font-medium disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  {t("next")} →
                </button>
              </div>
            )}
          </>
        ) : (
          <div className="text-center py-16">
            <p className="text-muted-foreground text-sm">{t("noProvidersFound")}</p>
            <button
              onClick={() => { setActiveCategory(""); setQuery(""); }}
              className="text-accent text-sm font-medium mt-2"
            >
              {t("clearFilters")}
            </button>
          </div>
        )}
      </section>
      </div>
    </div>
  );
};

export default Explore;
