import { useParams, useNavigate } from "react-router-dom";
import { categoryNames } from "@/lib/mock-data";
import { DEFAULT_AVATAR_URL, useProviderById, usePublicProviderSchedule } from "@/hooks/useAllProviders";
import { getProviderStatus, type ProviderStatus } from "@/lib/providerStatus";
import { getNextOpening, openingStatusParts, summarizeOpening } from "@/lib/openingSummary";
import type { MonthlySettings } from "@/lib/availabilityResolver";
import WeeklyHoursTable from "@/components/provider-detail/WeeklyHoursTable";
import MonthlyHoursTable from "@/components/provider-detail/MonthlyHoursTable";
import WriteReviewSection from "@/components/reviews/WriteReviewSection";
import { useProviderReviews } from "@/hooks/useReviews";
import { useFavorites } from "@/hooks/useFavorites";
import { usePublicProviderPhotos } from "@/hooks/useProviderPhotos";
import { Heart, Star, MapPin, Share2, X, ChevronLeft, ChevronRight, Images, CalendarPlus, Ticket } from "lucide-react";
import { BackOrHomeIcon } from "@/components/ui/directional-icon";
import { useSmartBack } from "@/hooks/useSmartBack";
import { SectionLabel } from "@/components/ui/SectionLabel";
import { ProviderCourses } from "@/components/academy/customer/ProviderCourses";
import { isAcademyCategory } from "@/lib/academyCategory";
import { motion } from "framer-motion";
import { useEffect, useState, useCallback, useRef } from "react";
import { toast } from "sonner";
import { useLang } from "@/contexts/LangContext";
import { useAuth } from "@/contexts/AuthContext";
import ReviewCard from "@/components/reviews/ReviewCard";
import { saveRedirectAfterLogin } from "@/lib/redirectAfterLogin";
import { sized, withOriginalFallback } from "@/lib/imageUrl";
import { SessionHandledError } from "@/lib/liveSession";
import { useProviderPackages, useMyPackagesAt, useRequestPackage } from "@/hooks/usePublicPackages";
import { packageErrorKey } from "@/hooks/usePackageActions";
import { MyPackageCard } from "@/components/packages/MyPackageCard";
import { UpcomingAppointmentCard } from "@/components/provider-detail/UpcomingAppointmentCard";
import { WaitlistRow } from "@/components/provider-detail/WaitlistRow";
import { OtherBranches } from "@/components/provider-detail/OtherBranches";
import { CollapsingHeader, HeaderIconButton } from "@/components/provider-detail/CollapsingHeader";
import { ProviderActions } from "@/components/provider-detail/ProviderActions";
import { ServiceList } from "@/components/provider-detail/ServiceList";
import { useKeyboardOpen } from "@/hooks/useKeyboardOpen";


// Sized copies (see lib/imageUrl). The cover/avatar full-screen viewer is the
// only place that loads the original.
// Rule: request width+height ONLY when the CSS box has exactly that aspect
// (server crop = final crop). Anything else requests width only (aspect
// preserved) and lets object-fit crop once — a server crop to a different
// aspect followed by a CSS crop looks zoomed.
const AVATAR_SIZE = { width: 216, height: 216 } as const; // h-[72px] w-[72px] × 3; mini h-8 w-8 shares it
// The status line is weekly-mode only, so the resolver is asked the weekly way.
const WEEKLY_SETTINGS: MonthlySettings = {
  availability_mode: "weekly",
  monthly_default_available: true,
  monthly_default_start: "09:00",
  monthly_default_end: "17:00",
};
const LIGHTBOX_SIZE = { width: 1600, resize: "contain" } as const;
const THUMB_SIZE = { width: 112, height: 128 } as const; // h-16 w-14 = 56×64 box, ×2

const ProviderDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  // The pinned Book bar would ride up over the keyboard on Android (see
  // useKeyboardOpen) and cover the review box; hide it while typing.
  const keyboardOpen = useKeyboardOpen();
  const { isEntry, goBack } = useSmartBack();
  const [coverFailed, setCoverFailed] = useState(false);
  const [avatarFailed, setAvatarFailed] = useState(false);
  const coverRef = useRef<HTMLDivElement>(null);
  const bigAvatarRef = useRef<HTMLDivElement>(null);
  const [aboutExpanded, setAboutExpanded] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  // Full-screen viewer for the hero images (cover / profile picture) —
  // separate from the gallery lightbox, which browses the photos array.
  const [fullImageSrc, setFullImageSrc] = useState<string | null>(null);
  const { lang, t, isRtl } = useLang();
  const { user } = useAuth();
  const { provider, isLoading } = useProviderById(id);
  const { data: dbReviews } = useProviderReviews(id);
  // Packages are a fitness_studio feature (group classes only), so the section
  // simply does not exist for any other provider type.
  const showsPackages = provider?.category === "fitness_studio";
  // An academy runs on dated courses: its page shows courses + Register in
  // place of services, weekly hours, the open/closed pill and the Book button.
  const isAcademy = isAcademyCategory(provider?.category);
  const { data: packageOffers = [] } = useProviderPackages(showsPackages ? id : undefined);
  const { data: myPackages = [] } = useMyPackagesAt(showsPackages ? id : undefined);
  const requestPackage = useRequestPackage();
  // The RPC refuses a second outstanding request per provider; mirroring that
  // here disables the button up front instead of failing after the round trip.
  const livePackages = myPackages.filter(
    (p) => p.status === "pending_activation" || p.status === "active",
  );
  const hasLivePackage = livePackages.length > 0;

  // SPENDABLE, not merely owned. Mirrors enforce_class_requires_package: only
  // an active package with entries left and not past its local expiry can pay
  // for a class. A pending one does NOT count -- the provider still has to
  // activate it after payment.
  const todayLocalStr = new Date().toISOString().slice(0, 10);
  const usablePackage = myPackages.find(
    (p) =>
      p.status === "active" &&
      p.entries_remaining > 0 &&
      (!p.expires_at || p.expires_at.slice(0, 10) >= todayLocalStr),
  );
  // Studios sell class access by package only, so booking is gated on having
  // one. Every other provider type books normally and is untouched.
  const canBook = !showsPackages || !!usablePackage;
  const hasSpentPackage = myPackages.some(
    (p) => p.status === "exhausted" || (p.status === "active" && p.entries_remaining <= 0),
  );
  const { isFavorite, toggleFavorite } = useFavorites();
  const { data: photos = [] } = usePublicProviderPhotos(id);
  const { availability, blockedDates, monthlySettings, overrides } = usePublicProviderSchedule(id);
  const isMonthly = monthlySettings.availability_mode === "monthly";
  const liked = id ? isFavorite(id) : false;

  // Open/closed comes from the shared helper (same as Home); the next opening
  // from the resolver. Both are derived on render, and a minute tick re-renders
  // the page so the line turns over on time.
  const [, setMinuteTick] = useState(0);
  useEffect(() => {
    const intervalId = setInterval(() => setMinuteTick((n) => n + 1), 60_000);
    return () => clearInterval(intervalId);
  }, []);
  const now = new Date();
  const status: ProviderStatus = getProviderStatus(availability, blockedDates, now, overrides);
  // Shown for weekly-mode providers only (monthly mode has no status yet — the
  // shared helper reads weekday rows), so the weekly resolver path is the one asked.
  const showStatus = status.hasSchedule && !isAcademy && !isMonthly;
  const opening = summarizeOpening(
    status,
    showStatus && !status.isOpen
      ? getNextOpening(now, WEEKLY_SETTINGS, availability, blockedDates, overrides)
      : null,
    now,
  );
  const statusParts = openingStatusParts(opening, lang, t);

  // A provider without an avatar carries a stock photo (see DEFAULT_AVATAR_URL);
  // here that counts as no avatar, and the initial letter is shown instead.
  const rawAvatar = provider?.image?.trim() || "";
  const avatarSrc = rawAvatar && rawAvatar !== DEFAULT_AVATAR_URL && !avatarFailed ? rawAvatar : "";
  const coverSrc = coverFailed ? "" : provider?.coverImage?.trim() || "";

  const reviewCount = dbReviews?.length || 0;
  const avgRating = dbReviews && dbReviews.length > 0
    ? dbReviews.reduce((sum, r) => sum + r.rating, 0) / reviewCount
    : 0;

  // Gallery viewer: warm the browser cache with the neighbouring photos (same
  // 1600px URL the slide will request) so a swipe shows the next photo at
  // once. If the sized copy is refused, preload the original instead — that's
  // what the slide's own fallback will ask for.
  useEffect(() => {
    if (lightboxIndex === null) return;
    for (const i of [lightboxIndex - 1, lightboxIndex + 1]) {
      const original = photos[i]?.url;
      if (!original) continue;
      const img = new Image();
      img.decoding = "async";
      img.onerror = () => {
        img.onerror = null;
        if (img.src !== original) img.src = original;
      };
      img.src = sized(original, LIGHTBOX_SIZE);
    }
  }, [lightboxIndex, photos]);

  // Keep the active thumbnail centred — only when the index changes, not on
  // every render.
  const stripRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (lightboxIndex === null) return;
    stripRef.current
      ?.querySelector<HTMLElement>(`[data-strip-index="${lightboxIndex}"]`)
      ?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }, [lightboxIndex]);

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

  // The BottomNav is hidden on /provider/*, so a visitor who landed on a dead
  // or slow link from Instagram needs a way out of these two screens too.
  const escapeButton = (
    <button
      onClick={goBack}
      aria-label={t(isEntry ? "home" : "back")}
      className="absolute start-4 top-[calc(env(safe-area-inset-top,0px)+0.75rem)] flex h-11 w-11 items-center justify-center rounded-full bg-white/85 shadow-[0_4px_16px_rgba(0,0,0,0.08)] ring-1 ring-black/5 backdrop-blur-md transition-transform active:scale-95"
    >
      <BackOrHomeIcon home={isEntry} variant="arrow" className="h-5 w-5" />
    </button>
  );

  if (isLoading) {
    return (
      <div className="relative min-h-screen flex items-center justify-center">
        {escapeButton}
        <div className="w-8 h-8 rounded-full border-2 border-accent border-t-transparent animate-spin" />
      </div>
    );
  }

  if (!provider) {
    return (
      <div className="relative flex min-h-screen flex-col items-center justify-center gap-5 px-6 text-center">
        {escapeButton}
        <p className="text-muted-foreground">{t("providerNotAvailable")}</p>
        <button
          onClick={() => navigate("/")}
          className="inline-flex h-11 items-center justify-center rounded-2xl bg-accent px-6 text-sm font-semibold text-accent-foreground transition-transform active:scale-[0.98]"
        >
          {t("backToHome")}
        </button>
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

      {/* Back / share / favourite — pinned; a frosted bar with a small
          avatar fades in behind them once the big avatar scrolls away. */}
      <CollapsingHeader
        coverRef={coverRef}
        bigAvatarRef={bigAvatarRef}
        avatar={
          avatarSrc ? (
            // Same 216px URL as the big avatar below, so it's one download.
            <img
              src={sized(avatarSrc, AVATAR_SIZE)}
              alt=""
              decoding="async"
              width={32}
              height={32}
              className="h-full w-full object-cover"
              onError={withOriginalFallback(avatarSrc)}
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <span className="select-none text-sm font-medium text-foreground/60">
                {provider.name[lang]?.charAt(0)?.toUpperCase()}
              </span>
            </div>
          )
        }
        start={
          <HeaderIconButton onClick={goBack} aria-label={t(isEntry ? "home" : "back")}>
            <BackOrHomeIcon home={isEntry} variant="arrow" className="h-5 w-5" />
          </HeaderIconButton>
        }
        end={
          <>
            <HeaderIconButton onClick={handleShare} aria-label={t("shareProvider")}>
              <Share2 className="h-5 w-5" />
            </HeaderIconButton>
            <HeaderIconButton
              aria-label={liked ? t("removeFromFavorites") : t("addToFavorites")}
              aria-pressed={liked}
              onClick={() => { if (user && id) toggleFavorite.mutate(id); else if (!user) { saveRedirectAfterLogin(); navigate("/auth"); } }}
            >
              <Heart className={`h-5 w-5 transition-all ${liked ? "scale-110 fill-accent text-accent" : ""}`} />
            </HeaderIconButton>
          </>
        }
      />

      <div className="relative">
      {/* Cover — no scrim: a white or logo cover stays as the provider made
          it. The pinned buttons carry their own backing. */}
      <div ref={coverRef} className="relative overflow-hidden bg-secondary">
        {coverSrc ? (
          // Keep the image's natural aspect ratio (height only clamped to a
          // sane range) so designed banners with text/logos are shown in full
          // instead of being cropped by a fixed height. Width-only request
          // keeps that aspect; the page jumps once when it loads (accepted —
          // a fixed box cropped real covers).
          <button
            type="button"
            className="block w-full"
            onClick={() => setFullImageSrc(coverSrc)}
          >
            <img
              // 1200: a 16:9 cover is clamped to 224px tall at 375px wide,
              // and 1200×675 still covers 672px (224 × 3) after contain.
              src={sized(coverSrc, { width: 1200 })}
              alt={provider.name[lang]}
              decoding="async"
              className="max-h-96 min-h-56 w-full object-cover"
              onError={withOriginalFallback(coverSrc, () => setCoverFailed(true))}
            />
          </button>
        ) : (
          // No cover: a short, quiet band in the brand tint. Nothing to show,
          // so it stays low and the name and services sit higher.
          <div aria-hidden className="h-36 w-full bg-accent/10" />
        )}
      </div>

      {/* Identity — start-aligned. The avatar straddles the cover's bottom
          edge on the start side, so a centred logo cover and the avatar (often
          the same logo) no longer sit on top of each other. */}
      <div className="relative px-5">
        <div
          ref={bigAvatarRef}
          className="-mt-9 h-[72px] w-[72px] overflow-hidden rounded-full bg-secondary ring-4 ring-background"
        >
          {avatarSrc ? (
            <button
              type="button"
              className="block h-full w-full"
              onClick={() => setFullImageSrc(avatarSrc)}
            >
              <img
                src={sized(avatarSrc, AVATAR_SIZE)}
                alt={provider.name[lang]}
                decoding="async"
                width={72}
                height={72}
                className="h-full w-full object-cover"
                onError={withOriginalFallback(avatarSrc, () => setAvatarFailed(true))}
              />
            </button>
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-accent/10">
              <span className="select-none text-2xl font-semibold text-foreground/70">
                {provider.name[lang]?.charAt(0)?.toUpperCase()}
              </span>
            </div>
          )}
        </div>

        <h1 className="mt-3 text-start text-2xl font-bold leading-tight tracking-normal">
          {provider.name[lang]}
        </h1>

        {(categoryNames[provider.category]?.[lang] || reviewCount > 0) && (
          <div className="mt-1 flex flex-wrap items-center gap-x-3 text-[13px] text-foreground/70">
            {categoryNames[provider.category]?.[lang] && (
              <span>{categoryNames[provider.category][lang]}</span>
            )}
            {reviewCount > 0 && (
              // Compact rating; the -my-3 keeps a 44px tap area without adding
              // height to the line. Jumps to the reviews section.
              <button
                type="button"
                aria-label={`${avgRating.toFixed(1)} (${reviewCount}) · ${t("ratingJumpToReviews")}`}
                onClick={() =>
                  document.getElementById("provider-reviews")?.scrollIntoView({
                    block: "start",
                    behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
                  })
                }
                className="-my-3 inline-flex min-h-11 items-center gap-1"
              >
                <Star aria-hidden className="h-3.5 w-3.5 fill-accent text-accent" />
                <span dir="ltr" className="tabular-nums">
                  <span className="font-semibold text-foreground">{avgRating.toFixed(1)}</span> ({reviewCount})
                </span>
              </button>
            )}
          </div>
        )}

        {provider.address[lang] && (
          <p className="mt-1 flex items-start gap-1.5 text-start text-[13px] text-foreground/70">
            <MapPin aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{provider.address[lang]}</span>
          </p>
        )}

        {/* Status: one line, neutral when closed (closed is a normal state),
            green only when open, and always the next opening when known. */}
        {showStatus && (
          <p className="mt-2.5 flex items-start gap-2 text-start text-sm">
            <span
              aria-hidden
              className={`mt-1.5 block h-2 w-2 shrink-0 rounded-full ${
                opening.kind === "open" ? "bg-green-600" : "bg-foreground/30"
              }`}
            />
            <span>
              <span className={`font-semibold ${opening.kind === "open" ? "text-green-700" : "text-foreground"}`}>
                {statusParts.head}
              </span>
              {statusParts.detail && (
                <span className="text-foreground/70"> · {statusParts.detail}</span>
              )}
            </span>
          </p>
        )}

        {/* Branch switcher — renders nothing for a single-branch owner.
            Under the location and status so a visitor on the wrong city sees
            it before booking. */}
        <OtherBranches provider={provider} />
        <ProviderActions socialLinks={provider.socialLinks} phone={provider.phone} className="mt-4" />
      </div>

      {/* The signed-in customer's next appointment here — renders nothing
          otherwise. Above "about" so a returning customer sees it first; the
          book button is pinned to the viewport, so this never hides it. */}
      <UpcomingAppointmentCard provider={provider} />
      {/* Waiting list: one slim row, only with the provider's opt-in and an
          active entry here. */}
      <WaitlistRow provider={provider} />

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

      {isAcademy && <ProviderCourses providerId={provider.id} />}

      {/* Photo Gallery — static collage (Google-Business style): a featured
          tile plus a grid of smaller ones, layout adapting to photo count.
          At most 5 tiles render; a "+N" scrim on the last tile signals the
          rest, and tapping any tile browses the full set in the lightbox. */}
      {photos.length > 0 && (() => {
        const visible = photos.slice(0, 5);
        const hiddenCount = photos.length - visible.length;

        // Width-only (resize=contain), so object-cover does the single crop.
        // Sized so a typical 16:9 photo still covers its box at DPR 3 in BOTH
        // dimensions (contain height = width × 9/16 must reach box height × 3).
        // Boxes at 375px (content 335px, gap 6px):
        //   1-up 335×209 → 1200 · 3-up lead 165×335 (tall) → 1800
        //   5-up lead 183×146 → 800 · 165px squares (2/3/4-up) → 900
        //   5-up 70px squares → 400
        const tileWidth = (i: number) => {
          const n = visible.length;
          if (i === 0 && n === 1) return 1200;
          if (i === 0 && n === 3) return 1800;
          if (i === 0 && n === 5) return 800;
          return n === 5 ? 400 : 900;
        };
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
              src={sized(visible[i].url, { width: tileWidth(i) })}
              alt={visible[i].caption ?? ""}
              loading="lazy"
              decoding="async"
              className="absolute inset-0 h-full w-full object-cover"
              onError={withOriginalFallback(visible[i].url)}
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
                src={sized(photos[lightboxIndex].url, LIGHTBOX_SIZE)}
                alt={photos[lightboxIndex].caption ?? ""}
                decoding="async"
                className="max-h-[calc(100dvh-12rem)] max-w-full rounded-xl object-contain"
                onError={withOriginalFallback(photos[lightboxIndex].url)}
              />
              {photos[lightboxIndex].caption && (
                <p className="mt-3 text-center text-sm text-white/80">{photos[lightboxIndex].caption}</p>
              )}
            </motion.div>
            <div
              className="absolute inset-x-0 bottom-0 overflow-x-auto bg-gradient-to-t from-black via-black/80 to-transparent pb-[calc(env(safe-area-inset-bottom,0px)+0.875rem)] pt-4 scrollbar-hide"
              onClick={e => e.stopPropagation()}
            >
              <div ref={stripRef} className="mx-auto flex w-max gap-2 px-4">
                {photos.map((photo, i) => {
                  const isActive = i === lightboxIndex;
                  return (
                    <button
                      key={photo.id}
                      data-strip-index={i}
                      onClick={() => setLightboxIndex(i)}
                      className={`h-16 w-14 shrink-0 overflow-hidden rounded-lg transition-all ${
                        isActive
                          ? "ring-2 ring-white"
                          : "opacity-50 ring-1 ring-white/20 hover:opacity-80"
                      }`}
                    >
                      <img
                        src={sized(photo.url, THUMB_SIZE)}
                        alt={photo.caption ?? ""}
                        loading="lazy"
                        decoding="async"
                        width={56}
                        height={64}
                        className="h-full w-full object-cover"
                        onError={withOriginalFallback(photo.url)}
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
      {isAcademy ? null : isMonthly ? (
        <section className="mt-8 px-5">
          <SectionLabel className="mb-3">{t("workingHoursLabel")}</SectionLabel>
          <MonthlyHoursTable
            monthlySettings={monthlySettings}
            blockedDates={blockedDates}
            overrides={overrides}
            bookingWindowDays={provider.bookingWindowDays}
            staffEnabled={provider.staffEnabled}
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
              staffEnabled={provider.staffEnabled}
              lang={lang}
              t={t}
            />
          </section>
        )
      )}

      {/* Services — one price list (see ServiceList). */}
      {provider.services.length > 0 && !isAcademy && (
        <section className="mt-8 px-5">
          <SectionLabel className="mb-3">{t("services")}</SectionLabel>
          <ServiceList services={provider.services} showPrices={provider.showPrices} lang={lang} t={t} />
        </section>
      )}

      {/* Packages — fitness studios only. Purchase is a REQUEST: payment happens
          outside the app, and the provider activates once they have it. */}
      {showsPackages && !usablePackage && packageOffers.length > 0 && (
        <section className="mt-8 px-5">
          {/* What this customer already has here, before what is on sale —
              "how many classes do I have left" is the more common question. */}
          {livePackages.length > 0 && (
            <div className="mb-4 flex flex-col gap-2">
              <h3 className="text-sm font-bold">{t("myPackages")}</h3>
              {livePackages.map((pkg, i) => (
                <MyPackageCard
                  key={pkg.id}
                  pkg={pkg}
                  templateName={packageOffers.find((o) => o.id === pkg.template_id)?.name ?? null}
                  showProvider={false}
                  index={i}
                />
              ))}
            </div>
          )}

          {hasSpentPackage && (
            <p className="mb-3 rounded-2xl bg-rose-50 px-4 py-2.5 text-center text-xs font-medium text-rose-700">
              {t("packageExhaustedMessage")}
            </p>
          )}
          <SectionLabel className="mb-3">{t("availablePackages")}</SectionLabel>
          <div className="flex flex-col gap-2">
            {packageOffers.map((pkg, i) => (
              <motion.div
                key={pkg.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.25 + i * 0.06, duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
                className="surface-soft flex items-center gap-3.5 rounded-2xl p-4"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent">
                  <Ticket className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1 text-start">
                  <p className="line-clamp-2 text-sm font-medium leading-snug">{pkg.name}</p>
                  {pkg.description && (
                    <p className="mt-0.5 line-clamp-1 text-[11px] text-muted-foreground">{pkg.description}</p>
                  )}
                  <span className="mt-1 inline-flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
                    <span>{pkg.total_entries} {t("entriesShort")}</span>
                    <span>·</span>
                    <span>{pkg.validity_days} {t("daysUnit")}</span>
                  </span>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1.5">
                  <div className="flex items-baseline gap-0.5">
                    <span className="text-sm text-muted-foreground">₪</span>
                    <span className="text-lg font-semibold tracking-tight tabular-nums">{pkg.price}</span>
                  </div>
                  <button
                    onClick={() => {
                      if (!user) {
                        saveRedirectAfterLogin(`/provider/${id}`);
                        navigate("/auth");
                        return;
                      }
                      requestPackage.mutate(pkg.id, {
                        onSuccess: () => toast.success(t("purchasePendingNote")),
                        onError: (err) => {
                          if (err instanceof SessionHandledError) return;
                          const key = packageErrorKey(err instanceof Error ? err.message : String(err));
                          toast.error(t(key ? (key as never) : "packageRequestFailed"));
                        },
                      });
                    }}
                    disabled={requestPackage.isPending || hasLivePackage}
                    className="rounded-xl bg-accent px-3 py-1.5 text-[11px] font-semibold text-accent-foreground transition-opacity active:scale-95 disabled:opacity-50"
                  >
                    {t("purchasePackage")}
                  </button>
                </div>
              </motion.div>
            ))}
          </div>
          {hasLivePackage && (
            <p className="mt-2 text-center text-[11px] text-muted-foreground">
              {t("packageAlreadyPending")}
            </p>
          )}
        </section>
      )}

      {/* Reviews */}
      {dbReviews && dbReviews.length > 0 && (
        <section id="provider-reviews" className="mt-8 scroll-mt-20 px-5">
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

      {/* Sticky Book Button — hidden for a studio customer with no spendable
          package. The booking flow would only show them locked cards, and the
          database refuses the insert anyway (NO_ACTIVE_PACKAGE), so offering
          the CTA promises something that cannot happen. The packages section
          above is their path instead. */}
      {/* Also hidden for an academy (courses, no booking flow — main) and
          while the keyboard is up (it would ride over it — this branch). */}
      {canBook && !isAcademy && !keyboardOpen && (
      <div className="fixed inset-x-0 bottom-0 z-50">
        <div className="pointer-events-none absolute inset-x-0 -top-6 h-6 bg-gradient-to-t from-[hsl(40_30%_96%)] to-transparent" />
        <div className="border-t border-white/40 bg-white/70 p-4 pb-[calc(env(safe-area-inset-bottom,0px)+1rem)] backdrop-blur-xl">
          <button
            onClick={() => navigate(`/provider/${provider.id}/book`)}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-accent py-4 text-base font-semibold text-accent-foreground shadow-[0_8px_24px_-8px_hsl(var(--accent)/0.55)] transition-transform active:scale-[0.98]"
          >
            <CalendarPlus className="h-5 w-5" />
            {t("bookAppointment")}
          </button>
        </div>
      </div>
      )}
      </div>
    </div>
  );
};

// Keyed by id: /provider/A -> /provider/B (the "Other branches" rows) stays on
// this route, so without a remount A's local state (cover fallback, expanded
// about, lightbox, collapsing header) would carry over to B.
const ProviderDetailPage = () => {
  const { id } = useParams();
  return <ProviderDetail key={id} />;
};

export default ProviderDetailPage;
