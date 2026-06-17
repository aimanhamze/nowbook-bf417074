import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { useLang } from "@/contexts/LangContext";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { fmtDayMonth, ListSkeleton, ErrorState, EmptyState } from "./dashboard-ui";
import { useAdminBookingsOverTime } from "@/hooks/useAdminDashboard";

const ACCENT = "hsl(24 80% 55%)"; // brand accent

// Bookings over the last 30 days. RTL handling mirrors StatsCharts.tsx:
// the chart subtree is forced dir="ltr" so recharts keeps its stable native
// coordinate space and numeric date ticks ("17/6") are not bidi-reordered; the
// RTL *mirror* comes from reversing the DATA (earliest → right, latest → left)
// and placing the value axis on the right.
export function BookingsTrendChart() {
  const { t, isRtl } = useLang();
  const { data, isLoading, isError } = useAdminBookingsOverTime(30);

  if (isLoading) return <ListSkeleton rows={4} />;
  if (isError) return <ErrorState />;

  const points = (data ?? []).map((d) => ({
    label: fmtDayMonth(d.day),
    count: d.bookings_count,
  }));
  const hasData = points.some((p) => p.count > 0);
  if (!hasData) return <EmptyState message={t("chartNoData")} />;

  const chartData = isRtl ? [...points].reverse() : points;
  const config = { count: { label: t("dashBookingsUnit"), color: ACCENT } } satisfies ChartConfig;

  return (
    <ChartContainer config={config} className="aspect-auto h-[200px] w-full" dir="ltr">
      <BarChart data={chartData} margin={{ top: 8, right: 4, left: 4, bottom: 0 }}>
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="label"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          fontSize={11}
          interval="preserveStartEnd"
          minTickGap={24}
        />
        <YAxis
          orientation={isRtl ? "right" : "left"}
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
  );
}
