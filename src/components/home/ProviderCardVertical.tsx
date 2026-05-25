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

interface ProviderCardVerticalProps {
  provider: Provider;
  index?: number;
  schedule?: ProviderSchedule;
  now?: Date;
}

export function ProviderCardVertical({
  provider,
  index = 0,
  schedule,
  now,
}: ProviderCardVerticalProps) {
  const navigate = useNavigate();
  const { lang, t } = useLang();
  const { user } = useAuth();
  const { isFavorite, toggleFavorite } = useFavorites();
  const liked = isFavorite(provider.id);
  const isPending = toggleFavorite.isPending && toggleFavorite.variables === provider.id;

  const [imgOk, setImgOk] = useState(true);

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
      transition={{ delay: index * 0.08, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      onClick={() => navigate(`/provider/${provider.id}`)}
      className="glass-card relative flex flex-col items-center p-4 rounded-2xl w-full active:scale-[0.98] transition-transform"
    >
      <div className="w-[64px] h-[64px] rounded-full ring-2 ring-accent/30 ring-offset-2 ring-offset-white/40 overflow-hidden bg-accent/15 flex items-center justify-center mb-3 shrink-0">
        {imgOk ? (
          <img
            src={provider.image}
            alt={provider.name[lang]}
            className="w-full h-full object-cover"
            loading="lazy"
            onError={() => setImgOk(false)}
          />
        ) : (
          <span className="text-xl font-bold text-accent">{initial}</span>
        )}
      </div>

      <div className="min-h-[2.5rem] flex items-center justify-center w-full">
        <h3 className="text-base font-bold text-foreground text-center leading-tight line-clamp-2 w-full">
          {provider.name[lang]}
        </h3>
      </div>
      <p className="text-xs text-muted-foreground text-center truncate w-full mt-0.5">
        {categoryNames[provider.category]?.[lang]}
      </p>

      <div className="flex items-center gap-1 mt-2 text-xs font-medium">
        <Star className="h-3.5 w-3.5 fill-accent text-accent" />
        <span>{provider.rating > 0 ? provider.rating.toFixed(1) : "—"}</span>
      </div>

      {status?.hasSchedule && (
        <>
          <div className="w-full border-t border-border/40 mt-3" />
          <div className="flex items-center gap-1.5 text-xs mt-2.5">
            <span
              aria-hidden
              className={`block h-1.5 w-1.5 rounded-full ${status.isOpen ? "bg-green-500" : "bg-red-500"}`}
            />
            <span className={`font-medium ${status.isOpen ? "text-green-700" : "text-red-700"}`}>
              {status.isOpen && status.todayHours
                ? t("openUntil").replace("{time}", status.todayHours.close)
                : t("providerStatusClosed")}
            </span>
          </div>
        </>
      )}

      {user && (
        <button
          onClick={handleFavorite}
          aria-label={liked ? t("removeFromFavorites") : t("addToFavorites")}
          className="absolute top-2.5 right-2.5 p-1.5 rounded-full bg-white/70 backdrop-blur-md border border-white/60 shadow-[0_2px_8px_-2px_rgba(120,70,30,0.18)] active:scale-90 transition-transform"
        >
          {isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
          ) : (
            <Heart className={`h-3.5 w-3.5 transition-colors ${liked ? "fill-accent text-accent" : "text-muted-foreground"}`} />
          )}
        </button>
      )}
    </motion.button>
  );
}
