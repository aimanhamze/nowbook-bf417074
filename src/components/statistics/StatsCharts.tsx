import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  XAxis,
  YAxis,
} from "recharts";
import { useLang } from "@/contexts/LangContext";
import type { ProviderStats } from "@/hooks/useProviderStats";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";

// Phase 4 — chart visualisations for the provider Statistics page. First real
// use of the ui/chart.tsx (recharts) wrapper.
//
// RTL (the app is Hebrew-default; recharts has no native RTL support):
// Each CARTESIAN chart's subtree is forced to `dir="ltr"` so recharts runs in
// its stable native coordinate space and numeric tick labels (e.g. "5/6") are
// not bidi-reordered. The RTL *mirror* is then produced deliberately:
//   • time series (revenue, weekday) — reverse the DATA array (earliest →
//     right, latest → left); axes stay un-`reversed`.
//   • horizontal bars (top services) — keep the ranking; `reversed` on the
//     value axis flips bar growth, the category axis moves to the right.
//   • the dependent/scale axis is placed on the right (`orientation`).
// The PIE/donut is direction-neutral and keeps the document's `dir=rtl`.

const ACCENT = "hsl(24 80% 55%)";   // revenue (brand accent)
const VIOLET = "hsl(265 60% 60%)";  // services
const BLUE = "hsl(217 80% 55%)";    // busiest days
const GREEN = "hsl(142 70% 45%)";   // confirmed
const AMBER = "hsl(38 92% 50%)";    // pending
const ROSE = "hsl(0 72% 55%)";      // cancelled

const WEEKDAY_KEYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

const CARD = "rounded-2xl border border-border bg-card p-4";
const CHART_BOX = "aspect-auto h-[200px] w-full";

function ChartCard({ title, empty, children }: { title: string; empty: boolean; children: React.ReactNode }) {
  const { t } = useLang();
  return (
    <div className={CARD}>
      <h3 className="text-sm font-semibold mb-3">{title}</h3>
      {empty ? (
        <div className="h-[200px] flex items-center justify-center">
          <p className="text-xs text-muted-foreground">{t("chartNoData")}</p>
        </div>
      ) : (
        children
      )}
    </div>
  );
}

