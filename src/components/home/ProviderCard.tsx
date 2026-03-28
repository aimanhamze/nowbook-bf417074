import { Star, Clock } from "lucide-react";
import { useNavigate } from "react-router-dom";
import type { Provider } from "@/lib/mock-data";
import { motion } from "framer-motion";
import { useLang } from "@/contexts/LangContext";
import { categoryNames } from "@/lib/mock-data";

interface ProviderCardProps {
  provider: Provider;
  index?: number;
}

export function ProviderCard({ provider, index = 0 }: ProviderCardProps) {
  const navigate = useNavigate();
  const { lang, t } = useLang();

  const minPrice = provider.services.length
    ? Math.min(...provider.services.map((s) => s.price))
    : null;

  return (
    <motion.button
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.15 }}
      transition={{ delay: index * 0.05, duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      onClick={() => navigate(`/provider/${provider.id}`)}
      className="flex flex-col rounded-2xl bg-card overflow-hidden shadow-sm hover:shadow-lg transition-shadow text-right w-full active:scale-[0.98] group"
    >
      {/* Image */}
      <div className="relative w-full aspect-[16/10] bg-muted overflow-hidden">
        <img
          src={provider.image}
          alt={provider.name[lang]}
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
          loading="lazy"
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = "none";
          }}
        />
        {/* Category badge */}
        <span className="absolute top-2.5 right-2.5 px-2.5 py-1 rounded-lg bg-card/90 backdrop-blur-sm text-[11px] font-semibold text-foreground shadow-sm">
          {categoryNames[provider.category]?.[lang]}
        </span>
        {/* Distance badge */}
        {provider.distance && provider.distance !== "—" && (
          <span className="absolute bottom-2.5 left-2.5 px-2 py-0.5 rounded-md bg-foreground/70 text-[11px] font-medium text-primary-foreground">
            {provider.distance} {t("km")}
          </span>
        )}
      </div>

      {/* Info */}
      <div className="p-3 flex flex-col gap-1">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-bold text-sm truncate">{provider.name[lang]}</h3>
          {provider.rating > 0 && (
            <span className="flex items-center gap-1 shrink-0 text-xs font-semibold bg-accent/10 text-accent px-1.5 py-0.5 rounded-md">
              <Star className="h-3 w-3 fill-accent text-accent" />
              {provider.rating}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          {provider.services.length > 0 && (
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {provider.services[0].duration}+ {t("min")}
            </span>
          )}
          {minPrice !== null && (
            <span>
              {lang === "he" ? "החל מ-" : "From "}₪{minPrice}
            </span>
          )}
        </div>
      </div>
    </motion.button>
  );
}
