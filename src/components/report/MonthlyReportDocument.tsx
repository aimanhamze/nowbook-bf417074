import { Fragment } from "react";
import type { EnrichedBooking } from "@/hooks/useProviderBookings";
import type { ProviderStats } from "@/lib/providerStats";
import {
  HEBREW_WEEKDAYS_SHORT,
  countLogged,
  delta,
  formatMonthLabel,
  formatTime,
  type DayLogGroup,
  type Delta,
  type MonthRef,
} from "@/lib/monthlyReport";

// ─────────────────────────────────────────────────────────────────────────────
// THE MONTHLY REPORT DOCUMENT — Hebrew, RTL, print-first.
//
// Design: a LEDGER, not a dashboard. Rule weight is the only hierarchy device —
// hairline = data row, 1.5px ink = section boundary. No cards, shadows or
// rounded boxes: they cost toner, print unevenly, and read as app chrome inside
// a document meant to be handed to an accountant. Numerals are tabular
// throughout so money columns align down the page.
//
// The sheet is ALWAYS white with dark ink, even under the app's dark theme. The
// provider is looking at a print preview; making it match the paper is the point.
//
// TWO NON-NEGOTIABLES, both proven on the spike/print-pdf branch:
//
// 1. <bdi> AROUND EVERY CURRENCY VALUE. Next to Arabic text the ₪ jumps to the
//    wrong side of its digits: Arabic letters are bidi class AL, which makes the
//    following digits ARABIC-NUMBER (AN), and the Unicode rule that glues a
//    currency symbol to its number (W5) only fires for EUROPEAN-NUMBER (EN). The
//    symbol is left neutral and drifts to the paragraph edge. An isolate pins it.
//    This document is Hebrew-only today, but service names, customer names and
//    business names are routinely Arabic in this market — so the hazard is live
//    inside the report, not just in a future ar/en translation. Enforced by
//    funnelling every price through <Money>, which cannot render without it.
//
// 2. NO PAGE NUMBERS. Chrome ignores @page margin boxes, so counter(page) is
//    unavailable and "עמוד 3 מתוך 6" cannot be produced. The document is
//    therefore built to not need one: the summary is self-contained on page 1,
//    and the log repeats its column header on every page so any sheet can be
//    read on its own.
// ─────────────────────────────────────────────────────────────────────────────

const INK = "#14161A";

