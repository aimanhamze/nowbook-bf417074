import { useParams, useNavigate } from "react-router-dom";
import { categoryNames } from "@/lib/mock-data";
import { useProviderById } from "@/hooks/useAllProviders";
import { useProviderReviews } from "@/hooks/useReviews";
import { useFavorites } from "@/hooks/useFavorites";
import { usePublicProviderPhotos } from "@/hooks/useProviderPhotos";
import { Heart, Star, MapPin, Clock, Share2, Navigation, Globe, X, ChevronLeft, ChevronRight } from "lucide-react";
import { BackArrow } from "@/components/ui/directional-icon";
import { WhatsAppIcon, TikTokIcon } from "@/components/icons/SocialIcons";
import { motion, AnimatePresence } from "framer-motion";
import { useEffect, useState } from "react";
import { useLang } from "@/contexts/LangContext";
import { useAuth } from "@/contexts/AuthContext";
import ReviewCard from "@/components/reviews/ReviewCard";
import type { SocialLinks } from "@/lib/socialLinks";
import { buildWhatsAppLink } from "@/lib/socialLinks";

interface SocialLinkEntry {
  href: string;
  icon: React.ReactNode;
  label: string;
  external: boolean;
}

function SocialLinksRow({ socialLinks }: { socialLinks: SocialLinks | null | undefined }) {
  const { t } = useLang();

  const entries: SocialLinkEntry[] = [];

  if (socialLinks?.whatsapp) {
    entries.push({
      href: buildWhatsAppLink(socialLinks.whatsapp),
      icon: <WhatsAppIcon className="h-5 w-5" />,
      label: t("socialLinksWhatsapp"),
      external: true,
    });
  }
  if (socialLinks?.instagram) {
    entries.push({
      href: socialLinks.instagram,
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden="true">
          <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
          <circle cx="12" cy="12" r="4" />
          <circle cx="17.5" cy="6.5" r="0.5" fill="currentColor" stroke="none" />
        </svg>
      ),
      label: t("socialLinksInstagram"),
      external: true,
    });
  }
  if (socialLinks?.tiktok) {
    entries.push({
      href: socialLinks.tiktok,
      icon: <TikTokIcon className="h-5 w-5" />,
      label: t("socialLinksTiktok"),
      external: true,
    });
  }
  if (socialLinks?.facebook) {
    entries.push({
      href: socialLinks.facebook,
      icon: (
        <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5" aria-hidden="true">
          <path d="M24 12.073C24 5.404 18.627 0 12 0S0 5.404 0 12.073C0 18.1 4.388 23.094 10.125 24v-8.437H7.078v-3.49h3.047V9.41c0-3.025 1.792-4.697 4.533-4.697 1.313 0 2.686.236 2.686.236v2.97h-1.513c-1.491 0-1.956.93-1.956 1.886v2.268h3.328l-.532 3.49h-2.796V24C19.612 23.094 24 18.1 24 12.073z" />
        </svg>
      ),
      label: t("socialLinksFacebook"),
      external: true,
    });
  }
  if (socialLinks?.waze) {
    entries.push({
      href: socialLinks.waze,
      icon: <Navigation className="h-5 w-5" />,
      label: t("socialLinksWaze"),
      external: true,
    });
  }
  if (socialLinks?.website) {
    entries.push({
      href: socialLinks.website,
      icon: <Globe className="h-5 w-5" />,
      label: t("socialLinksWebsite"),
      external: true,
    });
  }

  if (entries.length === 0) return null;

  return (
    <div className="flex gap-2 mt-3 flex-wrap">
      {entries.map(entry => (
        <a
          key={entry.label}
          href={entry.href}
          aria-label={entry.label}
          target={entry.external ? "_blank" : undefined}
          rel={entry.external ? "noopener noreferrer" : undefined}
          className="p-2 rounded-full bg-secondary/60 active:scale-95 transition-transform"
        >
          {entry.icon}
        </a>
      ))}
    </div>
  );
}

const ProviderDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [coverImgSrc, setCoverImgSrc] = useState("");
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const { lang, t } = useLang();
  const { user } = useAuth();
  const { provider, isLoading } = useProviderById(id);
  const { data: dbReviews } = useProviderReviews(id);
  const { isFavorite, toggleFavorite } = useFavorites();
  const { data: photos = [] } = usePublicProviderPhotos(id);
  const liked = id ? isFavorite(id) : false;

  const reviewCount = dbReviews?.length || 0;
  const avgRating = dbReviews && dbReviews.length > 0
    ? dbReviews.reduce((sum, r) => sum + r.rating, 0) / reviewCount
    : 0;

  useEffect(() => {
    const primary = provider?.coverImage?.trim() || "";
    const fallback = provider?.image?.trim() || "";
    setCoverImgSrc(primary || fallback);
  }, [provider?.id, provider?.coverImage, provider?.image]);

  const handleCoverImageError = () => {
    const primary = provider?.coverImage?.trim() || "";
    const fallback = provider?.image?.trim() || "";

    if (coverImgSrc === primary && fallback && fallback !== primary) {
      setCoverImgSrc(fallback);
      return;
    }

    setCoverImgSrc("");
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 rounded-full border-2 border-accent border-t-transparent animate-spin" />
      </div>
    );
  }

  if (!provider) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-muted-foreground">{t("providerNotFound")}</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-36">
      {/* Cover */}
      <div className="relative h-56 bg-gradient-to-br from-accent/20 to-accent/5">
        {coverImgSrc ? (
          <img
            src={coverImgSrc}
            alt={provider.name[lang]}
            className="w-full h-full object-cover"
            onError={handleCoverImageError}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <span className="text-5xl font-bold text-accent/30">{provider.name[lang]?.charAt(0)?.toUpperCase()}</span>
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent" />
        <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-4 pt-10">
          <button onClick={() => navigate(-1)} className="p-2 rounded-full bg-card/80 backdrop-blur-sm active:scale-95">
            <BackArrow variant="arrow" className="h-5 w-5" />
          </button>
          <div className="flex gap-2">
            <button className="p-2 rounded-full bg-card/80 backdrop-blur-sm active:scale-95">
              <Share2 className="h-5 w-5" />
            </button>
            <button onClick={() => { if (user && id) toggleFavorite.mutate(id); else if (!user) navigate("/auth"); }} className="p-2 rounded-full bg-card/80 backdrop-blur-sm active:scale-95">
              <Heart className={`h-5 w-5 transition-colors ${liked ? "fill-accent text-accent" : ""}`} />
            </button>
          </div>
        </div>
      </div>

      {/* Info */}
      <motion.div className="px-5 -mt-6 relative" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}>
        <div className="bg-card rounded-2xl border border-border p-5 shadow-sm">
          <h1 className="text-xl font-bold mb-1">{provider.name[lang]}</h1>
          <div className="flex items-center gap-3 text-sm text-muted-foreground mb-3">
            {reviewCount > 0 && (
              <span className="flex items-center gap-1">
                <Star className="h-4 w-4 fill-accent text-accent" />
                <span className="font-medium text-foreground">{avgRating.toFixed(1)}</span>
                ({reviewCount})
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground flex items-center gap-1.5">
            <MapPin className="h-3 w-3 shrink-0" />
            {provider.address[lang]}
          </p>
          <SocialLinksRow socialLinks={provider.socialLinks} />
        </div>
      </motion.div>

      {/* About */}
      {provider.about[lang] && (
        <section className="px-5 mt-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-2">{t("about")}</h2>
          <p className="text-sm leading-relaxed">{provider.about[lang]}</p>
        </section>
      )}

      {/* Photo Gallery */}
      {photos.length > 0 && (
        <section className="mt-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-3 px-5">{t("ourWork")}</h2>
          <div className="flex gap-2 overflow-x-auto px-5 pb-2 scrollbar-hide">
            {photos.map((photo, i) => (
              <motion.button
                key={photo.id}
                initial={{ opacity: 0, scale: 0.95 }}
                whileInView={{ opacity: 1, scale: 1 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.04, duration: 0.3 }}
                onClick={() => setLightboxIndex(i)}
                className="flex-shrink-0 w-28 h-28 rounded-xl overflow-hidden bg-secondary active:scale-95 transition-transform"
              >
                <img src={photo.url} alt={photo.caption ?? ""} className="w-full h-full object-cover" />
              </motion.button>
            ))}
          </div>
        </section>
      )}

      {/* Lightbox */}
      <AnimatePresence>
        {lightboxIndex !== null && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/95 flex items-center justify-center"
            onClick={() => setLightboxIndex(null)}
          >
            <button
              className="absolute top-4 right-4 p-2 rounded-full bg-white/10 text-white z-10"
              onClick={() => setLightboxIndex(null)}
            >
              <X className="h-5 w-5" />
            </button>
            {lightboxIndex > 0 && (
              <button
                className="absolute left-3 p-2 rounded-full bg-white/10 text-white z-10"
                onClick={e => { e.stopPropagation(); setLightboxIndex(lightboxIndex - 1); }}
              >
                <ChevronLeft className="h-6 w-6" />
              </button>
            )}
            {lightboxIndex < photos.length - 1 && (
              <button
                className="absolute right-3 p-2 rounded-full bg-white/10 text-white z-10"
                onClick={e => { e.stopPropagation(); setLightboxIndex(lightboxIndex + 1); }}
              >
                <ChevronRight className="h-6 w-6" />
              </button>
            )}
            <motion.div
              key={lightboxIndex}
              initial={{ opacity: 0, scale: 0.92 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.2 }}
              className="max-w-full max-h-full px-12"
              onClick={e => e.stopPropagation()}
            >
              <img
                src={photos[lightboxIndex].url}
                alt={photos[lightboxIndex].caption ?? ""}
                className="max-w-[90vw] max-h-[80vh] rounded-xl object-contain"
              />
              {photos[lightboxIndex].caption && (
                <p className="text-white/80 text-sm text-center mt-3">{photos[lightboxIndex].caption}</p>
              )}
            </motion.div>
            <p className="absolute bottom-6 text-white/50 text-xs">
              {lightboxIndex + 1} / {photos.length}
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Services */}
      {provider.services.length > 0 && (
        <section className="px-5 mt-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-3">{t("services")}</h2>
          <div className="flex flex-col gap-2">
            {provider.services.map((service, i) => (
              <motion.div key={service.id} initial={{ opacity: 0, x: 12 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.06, duration: 0.4, ease: [0.16, 1, 0.3, 1] }} className="flex items-center justify-between p-4 rounded-xl bg-secondary/60">
                <div>
                  <p className="text-sm font-medium">{service.name[lang]}</p>
                  <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                    <Clock className="h-3 w-3" />
                    {service.duration} {t("min")}
                  </p>
                </div>
                <div className="text-left">
                  <p className="text-sm font-bold">₪{service.price}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </section>
      )}

      {/* Reviews */}
      {dbReviews && dbReviews.length > 0 && (
        <section className="px-5 mt-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-3">{t("reviews")}</h2>
          <div className="flex flex-col gap-3">
            {dbReviews.map((review, i) => (
              <ReviewCard key={review.id} review={review} index={i} />
            ))}
          </div>
        </section>
      )}

      {/* Sticky Book Button */}
      <div className="fixed bottom-0 left-0 right-0 z-50 border-t border-border bg-card/90 p-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] backdrop-blur-xl shadow-lg">
        <button
          onClick={() => navigate(`/provider/${provider.id}/book`)}
          className="w-full py-3.5 rounded-2xl bg-accent text-accent-foreground font-semibold text-sm active:scale-[0.98] transition-transform"
        >
          {t("bookAppointment")}
        </button>
      </div>
    </div>
  );
};

export default ProviderDetail;
