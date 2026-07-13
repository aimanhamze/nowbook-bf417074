import { useParams, useNavigate } from "react-router-dom";
import { categoryNames } from "@/lib/mock-data";
import { useProviderById, usePublicProviderSchedule } from "@/hooks/useAllProviders";
import { getProviderStatus, type ProviderStatus } from "@/lib/providerStatus";
import WeeklyHoursTable from "@/components/provider-detail/WeeklyHoursTable";
import MonthlyHoursTable from "@/components/provider-detail/MonthlyHoursTable";
import WriteReviewSection from "@/components/reviews/WriteReviewSection";
import { useProviderReviews } from "@/hooks/useReviews";
import { useFavorites } from "@/hooks/useFavorites";
import { usePublicProviderPhotos } from "@/hooks/useProviderPhotos";
import { Heart, Star, MapPin, Clock, Share2, Globe, X, ChevronLeft, ChevronRight, Images, Sparkles } from "lucide-react";
import { BackArrow } from "@/components/ui/directional-icon";
import { SectionLabel } from "@/components/ui/SectionLabel";
import { FaWhatsapp, FaInstagram, FaTiktok, FaFacebook, FaWaze } from "react-icons/fa6";
import { motion } from "framer-motion";
import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
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
  const [avatarFailed, setAvatarFailed] = useState(false);
  const [aboutExpanded, setAboutExpanded] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  // Full-screen viewer for the hero images (cover / profile picture) —
  // separate from the gallery lightbox, which browses the photos array.
  const [fullImageSrc, setFullImageSrc] = useState<string | null>(null);
  const { lang, t, isRtl } = useLang();
  const { user } = useAuth();
  const { provider, isLoading } = useProviderById(id);
  const { data: dbReviews } = useProviderReviews(id);
  const { isFavorite, toggleFavorite } = useFavorites();
  const { data: photos = [] } = usePublicProviderPhotos(id);
  const { availability, blockedDates, monthlySettings, overrides } = usePublicProviderSchedule(id);
  const isMonthly = monthlySettings.availability_mode === "monthly";
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
    setAvatarFailed(false);
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

  const handleShare = useCallback(async () => {
    const url = window.location.href;
    const name = provider?.name ?? "";
    if (navigator.share) {
      try {
        await navigator.share({ title: name, url });
        return;
      } catch {
        // user cancelled or share failed — fall through to clipboard
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      toast.success(t("shareLinkCopied"));
    } catch {
      toast.error(url);
    }
  }, [provider?.name, t]);

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
        <p className="text-muted-foreground">{t("providerNotAvailable")}</p>
      </div>
    );
  }

  return (
    <div
      className="relative min-h-screen overflow-x-clip pb-36"
      style={{ background: "var(--bg-atmosphere)" }}
    >
      {/* Radial accent glows — anchored below the cover so they bleed around
          the info card and into the services area, not behind the cover image. */}
      <div
        aria-hidden
        className="pointer-events-none absolute top-[16rem] [inset-inline-end:-5rem] h-[24rem] w-[24rem] rounded-full blur-3xl opacity-55"
        style={{ background: "radial-gradient(circle, hsl(24 95% 78% / 0.55) 0%, transparent 65%)" }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute top-[44rem] [inset-inline-start:-6rem] h-[30rem] w-[30rem] rounded-full blur-3xl opacity-50"
        style={{ background: "radial-gradient(circle, hsl(265 60% 80% / 0.45) 0%, transparent 65%)" }}
      />

      <div className="relative">
      {/* Cover */}
      <div className="relative overflow-hidden bg-gradient-to-br from-accent/15 via-secondary to-secondary/40">
        {coverImgSrc ? (
          coverImgSrc === (provider.image?.trim() || "") ? (
            // Avatar standing in for a missing cover: fixed height, blurred,
            // so the same photo isn't shown twice (avatar renders sharply
            // below) and it reads as an intentional backdrop.
            <button
              type="button"
              className="block w-full"
              onClick={() => setFullImageSrc(coverImgSrc)}
            >
              <img
                src={coverImgSrc}
                alt={provider.name[lang]}
                className="h-64 w-full scale-110 object-cover blur-xl"
                onError={handleCoverImageError}
              />
            </button>
          ) : (
            // Real cover: keep the image's natural aspect ratio (height only
            // clamped to a sane range) so designed banners with text/logos
            // are shown in full instead of being cropped by a fixed height.
            <button
              type="button"
              className="block w-full"
              onClick={() => setFullImageSrc(coverImgSrc)}
            >
              <img
                src={coverImgSrc}
                alt={provider.name[lang]}
                className="max-h-96 min-h-56 w-full object-cover"
                onError={handleCoverImageError}
              />
            </button>
          )
        ) : (
          <div className="flex h-64 w-full items-center justify-center">
            <span className="select-none text-[7rem] font-extralight leading-none tracking-tighter text-foreground/25 md:text-[9rem]">
              {provider.name[lang]?.charAt(0)?.toUpperCase()}
            </span>
          </div>
        )}
        {/* Bottom of cover fades to transparent so the page atmosphere
            shows through cleanly where the info card lands. */}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/45 via-black/0 to-transparent" />
        <div className="absolute inset-x-0 top-0 flex items-center justify-between px-4 pt-[calc(env(safe-area-inset-top,0px)+0.75rem)]">
          <button
            onClick={() => navigate(-1)}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-white/85 shadow-[0_4px_16px_rgba(0,0,0,0.08)] ring-1 ring-white/40 backdrop-blur-md transition-transform active:scale-95"
          >
            <BackArrow variant="arrow" className="h-5 w-5" />
          </button>
          <div className="flex gap-2">
            <button onClick={handleShare} className="flex h-10 w-10 items-center justify-center rounded-full bg-white/85 shadow-[0_4px_16px_rgba(0,0,0,0.08)] ring-1 ring-white/40 backdrop-blur-md transition-transform active:scale-95">
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
        <div className="glass-card relative rounded-3xl px-6 pb-6 pt-[4.25rem] text-center">
          {/* Profile picture — straddles the cover/card seam. Outer div owns
              the centering transform; the motion.div only animates scale so
              framer's inline transform can't override the translate. */}
          <div className="absolute -top-14 left-1/2 -translate-x-1/2">
            <motion.div
              initial={{ opacity: 0, scale: 0.7 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.5, delay: 0.15, ease: [0.16, 1, 0.3, 1] }}
              className="h-28 w-28 overflow-hidden rounded-full bg-gradient-to-br from-accent/25 to-secondary shadow-[0_12px_32px_-8px_rgba(40,20,10,0.35)] ring-4 ring-white/90"
            >
              {provider.image?.trim() && !avatarFailed ? (
                <button
                  type="button"
                  className="block h-full w-full"
                  onClick={() => setFullImageSrc(provider.image.trim())}
                >
                  <img
                    src={provider.image.trim()}
                    alt={provider.name[lang]}
                    className="h-full w-full object-cover"
                    onError={() => setAvatarFailed(true)}
                  />
                </button>
              ) : (
                <div className="flex h-full w-full items-center justify-center">
                  <span className="select-none text-4xl font-light text-foreground/50">
                    {provider.name[lang]?.charAt(0)?.toUpperCase()}
                  </span>
                </div>
              )}
            </motion.div>
          </div>

          <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">{provider.name[lang]}</h1>

          <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
            {categoryNames[provider.category]?.[lang] && (
              <span className="rounded-full bg-accent/10 px-3 py-1 text-xs font-medium text-accent">
                {categoryNames[provider.category][lang]}
              </span>
            )}
            {reviewCount > 0 && (
              <span className="flex items-center gap-1 rounded-full bg-secondary/70 px-3 py-1 text-xs text-muted-foreground">
                <Star className="h-3.5 w-3.5 fill-accent text-accent" />
                <span className="font-medium text-foreground">{avgRating.toFixed(1)}</span>
                <span>({reviewCount})</span>
              </span>
            )}
          </div>

          {status.hasSchedule && (
            <div className="mt-3 flex justify-center">
              <span
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${
                  status.isOpen
                    ? "border-green-500/30 bg-green-500/10 text-green-700"
                    : "border-red-500/30 bg-red-500/10 text-red-700"
                }`}
              >
                <span
                  aria-hidden
                  className={`block h-1.5 w-1.5 rounded-full ${status.isOpen ? "bg-green-500" : "bg-red-500"}`}
                />
                <span>{t(status.isOpen ? "providerStatusOpen" : "providerStatusClosed")}</span>
                {status.todayHours && (
                  <>
                    <span aria-hidden className="opacity-40">·</span>
                    <span dir="ltr">{status.todayHours.open} - {status.todayHours.close}</span>
                  </>
                )}
              </span>
            </div>
          )}

          <p className="mt-3 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
            <MapPin className="h-3.5 w-3.5 shrink-0 text-accent" />
            {provider.address[lang]}
          </p>
          <SocialLinksRow socialLinks={provider.socialLinks} />
        </div>
      </motion.div>

      {/* About — soft card matching the rest of the page; long descriptions
          clamp to 4 lines with a read-more toggle so the section never
          pushes the services/hours below the fold. */}
      {provider.about[lang] && (
        <section className="mt-8 px-5">
          <SectionLabel className="mb-3">{t("about")}</SectionLabel>
          <div className="surface-soft rounded-2xl p-5">
            <p
              className={`whitespace-pre-line text-start text-sm leading-7 text-foreground/85 ${
                aboutExpanded ? "" : "line-clamp-4"
              }`}
            >
              {provider.about[lang]}
            </p>
            {(provider.about[lang]?.length ?? 0) > 180 && (
              <button
                onClick={() => setAboutExpanded(v => !v)}
                className="mt-2 text-xs font-semibold text-accent"
              >
                {t(aboutExpanded ? "showLess" : "readMore")}
              </button>
            )}
          </div>
        </section>
      )}

      {/* Photo Gallery — static collage (Google-Business style): a featured
          tile plus a grid of smaller ones, layout adapting to photo count.
          At most 5 tiles render; a "+N" scrim on the last tile signals the
          rest, and tapping any tile browses the full set in the lightbox. */}
      {photos.length > 0 && (() => {
        const visible = photos.slice(0, 5);
        const hiddenCount = photos.length - visible.length;

        const tile = (i: number, sizeClass: string, withMoreBadge = false) => (
          <motion.button
            key={visible[i].id}
            initial={{ opacity: 0, scale: 0.97 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            transition={{ delay: i * 0.05, duration: 0.3 }}
            onClick={() => setLightboxIndex(i)}
            className={`relative overflow-hidden rounded-xl bg-secondary ring-1 ring-black/5 transition-transform active:scale-[0.98] ${sizeClass}`}
          >
            <img
              src={visible[i].url}
              alt={visible[i].caption ?? ""}
              loading="lazy"
              className="absolute inset-0 h-full w-full object-cover"
            />
            {withMoreBadge && hiddenCount > 0 && (
              <div className="absolute inset-0 flex items-center justify-center gap-1.5 bg-black/50 text-white">
                <Images className="h-4 w-4" />
                <span className="text-base font-semibold">+{hiddenCount}</span>
              </div>
            )}
          </motion.button>
        );

        return (
          <section className="mt-8 px-5">
            <SectionLabel className="mb-3">{t("ourWork")}</SectionLabel>
            {visible.length === 1 && (
              <div className="grid">{tile(0, "aspect-[16/10] w-full")}</div>
            )}
            {visible.length === 2 && (
              <div className="grid grid-cols-2 gap-1.5">
                {tile(0, "aspect-square")}
                {tile(1, "aspect-square")}
              </div>
            )}
            {visible.length === 3 && (
              <div className="grid grid-cols-2 grid-rows-2 gap-1.5">
                {tile(0, "row-span-2 h-full")}
                {tile(1, "aspect-square")}
                {tile(2, "aspect-square")}
              </div>
            )}
            {visible.length === 4 && (
              <div className="grid grid-cols-2 gap-1.5">
                {tile(0, "aspect-square")}
                {tile(1, "aspect-square")}
                {tile(2, "aspect-square")}
                {tile(3, "aspect-square")}
              </div>
            )}
            {visible.length === 5 && (
              <div className="grid grid-cols-[1.25fr_1fr] gap-1.5">
                {tile(0, "h-full")}
                <div className="grid grid-cols-2 gap-1.5">
                  {tile(1, "aspect-square")}
                  {tile(2, "aspect-square")}
                  {tile(3, "aspect-square")}
                  {tile(4, "aspect-square", true)}
                </div>
              </div>
            )}
          </section>
        );
      })()}

      {/* Hero image viewer — full-screen look at the cover / profile picture.
          Tap anywhere (or X) to close. Unmounts synchronously on close (no
          AnimatePresence) for the same tap-swallowing reason as the lightbox. */}
      {fullImageSrc && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black p-4"
          onClick={() => setFullImageSrc(null)}
        >
          <button
            className="absolute top-[calc(env(safe-area-inset-top,0px)+1rem)] left-4 z-10 rounded-full bg-white/10 p-2 text-white"
            onClick={() => setFullImageSrc(null)}
          >
            <X className="h-5 w-5" />
          </button>
          <motion.img
            src={fullImageSrc}
            alt={provider.name[lang]}
            initial={{ opacity: 0, scale: 0.92 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.2 }}
            className="max-h-full max-w-full rounded-xl object-contain"
            onClick={e => e.stopPropagation()}
          />
        </motion.div>
      )}

      {/* Lightbox — full-screen viewer with a bottom thumbnail filmstrip:
          active thumb ringed white, others dimmed; tap to jump, and the
          strip auto-scrolls to keep the active thumbnail visible.
          Deliberately NOT wrapped in AnimatePresence: a stuck exit animation
          left the invisible overlay mounted at z-60, swallowing every tap on
          the page. Closing must unmount synchronously. */}
      {lightboxIndex !== null && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="fixed inset-0 z-[60] flex items-center justify-center bg-black"
            onClick={() => setLightboxIndex(null)}
          >
            <button
              className="absolute top-[calc(env(safe-area-inset-top,0px)+1rem)] left-4 z-10 rounded-full bg-white/10 p-2 text-white"
              onClick={() => setLightboxIndex(null)}
            >
              <X className="h-5 w-5" />
            </button>
            <p
              dir="ltr"
              className="absolute top-[calc(env(safe-area-inset-top,0px)+1.375rem)] left-1/2 -translate-x-1/2 text-xs text-white/60"
            >
              {lightboxIndex + 1} / {photos.length}
            </p>
            {/* In RTL the gallery flows right-to-left (next photo sits to the
                LEFT in the filmstrip), so the physical arrows swap roles:
                ◀ advances, ▶ goes back. In LTR it's the usual mapping. */}
            {(isRtl ? lightboxIndex < photos.length - 1 : lightboxIndex > 0) && (
              <button
                className="absolute left-3 z-10 rounded-full bg-white/10 p-2 text-white"
                onClick={e => { e.stopPropagation(); setLightboxIndex(lightboxIndex + (isRtl ? 1 : -1)); }}
              >
                <ChevronLeft className="h-6 w-6" />
              </button>
            )}
            {(isRtl ? lightboxIndex > 0 : lightboxIndex < photos.length - 1) && (
              <button
                className="absolute right-3 z-10 rounded-full bg-white/10 p-2 text-white"
                onClick={e => { e.stopPropagation(); setLightboxIndex(lightboxIndex + (isRtl ? -1 : 1)); }}
              >
                <ChevronRight className="h-6 w-6" />
              </button>
            )}
            <motion.div
              key={lightboxIndex}
              initial={{ opacity: 0, scale: 0.92 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.2 }}
              // Finger-swipe navigation. Mirrors with direction like the
              // arrows: in LTR the next photo is to the right (swipe left to
              // advance); in RTL it's to the left (swipe right to advance).
              // Constraints keep the image anchored; past either end it just
              // springs back.
              drag="x"
              dragConstraints={{ left: 0, right: 0 }}
              dragElastic={0.25}
              dragMomentum={false}
              onDragEnd={(_, info) => {
                const step = (delta: number) =>
                  setLightboxIndex(i =>
                    i === null ? i : Math.min(Math.max(i + delta, 0), photos.length - 1)
                  );
                if (info.offset.x < -56 || info.velocity.x < -500) {
                  step(isRtl ? -1 : 1); // swiped toward the left
                } else if (info.offset.x > 56 || info.velocity.x > 500) {
                  step(isRtl ? 1 : -1); // swiped toward the right
                }
              }}
              // pb-14 ≈ bottom chrome (filmstrip) minus top chrome (close/counter
              // bar), so flex-centering lands the image midway between the two.
              // Slim px-4 lets the photo run nearly full-width; the nav arrows
              // float over its edges instead of reserving side gutters.
              className="max-h-full max-w-full px-4 pb-14"
              onClick={e => e.stopPropagation()}
            >
              <img
                src={photos[lightboxIndex].url}
                alt={photos[lightboxIndex].caption ?? ""}
                className="max-h-[calc(100dvh-12rem)] max-w-full rounded-xl object-contain"
              />
              {photos[lightboxIndex].caption && (
                <p className="mt-3 text-center text-sm text-white/80">{photos[lightboxIndex].caption}</p>
              )}
            </motion.div>
            <div
              className="absolute inset-x-0 bottom-0 overflow-x-auto bg-gradient-to-t from-black via-black/80 to-transparent pb-[calc(env(safe-area-inset-bottom,0px)+0.875rem)] pt-4 scrollbar-hide"
              onClick={e => e.stopPropagation()}
            >
              <div className="mx-auto flex w-max gap-2 px-4">
                {photos.map((photo, i) => {
                  const isActive = i === lightboxIndex;
                  return (
                    <button
                      key={photo.id}
                      ref={el => {
                        if (isActive && el) {
                          el.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
                        }
                      }}
                      onClick={() => setLightboxIndex(i)}
                      className={`h-16 w-14 shrink-0 overflow-hidden rounded-lg transition-all ${
                        isActive
                          ? "ring-2 ring-white"
                          : "opacity-50 ring-1 ring-white/20 hover:opacity-80"
                      }`}
                    >
                      <img
                        src={photo.url}
                        alt={photo.caption ?? ""}
                        loading="lazy"
                        className="h-full w-full object-cover"
                      />
                    </button>
                  );
                })}
              </div>
            </div>
          </motion.div>
      )}

      {/* Working Hours — MONTHLY providers get a date-based list (resolved per
          date via the shared resolver); WEEKLY providers keep the weekday list
          UNCHANGED. Monthly gates on mode (a monthly provider may have no weekly
          rows, so status.hasSchedule can't gate it). */}
      {isMonthly ? (
        <section className="mt-8 px-5">
          <SectionLabel className="mb-3">{t("workingHoursLabel")}</SectionLabel>
          <MonthlyHoursTable
            monthlySettings={monthlySettings}
            blockedDates={blockedDates}
            overrides={overrides}
            bookingWindowDays={provider.bookingWindowDays}
            lang={lang}
            t={t}
          />
        </section>
      ) : (
        status.hasSchedule && (
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
        )
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
                className="surface-soft flex items-center gap-3.5 rounded-2xl p-4 transition-colors hover:border-accent/30"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent">
                  <Sparkles className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1 text-start">
                  <p className="line-clamp-2 text-sm font-medium leading-snug">{service.name[lang]}</p>
                  <span className="mt-1 inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    {service.duration} {t("min")}
                  </span>
                </div>
                {provider.showPrices && service.price > 0 && (
                  <div className="flex shrink-0 items-baseline gap-0.5 text-end">
                    <span className="text-sm text-muted-foreground">₪</span>
                    <span className="text-lg font-semibold tracking-tight tabular-nums">{service.price}</span>
                  </div>
                )}
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
        <div className="pointer-events-none absolute inset-x-0 -top-6 h-6 bg-gradient-to-t from-[hsl(40_30%_96%)] to-transparent" />
        <div className="border-t border-white/40 bg-white/70 p-4 pb-[calc(env(safe-area-inset-bottom,0px)+1rem)] backdrop-blur-xl">
          <button
            onClick={() => navigate(`/provider/${provider.id}/book`)}
            className="w-full rounded-2xl bg-accent py-4 text-base font-semibold text-accent-foreground shadow-[0_8px_24px_-8px_hsl(var(--accent)/0.55)] transition-transform active:scale-[0.98]"
          >
            {t("bookAppointment")}
          </button>
        </div>
      </div>
      </div>
    </div>
  );
};

export default ProviderDetail;
