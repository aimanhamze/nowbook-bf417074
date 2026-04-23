import { useParams, useNavigate } from "react-router-dom";
import { categoryNames } from "@/lib/mock-data";
import { useProviderById } from "@/hooks/useAllProviders";
import { useProviderReviews } from "@/hooks/useReviews";
import { useFavorites } from "@/hooks/useFavorites";
import { usePublicProviderPhotos } from "@/hooks/useProviderPhotos";
import { Heart, Star, MapPin, Clock, Share2, Globe, X, ChevronLeft, ChevronRight } from "lucide-react";
import { BackArrow } from "@/components/ui/directional-icon";
import { FaWhatsapp, FaInstagram, FaTiktok, FaFacebook, FaWaze } from "react-icons/fa6";
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
  frameClass: string;
}

const PLATFORM_PALETTE = {
  whatsapp:  { frameClass: "bg-[#25D366]/15" },
  instagram: { frameClass: "bg-[#E4405F]/15" },
  facebook:  { frameClass: "bg-[#1877F2]/15" },
  tiktok:    { frameClass: "bg-foreground/10" },
  waze:      { frameClass: "bg-[#05C3DE]/15" },
  website:   { frameClass: "bg-foreground/10" },
};

function SocialLinksRow({ socialLinks }: { socialLinks: SocialLinks | null | undefined }) {
  const { t } = useLang();

  const entries: SocialLinkEntry[] = [];

  if (socialLinks?.whatsapp) {
    entries.push({
      href: buildWhatsAppLink(socialLinks.whatsapp),
      icon: <FaWhatsapp className="h-6 w-6" style={{ color: "#25D366" }} />,
      label: t("socialLinksWhatsapp"),
      frameClass: PLATFORM_PALETTE.whatsapp.frameClass,
    });
  }
  if (socialLinks?.instagram) {
    entries.push({
      href: socialLinks.instagram,
      icon: <FaInstagram className="h-6 w-6" style={{ color: "#E4405F" }} />,
      label: t("socialLinksInstagram"),
      frameClass: PLATFORM_PALETTE.instagram.frameClass,
    });
  }
  if (socialLinks?.tiktok) {
    entries.push({
      href: socialLinks.tiktok,
      icon: <FaTiktok className="h-6 w-6" />,
      label: t("socialLinksTiktok"),
      frameClass: PLATFORM_PALETTE.tiktok.frameClass,
    });
  }
  if (socialLinks?.facebook) {
    entries.push({
      href: socialLinks.facebook,
      icon: <FaFacebook className="h-6 w-6" style={{ color: "#1877F2" }} />,
      label: t("socialLinksFacebook"),
      frameClass: PLATFORM_PALETTE.facebook.frameClass,
    });
  }
  if (socialLinks?.waze) {
    entries.push({
      href: socialLinks.waze,
      icon: <FaWaze className="h-6 w-6" style={{ color: "#05C3DE" }} />,
      label: t("socialLinksWaze"),
      frameClass: PLATFORM_PALETTE.waze.frameClass,
    });
  }
  if (socialLinks?.website) {
    entries.push({
      href: socialLinks.website,
      icon: <Globe className="h-6 w-6" />,
      label: t("socialLinksWebsite"),
      frameClass: PLATFORM_PALETTE.website.frameClass,
    });
  }

  if (entries.length === 0) return null;

  return (
    <div className="flex gap-3 mt-3 flex-wrap justify-center">
      {entries.map(entry => (
        <a
          key={entry.label}
          href={entry.href}
          aria-label={entry.label}
          target="_blank"
          rel="noopener noreferrer"
          className={`flex items-center justify-center h-12 w-12 rounded-2xl ${entry.frameClass} active:scale-95 hover:brightness-110 transition-all`}
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
        <div className="bg-card rounded-2xl border border-border p-5 shadow-sm text-center">
          <h1 className="text-xl font-bold mb-1">{provider.name[lang]}</h1>
          <div className="flex items-center justify-center gap-3 text-sm text-muted-foreground mb-3">
            {reviewCount > 0 && (
              <span className="flex items-center gap-1">
                <Star className="h-4 w-4 fill-accent text-accent" />
                <span className="font-medium text-foreground">{avgRating.toFixed(1)}</span>
                ({reviewCount})
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground flex items-center justify-center gap-1.5">
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
