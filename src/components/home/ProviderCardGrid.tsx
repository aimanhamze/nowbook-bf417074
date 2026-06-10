import { useState, useMemo } from "react";
import { Star, Heart, Loader2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import type { Provider } from "@/lib/mock-data";
import { categoryNames } from "@/lib/mock-data";
import { useLang } from "@/contexts/LangContext";
import { useAuth } from "@/contexts/AuthContext";
import { useFavorites } from "@/hooks/useFavorites";
import { getProviderStatus } from "@/lib/providerStatus";
import type { ProviderSchedule } from "@/hooks/useAllProviders";

interface ProviderCardGridProps {
  provider: Provider;
  index?: number;
  schedule?: ProviderSchedule;
  now?: Date;
}

/**
 * Image-forward provider card for the 2-column Explore grid. Shares the same
 * logic primitives as the Home rail card (ProviderCardVertical) — useFavorites,
 * getProviderStatus — but lays out a large cover banner on top with the name,
 * category and "rating (count)" beneath, plus a green "open"/red "closed" pill.
 * Alignment is dir-driven (no hardcoded left/right) so he/ar/en all read right.
 */
export function ProviderCardGrid({
  provider,
  index = 0,
  schedule,
  now,
}: ProviderCardGridProps) {
  const navigate = useNavigate();
  const { lang, t } = useLang();
  const { user } = useAuth();
  const { isFavorite, toggleFavorite } = useFavorites();
  const liked = isFavorite(provider.id);
  const isPending = toggleFavorite.isPending && toggleFavorite.variables === provider.id;

  // Cover banner: coverImage → avatar (provider.image) → gradient placeholder.
  const banner = provider.coverImage || provider.image || "";
  const [imgOk, setImgOk] = useState(!!banner);

  const status = useMemo(() => {
    if (!schedule || !now) return null;
    return getProviderStatus(schedule.availability, schedule.blockedDates, now);
  }, [schedule, now]);

  const handleFavorite = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!user) { navigate("/auth"); return; }
    toggleFavorite.mutate(provider.id);
  };

  const initial = provider.name[lang].trim()[0]?.toUpperCase() ?? "·";

  return (
    <motion.button
      initial={{ opacity: 0, y: 16, filter: "blur(4px)" }}
      whileInView={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      viewport={{ once: true, amount: 0.2 }}
      transition={{ delay: index * 0.06, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      onClick={() => navigate(`/provider/${provider.id}`)}
      className="glass-card relative flex flex-col rounded-2xl overflow-hidden w-full text-start active:scale-[0.98] transition-transform hover:shadow-[0_1px_2px_rgba(40,20,10,0.04),0_24px_56px_-22px_rgba(120,70,30,0.28)]"
    >
      {/* Cover banner */}
      <div className="relative aspect-[4/3] w-full bg-gradient-to-br from-accent/30 via-accent/10 to-[hsl(265_45%_88%)] overflow-hidden">
        {imgOk ? (
          <img
            src={banner}
            alt={provider.name[lang]}
            className="w-full h-full object-cover"
            loading="lazy"
            onError={() => setImgOk(false)}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <span className="text-3xl font-bold text-accent">{initial}</span>
          </div>
        )}

        {/* Open / closed pill (dir-aware: bottom-start corner) */}
        {status?.hasSchedule && (
          <div
            className={`absolute bottom-2 start-2 flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold backdrop-blur-md ${
              status.isOpen ? "bg-green-500/90 text-white" : "bg-red-500/90 text-white"
            }`}
          >
            <span aria-hidden className="block h-1.5 w-1.5 rounded-full bg-white/90" />
            {status.isOpen && status.todayHours
              ? t("openUntil").replace("{time}", status.todayHours.close)
              : t("providerStatusClosed")}
          </div>
        )}

        {/* Favorite heart (dir-aware: top-end corner) */}
        {user && (
          <button
            onClick={handleFavorite}
            aria-label={liked ? t("removeFromFavorites") : t("addToFavorites")}
            className="absolute top-2 end-2 p-1.5 rounded-full bg-white/70 backdrop-blur-md border border-white/60 shadow-[0_2px_8px_-2px_rgba(120,70,30,0.18)] active:scale-90 transition-transform"
          >
            {isPending ? (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            ) : (
              <Heart className={`h-4 w-4 transition-colors ${liked ? "fill-accent text-accent" : "text-muted-foreground"}`} />
            )}
          </button>
        )}
      </div>

      {/* Content */}
      <div className="flex flex-col gap-1 p-3">
        <h3 className="font-semibold text-sm leading-tight line-clamp-1">{provider.name[lang]}</h3>
        <p className="text-xs text-muted-foreground truncate">{categoryNames[provider.category]?.[lang]}</p>
        <div className="flex items-center gap-1 mt-0.5 text-xs font-medium">
          <Star className="h-3.5 w-3.5 fill-accent text-accent shrink-0" />
          <span>{provider.rating > 0 ? provider.rating.toFixed(1) : "—"}</span>
          {provider.reviewCount > 0 && (
            <span className="text-muted-foreground">({provider.reviewCount})</span>
          )}
        </div>
      </div>
    </motion.button>
  );
}