/** Scoped to #mr-doc / .mr-* so nothing here can leak into the rest of the app. */
const REPORT_CSS = `
/* ── page geometry (ported from spike/print-pdf) ────────────────────────── */
@page {
  size: A4 portrait;
  margin: 14mm 12mm 16mm 12mm;
}

/* ── the sheet ──────────────────────────────────────────────────────────── */
#mr-doc {
  --ink: ${INK};
  --ink-2: #4A5260;
  --ink-3: #79818F;
  --hair: #E3E6EB;
  --tint: #F5F6F8;
  --pos: #17553A;
  --neg: #8A2B2B;

  direction: rtl;
  background: #fff;
  color: var(--ink);
  font-family: "Assistant", "Heebo", "Segoe UI", "Arial Hebrew", system-ui, -apple-system, sans-serif;
  font-size: 14px;
  line-height: 1.5;
  font-variant-numeric: tabular-nums;
  font-feature-settings: "tnum" 1;
  max-width: 840px;
  margin: 0 auto;
  padding: 28px 26px 40px;
  border: 1px solid var(--hair);
}
@media (max-width: 640px) {
  #mr-doc { padding: 18px 14px 28px; font-size: 13px; border-inline: none; }
}

#mr-doc h1, #mr-doc h2, #mr-doc h3, #mr-doc p, #mr-doc figure { margin: 0; }
#mr-doc table { border-collapse: collapse; width: 100%; }

/* Numbers must never reorder inside RTL prose. */
.mr-num { unicode-bidi: isolate; }
.mr-ltr { direction: ltr; unicode-bidi: isolate; }

/* ── masthead ───────────────────────────────────────────────────────────── */
.mr-masthead {
  display: flex; align-items: flex-start; gap: 14px;
  padding-bottom: 14px; border-bottom: 1.5px solid var(--ink);
}
.mr-logo {
  width: 44px; height: 44px; flex: none; object-fit: cover;
  border: 1px solid var(--hair);
}
.mr-masthead-main { flex: 1; min-width: 0; }
.mr-business {
  font-size: 12px; font-weight: 600; letter-spacing: .12em;
  color: var(--ink-3); text-transform: uppercase;
}
.mr-title { font-size: 26px; font-weight: 800; letter-spacing: -.02em; margin-top: 2px !important; }
.mr-title span { font-weight: 400; color: var(--ink-2); }
.mr-generated { font-size: 12px; color: var(--ink-3); margin-top: 3px !important; }

/* ── KPI ledger grid ────────────────────────────────────────────────────── */
.mr-kpis {
  display: grid; grid-template-columns: repeat(3, 1fr);
  border-bottom: 1.5px solid var(--ink);
}
.mr-kpi { padding: 12px 14px 13px; border-bottom: 1px solid var(--hair); }
.mr-kpi:nth-child(3n+1) { padding-inline-start: 0; }
.mr-kpi:not(:nth-child(3n+1)) { border-inline-start: 1px solid var(--hair); }
.mr-kpi-label { font-size: 11.5px; color: var(--ink-3); letter-spacing: .04em; }
.mr-kpi-label sup { font-size: 9px; margin-inline-start: 2px; color: var(--ink-3); }
.mr-kpi-value { font-size: 25px; font-weight: 700; letter-spacing: -.02em; line-height: 1.15; margin-top: 3px; }
.mr-kpi-sub { font-size: 11.5px; color: var(--ink-3); margin-top: 1px; }
@media (max-width: 640px) {
  .mr-kpis { grid-template-columns: repeat(2, 1fr); }
  .mr-kpi:nth-child(3n+1) { padding-inline-start: 14px; }
  .mr-kpi:not(:nth-child(3n+1)) { border-inline-start: none; }
  .mr-kpi:nth-child(2n+1) { padding-inline-start: 0; }
  .mr-kpi:not(:nth-child(2n+1)) { border-inline-start: 1px solid var(--hair); }
  .mr-kpi-value { font-size: 21px; }
}

/* ── delta chip ─────────────────────────────────────────────────────────── */
.mr-delta { font-size: 11.5px; font-weight: 600; margin-top: 3px; display: block; }
.mr-delta--up { color: var(--pos); }
.mr-delta--down { color: var(--neg); }
.mr-delta--flat { color: var(--ink-3); font-weight: 500; }
.mr-delta em { font-style: normal; color: var(--ink-3); font-weight: 400; }

/* ── two-column analysis band ───────────────────────────────────────────── */
.mr-band { display: grid; grid-template-columns: 1fr 1fr; gap: 0 28px; }
@media (max-width: 640px) { .mr-band { grid-template-columns: 1fr; gap: 0; } }

.mr-block { padding: 16px 0 4px; }
.mr-block + .mr-block { border-top: 1px solid var(--hair); }
.mr-band > div > .mr-block:first-child { padding-top: 14px; }
.mr-h { font-size: 11.5px; font-weight: 700; letter-spacing: .1em; color: var(--ink-2); text-transform: uppercase; margin-bottom: 9px !important; }

/* rows whose bar IS a rule — the document's one repeated motif */
.mr-row { display: flex; align-items: baseline; gap: 8px; font-size: 12.5px; padding: 3px 0; }
.mr-row-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mr-row-val { color: var(--ink-2); font-size: 12px; flex: none; }
.mr-bar { height: 3px; background: var(--ink); flex: none; }
.mr-bar--soft { background: #C7CBD2; }

/* cohort split — one proportional rule, not a pie */
.mr-cohort { display: flex; height: 8px; margin-bottom: 8px; }
.mr-cohort-legend { display: flex; gap: 16px; font-size: 12px; }
.mr-swatch { display: inline-block; width: 9px; height: 9px; margin-inline-end: 5px; }

/* weekday strip: 7 columns, RTL so Sunday sits on the right */
.mr-week { display: grid; grid-template-columns: repeat(7, 1fr); gap: 5px; align-items: end; height: 54px; }
.mr-week-col { display: flex; flex-direction: column; align-items: center; justify-content: flex-end; height: 100%; gap: 3px; }
.mr-week-bar { width: 100%; background: var(--ink); min-height: 2px; }
.mr-week-label { font-size: 10.5px; color: var(--ink-3); flex: none; }

/* ── footnotes: the document's defensibility, given real presence ───────── */
.mr-notes { margin-top: 18px; border-top: 1.5px solid var(--ink); padding-top: 10px; }
.mr-notes-h { font-size: 11px; font-weight: 700; letter-spacing: .1em; color: var(--ink-2); text-transform: uppercase; margin-bottom: 6px !important; }
/* list-style is restated because Tailwind's preflight resets ol/ul to
   list-style:none globally. Without it the markers vanish and the 1,2,3,4
   superscripts on the KPI labels reference nothing. */
.mr-notes ol { margin: 0; padding-inline-start: 18px; list-style: decimal outside; }
.mr-notes li { font-size: 11px; line-height: 1.65; color: var(--ink-2); padding-inline-start: 2px; }
.mr-notes li::marker { color: var(--ink-3); font-weight: 700; }

/* ── the daily log ──────────────────────────────────────────────────────── */
.mr-log-h { font-size: 17px; font-weight: 800; letter-spacing: -.01em; }
.mr-log-sub { font-size: 12px; color: var(--ink-3); margin: 2px 0 10px !important; }

.mr-log th {
  text-align: right; font-size: 10.5px; font-weight: 700; letter-spacing: .08em;
  color: #fff; background: var(--ink); padding: 7px 8px; text-transform: uppercase;
}
.mr-log td { padding: 6px 8px; border-bottom: 1px solid var(--hair); vertical-align: top; font-size: 12.5px; }

.mr-daybreak td {
  background: var(--tint); border-top: 1.5px solid var(--ink);
  border-bottom: 1px solid var(--hair); padding: 7px 8px;
}
.mr-day-label { font-weight: 700; font-size: 12.5px; }
.mr-day-date { color: var(--ink-2); font-weight: 400; }
.mr-day-count { float: left; color: var(--ink-3); font-size: 11.5px; }

.mr-time { font-weight: 600; white-space: nowrap; }
.mr-phone { direction: ltr; unicode-bidi: isolate; white-space: nowrap; color: inherit; text-decoration: none; }
.mr-pending {
  font-size: 10px; font-weight: 700; border: 1px solid var(--ink-3); color: var(--ink-2);
  padding: 0 4px; margin-inline-start: 6px; white-space: nowrap;
}
.mr-empty { padding: 26px 0; text-align: center; color: var(--ink-3); font-size: 13px; }
.mr-end { margin-top: 12px; padding-top: 8px; border-top: 1.5px solid var(--ink); font-size: 11px; color: var(--ink-3); }

/* ══ PRINT ═══════════════════════════════════════════════════════════════ */
@media print {
  /* app chrome */
  nav, [data-print-hide], [data-sonner-toaster], .toaster { display: none !important; }

  html, body { background: #fff !important; margin: 0 !important; padding: 0 !important; }

  /* shaded header rows / bars must actually print */
  * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }

  /* Neutralise the page shell. ID beats the Tailwind classes on these two
     elements, so the sheet fills the @page box instead of the app's column. */
  #mr-page { max-width: none !important; padding: 0 !important; margin: 0 !important; }
  #mr-doc {
    /* stays in normal static flow — an absolutely-positioned root paginates
       badly in Chrome, which would defeat the whole approach */
    max-width: none !important; margin: 0 !important; padding: 0 !important;
    border: none !important; font-size: 10pt;
  }
  .mr-screen-only { display: none !important; }

  /* repeat the log's column header on every page */
  thead { display: table-header-group; }
  tfoot { display: table-footer-group; }

  /* never split a row, a KPI cell or a day header across a page break */
  tr, .mr-kpi, .mr-block, .mr-notes { break-inside: avoid; page-break-inside: avoid; }
  .mr-daybreak { break-inside: avoid; page-break-inside: avoid;
                 break-after: avoid; page-break-after: avoid; }

  /* summary owns page 1; the log starts on a fresh sheet */
  .mr-summary { break-after: page; page-break-after: page; }

  a { color: inherit !important; text-decoration: none !important; }
  a[href]::after { content: none !important; }
}
`;

