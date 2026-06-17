import { useNavigate } from "react-router-dom";
import {
  ArrowUp,
  ArrowDown,
  Minus,
  Users,
  Store,
  UserPlus,
  Star,
  TrendingUp,
  Moon,
} from "lucide-react";
import { useLang } from "@/contexts/LangContext";
import {
  useAdminCounts,
  useAdminTodayBookings,
  useAdminProviderCounts,
  useAdminLowRatings,
  type AdminReview,
} from "@/hooks/useAdminDashboard";
import { BookingsTrendChart } from "./dashboard/BookingsTrendChart";
import {
  CARD,
  SectionCard,
  BookingRow,
  ListSkeleton,
  EmptyState,
  ErrorState,
  fmtDayMonth,
} from "./dashboard/dashboard-ui";

// Section heading with the brand orange accent bar — matches the customer
// home's SectionTitle. The bar is first in the flex row, so RTL handles its
// side automatically (right of the text in he/ar, left in en).
function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="flex items-center gap-2 text-[15px] font-bold tracking-tight px-1">
      <span aria-hidden className="block h-3.5 w-1 shrink-0 rounded-full bg-accent" />
      {children}
    </h2>
  );
}

// ── Trend pill ───────────────────────────────────────────────────────────────
// Vertical arrows (▲ up / ▼ down) — deliberately direction-NEUTRAL so meaning
// never flips in RTL: up = more, regardless of he/ar/en text direction.
function Trend({ current, previous }: { current: number; previous: number }) {
  const { t } = useLang();
  const delta = current - previous;
  const pct = previous > 0 ? Math.round((delta / previous) * 100) : current > 0 ? 100 : 0;
  const Icon = delta > 0 ? ArrowUp : delta < 0 ? ArrowDown : Minus;
  const color = delta > 0 ? "text-emerald-600" : delta < 0 ? "text-rose-600" : "text-muted-foreground";
  return (
    <span className={`inline-flex items-center gap-0.5 text-[11px] font-semibold ${color}`}>
      <Icon className="h-3 w-3" />
      <span className="tabular-nums" dir="ltr">{pct > 0 ? `${Math.abs(pct)}%` : "—"}</span>
      <span className="text-muted-foreground font-normal">{t("dashVsLastWeek")}</span>
    </span>
  );
}

function KpiCard({
  icon: Icon,
  iconColor,
  label,
  value,
  sub,
}: {
  icon: typeof Users;
  iconColor: string;
  label: string;
  value: number | string;
  sub?: React.ReactNode;
}) {
  return (
    <div className={`${CARD} p-4 flex flex-col gap-1.5`}>
      <div className="flex items-center gap-2">
        <Icon className={`h-4 w-4 ${iconColor}`} />
        <span className="text-xs text-muted-foreground">{label}</span>
      </div>
      <span className="text-2xl font-bold tabular-nums">{value}</span>
      {sub && <div className="min-h-[16px]">{sub}</div>}
    </div>
  );
}

function StarRow({ rating }: { rating: number }) {
  return (
    <span className="inline-flex items-center gap-0.5">
      {Array.from({ length: 5 }).map((_, i) => (
        <Star
          key={i}
          className={`h-3 w-3 ${i < rating ? "fill-amber-400 text-amber-400" : "text-muted-foreground/30"}`}
        />
      ))}
    </span>
  );
}

// Low-rating review row — always rendered in the highlighted (rose) treatment
// since the strip only contains ratings <= 2.
function LowRatingRow({ review }: { review: AdminReview }) {
  return (
    <div className="py-2.5 -mx-2 px-2 rounded-lg bg-rose-50 border-b border-border/60 last:border-0">
      <div className="flex items-center justify-between gap-2 mb-0.5">
        <span className="text-sm font-semibold truncate">{review.business_name || "—"}</span>
        <StarRow rating={review.rating} />
      </div>
      {review.comment ? (
        <p className="text-xs text-muted-foreground line-clamp-2">{review.comment}</p>
      ) : null}
      <p className="text-[10px] text-muted-foreground mt-0.5">
        {review.display_name || ""} · {fmtDayMonth(review.created_at.slice(0, 10))}
      </p>
    </div>
  );
}

// ── 1. Growth KPIs ──────────────────────────────────────────────────────────
function GrowthSection() {
  const { t } = useLang();
  const { data: c, isLoading, isError } = useAdminCounts();

  return (
    <div className="space-y-3">
      <SectionTitle>{t("dashGrowth")}</SectionTitle>
      {isLoading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 rounded-2xl bg-muted animate-pulse" />
          ))}
        </div>
      ) : isError || !c ? (
        <div className={`${CARD} p-4`}>
          <ErrorState />
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <KpiCard
            icon={TrendingUp}
            iconColor="text-violet-500"
            label={t("dashBookingsThisWeek")}
            value={c.bookings_this_week}
            sub={<Trend current={c.bookings_this_week} previous={c.bookings_last_week} />}
          />
          <KpiCard
            icon={UserPlus}
            iconColor="text-blue-500"
            label={t("dashNewUsers")}
            value={c.new_users_this_week}
            sub={<span className="text-[11px] text-muted-foreground">{t("dashThisWeek")}</span>}
          />
          <KpiCard
            icon={Store}
            iconColor="text-emerald-500"
            label={t("dashNewProviders")}
            value={c.new_providers_this_week}
            sub={<span className="text-[11px] text-muted-foreground">{t("dashThisWeek")}</span>}
          />
          <KpiCard
            icon={Users}
            iconColor="text-amber-500"
            label={t("dashTotalUsers")}
            value={c.total_users}
            sub={
              <span className="text-[11px] text-muted-foreground">
                {c.total_active_providers} · {t("dashActiveProviders")}
              </span>
            }
          />
        </div>
      )}
    </div>
  );
}

