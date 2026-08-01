import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Printer } from "lucide-react";
import { useLang } from "@/contexts/LangContext";
import { useAuth } from "@/contexts/AuthContext";
import { useProviderProfile } from "@/hooks/useProviderProfile";
import { useMonthlyReport } from "@/hooks/useMonthlyReport";
import { BackArrow } from "@/components/ui/directional-icon";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { MonthlyReportDocument } from "@/components/report/MonthlyReportDocument";
import {
  formatMonthLabel, lastCompleteMonth, monthKey, parseMonthKey,
} from "@/lib/monthlyReport";
import { providerDesktopPage } from "@/components/layout/providerDesktop";

// ─────────────────────────────────────────────────────────────────────────────
// Provider monthly report — screen view + print/PDF export.
//
// Mirrors the Statistics page shell (provider-gated, back arrow → profile), but
// the content column is the DOCUMENT's own width rather than providerDesktop-
// Column's lg:max-w-2xl: this is a document viewer, and a four-column log needs
// the room. The chrome above is capped to the same width so the two align.
//
// Export is window.print(). Proven on spike/print-pdf: real vector text with
// embedded font subsets, ~54 KB per page, correct Hebrew bidi and clean
// pagination. Everything in this file that is not the document itself carries
// data-print-hide, so the printed sheet starts at the masthead.
// ─────────────────────────────────────────────────────────────────────────────

const COLUMN = "mx-auto w-full max-w-[840px]";

export default function MonthlyReport() {
  const { t } = useLang();
  const { user, isProvider } = useAuth();
  const navigate = useNavigate();
  const { profile, isLoading: profileLoading } = useProviderProfile();

  // Default to the last COMPLETE month — the report is a closed-books document,
  // so it never opens on a partial month whose numbers still move.
  const [selected, setSelected] = useState(() => lastCompleteMonth());

  const { stats, prevStats, days, months, generatedOn, isLoading } =
    useMonthlyReport(selected);

  useEffect(() => {
    if (user && !isProvider) navigate("/", { replace: true });
  }, [user, isProvider, navigate]);

  // If the provider's history does not reach the default month (a new provider
  // whose first booking is this month), fall back to their most recent month.
  useEffect(() => {
    if (months.length === 0) return;
    if (!months.some((m) => monthKey(m) === monthKey(selected))) {
      setSelected(months[0]);
    }
  }, [months, selected]);

  const selectedKey = useMemo(() => monthKey(selected), [selected]);

  if (!user || !isProvider) return null;

  if (!profileLoading && !profile) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-5 gap-4">
        <p className="text-muted-foreground text-center">{t("profileNotSetup")}</p>
        <Button onClick={() => navigate("/")}>{t("home")}</Button>
      </div>
    );
  }

  // Hebrew literal: the document itself is Hebrew-only this phase.
  const businessName = profile?.business_name || "העסק שלי";

  return (
    <div id="mr-page" className={`min-h-screen pb-24 ${providerDesktopPage}`}>
      {/* ── chrome: never printed ── */}
      <header data-print-hide className={`${COLUMN} px-5 pt-12 pb-4`}>
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate("/profile")}
            className="active:scale-95"
            aria-label={t("profile")}
          >
            <BackArrow className="h-5 w-5" />
          </button>
          <h1 className="text-xl font-bold flex-1">{t("monthlyReport")}</h1>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Select
            value={selectedKey}
            onValueChange={(v) => setSelected(parseMonthKey(v))}
            disabled={months.length === 0}
          >
            <SelectTrigger className="w-[190px]">
              <SelectValue placeholder={formatMonthLabel(selected)} />
            </SelectTrigger>
            <SelectContent>
              {months.map((m) => (
                <SelectItem key={monthKey(m)} value={monthKey(m)}>
                  {formatMonthLabel(m)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button
            onClick={() => window.print()}
            disabled={isLoading || months.length === 0}
            className="gap-2"
          >
            <Printer className="h-4 w-4" />
            {t("exportPdf")}
          </Button>
        </div>

        <p className="mt-2 text-xs text-muted-foreground">
          {t("monthlyReportCurrentMonthNote")}
        </p>
      </header>

      {/* ── the document ── */}
      <div className={`${COLUMN} px-2 sm:px-5`}>
        {isLoading ? (
          <div data-print-hide className="py-20 flex justify-center">
            <div className="w-8 h-8 rounded-full border-2 border-accent border-t-transparent animate-spin" />
          </div>
        ) : months.length === 0 ? (
          <p data-print-hide className="py-20 text-center text-muted-foreground">
            {t("monthlyReportNoHistory")}
          </p>
        ) : (
          <MonthlyReportDocument
            businessName={businessName}
            logoUrl={profile?.avatar_image}
            month={selected}
            stats={stats}
            prevStats={prevStats}
            days={days}
            generatedOn={generatedOn}
          />
        )}
      </div>
    </div>
  );
}