/* ── currency ──────────────────────────────────────────────────────────────
   The ONLY way a price reaches the DOM in this document. <bdi> is baked in so
   the Arabic-context bidi bug cannot be reintroduced by forgetting a wrapper. */
function formatILS(value: number): string {
  const rounded = Math.round(value);
  const abs = Math.abs(rounded).toLocaleString("en-US");
  return `${rounded < 0 ? "−" : ""}₪${abs}`;
}

function Money({ value, signed = false }: { value: number; signed?: boolean }) {
  const sign = signed && value > 0 ? "+" : "";
  return <bdi className="mr-num">{sign}{formatILS(value)}</bdi>;
}

/** Plain integers also get isolated — "12" inside RTL prose is still a bidi run. */
function Num({ value, suffix = "" }: { value: number; suffix?: string }) {
  return <bdi className="mr-num">{value.toLocaleString("en-US")}{suffix}</bdi>;
}

function DeltaChip({ d, money = false }: { d: Delta; money?: boolean }) {
  if (d.abs === 0) {
    return <span className="mr-delta mr-delta--flat">ללא שינוי מהחודש הקודם</span>;
  }
  const arrow = d.direction === "up" ? "▲" : "▼";
  return (
    <span className={`mr-delta mr-delta--${d.direction}`}>
      {arrow}{" "}
      {d.pct === null ? (
        // No baseline: a percentage against zero is undefined, so quote the
        // absolute move rather than an invented +100%.
        <>
          {money ? <Money value={d.abs} signed /> : <Num value={Math.abs(d.abs)} />}{" "}
          <em>(אין חודש קודם להשוואה)</em>
        </>
      ) : (
        <>
          <bdi className="mr-num">{Math.abs(Math.round(d.pct * 100))}%</bdi>{" "}
          <em>
            (
            {money ? <Money value={d.abs} signed /> : <Num value={d.abs} />}
            )
          </em>
        </>
      )}
    </span>
  );
}

