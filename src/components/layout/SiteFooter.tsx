import { Mail, Phone } from "lucide-react";
import { Link } from "react-router-dom";
import { useLang } from "@/contexts/LangContext";
import { BUSINESS } from "@/lib/businessInfo";

/**
 * Site footer — direction A, "shop plate".
 *
 * Every business in Ehjezly is a small local shop, so the footer is treated as
 * the plate on our own door: one contained glass panel holding the name and
 * the two ways to reach us, with the registration details set beneath it as
 * fine print rather than crowded inside.
 *
 * Hierarchy is carried by the composition, not by separators — brand (with the
 * accent rule Home's SectionTitle already uses), then contact, then the legal
 * line at the quietest tier outside the panel.
 *
 * Centred throughout, so the layout is identical in RTL and LTR; only the
 * phone and email are pinned dir="ltr" so their digits never reorder. Clearing
 * the fixed BottomNav is the caller's job — Index's `pb-28` does it.
 */

const ROW =
  "flex min-h-[44px] items-center justify-center gap-2.5 text-[13px] text-foreground/70 " +
  "transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 " +
  "focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-transparent rounded-xl";

export function SiteFooter() {
  const { t } = useLang();

  return (
    <footer className="mt-14 px-5 pb-6 text-center">
      <div className="glass-card-md mx-auto w-full max-w-sm rounded-2xl px-5 py-6">
        <p className="text-[17px] font-bold tracking-tight text-foreground">
          {t("footerBrand")}
        </p>
        <span aria-hidden className="mx-auto mt-2.5 block h-[3px] w-6 rounded-full bg-accent" />

        <div className="mt-4 flex flex-col">
          <a href={`tel:${BUSINESS.phone}`} aria-label={t("footerCallAria")} className={ROW}>
            <Phone aria-hidden className="h-4 w-4 shrink-0 text-accent/70" />
            <span dir="ltr">{BUSINESS.phone}</span>
          </a>
          <a href={`mailto:${BUSINESS.email}`} aria-label={t("footerEmailAria")} className={ROW}>
            <Mail aria-hidden className="h-4 w-4 shrink-0 text-accent/70" />
            <span dir="ltr">{BUSINESS.email}</span>
          </a>
        </div>

        <div aria-hidden className="mx-auto mt-1 h-px w-full bg-border/60" />

        <Link
          to="/privacy"
          className="mt-1 flex min-h-[44px] items-center justify-center rounded-xl text-[13px] font-medium text-accent transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-transparent"
        >
          {t("privacyTitle")}
        </Link>
      </div>

      {/* Fine print, deliberately outside the plate: the quietest tier. */}
      <p className="mt-4 text-[11px] leading-relaxed text-muted-foreground/80">
        {BUSINESS.legalName}
        <br />
        {t("footerVatLabel")} <span dir="ltr" className="inline-block">{BUSINESS.vatNumber}</span>
      </p>
    </footer>
  );
}
