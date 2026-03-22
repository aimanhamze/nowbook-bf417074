import { SearchBar } from "@/components/home/SearchBar";
import { CategoryRow } from "@/components/home/CategoryRow";
import { ProviderCard } from "@/components/home/ProviderCard";
import { providers } from "@/lib/mock-data";
import { motion } from "framer-motion";

const Index = () => {
  return (
    <div className="min-h-screen pb-24">
      {/* Header */}
      <header className="px-5 pt-12 pb-6">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        >
          <p className="text-sm text-muted-foreground mb-1">Good morning ☀️</p>
          <h1 className="text-2xl font-bold leading-tight">
            Find your next<br />
            <span className="text-accent">appointment</span>
          </h1>
        </motion.div>
      </header>

      {/* Search */}
      <div className="px-5 mb-6">
        <SearchBar />
      </div>

      {/* Categories */}
      <section className="px-5 mb-8">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
          Browse by category
        </h2>
        <CategoryRow />
      </section>

      {/* Featured Providers */}
      <section className="px-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold">Popular nearby</h2>
          <button className="text-xs text-accent font-semibold">See all</button>
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
