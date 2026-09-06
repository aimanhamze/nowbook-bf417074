import { Link } from "react-router-dom";
import { useLang } from "@/contexts/LangContext";
import { BUSINESS } from "@/lib/businessInfo";

/**
 * Site footer — direction B, "open signature".
 *
 * No panel: the page's warm gradient runs all the way to the bottom and the
 * footer is drawn on it directly, closed off by a single full-bleed hairline
 * and a lot of air. The brand is set large in the accent and is the only bold
 * thing here — the contact details sit under it as quiet surface-soft pills,
 * and the registration line is the last, faintest thing on the page.
 *
 * Centred throughout, so the layout is identical in RTL and LTR; only the
 * phone and email are pinned dir="ltr" so their digits never reorder. Clearing
 * the fixed BottomNav is the caller's job — Index's `pb-28` does it.
 */

const PILL =
  "surface-soft inline-flex min-h-[44px] items-center rounded-full px-4 text-[13px] text-foreground/75 " +
  "transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 " +
  "focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-transparent";

export function SiteFooter() {
  const { t } = useLang();

  return (
    <footer className="mt-14 border-t border-border/70 px-5 pb-6 pt-10 text-center">
      <p className="text-[22px] font-extrabold leading-none tracking-tight text-accent">
        {t("footerBrand")}
      </p>

      <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
        <a href={`tel:${BUSINESS.phone}`} aria-label={t("footerCallAria")} className={PILL}>
          <span dir="ltr">{BUSINESS.phone}</span>
        </a>
        <a href={`mailto:${BUSINESS.email}`} aria-label={t("footerEmailAria")} className={PILL}>
          <span dir="ltr">{BUSINESS.email}</span>
        </a>
      </div>

      <Link
        to="/privacy"
        className="mx-auto mt-1 flex min-h-[44px] w-fit items-center rounded-xl px-2 text-[13px] text-foreground/60 underline underline-offset-4 transition-colors hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-transparent"
      >
        {t("privacyTitle")}
      </Link>

      <p className="mt-4 text-[11px] leading-relaxed text-muted-foreground/75">
        {BUSINESS.legalName}
        <br />
        {t("footerVatLabel")} <span dir="ltr" className="inline-block">{BUSINESS.vatNumber}</span>
      </p>
    </footer>
  );
}
