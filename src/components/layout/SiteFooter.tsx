import { Link } from "react-router-dom";
import { useLang } from "@/contexts/LangContext";
import { BUSINESS } from "@/lib/businessInfo";

/**
 * Quiet site footer — business identity and the privacy policy link, reachable
 * without an account.
 *
 * Exists for Meta Business Verification: a reviewer loading the site logged out
 * must find the business name, a way to contact it, and a working privacy
 * policy link.
 *
 * Clearing the fixed BottomNav is the caller's job: this renders as the last
 * block of ordinary page content, and Index's `pb-28` keeps it above the bar.
 * Phone and email are wrapped in `dir="ltr"` so their digits and punctuation
 * stay in Latin order inside the Hebrew and Arabic (RTL) layouts.
 */
export function SiteFooter() {
  const { t } = useLang();

  return (
    <footer className="mt-12 border-t border-border/60 px-5 pb-4 pt-5 text-start text-xs leading-relaxed text-muted-foreground">
      <p className="font-semibold text-foreground/70">{t("footerBrand")}</p>

      <p className="mt-1">
        {BUSINESS.legalName} · {t("footerVatLabel")}{" "}
        <span dir="ltr" className="inline-block">{BUSINESS.vatNumber}</span>
      </p>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        <a
          href={`tel:${BUSINESS.phone}`}
          aria-label={t("footerCallAria")}
          className="transition-colors hover:text-foreground"
        >
          <span dir="ltr" className="inline-block">{BUSINESS.phone}</span>
        </a>
        <a
          href={`mailto:${BUSINESS.email}`}
          aria-label={t("footerEmailAria")}
          className="transition-colors hover:text-foreground"
        >
          <span dir="ltr" className="inline-block">{BUSINESS.email}</span>
        </a>
        <Link to="/privacy" className="underline underline-offset-2 transition-colors hover:text-foreground">
          {t("privacyTitle")}
        </Link>
      </div>
    </footer>
  );
}
