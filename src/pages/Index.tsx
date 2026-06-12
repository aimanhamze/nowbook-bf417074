import { useEffect, useState } from "react";
import { SearchBar } from "@/components/home/SearchBar";
import { CategoryRow } from "@/components/home/CategoryRow";
import { ProviderCardGrid } from "@/components/home/ProviderCardGrid";
import { ForwardArrow } from "@/components/ui/directional-icon";
import { Skeleton } from "@/components/ui/skeleton";
import { Bell, CalendarDays, Moon, Store, Sun, Sunrise, Sunset, User as UserIcon, type LucideIcon } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { format, isToday, isTomorrow, parseISO } from "date-fns";
import { he, ar, enUS } from "date-fns/locale";
import { useAllProviders, useAllProviderSchedules } from "@/hooks/useAllProviders";
import type { ProviderSchedule } from "@/hooks/useAllProviders";
import { getProviderStatus } from "@/lib/providerStatus";
import { useFavorites } from "@/hooks/useFavorites";
import { beautyCategories, healthCategories, fitnessCategories } from "@/lib/mock-data";
import { useLang } from "@/contexts/LangContext";
import { useAuth } from "@/contexts/AuthContext";
import { Navigate, useNavigate } from "react-router-dom";
import type { Provider } from "@/lib/mock-data";

const MAX_FAVORITES_SHOWN = 10;
const CARD_WIDTH = "w-[165px]";
// One consistent heading color across Home (hero line 1 + all section titles):
// a dark gray one step down from the near-black foreground token (~gray-700).
const HEADING_TEXT = "text-foreground/75";


function sortFavoritesFirst(providers: Provider[], favoriteIds: string[]): Provider[] {
  return [...providers].sort((a, b) => {
    const aFav = favoriteIds.includes(a.id) ? 1 : 0;
    const bFav = favoriteIds.includes(b.id) ? 1 : 0;
    return bFav - aFav;
  });
}

/** Single source of truth for the time-aware greeting: the translation key
    and its matching icon always switch together on the same hour ranges. */
function getGreetingParts(now: Date): { key: string; Icon: LucideIcon } {
  const hour = now.getHours();
  if (hour >= 5 && hour < 12) return { key: "goodMorning", Icon: Sunrise };
  if (hour >= 12 && hour < 17) return { key: "goodAfternoon", Icon: Sun };
  if (hour >= 17 && hour < 21) return { key: "goodEvening", Icon: Sunset };
  return { key: "goodNight", Icon: Moon };
}

function toLocalDateStr(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Round header avatar (~40px): photo when available, otherwise the user's
    initial on the warm soft background. Taps through to Profile. */
function HeaderAvatar({ src, initial, label, onClick }: {
  src: string | null;
  initial: string | null;
  label: string;
  onClick: () => void;
}) {
  const [imgOk, setImgOk] = useState(!!src);
  return (
    // 44px button (tap target) around the 40px visual circle.
    <button
      onClick={onClick}
      aria-label={label}
      className="flex h-11 w-11 shrink-0 items-center justify-center transition-transform active:scale-95"
    >
      <span className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full bg-accent/15 ring-1 ring-white/60 shadow-[0_4px_12px_-6px_rgba(120,70,30,0.3)]">
        {imgOk && src ? (
          <img
            src={src}
            alt=""
            className="h-full w-full object-cover"
            onError={() => setImgOk(false)}
          />
        ) : initial ? (
          <span className="text-sm font-bold text-accent">{initial}</span>
        ) : (
          <UserIcon className="h-5 w-5 text-accent" />
        )}
      </span>
    </button>
  );
}

/** Home section title: bold text with the short brand-orange bar on the
    inline-start side (right of the text in he/ar, left in en — the bar is
    simply first in the flex row, so direction handles itself). */
function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className={`flex items-center gap-2 text-[15px] font-bold tracking-tight ${HEADING_TEXT}`}>
      <span aria-hidden className="block h-3.5 w-1 shrink-0 rounded-full bg-accent" />
      {children}
    </h2>
  );
}

/** Mirrors the loaded rail's exact card width and fixed image height so
    nothing shifts when real cards arrive. */
