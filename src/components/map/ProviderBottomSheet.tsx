import { useNavigate } from "react-router-dom";
import { MapPin, Star } from "lucide-react";
import { Drawer, DrawerContent } from "@/components/ui/drawer";
import { useLang } from "@/contexts/LangContext";
import { haversineKm, formatDistance, getInitials } from "@/lib/geo";
import type { ProviderLocation } from "@/hooks/useProviderLocations";
import type { TranslationKey } from "@/lib/translations";

const KNOWN_CATEGORIES = new Set([
  "barber", "salon", "nails", "brows", "spa", "skincare", "makeup",
]);

interface ProviderBottomSheetProps {
  provider: ProviderLocation | null;
  open: boolean;
  onClose: () => void;
  userPosition: GeolocationCoordinates | null;
}

// Circular avatar: initials on primary background, avatar image layered on top.
// If the image loads it covers the initials; if it fails (onerror) the initials show through.
function AvatarCircle({ provider, size }: { provider: ProviderLocation; size: number }) {
  const initials = getInitials(provider.business_name);
  return (
    <div
      style={{ width: size, height: size }}
      className="relative rounded-full bg-[hsl(220,15%,13%)] flex items-center justify-center shrink-0 border-2 border-accent overflow-hidden"
      aria-label={provider.business_name}
    >
      <span
        className="relative z-0 text-white font-semibold select-none pointer-events-none"
        style={{ fontSize: Math.round(size * 0.33) }}
      >
        {initials}
      </span>
      {provider.avatar_image && (
        <img
          src={provider.avatar_image}
          alt=""
          loading="lazy"
          className="absolute inset-0 w-full h-full object-cover rounded-full z-10"
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = "none";
          }}
        />
      )}
    </div>
  );
}

export function ProviderBottomSheet({
  provider,
  open,
  onClose,
  userPosition,
}: ProviderBottomSheetProps) {
  const navigate = useNavigate();
  const { t, isRtl } = useLang();

  const distanceKm =
    userPosition !== null && provider !== null
      ? haversineKm(
          userPosition.latitude,
          userPosition.longitude,
          provider.latitude,
          provider.longitude,
        )
      : null;

  const formattedDist =
    distanceKm !== null
      ? t("kmAway").replace("{distance}", formatDistance(distanceKm))
      : null;

  const categoryLabel =
    provider && KNOWN_CATEGORIES.has(provider.category)
      ? t(provider.category as TranslationKey)
      : provider?.category ?? "";

  return (
    // shouldScaleBackground=false: prevents Vaul from scaling the map behind the sheet
    <Drawer open={open} onOpenChange={(o) => { if (!o) onClose(); }} shouldScaleBackground={false}>
      <DrawerContent className="max-h-[55vh] focus:outline-none">
        {provider && (
          <div className="overflow-y-auto">
            <div
              className="px-5 pt-4 pb-8 space-y-3"
              dir={isRtl ? "rtl" : "ltr"}
            >
              {/* Avatar */}
              <div className="flex justify-center pt-1">
                <AvatarCircle provider={provider} size={64} />
              </div>

              {/* Name */}
              <p className="text-base font-semibold text-center leading-tight">
                {provider.business_name}
              </p>

              {/* Category */}
              <p className="text-sm text-muted-foreground text-center">
                {categoryLabel}
              </p>

              {/* Rating */}
              {provider.average_rating !== null && provider.average_rating > 0 && (
                <div className="flex items-center justify-center gap-1">
                  <Star className="h-3.5 w-3.5 fill-accent text-accent" />
                  <span className="text-sm font-medium">
                    {provider.average_rating.toFixed(1)}
                  </span>
                </div>
              )}

              {/* Distance — entire string forced LTR to prevent digit reversal in RTL */}
              {formattedDist !== null && (
                <p className="text-sm text-muted-foreground text-center">
                  <span dir="ltr">{formattedDist}</span>
                </p>
              )}

              {/* Address */}
              {provider.address && (
                <div className="flex items-start gap-1.5 justify-center">
                  <MapPin className="h-3.5 w-3.5 text-muted-foreground mt-0.5 shrink-0" />
                  <p className="text-sm text-muted-foreground leading-snug">
                    {provider.address}
                  </p>
                </div>
              )}

              {/* View profile */}
              <button
                className="w-full bg-accent text-accent-foreground font-semibold text-sm rounded-xl py-3 active:opacity-80 transition-opacity"
                onClick={() => navigate(`/provider/${provider.id}`)}
              >
                {t("viewProfile")}
              </button>
            </div>
          </div>
        )}
      </DrawerContent>
    </Drawer>
  );
}