function Kpi({
  label, notes, value, sub, d, money,
}: {
  label: string;
  notes?: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  d?: Delta;
  money?: boolean;
}) {
  return (
    <div className="mr-kpi">
      <div className="mr-kpi-label">
        {label}
        {notes && <sup>{notes}</sup>}
      </div>
      <div className="mr-kpi-value">{value}</div>
      {sub && <div className="mr-kpi-sub">{sub}</div>}
      {d && <DeltaChip d={d} money={money} />}
    </div>
  );
}

export interface MonthlyReportDocumentProps {
  businessName: string;
  logoUrl?: string | null;
  month: MonthRef;
  stats: ProviderStats;
  prevStats: ProviderStats;
  days: (DayLogGroup & { bookings: EnrichedBooking[] })[];
  /** Local "YYYY-MM-DD" */
  generatedOn: string;
}

export function MonthlyReportDocument({
  businessName, logoUrl, month, stats, prevStats, days, generatedOn,
}: MonthlyReportDocumentProps) {
  const monthLabel = formatMonthLabel(month);
  const logged = countLogged(days);

  const topServices = stats.topServices.slice(0, 5);
  const maxServiceCount = topServices[0]?.count || 1;
  const maxWeekday = Math.max(1, ...stats.busiest.byWeekday.map((w) => w.count));
  const topHours = [...stats.busiest.byHour].sort((a, b) => b.count - a.count).slice(0, 5);
  const maxHour = topHours[0]?.count || 1;

  const cohortTotal = stats.customers.new + stats.customers.returning;
  const newPct = cohortTotal ? (stats.customers.new / cohortTotal) * 100 : 0;

  const [gy, gm, gd] = generatedOn.split("-");

  return (
    <>
      <style>{REPORT_CSS}</style>

      <div id="mr-doc" dir="rtl" lang="he">
        {/* ══════════ PAGE 1 — SUMMARY ══════════ */}
        <section className="mr-summary">
          <header className="mr-masthead">
            {logoUrl && <img className="mr-logo" src={logoUrl} alt="" />}
            <div className="mr-masthead-main">
              <p className="mr-business">{businessName}</p>
              <h1 className="mr-title">
                דוח חודשי <span>· {monthLabel}</span>
              </h1>
              <p className="mr-generated">
                הופק בתאריך <bdi className="mr-num">{`${gd}.${gm}.${gy}`}</bdi>
              </p>
            </div>
          </header>

          {/* ── KPI ledger ── */}
          <div className="mr-kpis">
            <Kpi
              label="הכנסות"
              notes="1,2,4"
              value={<Money value={stats.revenue.earned} />}
              d={delta(stats.revenue.earned, prevStats.revenue.earned)}
              money
            />
            <Kpi
              label="תורים שהתקיימו"
              notes="2"
              value={<Num value={stats.bookings.active} />}
              d={delta(stats.bookings.active, prevStats.bookings.active)}
            />
            <Kpi
              label="בוטלו"
              notes="3"
              value={<Num value={stats.bookings.byStatus.cancelled} />}
              sub={<>שיעור ביטול <bdi className="mr-num">{Math.round(stats.bookings.cancellationRate * 100)}%</bdi></>}
              d={delta(stats.bookings.byStatus.cancelled, prevStats.bookings.byStatus.cancelled)}
            />
            <Kpi
              label="לקוחות ייחודיים"
              value={<Num value={stats.customers.unique} />}
              sub={<>מתוכם <bdi className="mr-num">{stats.customers.walkins}</bdi> ללא חשבון</>}
              d={delta(stats.customers.unique, prevStats.customers.unique)}
            />
            <Kpi
              label="ממוצע לתור"
              notes="1,2"
              value={<Money value={stats.customers.avgTicket} />}
              d={delta(stats.customers.avgTicket, prevStats.customers.avgTicket)}
              money
            />
            <Kpi
              label="שעות מוזמנות"
              value={<Num value={Math.round(stats.bookedHours * 10) / 10} />}
              sub="לפי משך השירותים"
              d={delta(
                Math.round(stats.bookedHours * 10) / 10,
                Math.round(prevStats.bookedHours * 10) / 10
              )}
            />
          </div>

          {/* ── analysis band ── */}
          <div className="mr-band">
            <div>
              <section className="mr-block">
                <h2 className="mr-h">לקוחות חדשים מול חוזרים</h2>
                {cohortTotal === 0 ? (
                  <p className="mr-row-val">לא היו לקוחות פעילים החודש.</p>
                ) : (
                  <>
                    <div className="mr-cohort">
                      <div style={{ width: `${newPct}%`, background: INK }} />
                      <div style={{ width: `${100 - newPct}%`, background: "#C7CBD2" }} />
                    </div>
                    <div className="mr-cohort-legend">
                      <span>
                        <i className="mr-swatch" style={{ background: INK }} />
                        חדשים <Num value={stats.customers.new} />
                      </span>
                      <span>
                        <i className="mr-swatch" style={{ background: "#C7CBD2" }} />
                        חוזרים <Num value={stats.customers.returning} />
                      </span>
                    </div>
                  </>
                )}
              </section>

              <section className="mr-block">
                <h2 className="mr-h">שירותים מובילים · לפי מספר תורים</h2>
                {topServices.length === 0 ? (
                  <p className="mr-row-val">אין נתונים לחודש זה.</p>
                ) : (
                  topServices.map((s) => (
                    <div className="mr-row" key={s.id}>
                      <span className="mr-row-name">{s.name}</span>
                      <span
                        className="mr-bar"
                        style={{ width: `${(s.count / maxServiceCount) * 64 + 6}px` }}
                      />
                      <span className="mr-row-val"><Num value={s.count} /></span>
                    </div>
                  ))
                )}
              </section>
            </div>

            <div>
              <section className="mr-block">
                <h2 className="mr-h">ימים עמוסים</h2>
                <div className="mr-week">
                  {stats.busiest.byWeekday.map((w) => (
                    <div className="mr-week-col" key={w.weekday}>
                      <span
                        className="mr-week-bar"
                        style={{ height: `${(w.count / maxWeekday) * 38}px` }}
                      />
                      <span className="mr-week-label">{HEBREW_WEEKDAYS_SHORT[w.weekday]}</span>
                    </div>
                  ))}
                </div>
              </section>

              <section className="mr-block">
                <h2 className="mr-h">שעות עמוסות</h2>
                {topHours.length === 0 ? (
                  <p className="mr-row-val">אין נתונים לחודש זה.</p>
                ) : (
                  topHours.map((h) => (
                    <div className="mr-row" key={h.hour}>
                      <span className="mr-row-name mr-ltr" style={{ maxWidth: 46 }}>
                        {String(h.hour).padStart(2, "0")}:00
                      </span>
                      <span
                        className="mr-bar mr-bar--soft"
                        style={{ width: `${(h.count / maxHour) * 64 + 6}px`, background: INK }}
                      />
                      <span className="mr-row-val"><Num value={h.count} /></span>
                    </div>
                  ))
                )}
              </section>

              <section className="mr-block">
                <h2 className="mr-h">דירוג</h2>
                <div className="mr-row">
                  <span className="mr-row-name">דירוג כללי (כל הזמן)</span>
                  <span className="mr-row-val">
                    {stats.rating.count === 0 ? (
                      "אין דירוגים"
                    ) : (
                      <>
                        <bdi className="mr-num">{stats.rating.avg.toFixed(1)}</bdi> ★{" "}
                        <bdi className="mr-num">({stats.rating.count})</bdi>
                      </>
                    )}
                  </span>
                </div>
                <div className="mr-row">
                  <span className="mr-row-name">ביקורות שהתקבלו החודש</span>
                  <span className="mr-row-val"><Num value={stats.rating.periodCount} /></span>
                </div>
              </section>
            </div>
          </div>

          {/* ── footnotes ── */}
          <section className="mr-notes">
            <h2 className="mr-notes-h">הערות למספרים</h2>
            <ol>
              <li>
                ההכנסה מחושבת לפי מחירי השירותים שנקבעו בתור — זהו סכום צפוי, לא סכום
                שנגבה בפועל. התשלום מתבצע בעסק ואינו נרשם במערכת.
              </li>
              <li>
                אי-הגעה של לקוח אינה נרשמת במערכת (אין סטטוס כזה), ולכן תור שהלקוח לא
                הגיע אליו נספר כתור שהתקיים ובהכנסה מלאה.
              </li>
              <li>
                "בוטלו" כולל ביטולים על ידך ובקשות שדחית, ומשויך לחודש שבו נקבע התור —
                לא לחודש שבו בוצע הביטול.
              </li>
              <li>
                בקשות שממתינות לאישור אינן נכללות בהכנסה
                {stats.revenue.pending > 0 && (
                  <> (<Money value={stats.revenue.pending} /> החודש)</>
                )}
                .
              </li>
            </ol>
          </section>
        </section>

        {/* ══════════ PAGES 2+ — DAILY APPOINTMENT LOG ══════════ */}
        <section>
          <h2 className="mr-log-h">יומן תורים · {monthLabel}</h2>
          <p className="mr-log-sub">
            כל התורים שלא בוטלו — מאושרים וממתינים לאישור. ימים ללא תורים אינם מוצגים.
          </p>

          {logged === 0 ? (
            <p className="mr-empty">לא נקבעו תורים בחודש זה.</p>
          ) : (
            <>
              <table className="mr-log">
                <thead>
                  <tr>
                    <th style={{ width: "12%" }}>שעה</th>
                    <th style={{ width: "31%" }}>שם הלקוח</th>
                    <th style={{ width: "22%" }}>טלפון</th>
                    <th>שירות</th>
                  </tr>
                </thead>
                <tbody>
                  {days.map((day) => (
                    <Fragment key={day.date}>
                      <tr className="mr-daybreak">
                        <td colSpan={4}>
                          <span className="mr-day-label">{day.weekdayLabel}</span>{" "}
                          <span className="mr-day-date">
                            · <bdi className="mr-num">{day.dateLabel}</bdi>
                          </span>
                          <span className="mr-day-count">
                            <Num value={day.bookings.length} />{" "}
                            {day.bookings.length === 1 ? "תור" : "תורים"}
                          </span>
                        </td>
                      </tr>
                      {day.bookings.map((b) => (
                        <tr className="mr-apt" key={b.id}>
                          <td className="mr-time mr-ltr">{formatTime(b.booking_time)}</td>
                          <td>
                            {b.customer_name || "ללא שם"}
                            {b.status === "pending" && (
                              <span className="mr-pending">ממתין</span>
                            )}
                          </td>
                          <td>
                            {b.customer_phone ? (
                              <a className="mr-phone" href={`tel:${b.customer_phone}`}>
                                {b.customer_phone}
                              </a>
                            ) : (
                              <span className="mr-row-val">—</span>
                            )}
                          </td>
                          <td>{b.service_names.join(" · ") || "—"}</td>
                        </tr>
                      ))}
                    </Fragment>
                  ))}
                </tbody>
              </table>

              <p className="mr-end">
                סוף הדוח · <Num value={logged} /> תורים ב־<Num value={days.length} /> ימי
                פעילות · {businessName} · {monthLabel}
              </p>
            </>
          )}
        </section>
      </div>
    </>
  );
}
