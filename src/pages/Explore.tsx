import { useSearchParams } from "react-router-dom";
import { Search, SlidersHorizontal } from "lucide-react";
import { categories, categoryNames, beautyCategories, healthCategories, fitnessCategories } from "@/lib/mock-data";
import { useAllProviders } from "@/hooks/useAllProviders";
import { useFavorites } from "@/hooks/useFavorites";
import { ProviderCard } from "@/components/home/ProviderCard";
import { cn } from "@/lib/utils";
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
  const { favoriteIds } = useFavorites();

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
    <div className="min-h-screen pb-24">
      <header className="px-5 pt-12 pb-4">
        <h1 className="text-xl font-bold mb-4">{t("explore")}</h1>
        <div className="flex items-center gap-2">
          <div className="flex-1 flex items-center gap-3 rounded-xl border border-border bg-card px-3 py-2.5">
            <Search className="h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              placeholder={t("search")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
          <button className="p-2.5 rounded-xl border border-border bg-card">
            <SlidersHorizontal className="h-4 w-4" />
          </button>
        </div>
      </header>

      <div className="flex gap-2 px-5 mb-6 overflow-x-auto pb-1 scrollbar-none">
        <button
          onClick={() => setActiveCategory("")}
          className={cn(
            "px-4 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors",
            !activeCategory
              ? "bg-primary text-primary-foreground"
              : "bg-secondary text-secondary-foreground"
          )}
        >
          {t("all")}
        </button>
        {categories.map((cat) => (
          <button
            key={cat.id}
            onClick={() => setActiveCategory(cat.id === activeCategory ? "" : cat.id)}
            className={cn(
              "px-4 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors",
              cat.id === activeCategory
                ? "bg-primary text-primary-foreground"
                : "bg-secondary text-secondary-foreground"
            )}
          >
            {cat.icon} {categoryNames[cat.id][lang]}
          </button>
        ))}
      </div>

      <section className="px-5">
        <p className="text-xs text-muted-foreground mb-3">
          {filtered.length} {filtered.length !== 1 ? t("providersFound") : t("providerFound")}
        </p>
        {filtered.length > 0 ? (
          <>
            <motion.div
              className="flex flex-col gap-3"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.3 }}
            >
              {pagedProviders.map((p, i) => (
                <ProviderCard key={p.id} provider={p} index={i} />
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
  );
};

export default Explore;