// ── 2. Bookings last 30 days (chart) ────────────────────────────────────────
function TrendSection() {
  const { t } = useLang();
  return (
    <div className="space-y-3">
      <SectionTitle>{t("dashBookingsTrend")}</SectionTitle>
      <div className={`${CARD} p-4`}>
        <BookingsTrendChart />
      </div>
    </div>
  );
}

// ── 3. Today's bookings ─────────────────────────────────────────────────────
function TodaySection() {
  const { t } = useLang();
  const counts = useAdminCounts();
  const today = useAdminTodayBookings();

  return (
    <SectionCard title={t("dashTodayBookings")} count={counts.data?.bookings_today}>
      {today.isLoading ? (
        <ListSkeleton />
      ) : today.isError ? (
        <ErrorState />
      ) : today.data && today.data.length > 0 ? (
        <div>
          {today.data.map((r) => (
            <BookingRow key={r.booking_id} row={r} />
          ))}
        </div>
      ) : (
        <EmptyState message={t("dashNoToday")} />
      )}
    </SectionCard>
  );
}

// ── 4 & 5. Performers: top providers + dormant providers ────────────────────
function PerformersSection() {
  const { t } = useLang();
  const navigate = useNavigate();
  const providers = useAdminProviderCounts();

  const top = (providers.data ?? []).filter((p) => p.bookings_count > 0).slice(0, 5);
  const dormant = (providers.data ?? []).filter((p) => p.bookings_count === 0).slice(0, 6);

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {/* Top providers */}
      <SectionCard title={t("dashTopProviders")}>
        {providers.isLoading ? (
          <ListSkeleton />
        ) : providers.isError ? (
          <ErrorState />
        ) : top.length > 0 ? (
          <div>
            {top.map((p, i) => (
              <button
                key={p.provider_id}
                onClick={() => navigate(`/provider/${p.provider_id}`)}
                className="w-full flex items-center gap-3 py-2.5 border-b border-border/60 last:border-0 text-start active:scale-[0.99] transition-transform"
              >
                <span className="w-5 text-xs font-bold text-muted-foreground tabular-nums">
                  {i + 1}
                </span>
                <span className="flex-1 min-w-0 text-sm font-semibold truncate">
                  {p.business_name}
                </span>
                <span className="text-xs font-bold tabular-nums shrink-0">
                  {p.bookings_count}{" "}
                  <span className="text-muted-foreground font-normal">{t("dashBookingsUnit")}</span>
                </span>
              </button>
            ))}
          </div>
        ) : (
          <EmptyState message={t("chartNoData")} />
        )}
      </SectionCard>

      {/* Dormant providers */}
      <SectionCard title={t("dashDormantProviders")} count={dormant.length}>
        {providers.isLoading ? (
          <ListSkeleton />
        ) : providers.isError ? (
          <ErrorState />
        ) : dormant.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {dormant.map((p) => (
              <button
                key={p.provider_id}
                onClick={() => navigate(`/provider/${p.provider_id}`)}
                className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full bg-secondary text-secondary-foreground hover:bg-rose-100 hover:text-rose-700 transition-colors"
              >
                <Moon className="h-3 w-3" />
                <span className="truncate max-w-[120px]">{p.business_name}</span>
              </button>
            ))}
          </div>
        ) : (
          <EmptyState message={t("dashNoDormant")} />
        )}
      </SectionCard>
    </div>
  );
}

// ── Low ratings strip (reduced replacement for the recent-reviews section) ───
function LowRatingsSection() {
  const { t } = useLang();
  const { data, isLoading, isError } = useAdminLowRatings(5);

  return (
    <SectionCard title={t("dashLowRatings")} count={data?.length} highlight>
      {isLoading ? (
        <ListSkeleton rows={2} />
      ) : isError ? (
        <ErrorState />
      ) : data && data.length > 0 ? (
        <div>
          {data.map((r) => (
            <LowRatingRow key={r.id} review={r} />
          ))}
        </div>
      ) : (
        <EmptyState message={t("dashNoLowRatings")} />
      )}
    </SectionCard>
  );
}

export function AdminDashboard() {
  return (
    <div className="space-y-6">
      <GrowthSection />
      <TrendSection />
      <TodaySection />
      <PerformersSection />
      <LowRatingsSection />
    </div>
  );
}