export function StatsCharts({ stats }: { stats: ProviderStats }) {
  const { t, isRtl } = useLang();
  const yAxisSide = isRtl ? "right" : "left";

  // ── Revenue trend (area) ────────────────────────────────────────────────────
  // RTL mirroring is done by reversing the DATA (earliest plots on the right,
  // latest on the left) — NOT via XAxis `reversed`, which clashes with the
  // forced-LTR chart subtree (see the dir="ltr" note on ChartContainer below).
  const revenueConfig = { revenue: { label: t("statRevenue"), color: ACCENT } } satisfies ChartConfig;
  const hasRevenue = stats.revenue.buckets.some((b) => b.revenue > 0);
  const revenueData = isRtl ? [...stats.revenue.buckets].reverse() : stats.revenue.buckets;

  // ── Status breakdown (donut) ────────────────────────────────────────────────
  const statusConfig = {
    confirmed: { label: t("statConfirmed"), color: GREEN },
    pending: { label: t("statPending"), color: AMBER },
    cancelled: { label: t("statCancelled"), color: ROSE },
  } satisfies ChartConfig;
  const statusData = [
    { key: "confirmed", value: stats.bookings.byStatus.confirmed, fill: GREEN },
    { key: "pending", value: stats.bookings.byStatus.pending, fill: AMBER },
    { key: "cancelled", value: stats.bookings.byStatus.cancelled, fill: ROSE },
  ].filter((d) => d.value > 0);

  // ── Top services (horizontal bar, top 5 by BOOKING COUNT) ───────────────────
  // Counts, not revenue: a per-service revenue split could only be derived from
  // the CURRENT catalog price x occurrences, which let a price change rewrite
  // history and never summed back to headline revenue. Counts come straight off
  // each booking's service_ids and are exact.
  const topServices = stats.topServices.slice(0, 5);
  const servicesConfig = { count: { label: t("statBookings"), color: VIOLET } } satisfies ChartConfig;

  // ── Busiest days (bar by weekday) ───────────────────────────────────────────
  const weekdayData = stats.busiest.byWeekday.map((w) => ({
    // Hebrew/Arabic names are short single words; abbreviate English to 3 chars
    // so all seven ticks fit on a mobile axis.
    label: isRtl ? t(WEEKDAY_KEYS[w.weekday]) : t(WEEKDAY_KEYS[w.weekday]).slice(0, 3),
    count: w.count,
  }));
  const busiestConfig = { count: { label: t("statBookings"), color: BLUE } } satisfies ChartConfig;
  const hasBusiest = weekdayData.some((d) => d.count > 0);
  // RTL: reverse so Sunday→Saturday reads right-to-left (Sunday on the right).
  const weekdayChartData = isRtl ? [...weekdayData].reverse() : weekdayData;

  return (
    <div className="mt-3 space-y-3">
      {/* Revenue trend */}
      <ChartCard title={t("chartRevenueTrend")} empty={!hasRevenue}>
        {/* dir="ltr" forces recharts into its native LTR coordinate space so
            geometry is stable and numeric date ticks ("5/6") don't bidi-flip.
            RTL appearance comes from the reversed `revenueData` + right-side YAxis. */}
        <ChartContainer config={revenueConfig} className={CHART_BOX} dir="ltr">
          <AreaChart data={revenueData} margin={{ top: 8, right: 4, left: 4, bottom: 0 }}>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              fontSize={11}
              interval="preserveStartEnd"
            />
            <YAxis
              orientation={yAxisSide}
              tickLine={false}
              axisLine={false}
              width={40}
              fontSize={11}
              tickFormatter={(v) => `₪${v}`}
            />
            <ChartTooltip content={<ChartTooltipContent indicator="line" />} />
            <Area
              dataKey="revenue"
              type="monotone"
              stroke="var(--color-revenue)"
              fill="var(--color-revenue)"
              fillOpacity={0.2}
              strokeWidth={2}
            />
          </AreaChart>
        </ChartContainer>
      </ChartCard>

      {/* Booking status breakdown */}
      <ChartCard title={t("chartStatusBreakdown")} empty={statusData.length === 0}>
        <ChartContainer config={statusConfig} className={CHART_BOX}>
          <PieChart>
            <ChartTooltip content={<ChartTooltipContent nameKey="key" hideLabel />} />
            <Pie data={statusData} dataKey="value" nameKey="key" innerRadius={50} outerRadius={80} strokeWidth={2}>
              {statusData.map((d) => (
                <Cell key={d.key} fill={d.fill} />
              ))}
            </Pie>
            <ChartLegend content={<ChartLegendContent nameKey="key" />} />
          </PieChart>
        </ChartContainer>
      </ChartCard>

      {/* Top services */}
      <ChartCard title={t("chartTopServices")} empty={topServices.length === 0}>
        {/* dir="ltr" keeps recharts in native space (fixes the RTL overflow &
            label clipping). Mirroring: value axis `reversed` flips bar growth
            direction; category YAxis moves to the right with width for the
            (fully visible) Hebrew/Arabic service names. */}
        <ChartContainer config={servicesConfig} className={CHART_BOX} dir="ltr">
          <BarChart data={topServices} layout="vertical" margin={{ top: 0, right: 12, left: 4, bottom: 0 }}>
            <XAxis type="number" dataKey="count" reversed={isRtl} hide />
            <YAxis
              type="category"
              dataKey="name"
              orientation={yAxisSide}
              width={96}
              tickLine={false}
              axisLine={false}
              fontSize={11}
              tickFormatter={(v: string) => (v.length > 12 ? `${v.slice(0, 12)}…` : v)}
            />
            <ChartTooltip content={<ChartTooltipContent />} />
            <Bar dataKey="count" fill="var(--color-count)" radius={4} />
          </BarChart>
        </ChartContainer>
      </ChartCard>

      {/* Busiest days */}
      <ChartCard title={t("chartBusiestDays")} empty={!hasBusiest}>
        {/* dir="ltr" + reversed `weekdayChartData` → Sunday on the right,
            Saturday on the left; weekday ticks stay aligned with their bars. */}
        <ChartContainer config={busiestConfig} className={CHART_BOX} dir="ltr">
          <BarChart data={weekdayChartData} margin={{ top: 8, right: 4, left: 4, bottom: 0 }}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} interval={0} />
            <YAxis
              orientation={yAxisSide}
              allowDecimals={false}
              tickLine={false}
              axisLine={false}
              width={28}
              fontSize={11}
            />
            <ChartTooltip content={<ChartTooltipContent />} />
            <Bar dataKey="count" fill="var(--color-count)" radius={4} />
          </BarChart>
        </ChartContainer>
      </ChartCard>
    </div>
  );
}