function RailSkeleton() {
  return (
    <div className="flex gap-3 overflow-hidden px-5 pb-1" aria-hidden>
      {[0, 1, 2].map((i) => (
        <div key={i} className={`surface-soft ${CARD_WIDTH} shrink-0 overflow-hidden rounded-2xl`}>
          <Skeleton className="h-[104px] w-full rounded-none" />
          <div className="flex flex-col p-3">
            <Skeleton className="h-3.5 w-24 rounded-full" />
            <Skeleton className="mt-1.5 h-3 w-16 rounded-full" />
            <Skeleton className="mt-2.5 h-3 w-12 rounded-full" />
            <Skeleton className="mt-2 h-3 w-14 rounded-full" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** First word only when the full name would overflow the ~72px tile —
    avoids the broken-looking "DR.Moham..." hard truncation. */
function favoriteDisplayName(fullName: string): string {
  const trimmed = fullName.trim();
  if (trimmed.length <= 12) return trimmed;
  return trimmed.split(/\s+/)[0];
}

interface FavoriteStoryProps {
  provider: Provider;
  schedule?: ProviderSchedule;
  now: Date;
  onClick: () => void;
}

/** "Stories"-style favorite tile: round avatar in a decorative warm gradient
    ring (same on every favorite). Open-now is shown only by the green dot
    badge (same schedule data as the cards below). Fixed sizes — no shift. */
function FavoriteStory({ provider, schedule, now, onClick }: FavoriteStoryProps) {
  const { lang } = useLang();
  const [imgOk, setImgOk] = useState(!!provider.image);

  const isOpen = (() => {
    if (!schedule) return false;
    return getProviderStatus(schedule.availability, schedule.blockedDates, now).isOpen;
  })();

  const initial = provider.name[lang].trim()[0]?.toUpperCase() ?? "·";

  return (
    <button
      onClick={onClick}
      className="flex w-[72px] shrink-0 snap-start flex-col items-center gap-1.5 transition-transform active:scale-95"
    >
      {/* Decorative story-style gradient ring, identical on every favorite
          (open/closed is the dot badge's job). Warm conic flow derived from the
          brand accent hsl(24 80% 55%): amber → orange → soft coral. The cream
          inner pad (the atmosphere gradient's dominant stop) gives a clean gap
          so the ring reads on both light and dark avatar photos. Total 68px —
          the same visual footprint the previous ring+offset occupied. */}
      <div
        className="relative h-[68px] w-[68px] shrink-0 rounded-full p-[2.5px]"
        style={{
          background:
            "conic-gradient(from 220deg, hsl(38 90% 55%), hsl(24 80% 55%), hsl(10 80% 68%), hsl(38 90% 55%))",
        }}
      >
        <div className="h-full w-full rounded-full bg-[hsl(40_30%_96%)] p-[2px]">
          <div className="flex h-full w-full items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-accent/30 via-accent/10 to-[hsl(265_45%_88%)]">
            {imgOk ? (
              <img
                src={provider.image}
                alt={provider.name[lang]}
                className="h-full w-full object-cover"
                loading="lazy"
                onError={() => setImgOk(false)}
              />
            ) : (
              <span className="text-lg font-bold text-accent">{initial}</span>
            )}
          </div>
        </div>
        {isOpen && (
          <span
            aria-hidden
            className="absolute bottom-0 end-0 h-3 w-3 rounded-full bg-green-500 ring-2 ring-[hsl(40_30%_96%)]"
          />
        )}
      </div>
      <span
        dir="auto"
        className="w-full truncate text-center text-[11px] font-medium leading-tight text-muted-foreground"
      >
        {favoriteDisplayName(provider.name[lang])}
      </span>
    </button>
  );
}

const Index = () => {
  const { t, lang } = useLang();
  const { isProvider, isAdmin, user } = useAuth();
  const navigate = useNavigate();
  const { providers, isLoading } = useAllProviders();
  const { favoriteIds } = useFavorites();
  const { schedulesByProviderId } = useAllProviderSchedules();

  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);


  // Same queryKey + select as Profile.tsx, so React Query dedupes the fetch.
  const { data: profileData } = useQuery({
    queryKey: ["user-profile", user?.id],
    queryFn: async () => {
      if (!user) return null;
      const { data } = await supabase
        .from("profiles")
        .select("display_name, avatar_url")
        .eq("user_id", user.id)
        .single();
      return data;
    },
    enabled: !!user,
  });

  // Next upcoming booking — same own-rows pattern as the Bookings (תורים) tab,
  // narrowed to upcoming confirmed/pending. Small fetch, picks the first
  // booking whose date+time is still ahead of now.
  const { data: nextBooking, isLoading: nextBookingLoading } = useQuery({
    queryKey: ["next-booking", user?.id],
    queryFn: async () => {
      if (!user) return null;
      const { data, error } = await supabase
        .from("bookings")
        .select("*")
        .eq("user_id", user.id)
        .in("status", ["confirmed", "pending"])
        .gte("booking_date", toLocalDateStr(new Date()))
        .order("booking_date", { ascending: true })
        .order("booking_time", { ascending: true })
        .limit(5);
      if (error) throw error;
      const current = new Date();
      const upcoming = ((data || []) as Tables<"bookings">[]).find(
        (b) => new Date(`${b.booking_date}T${b.booking_time}:00`) >= current
      );
      return upcoming ?? null;
    },
    enabled: !!user,
  });

  // Same queryKey + queryFn as BottomNav's bell badge — React Query shares the
  // cached count, so the header bell always shows the exact same number.
  const { data: unreadCount = 0 } = useQuery({
    queryKey: ["unread-notifications", user?.id],
    staleTime: 30 * 1000,
    queryFn: async () => {
      if (!user) return 0;
      const { count, error } = await supabase
        .from("notifications")
        .select("*", { count: "exact", head: true })
        .eq("user_id", user.id)
        .eq("is_read", false);
      if (error) return 0;
      return count || 0;
    },
    enabled: !!user,
    refetchInterval: 30000,
  });

  const dateFnsLocale = lang === "he" ? he : lang === "ar" ? ar : enUS;

  // Greeting name: only a real display name qualifies. Some accounts store the
  // email as their name — never greet with an email (or anything derived from
  // it); fall back to the plain greeting instead.
  const rawName = (profileData?.display_name || user?.user_metadata?.full_name || "").trim();
  const firstName = rawName && !rawName.includes("@") ? rawName.split(/\s+/)[0] : null;
  const { key: greetingKey, Icon: GreetingIcon } = getGreetingParts(now);
  const greeting = t(greetingKey);
  const greetingLine = firstName
    ? `${greeting}${lang === "ar" ? "، " : ", "}${firstName}`
    : greeting;
  // An email-derived initial is fine for the avatar fallback (unlike the greeting).
  const avatarInitial =
    (firstName?.[0] || user?.email?.[0])?.toUpperCase() ?? null;

  const smartBookingDate = (dateStr: string): string => {
    const d = parseISO(dateStr);
    if (isToday(d)) return t("today");
    if (isTomorrow(d)) return t("tomorrow");
    return format(d, "EEEE, d MMM", { locale: dateFnsLocale });
  };

  const nextBookingProvider = nextBooking
    ? providers.find((p) => p.id === nextBooking.provider_id)
    : undefined;

  if (isAdmin) {
    return <Navigate to="/admin" replace />;
  }

  if (isProvider) {
    return <Navigate to="/calendar" replace />;
  }

  const favoriteProviders = providers
    .filter((p) => favoriteIds.includes(p.id))
    .slice(0, MAX_FAVORITES_SHOWN);

  const sections = [
    {
      key: "beauty",
      title: t("beautyAndCosmetics"),
      providers: sortFavoritesFirst(
        providers.filter((p) => (beautyCategories as readonly string[]).includes(p.category)),
        favoriteIds
      ),
    },
    {
      key: "health",
      title: t("healthProfessionals"),
      providers: sortFavoritesFirst(
        providers.filter((p) => (healthCategories as readonly string[]).includes(p.category)),
        favoriteIds
      ),
    },
    {
      key: "fitness",
      title: t("fitnessStudio"),
      providers: sortFavoritesFirst(
        providers.filter((p) => (fitnessCategories as readonly string[]).includes(p.category)),
        favoriteIds
      ),
    },
  ];

  const seeAllLink = (onClick: () => void) => (
    <button
      className="-my-2 flex min-h-[44px] items-center gap-0.5 text-sm font-medium text-accent transition-opacity active:opacity-70"
      onClick={onClick}
    >
      {t("seeAll")}
      <ForwardArrow className="h-4 w-4" />
    </button>
  );

  return (
    <div
      className="relative min-h-screen overflow-x-clip pb-28"
      style={{ background: "var(--bg-atmosphere)" }}
    >
      {/* Radial accent glows — anchored via logical insets so they stay on the
          headline/favorites side in both LTR and RTL. */}
      <div
        aria-hidden
        className="pointer-events-none absolute top-[-4rem] [inset-inline-end:-4rem] h-[26rem] w-[26rem] rounded-full blur-3xl opacity-60"
        style={{ background: "radial-gradient(circle, hsl(24 95% 78% / 0.55) 0%, transparent 65%)" }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute top-[28rem] [inset-inline-start:-6rem] h-[32rem] w-[32rem] rounded-full blur-3xl opacity-55"
        style={{ background: "radial-gradient(circle, hsl(265 60% 80% / 0.45) 0%, transparent 65%)" }}
      />

      <div className="relative">
        {/* ── Centered header ──────────────────────────────────────────────── */}
        {/* Top padding respects the PWA safe-area inset (notch devices). */}
        <header className="relative px-5 pb-5 pt-[calc(env(safe-area-inset-top)+2rem)]">
          {/* Corner buttons live OUTSIDE the animated wrapper: an animated
              parent transform moves absolutely-positioned children, which made
              them visibly jump on every route remount. Dir-aware logical
              insets; top matches the header's safe-area padding (minus the 2px
              the 44px tap target adds around the 40px circle). */}
          {user && (
            <div className="absolute top-[calc(env(safe-area-inset-top)+1.75rem)] [inset-inline-start:1rem]">
              <HeaderAvatar
                src={profileData?.avatar_url || null}
                initial={avatarInitial}
                label={t("profile")}
                onClick={() => navigate("/profile")}
              />
            </div>
          )}
          <div className="absolute top-[calc(env(safe-area-inset-top)+1.75rem)] [inset-inline-end:1rem]">
            {/* 44px button (tap target) around the 40px visual circle. */}
            <button
              onClick={() => navigate("/notifications")}
              aria-label={t("notificationsLabel")}
              className="flex h-11 w-11 shrink-0 items-center justify-center transition-transform active:scale-95"
            >
              <span className="surface-soft relative flex h-10 w-10 items-center justify-center rounded-full">
                <Bell className="h-5 w-5 text-foreground/70" />
                {unreadCount > 0 && (
                  <span className="absolute -top-1 -end-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground">
                    {unreadCount > 9 ? "9+" : unreadCount}
                  </span>
                )}
              </span>
            </button>
          </div>

          {/* CSS entrance (opacity + transform only). The corners above are
              siblings, not children, so this transform can't move them. */}
          <div className="animate-home-enter">
            {/* Centered greeting + title + subtitle — starts at the header top,
                level with the corner buttons. px-9 (+ the header's px-5) keeps
                ≥56px clear of each corner so long greetings can't overlap. */}
            <div className="flex flex-col items-center px-9 text-center">
              <GreetingIcon aria-hidden className="h-5 w-5 text-accent/80" />
              <p className="mt-1.5 max-w-full truncate text-[15px] font-medium text-foreground/50">
                {greetingLine}
              </p>
              {/* Deliberate two-line title — one block per line in every
                  language, accent on the short emphatic second line. */}
              <h1 className="mt-1.5 text-[2rem] font-extrabold leading-[1.15] tracking-tight">
                <span className={`block ${HEADING_TEXT}`}>{t("homeTitleLine1")}</span>
                <span className="block font-black text-accent">{t("homeTitleLine2")}</span>
              </h1>
              <p className="mt-2 text-[13px] text-muted-foreground">
                {t("homeSubtitle")}
              </p>
            </div>
          </div>
        </header>

        {/* ── Search bar ───────────────────────────────────────────────────── */}
        <div className="animate-home-enter px-5 mb-10" style={{ animationDelay: "60ms" }}>
          <SearchBar onNearbyClick={() => navigate("/nearby")} />
        </div>

        {/* ── Next-appointment strip — only when an upcoming booking exists ── */}
        {user && nextBookingLoading && (
          <div className="px-5 mb-10">
            <Skeleton className="h-[60px] w-full rounded-2xl" />
          </div>
        )}
        {user && !nextBookingLoading && nextBooking && (
          <div className="animate-home-enter px-5 mb-10" style={{ animationDelay: "90ms" }}>
            <button
              onClick={() => navigate("/bookings")}
              className="surface-soft flex w-full items-center gap-3 rounded-2xl px-3.5 py-3 text-start transition-transform active:scale-[0.99]"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent/10">
                <CalendarDays className="h-[18px] w-[18px] text-accent" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[11px] font-medium text-muted-foreground">
                  {t("upcomingBookingLabel")}
                </span>
                <span className="block truncate text-sm font-semibold text-foreground">
                  {nextBookingProvider ? `${nextBookingProvider.name[lang]} · ` : ""}
                  {smartBookingDate(nextBooking.booking_date)} · {nextBooking.booking_time.slice(0, 5)}
                </span>
              </span>
              {nextBooking.status === "pending" && (
                <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                  {t("pendingApproval")}
                </span>
              )}
              <ForwardArrow className="h-4 w-4 shrink-0 text-muted-foreground" />
            </button>
          </div>
        )}

        {/* ── My Favorites — only when logged in with at least 1 favorite ─── */}
        {user && favoriteProviders.length > 0 && (
          <section className="animate-home-enter mb-9" style={{ animationDelay: "120ms" }}>
            <div className="mb-2.5 flex items-center justify-between px-5">
              <SectionTitle>{t("myFavorites")}</SectionTitle>
              {seeAllLink(() => navigate("/favorites"))}
            </div>
            <div className="flex gap-2.5 overflow-x-auto px-5 pb-1 scrollbar-none [scroll-snap-type:x_proximity] [scroll-padding-inline-start:1.25rem]">
              {favoriteProviders.map((p) => (
                <FavoriteStory
                  key={p.id}
                  provider={p}
                  schedule={schedulesByProviderId.get(p.id)}
                  now={now}
                  onClick={() => navigate(`/provider/${p.id}`)}
                />
              ))}
            </div>
          </section>
        )}

        {/* ── Categories: ONE row covering all categories ──────────────────── */}
        <section className="animate-home-enter mb-9" style={{ animationDelay: "150ms" }}>
          <div className="mb-2.5 px-5">
            <SectionTitle>{t("browseByCategory")}</SectionTitle>
          </div>
          <CategoryRow />
        </section>

        {/* ── Friendly fallback when nothing loaded ────────────────────────── */}
        {!isLoading && providers.length === 0 && (
          <section className="animate-home-enter px-5 mb-9" style={{ animationDelay: "150ms" }}>
            <div className="surface-soft flex flex-col items-center gap-3 rounded-2xl px-6 py-8 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-accent/10">
                <Store className="h-6 w-6 text-accent" />
              </div>
              <p className="text-sm font-semibold text-foreground/80">{t("noProvidersFound")}</p>
            </div>
          </section>
        )}

        {/* ── Provider sections: header + horizontal snap rail ─────────────── */}
        {sections.map((section, sectionIndex) => (
          (isLoading || section.providers.length > 0) && (
            <section
              key={section.key}
              className="animate-home-enter mb-9 last:mb-0"
              style={{ animationDelay: `${180 + sectionIndex * 60}ms` }}
            >
              <div className="mb-2.5 flex items-center justify-between px-5">
                <SectionTitle>{section.title}</SectionTitle>
                {seeAllLink(() => navigate(`/explore?group=${section.key}`))}
              </div>
              {isLoading ? (
                <RailSkeleton />
              ) : (
                <div className="scroll-rail gap-3 px-5 pb-1 [scroll-padding-inline-start:1.25rem] [scroll-padding-inline-end:1.25rem]">
                  {section.providers.map((provider) => (
                    <div key={provider.id} className={`${CARD_WIDTH} shrink-0 snap-start`}>
                      <ProviderCardGrid
                        provider={provider}
                        schedule={schedulesByProviderId.get(provider.id)}
                        now={now}
                      />
                    </div>
                  ))}
                </div>
              )}
            </section>
          )
        ))}
      </div>
    </div>
  );
};

export default Index;
