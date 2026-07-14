import { Calendar, Clock, Phone, Star, XCircle, CalendarPlus, History, MessageCircle, Info } from "lucide-react";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { useLang } from "@/contexts/LangContext";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAllProviders } from "@/hooks/useAllProviders";
import { useBookingReview } from "@/hooks/useReviews";
import ReviewForm from "@/components/reviews/ReviewForm";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { Tables } from "@/integrations/supabase/types";

// Fallback cutoff (hours) when a booking's provider can't be resolved (e.g. the
// provider went invisible). Matches the column default; real cutoff comes from
// each booking's OWN provider (provider_profiles.cancellation_notice_hours).
const DEFAULT_CANCELLATION_HOURS = 5;

type TabId = "upcoming" | "history";
type CardVariant = "upcoming" | "history";

const LOCALES: Record<string, string> = { he: "he-IL", ar: "ar", en: "en-US" };

// Combine the stored text date + time into a single Date. booking_date is an
// ISO date ("2026-06-25"), booking_time is "HH:MM" — both stored as text.
const toDateTime = (b: Tables<"bookings">) =>
  new Date(`${b.booking_date}T${b.booking_time}:00`);

// Same phone → wa.me formatting used by the provider dashboard (CalendarTab /
// PendingTab): keep numbers already in 972 form, otherwise drop a leading 0 and
// prefix the Israel country code. Mirrored here so customer + provider links
// build identical URLs.
function toWhatsAppUrl(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("972")) return `https://wa.me/${digits}`;
  const local = digits.startsWith("0") ? digits.slice(1) : digits;
  return `https://wa.me/972${local}`;
}

