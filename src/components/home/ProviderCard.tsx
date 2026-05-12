import { Star, Heart, Loader2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import type { Provider } from "@/lib/mock-data";
import { motion } from "framer-motion";
import { useLang } from "@/contexts/LangContext";
import { useAuth } from "@/contexts/AuthContext";
import { useFavorites } from "@/hooks/useFavorites";
import { categoryNames } from "@/lib/mock-data";

interface ProviderCardProps {
  provider: Provider;
  index?: number;
}

export function ProviderCard({ provider, index = 0 }: ProviderCardProps) {
  const navigate = useNavigate();
  const { lang, t } = useLang();
  const { user } = useAuth();
  const { isFavorite, toggleFavorite } = useFavorites();
  const liked = isFavorite(provider.id);
  const isPending = toggleFavorite.isPending && toggleFavorite.variables === provider.id;

  const handleFavorite = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!user) { navigate("/auth"); return; }
    toggleFavorite.mutate(provider.id);
  };

  return (
    <motion.button
      initial={{ opacity: 0, y: 16, filter: "blur(4px)" }}
      whileInView={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      viewport={{ once: true, amount: 0.2 }}
      transition={{ delay: index * 0.08, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      onClick={() => navigate(`/provider/${provider.id}`)}
      className="glass-card relative flex gap-4 p-3 rounded-2xl hover:shadow-[0_1px_2px_rgba(40,20,10,0.04),0_24px_56px_-22px_rgba(120,70,30,0.28)] transition-shadow text-right w-full active:scale-[0.98]"
    >
      <div className="w-[84px] h-[84px] rounded-2xl shrink-0 bg-gradient-to-br from-accent/30 via-accent/10 to-[hsl(265_45%_88%)] overflow-hidden">
        <img
          src={provider.image}
          alt={provider.name[lang]}
          className="w-full h-full object-cover"
          loading="lazy"
          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
        />
      </div>
      <div className="flex flex-col justify-center gap-1 min-w-0">
        <h3 className="font-semibold text-sm truncate">{provider.name[lang]}</h3>
        <p className="text-xs text-muted-foreground">{categoryNames[provider.category]?.[lang]}</p>
        <div className="flex items-center gap-3 mt-0.5">
          <span className="flex items-center gap-1 text-xs font-medium">
            <Star className="h-3.5 w-3.5 fill-accent text-accent" />
            {provider.rating > 0 ? provider.rating.toFixed(1) : "—"}
            {provider.reviewCount > 0 && (
              <span className="text-muted-foreground">({provider.reviewCount})</span>
            )}
          </span>
        </div>
      </div>

      {user && (
        <button
          onClick={handleFavorite}
          aria-label={liked ? t("removeFromFavorites") : t("addToFavorites")}
          className="absolute top-3 right-3 p-1.5 rounded-full bg-white/70 backdrop-blur-md border border-white/60 shadow-[0_2px_8px_-2px_rgba(120,70,30,0.18)] active:scale-90 transition-transform"
        >
          {isPending ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : (
            <Heart className={`h-4 w-4 transition-colors ${liked ? "fill-accent text-accent" : "text-muted-foreground"}`} />
          )}
        </button>
      )}
    </motion.button>
  );
}
