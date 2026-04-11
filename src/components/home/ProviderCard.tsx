import { Star } from "lucide-react";
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
  const { lang } = useLang();

  return (
    <motion.button
      initial={{ opacity: 0, y: 16, filter: "blur(4px)" }}
      whileInView={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      viewport={{ once: true, amount: 0.2 }}
      transition={{ delay: index * 0.08, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      onClick={() => navigate(`/provider/${provider.id}`)}
      className="flex gap-4 p-3 rounded-2xl bg-card border border-border/60 shadow-sm hover:shadow-md transition-shadow text-right w-full active:scale-[0.98]"
    >
      <div className="w-20 h-20 rounded-xl shrink-0 bg-gradient-to-br from-accent/20 to-accent/5 overflow-hidden">
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
    </motion.button>
  );
}
