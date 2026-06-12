import { useState, useMemo } from "react";
import { Star, Heart, Loader2, Sparkles, MapPin } from "lucide-react";
import { useNavigate } from "react-router-dom";
import type { Provider } from "@/lib/mock-data";
import { categoryNames } from "@/lib/mock-data";
import { useLang } from "@/contexts/LangContext";
import { useAuth } from "@/contexts/AuthContext";
import { useFavorites } from "@/hooks/useFavorites";
import { getProviderStatus } from "@/lib/providerStatus";
import type { ProviderSchedule } from "@/hooks/useAllProviders";

interface ProviderCardGridProps {
  provider: Provider;
  schedule?: ProviderSchedule;
  now?: Date;
}

/**
 * THE provider card — used identically on the Home rails and the Explore grid.
 * Fixed-height cover (no layout shift, equal card heights in every row), name
 * NEVER overlaid on the image, one meta row (rating+count OR a "new" badge),
 * a city row (pin + short location), and a soft status pill on the image's
 * bottom-end corner (soft green "open" / muted red "closed"). All corner
 * positioning is dir-aware (start/end).
 */
export function ProviderCardGrid({ provider, schedule, now }: ProviderCardGridProps) {
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

  // City short-form: most providers store just the city in `address`; for full
  // addresses the city is conventionally the last comma-separated segment.
  const fullAddress = (provider.address?.[lang] ?? "").trim();
  const city = fullAddress
    ? fullAddress.split(",").pop()!.trim().replace(/\.+$/, "").trim() || null
    : null;

  return (
    <button
      onClick={() => navigate(`/provider/${provider.id}`)}
      className="surface-soft relative flex w-full flex-col overflow-hidden rounded-2xl text-start transition-transform active:scale-[0.98]"
    >
      {/* Fixed-height cover — equal card heights, zero layout shift */}
      <div className="relative h-[104px] w-full shrink-0 overflow-hidden bg-gradient-to-br from-accent/30 via-accent/10 to-[hsl(265_45%_88%)]">
        {imgOk ? (
          <img
            src={banner}
            alt={provider.name[lang]}
            className="h-full w-full object-cover"
            loading="lazy"
            onError={() => setImgOk(false)}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <span className="text-2xl font-bold text-accent">{initial}</span>
          </div>
        )}

        {/* Status pill (dir-aware: bottom-end corner). Soft solid backgrounds —
            readable on any image; closed is a muted red, not alarm red. */}
        {status?.hasSchedule && (
          <span
            className={`absolute bottom-2 end-2 rounded-full px-2 py-[3px] text-[11px] font-semibold leading-none ${
              status.isOpen ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
            }`}
          >
            {status.isOpen ? t("providerStatusOpen") : t("providerStatusClosed")}
          </span>
        )}

        {/* Favorite heart (~28px, dir-aware: top-end corner) */}
        {user && (
          <button
            onClick={handleFavorite}
            aria-label={liked ? t("removeFromFavorites") : t("addToFavorites")}
            className="absolute top-2 end-2 rounded-full border border-white/60 bg-white/80 p-1.5 shadow-[0_2px_8px_-2px_rgba(120,70,30,0.18)] backdrop-blur-md transition-transform active:scale-90"
          >
            {isPending ? (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            ) : (
              <Heart className={`h-4 w-4 transition-colors ${liked ? "fill-accent text-accent" : "text-muted-foreground"}`} />
            )}
          </button>
        )}
      </div>

      {/* Body — every row has a fixed height so all cards in a row line up */}
      <div className="flex w-full flex-col p-3">
        <h3 className="truncate text-sm font-semibold leading-tight text-foreground">
          {provider.name[lang]}
        </h3>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {categoryNames[provider.category]?.[lang]}
        </p>

        {/* Meta row: rating + count, or the "new" badge — never both */}
        <div className="mt-1.5 flex h-5 items-center">
          {provider.rating > 0 ? (
            <span className="flex items-center gap-1 text-xs font-medium">
              <Star className="h-3.5 w-3.5 shrink-0 fill-accent text-accent" />
              {provider.rating.toFixed(1)}
              {provider.reviewCount > 0 && (
                <span className="font-normal text-muted-foreground">({provider.reviewCount})</span>
              )}
            </span>
          ) : (
            <span className="flex items-center gap-1 rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-semibold text-accent">
              <Sparkles className="h-3 w-3" />
              {t("ratingNew")}
            </span>
          )}
        </div>

        {/* Location row: pin + city. The fixed-height container always renders
            so every card in a row stays equal height; the icon+text only
            appear when a location exists. */}
        <div className="mt-1 flex h-4 items-center gap-1 text-[11px] text-muted-foreground">
          {city && (
            <>
              <MapPin className="h-3 w-3 shrink-0" />
              <span className="truncate">{city}</span>
            </>
          )}
        </div>
      </div>
    </button>
  );
}
