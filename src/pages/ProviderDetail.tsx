import { useParams, useNavigate } from "react-router-dom";
import { categoryNames } from "@/lib/mock-data";
import { useProviderById, usePublicProviderSchedule } from "@/hooks/useAllProviders";
import { getProviderStatus, type ProviderStatus } from "@/lib/providerStatus";
import WeeklyHoursTable from "@/components/provider-detail/WeeklyHoursTable";
import WriteReviewSection from "@/components/reviews/WriteReviewSection";
import { useProviderReviews } from "@/hooks/useReviews";
import { useFavorites } from "@/hooks/useFavorites";
import { usePublicProviderPhotos } from "@/hooks/useProviderPhotos";
import { Heart, Star, MapPin, Clock, Share2, Globe, X, ChevronLeft, ChevronRight } from "lucide-react";
import { BackArrow } from "@/components/ui/directional-icon";
import { SectionLabel } from "@/components/ui/SectionLabel";
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
    <>
      <div className="mx-auto my-4 h-px w-12 bg-border" />
      <div className="flex flex-wrap justify-center gap-3">
        {entries.map(entry => (
          <a
            key={entry.label}
            href={entry.href}
            aria-label={entry.label}
            target="_blank"
            rel="noopener noreferrer"
            className={`flex h-12 w-12 items-center justify-center rounded-2xl ring-1 ring-inset ring-white/40 ${entry.frameClass} transition-all hover:brightness-110 active:scale-95`}
          >
            {entry.icon}
          </a>
        ))}
      </div>
    </>
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
  const { availability, blockedDates } = usePublicProviderSchedule(id);
  const liked = id ? isFavorite(id) : false;

  const [status, setStatus] = useState<ProviderStatus>(() =>
    getProviderStatus(availability, blockedDates, new Date()),
  );

  useEffect(() => {
    setStatus(getProviderStatus(availability, blockedDates, new Date()));
    const intervalId = setInterval(() => {
      setStatus(getProviderStatus(availability, blockedDates, new Date()));
    }, 60_000);
    return () => clearInterval(intervalId);
  }, [availability, blockedDates]);

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
      <div className="relative h-72 overflow-hidden bg-gradient-to-br from-accent/15 via-secondary to-secondary/40">
        {coverImgSrc ? (
          <img
            src={coverImgSrc}
            alt={provider.name[lang]}
            className="h-full w-full object-cover"
            onError={handleCoverImageError}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <span className="select-none text-[7rem] font-extralight leading-none tracking-tighter text-foreground/25 md:text-[9rem]">
              {provider.name[lang]?.charAt(0)?.toUpperCase()}
            </span>
          </div>
        )}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/45 via-black/0 to-secondary/40" />
        {status.hasSchedule && (() => {
          const basePillClass = "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium shadow-md backdrop-blur-md";
          const statusPillClass = `${basePillClass} ${
            status.isOpen
              ? "border-green-500/30 bg-green-500/15 text-green-700"
              : "border-red-500/30 bg-red-500/15 text-red-700"
          }`;
          const hoursPillClass = `${basePillClass} ${
            status.isOpen
              ? "border-green-500/30 bg-green-500/15 text-green-700"
              : "border-white/40 bg-white/85"
          }`;
          return (
            <div className="absolute inset-x-4 bottom-12 z-10 flex translate-y-1/2 items-center justify-between">
              {status.todayHours && (
                <div className={hoursPillClass}>
                  <span dir="ltr">{status.todayHours.open} - {status.todayHours.close}</span>
                </div>
              )}
              <div className={statusPillClass}>
                <span
                  aria-hidden
                  className={`block h-1.5 w-1.5 rounded-full ${status.isOpen ? "bg-green-500" : "bg-red-500"}`}
                />
                <span>{t(status.isOpen ? "providerStatusOpen" : "providerStatusClosed")}</span>
              </div>
            </div>
          );
        })()}
        <div className="absolute inset-x-0 top-0 flex items-center justify-between px-4 pt-[calc(env(safe-area-inset-top)+0.75rem)]">
          <button
            onClick={() => navigate(-1)}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-white/85 shadow-[0_4px_16px_rgba(0,0,0,0.08)] ring-1 ring-white/40 backdrop-blur-md transition-transform active:scale-95"
          >
            <BackArrow variant="arrow" className="h-5 w-5" />
          </button>
          <div className="flex gap-2">
            <button className="flex h-10 w-10 items-center justify-center rounded-full bg-white/85 shadow-[0_4px_16px_rgba(0,0,0,0.08)] ring-1 ring-white/40 backdrop-blur-md transition-transform active:scale-95">
              <Share2 className="h-5 w-5" />
            </button>
            <button
              onClick={() => { if (user && id) toggleFavorite.mutate(id); else if (!user) navigate("/auth"); }}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-white/85 shadow-[0_4px_16px_rgba(0,0,0,0.08)] ring-1 ring-white/40 backdrop-blur-md transition-all active:scale-95"
            >
              <Heart className={`h-5 w-5 transition-all ${liked ? "scale-110 fill-accent text-accent" : ""}`} />
            </button>
          </div>
        </div>
      </div>

      {/* Info */}
      <motion.div
        className="relative -mt-12 px-5"
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
      >
        <div className="rounded-3xl bg-card p-6 text-center shadow-[0_10px_40px_-12px_rgba(0,0,0,0.12)]">
          <h1 className="mb-2 text-2xl font-semibold tracking-tight md:text-3xl">{provider.name[lang]}</h1>
          {reviewCount > 0 && (
            <div className="mb-3 flex items-center justify-center gap-1 text-sm text-muted-foreground">
              <Star className="h-4 w-4 fill-accent text-accent" />
              <span className="font-medium text-foreground">{avgRating.toFixed(1)}</span>
              <span>({reviewCount})</span>
            </div>
          )}
          <p className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
            <MapPin className="h-3.5 w-3.5 shrink-0 text-accent" />
            {provider.address[lang]}
          </p>
          <SocialLinksRow socialLinks={provider.socialLinks} />
        </div>
      </motion.div>

      {/* About */}
      {provider.about[lang] && (
        <section className="mt-8 px-5">
          <SectionLabel className="mb-3">{t("about")}</SectionLabel>
          <p className="text-start text-sm leading-relaxed text-foreground/80">{provider.about[lang]}</p>
        </section>
      )}

      {/* Photo Gallery */}
      {photos.length > 0 && (
        <section className="mt-8">
          <SectionLabel className="mb-3 px-5">{t("ourWork")}</SectionLabel>
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

      {/* Weekly Hours */}
      {status.hasSchedule && (
        <section className="mt-8 px-5">
          <SectionLabel className="mb-3">{t("workingHoursLabel")}</SectionLabel>
          <WeeklyHoursTable
            availability={availability}
            blockedDates={blockedDates}
            status={status}
            lang={lang}
            t={t}
          />
        </section>
      )}

      {/* Services */}
      {provider.services.length > 0 && (
        <section className="mt-8 px-5">
          <SectionLabel className="mb-3">{t("services")}</SectionLabel>
          <div className="flex flex-col gap-2">
            {provider.services.map((service, i) => (
              <motion.div
                key={service.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.25 + i * 0.06, duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
                className="flex items-center justify-between gap-4 rounded-2xl border border-border/60 bg-card p-4 transition-colors hover:border-accent/30"
              >
                <div className="min-w-0 text-start">
                  <p className="truncate text-sm font-medium">{service.name[lang]}</p>
                  <span className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-[11px] text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    {service.duration} {t("min")}
                  </span>
                </div>
                <div className="flex shrink-0 items-baseline gap-0.5 text-end">
                  <span className="text-sm text-muted-foreground">₪</span>
                  <span className="text-lg font-semibold tracking-tight">{service.price}</span>
                </div>
              </motion.div>
            ))}
          </div>
        </section>
      )}

      {/* Reviews */}
      {dbReviews && dbReviews.length > 0 && (
        <section className="mt-8 px-5">
          <SectionLabel className="mb-3">{t("reviews")}</SectionLabel>
          <div className="flex flex-col gap-3">
            {dbReviews.map((review, i) => (
              <ReviewCard key={review.id} review={review} index={i} />
            ))}
          </div>
        </section>
      )}

      {/* Write a Review */}
      <WriteReviewSection providerId={provider.id} />

      {/* Sticky Book Button */}
      <div className="fixed inset-x-0 bottom-0 z-50">
        <div className="pointer-events-none absolute inset-x-0 -top-6 h-6 bg-gradient-to-t from-background to-transparent" />
        <div className="border-t border-border/60 bg-card/85 p-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] backdrop-blur-xl">
          <button
            onClick={() => navigate(`/provider/${provider.id}/book`)}
            className="w-full rounded-2xl bg-accent py-4 text-base font-semibold text-accent-foreground shadow-[0_8px_24px_-8px_hsl(var(--accent)/0.55)] transition-transform active:scale-[0.98]"
          >
            {t("bookAppointment")}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ProviderDetail;
