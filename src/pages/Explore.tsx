import { useSearchParams } from "react-router-dom";
import { Search, SlidersHorizontal } from "lucide-react";
import { providers, categories } from "@/lib/mock-data";
import { ProviderCard } from "@/components/home/ProviderCard";
import { cn } from "@/lib/utils";
import { useState } from "react";
import { motion } from "framer-motion";

const Explore = () => {
  const [searchParams] = useSearchParams();
  const initialCategory = searchParams.get("category") || "";
  const [activeCategory, setActiveCategory] = useState(initialCategory);
  const [query, setQuery] = useState(searchParams.get("q") || "");

  const filtered = providers.filter((p) => {
    const matchesCategory = !activeCategory || p.category === activeCategory;
    const matchesQuery =
      !query ||
      p.name.toLowerCase().includes(query.toLowerCase()) ||
      p.category.toLowerCase().includes(query.toLowerCase());
    return matchesCategory && matchesQuery;
  });

  return (
    <div className="min-h-screen pb-24">
      <header className="px-5 pt-12 pb-4">
        <h1 className="text-xl font-bold mb-4">Explore</h1>
        <div className="flex items-center gap-2">
          <div className="flex-1 flex items-center gap-3 rounded-xl border border-border bg-card px-3 py-2.5">
            <Search className="h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search..."
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

      {/* Category filters */}
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
          All
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
            {cat.icon} {cat.name}
          </button>
        ))}
      </div>

      {/* Results */}
      <section className="px-5">
        <p className="text-xs text-muted-foreground mb-3">
          {filtered.length} provider{filtered.length !== 1 ? "s" : ""} found
        </p>
        {filtered.length > 0 ? (
          <motion.div
            className="flex flex-col gap-3"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3 }}
          >
            {filtered.map((p, i) => (
              <ProviderCard key={p.id} provider={p} index={i} />
            ))}
          </motion.div>
        ) : (
          <div className="text-center py-16">
            <p className="text-muted-foreground text-sm">No providers found</p>
            <button
              onClick={() => {
                setActiveCategory("");
                setQuery("");
              }}
              className="text-accent text-sm font-medium mt-2"
            >
              Clear filters
            </button>
          </div>
        )}
      </section>
    </div>
  );
};

export default Explore;