const Bookings = () => {
  const navigate = useNavigate();
  const { lang, t } = useLang();
  const { user } = useAuth();
  const { providers: allProviders } = useAllProviders();

  const PAGE_SIZE = 20;
  const [page, setPage] = useState(0);
  const [tab, setTab] = useState<TabId>("upcoming");

  const { data: bookingsData, isLoading } = useQuery({
    queryKey: ["bookings", user?.id, page],
    queryFn: async () => {
      if (!user) return { items: [], hasMore: false };
      // Fetch BOTH the customer's own bookings (user_id = me) AND provider-created
      // walk-ins linked to them by phone (linked_user_id = me, user_id NULL). The
      // SELECT RLS policy already permits reading linked rows (view-only). The
      // .or(...) group is AND-combined with the status filter by PostgREST.
      const { data, error } = await supabase
        .from("bookings")
        .select("*")
        .or(`user_id.eq.${user.id},linked_user_id.eq.${user.id}`)
        .in("status", ["confirmed", "pending", "cancelled"])
        .order("booking_date", { ascending: false })
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
      if (error) throw error;
      // Dedupe by id — a row is either user_id=me or linked_user_id=me, never
      // both, but guard so a booking can never render twice.
      const rows = (data || []) as Tables<"bookings">[];
      const items = Array.from(new Map(rows.map((b) => [b.id, b])).values());
      return { items, hasMore: rows.length === PAGE_SIZE };
    },
    enabled: !!user,
  });

  const bookings = bookingsData?.items;
  const hasMore = bookingsData?.hasMore ?? false;

  const getProviderName = (providerId: string) => {
    const p = allProviders.find((p) => p.id === providerId);
    return p ? p.name[lang] : providerId;
  };

  const getServiceNames = (serviceIds: string[]) => {
    for (const provider of allProviders) {
      const matched = provider.services.filter((s) => serviceIds.includes(s.id));
      if (matched.length > 0) return matched.map((s) => s.name[lang]).join("، ");
    }
    return serviceIds.join(", ");
  };

  // Split the loaded page into the two tabs.
  //   UPCOMING = future date/time AND still active (confirmed | pending).
  //   HISTORY  = everything else — any past booking (any status) OR any
  //              cancelled booking even if future-dated.
  // A cancelled booking is never "upcoming" even when its date is ahead.
  const now = Date.now();
  const isActive = (b: Tables<"bookings">) =>
    b.status === "confirmed" || b.status === "pending";

  const upcoming = (bookings ?? [])
    .filter((b) => toDateTime(b).getTime() >= now && isActive(b))
    .sort((a, b) => toDateTime(a).getTime() - toDateTime(b).getTime()); // soonest first

  const history = (bookings ?? [])
    .filter((b) => !(toDateTime(b).getTime() >= now && isActive(b)))
    .sort((a, b) => toDateTime(b).getTime() - toDateTime(a).getTime()); // most recent first

  const activeList = tab === "upcoming" ? upcoming : history;
  const showPager = page > 0 || hasMore;

  const tabs: { id: TabId; label: string; count: number }[] = [
    { id: "upcoming", label: t("tabUpcoming"), count: upcoming.length },
    { id: "history", label: t("tabHistory"), count: history.length },
  ];

  return (
    <div className="relative min-h-screen overflow-x-clip pb-24" style={{ background: "var(--bg-atmosphere)" }}>
      {/* Soft ambient glows — same warm atmosphere as Home. */}
      <div
        aria-hidden
        className="pointer-events-none absolute top-[-3rem] [inset-inline-end:-5rem] h-[22rem] w-[22rem] rounded-full blur-3xl opacity-50"
        style={{ background: "radial-gradient(circle, hsl(24 95% 78% / 0.5) 0%, transparent 65%)" }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute top-[26rem] [inset-inline-start:-6rem] h-[26rem] w-[26rem] rounded-full blur-3xl opacity-45"
        style={{ background: "radial-gradient(circle, hsl(265 60% 80% / 0.4) 0%, transparent 65%)" }}
      />

      <div className="relative">
        <header className="px-5 pt-12 pb-4">
          <h1 className="text-xl font-bold">{t("myBookings")}</h1>
        </header>

        {!user ? (
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }} className="px-5 flex flex-col items-center justify-center py-20">
            <Calendar className="h-12 w-12 text-muted-foreground/40 mb-4" />
            <p className="text-muted-foreground text-sm mb-1">{t("signInToManage")}</p>
            <button onClick={() => navigate("/auth")} className="mt-4 px-6 py-2.5 rounded-2xl bg-accent text-accent-foreground text-sm font-semibold active:scale-[0.98] transition-transform">
              {t("signIn")}
            </button>
          </motion.div>
        ) : (
          <>
            {/* Tab switcher — segmented control (app pattern). */}
            <div className="px-5">
              <div className="flex gap-1 rounded-2xl border border-border bg-secondary/70 p-1 backdrop-blur-sm">
                {tabs.map((tb) => {
                  const isSel = tab === tb.id;
                  return (
                    <motion.button
                      key={tb.id}
                      onClick={() => setTab(tb.id)}
                      whileTap={{ scale: 0.96 }}
                      aria-pressed={isSel}
                      className={`relative flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2.5 text-sm font-semibold transition-colors duration-200 ${
                        isSel ? "text-accent-foreground" : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {isSel && (
                        <motion.div
                          layoutId="bookingsTabPill"
                          className="absolute inset-0 rounded-xl bg-accent shadow-[0_2px_8px_-2px_hsl(var(--accent)/0.5)]"
                          transition={{ type: "spring", stiffness: 380, damping: 32 }}
                        />
                      )}
                      <span className="relative flex items-center gap-1.5">
                        {tb.label}
                        {tb.count > 0 && (
                          <span
                            className={`inline-flex min-w-[18px] items-center justify-center rounded-full px-1 text-[11px] font-bold ${
                              isSel ? "bg-white text-accent" : "bg-muted-foreground/15 text-muted-foreground"
                            }`}
                          >
                            {tb.count}
                          </span>
                        )}
                      </span>
                    </motion.button>
                  );
                })}
              </div>
            </div>

            {isLoading ? (
              <div className="px-5 pt-4 space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-[88px] rounded-3xl bg-card/60 animate-pulse" />
                ))}
              </div>
            ) : activeList.length === 0 ? (
              <EmptyState tab={tab} onExplore={() => navigate("/explore")} />
            ) : (
              <motion.div
                key={tab}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25 }}
                className="px-5 pt-4 space-y-3"
              >
                {activeList.map((booking, i) => (
                  <BookingCard
                    key={booking.id}
                    booking={booking}
                    index={i}
                    variant={tab}
                    isNext={tab === "upcoming" && i === 0}
                    // A row whose user_id isn't the current user is a provider-
                    // created walk-in linked to them by phone: view-only (RLS
                    // blocks update/delete), so owner actions are gated off.
                    isLinkedWalkin={booking.user_id !== user.id}
                    getProviderName={getProviderName}
                    getServiceNames={getServiceNames}
                    providerPhone={allProviders.find((p) => p.id === booking.provider_id)?.phone ?? null}
                    showPrices={allProviders.find((p) => p.id === booking.provider_id)?.showPrices ?? true}
                    cancellationNoticeHours={
                      allProviders.find((p) => p.id === booking.provider_id)?.cancellationNoticeHours
                        ?? DEFAULT_CANCELLATION_HOURS
                    }
                  />
                ))}
              </motion.div>
            )}

            {showPager && !isLoading && (
              <div className="px-5 flex justify-between items-center pt-4 pb-4">
                <button
                  disabled={page === 0}
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  className="text-sm text-accent font-medium disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  ← {lang === "he" ? "הקודם" : lang === "ar" ? "السابق" : "Prev"}
                </button>
                <span className="text-xs text-muted-foreground">
                  {lang === "he" ? `עמוד ${page + 1}` : lang === "ar" ? `صفحة ${page + 1}` : `Page ${page + 1}`}
                </span>
                <button
                  disabled={!hasMore}
                  onClick={() => setPage((p) => p + 1)}
                  className="text-sm text-accent font-medium disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  {lang === "he" ? "הבא" : lang === "ar" ? "التالي" : "Next"} →
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

function EmptyState({ tab, onExplore }: { tab: TabId; onExplore: () => void }) {
  const { t } = useLang();
  const isUpcoming = tab === "upcoming";
  return (
    <motion.div
      key={tab}
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45 }}
      className="px-5 pt-10"
    >
      <div className="glass-card-md mx-auto flex max-w-sm flex-col items-center rounded-3xl px-6 py-12 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-accent/10 mb-5">
          {isUpcoming ? (
            <CalendarPlus className="h-7 w-7 text-accent" />
          ) : (
            <History className="h-7 w-7 text-muted-foreground" />
          )}
        </div>
        <p className="text-base font-semibold mb-1.5">
          {isUpcoming ? t("noUpcomingBookings") : t("noPastBookings")}
        </p>
        {isUpcoming && (
          <>
            <p className="text-sm text-muted-foreground mb-6">{t("noUpcomingHint")}</p>
            <button
              onClick={onExplore}
              className="px-6 py-2.5 rounded-2xl bg-accent text-accent-foreground text-sm font-semibold shadow-[0_8px_20px_-8px_hsl(var(--accent)/0.6)] active:scale-[0.98] transition-transform"
            >
              {t("exploreServices")}
            </button>
          </>
        )}
      </div>
    </motion.div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const { t } = useLang();
  const map: Record<string, { dot: string; cls: string; label: string }> = {
    confirmed: { dot: "bg-green-500", cls: "bg-green-50 text-green-700 ring-green-600/20", label: t("confirmed") },
    pending: { dot: "bg-amber-500", cls: "bg-amber-50 text-amber-700 ring-amber-600/20", label: t("pendingApproval") },
    cancelled: { dot: "bg-red-400", cls: "bg-red-50 text-red-600 ring-red-500/20", label: t("cancelled") },
  };
  const s = map[status] ?? { dot: "bg-muted-foreground", cls: "bg-secondary text-muted-foreground ring-border", label: status };
  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ring-inset ${s.cls}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
}

function DateTile({ booking, variant, isNext }: { booking: Tables<"bookings">; variant: CardVariant; isNext: boolean }) {
  const { lang } = useLang();
  const locale = LOCALES[lang] ?? "en-US";
  const d = toDateTime(booking);
  const weekday = d.toLocaleDateString(locale, { weekday: "short" });
  const day = d.toLocaleDateString(locale, { day: "numeric" });
  const month = d.toLocaleDateString(locale, { month: "short" });

  const tone = isNext
    ? "bg-accent text-accent-foreground shadow-[0_8px_18px_-10px_hsl(var(--accent)/0.7)]"
    : variant === "upcoming"
      ? "bg-accent/10 text-accent"
      : "bg-secondary/80 text-muted-foreground";

  return (
    <div className={`flex h-[60px] w-[54px] shrink-0 flex-col items-center justify-center rounded-2xl ${tone}`}>
      <span className="text-[10px] font-medium uppercase leading-none opacity-80">{weekday}</span>
      <span dir="ltr" className="text-xl font-bold leading-tight tabular-nums">{day}</span>
      <span className="text-[10px] font-medium uppercase leading-none opacity-80">{month}</span>
    </div>
  );
}

function BookingCard({ booking, index, variant, isNext, isLinkedWalkin, getProviderName, getServiceNames, providerPhone, showPrices, cancellationNoticeHours }: {
  booking: Tables<"bookings">;
  index: number;
  variant: CardVariant;
  isNext: boolean;
  isLinkedWalkin: boolean;
  getProviderName: (id: string) => string;
  getServiceNames: (ids: string[]) => string;
  providerPhone: string | null;
  showPrices: boolean;
  cancellationNoticeHours: number;
}) {
  const { t } = useLang();
  const [showReviewForm, setShowReviewForm] = useState(false);
  const { data: existingReview } = useBookingReview(booking.id);

  const queryClient = useQueryClient();
  const bookingDateTime = new Date(`${booking.booking_date}T${booking.booking_time}:00`);
  const now = new Date();
  const isPast = bookingDateTime < now;
  const hoursUntilBooking = (bookingDateTime.getTime() - now.getTime()) / (1000 * 60 * 60);
  const isActive = !isPast && (booking.status === "confirmed" || booking.status === "pending");
  // Cutoff comes from THIS booking's provider. 0 = always cancellable while
  // active (no late-cancel block / call-to-cancel state).
  // Linked walk-ins are view-only for the customer: the UPDATE RLS policy is
  // user_id-only, so a self-cancel would fail. Suppress ALL cancel affordances
  // (self-cancel AND the call-to-cancel window notice) for them — a hint below
  // explains why. Reviews are unaffected (they insert with user_id = me).
  const canCancel = !isLinkedWalkin && isActive && (cancellationNoticeHours <= 0 || hoursUntilBooking > cancellationNoticeHours);
  const canCallToCancel = !isLinkedWalkin && isActive && cancellationNoticeHours > 0 && hoursUntilBooking <= cancellationNoticeHours;
  const canReview = isPast && booking.status === "confirmed" && !existingReview;
  // Cancel UI lives ONLY on the Upcoming tab. (canCancel/canCallToCancel are
  // already false for anything in History, but gate explicitly so History
  // never renders cancel affordances.)
  const isUpcomingTab = variant === "upcoming";

  const cancelMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("bookings")
        .update({ status: "cancelled" })
        .eq("id", booking.id);
      if (error) throw error;

      // Save cancellation notification for the customer
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await supabase.from("notifications").insert({
          user_id: user.id,
          title: "ביטלת תור ❌",
          body: `התור בתאריך ${booking.booking_date} בשעה ${booking.booking_time} בוטל`,
          url: `/provider/${booking.provider_id}`,
          type: "booking_cancelled",
        });
        queryClient.invalidateQueries({ queryKey: ["unread-notifications"] });
        queryClient.invalidateQueries({ queryKey: ["notifications"] });
      }

      // Notify provider about customer cancellation
      const { data: providerProfile } = await supabase
        .from("provider_profiles")
        .select("user_id")
        .eq("id", booking.provider_id)
        .single();
      if (providerProfile?.user_id) {
        await supabase.from("notifications").insert({
          user_id: providerProfile.user_id,
          title: "תור בוטל ❌",
          body: `לקוח ביטל תור בתאריך ${booking.booking_date} בשעה ${booking.booking_time}`,
          url: "/dashboard",
          type: "booking_cancelled",
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bookings"] });
      toast.success(t("bookingCancelled"));
    },
    onError: () => toast.error(t("errorCancelBooking")),
  });

  const surface = variant === "upcoming" ? "glass-card-md" : "surface-soft opacity-[0.92]";
  const nameTone = variant === "upcoming" ? "text-foreground" : "text-foreground/80";
  const hasReviewRow = !isUpcomingTab && (canReview || !!existingReview);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05, duration: 0.3 }}
    >
      <div className={`rounded-3xl ${surface} ${isNext ? "ring-1 ring-accent/30" : ""} p-3.5`}>
        <div className="flex gap-3.5">
          <DateTile booking={booking} variant={variant} isNext={isNext} />

          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex items-start justify-between gap-2">
              <p className={`font-bold text-[15px] leading-tight truncate ${nameTone}`}>
                {getProviderName(booking.provider_id)}
              </p>
              <StatusBadge status={booking.status} />
            </div>

            <p className="mt-1 text-xs text-muted-foreground truncate">
              {getServiceNames(booking.service_ids)}
            </p>

            <div className="mt-auto flex items-center justify-between gap-2 pt-2">
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-foreground/70">
                <Clock className="h-3.5 w-3.5 text-accent" />
                <span dir="ltr" className="tabular-nums">{booking.booking_time}</span>
              </span>
              {showPrices && booking.total_price > 0 ? (
                <span className="text-sm font-bold">₪{booking.total_price}</span>
              ) : null}
            </div>
          </div>
        </div>

        {/* Self-cancel — Upcoming tab, still outside the provider's cutoff window. */}
        {isUpcomingTab && canCancel && (
          <div className="mt-3 flex items-center gap-2 border-t border-border/40 pt-3">
            <Button
              variant="outline"
              size="sm"
              className="text-[11px] h-7 px-2.5 text-red-600 border-red-200 hover:bg-red-50"
              onClick={() => cancelMutation.mutate()}
              disabled={cancelMutation.isPending}
            >
              <XCircle className="h-3 w-3 me-1" />
              {cancelMutation.isPending ? t("cancelling") : t("cancelBooking")}
            </Button>
          </div>
        )}

        {/* Within the cutoff — can no longer self-cancel. One grouped unit:
            explain why (amber timing notice) → how to reach the provider (matched
            WhatsApp + Call buttons). Logic/links unchanged; styling only. */}
        {isUpcomingTab && canCallToCancel && (
          <div className="mt-3 space-y-2.5 border-t border-border/40 pt-3">
            <div className="flex items-start gap-2 rounded-xl border border-amber-300/70 bg-amber-100/80 px-3 py-2.5 text-xs leading-relaxed text-amber-900">
              <Clock className="mt-px h-4 w-4 shrink-0 text-amber-600" />
              <span>{t("cancellationBlocked").replace("{hours}", String(cancellationNoticeHours))}</span>
            </div>
            {providerPhone && (
              <div className="flex items-stretch gap-2">
                <a
                  href={toWhatsAppUrl(providerPhone)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-xl bg-green-600 text-xs font-semibold text-white shadow-[0_6px_14px_-8px_rgba(22,163,74,0.8)] transition-colors hover:bg-green-700"
                >
                  <MessageCircle className="h-4 w-4" />
                  WhatsApp
                </a>
                <a
                  href={`tel:${providerPhone}`}
                  className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-xl bg-accent text-xs font-semibold text-accent-foreground shadow-[0_6px_14px_-8px_hsl(var(--accent)/0.8)] transition-opacity hover:opacity-90"
                >
                  <Phone className="h-4 w-4" />
                  {t("call")}
                </a>
              </div>
            )}
          </div>
        )}

        {/* Linked walk-in — provider created this booking (matched to the
            customer by phone). It's view-only: no self-cancel (RLS blocks it),
            so a subtle hint replaces the cancel affordance on the Upcoming tab. */}
        {isUpcomingTab && isLinkedWalkin && isActive && (
          <div className="mt-3 flex items-start gap-2 border-t border-border/40 pt-3 text-xs leading-relaxed text-muted-foreground">
            <Info className="mt-px h-3.5 w-3.5 shrink-0 text-accent" />
            <span>{t("bookedByProvider")}</span>
          </div>
        )}

        {/* Review — History tab (past, confirmed). */}
        {hasReviewRow && (
          <div className="mt-3 flex items-center gap-2 border-t border-border/40 pt-3">
            {canReview ? (
              <button
                onClick={() => setShowReviewForm(!showReviewForm)}
                className="inline-flex items-center gap-1.5 rounded-xl border border-accent/25 bg-accent/5 px-3 py-1.5 text-xs font-semibold text-accent transition-colors hover:bg-accent/10 active:scale-[0.98]"
              >
                <Star className="h-3.5 w-3.5 fill-accent text-accent" />
                {t("leaveReview")}
              </button>
            ) : existingReview ? (
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <Star className="h-3.5 w-3.5 fill-accent text-accent" />
                {t("reviewed")}
              </span>
            ) : null}
          </div>
        )}
      </div>

      {showReviewForm && (
        <div className="mt-2">
          <ReviewForm
            bookingId={booking.id}
            providerId={booking.provider_id}
            onSubmitted={() => setShowReviewForm(false)}
          />
        </div>
      )}
    </motion.div>
  );
}

export default Bookings;
