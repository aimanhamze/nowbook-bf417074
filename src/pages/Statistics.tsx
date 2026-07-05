import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useLang } from "@/contexts/LangContext";
import { useAuth } from "@/contexts/AuthContext";
import { useProviderProfile } from "@/hooks/useProviderProfile";
import { useProviderStats } from "@/hooks/useProviderStats";
import { BackArrow } from "@/components/ui/directional-icon";
import { Button } from "@/components/ui/button";
import { CalendarDays, Star, Users, Receipt } from "lucide-react";
import { StatsCharts } from "@/components/statistics/StatsCharts";
import { providerDesktopPage, providerDesktopColumn } from "@/components/layout/providerDesktop";

// Period window for the statistics aggregation. Wired to data in Phase 2.
export type StatsPeriod = "week" | "month" | "3months";

const PERIODS: { id: StatsPeriod; labelKey: "statsPeriodWeek" | "statsPeriodMonth" | "statsPeriod3Months" }[] = [
  { id: "week", labelKey: "statsPeriodWeek" },
  { id: "month", labelKey: "statsPeriodMonth" },
  { id: "3months", labelKey: "statsPeriod3Months" },
];

// Standalone provider Statistics page. Mirrors the Reviews.tsx shell
// (provider-gated, back arrow → profile). v1 aggregates client-side over
// useProviderBookings — added in later phases. This phase is shell only.
export default function Statistics() {
  const { t } = useLang();
  const { user, isProvider } = useAuth();
  const navigate = useNavigate();
  const { profile, isLoading } = useProviderProfile();
  const [period, setPeriod] = useState<StatsPeriod>("month");
  const { stats, isLoading: statsLoading } = useProviderStats(period);

  useEffect(() => {
    if (user && !isProvider) {
      navigate("/", { replace: true });
    }
  }, [user, isProvider, navigate]);

  if (!user || !isProvider) return null;

  // No profile yet — mirror the other provider pages' graceful guard.
  if (!isLoading && !profile) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-5 gap-4">
        <p className="text-muted-foreground text-center">{t("profileNotSetup")}</p>
        <Button onClick={() => navigate("/")}>{t("home")}</Button>
      </div>
    );
  }

  return (
    <div className={`min-h-screen pb-24 ${providerDesktopPage}`}>
      <div className={providerDesktopColumn}>
      <header className="px-5 pt-12 pb-4">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate("/profile")} className="active:scale-95" aria-label={t("profile")}>
            <BackArrow className="h-5 w-5" />
          </button>
          <h1 className="text-xl font-bold flex-1">{t("statisticsTitle")}</h1>
        </div>
      </header>

      <div className="px-5">
        {/* Period selector — segmented control. Mirrors the language switcher
            style on Profile for visual consistency. RTL-safe via flex. */}
        <div className="flex gap-2">
          {PERIODS.map(({ id, labelKey }) => (
            <button
              key={id}
              onClick={() => setPeriod(id)}
              className={`flex-1 py-2.5 rounded-xl text-sm font-medium transition-all active:scale-[0.97] ${
                period === id
                  ? "bg-accent text-accent-foreground shadow-[0_8px_20px_-8px_hsl(24_80%_55%_/_0.6)]"
                  : "bg-white/50 text-foreground/70 hover:bg-white/70"
              }`}
            >
              {t(labelKey)}
            </button>
          ))}
        </div>

        {/* Summary stat cards — mirrors AdminStats grid/tokens. Charts: Phase 4. */}
        {statsLoading ? (
          <div className="mt-4">
            <div className="h-28 rounded-2xl bg-muted animate-pulse mb-3" />
            <div className="grid grid-cols-2 gap-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-24 rounded-2xl bg-muted animate-pulse" />
              ))}
            </div>
          </div>
        ) : (
          <div className="mt-4">
            {/* Headline: earned revenue */}
            <div className="rounded-2xl border border-accent/20 bg-accent/10 p-5 mb-3">
              <h3 className="text-sm font-semibold mb-1">{t("statRevenue")}</h3>
              <p className="text-3xl font-bold text-accent">₪{stats.revenue.earned.toLocaleString()}</p>
              {stats.revenue.pending > 0 && (
                <p className="text-xs text-muted-foreground mt-1">
                  ₪{stats.revenue.pending.toLocaleString()} {t("statPending")}
                </p>
              )}
            </div>

            {/* Secondary metrics */}
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-2xl border border-violet-500/20 bg-violet-500/10 p-4 flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <CalendarDays className="h-4 w-4 text-violet-500" />
                  <span className="text-xs text-muted-foreground">{t("statBookings")}</span>
                </div>
                <span className="text-2xl font-bold">{stats.bookings.total}</span>
                <span className="text-[11px] text-muted-foreground">
                  {stats.bookings.byStatus.confirmed} {t("statConfirmed")} · {stats.bookings.byStatus.pending} {t("statPending")}
                </span>
              </div>

              <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4 flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <Star className="h-4 w-4 text-amber-500" />
                  <span className="text-xs text-muted-foreground">{t("statRating")}</span>
                </div>
                <span className="text-2xl font-bold">
                  {stats.rating.count ? stats.rating.avg.toFixed(1) : "—"}
                </span>
                <span className="text-[11px] text-muted-foreground">
                  {stats.rating.count} {t("statsReviews")}
                </span>
              </div>

              <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-4 flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <Users className="h-4 w-4 text-emerald-500" />
                  <span className="text-xs text-muted-foreground">{t("statCustomers")}</span>
                </div>
                <span className="text-2xl font-bold">{stats.customers.unique}</span>
                <span className="text-[11px] text-muted-foreground">
                  {stats.customers.new} {t("statNew")} · {stats.customers.returning} {t("statReturning")}
                </span>
              </div>

              <div className="rounded-2xl border border-blue-500/20 bg-blue-500/10 p-4 flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <Receipt className="h-4 w-4 text-blue-500" />
                  <span className="text-xs text-muted-foreground">{t("statAvgTicket")}</span>
                </div>
                <span className="text-2xl font-bold">₪{Math.round(stats.customers.avgTicket).toLocaleString()}</span>
              </div>
            </div>

            {/* Charts (Phase 4) */}
            <StatsCharts stats={stats} />
          </div>
        )}
      </div>
      </div>
    </div>
  );
}
