import { Mail, Phone } from "lucide-react";
import { Link } from "react-router-dom";
import { useLang } from "@/contexts/LangContext";
import { BUSINESS, hasValue, telHref } from "@/lib/businessInfo";

/**
 * Site footer — "shop plate".
 *
 * Every business in Ehjezly is a small local shop, so the footer is treated as
 * the plate on our own door: one contained glass panel holding the name and
 * the ways to reach us, with the trading name set just beneath it.
 *
 * The brand block owns the top of the plate; the contact lines below it run
 * flush, as one tight group rather than a spaced-out list of form fields. The
 * two phone numbers share a single row, split into equal halves by a short
 * centred divider, so the plate stays short. The plate's own edge is the only
 * division inside the footer — nothing else draws a rule.
 *
 * Public surface: the trading name only. Neither the registered עוסק פטור
 * holder (BUSINESS.legalName) nor the VAT number belongs here; both live in
 * the privacy policy. The second phone is optional and takes its half of the
 * row with it, leaving a single full-width number and no empty tel: link.
 *
 * Centred throughout, so the layout is identical in RTL and LTR. Phone numbers
 * and the email are pinned dir="ltr" — the numbers are in +972 form and the
 * leading "+" would otherwise reorder in he/ar. The trading name is dir="auto"
 * so it keeps its own direction inside an English page.
 * Clearing the fixed BottomNav is the caller's job — Index's `pb-28` does it.
 */

/** Icon and label are one unit: a small gap, never separated by free space. */
const CONTACT =
  "flex min-h-[44px] items-center justify-center gap-1.5 text-[13px] text-foreground/70 " +
  "transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 " +
  "focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-transparent rounded-xl";

const ICON = "h-3.5 w-3.5 shrink-0 text-accent/70";

/**
 * One tappable phone half. The accessible name carries the number itself —
 * with two numbers present, a bare "call us" on both would leave a screen
 * reader user unable to tell them apart.
 */
function PhoneCell({ number, label }: { number: string; label: string }) {
  return (
    <a href={telHref(number)} aria-label={`${label} ${number}`} className={`${CONTACT} flex-1 px-1`}>
      <Phone aria-hidden className={ICON} />
      <span dir="ltr" className="truncate">{number}</span>
    </a>
  );
}

export function SiteFooter() {
  const { t } = useLang();
  const callLabel = t("footerCallAria");
  const hasSecondPhone = hasValue(BUSINESS.phoneSecondary);

  return (
    <footer className="mt-14 px-5 pb-6 text-center">
      <div className="glass-card-md mx-auto w-full max-w-sm rounded-2xl px-4 py-5">
        <p className="text-[17px] font-bold tracking-tight text-foreground">
          {t("footerBrand")}
        </p>
        <span aria-hidden className="mx-auto mt-2 block h-[3px] w-6 rounded-full bg-accent" />

        {/* Contact lines run flush — one group, not three spaced rows. */}
        <div className="mt-2.5 flex flex-col">
          <a href={`mailto:${BUSINESS.email}`} aria-label={t("footerEmailAria")} className={CONTACT}>
            <Mail aria-hidden className={ICON} />
            <span dir="ltr">{BUSINESS.email}</span>
          </a>

          <div className="flex items-center">
            {hasValue(BUSINESS.phonePrimary) && (
              <PhoneCell number={BUSINESS.phonePrimary} label={callLabel} />
            )}
            {hasSecondPhone && (
              <>
                {/* Short centred rule, not a full-height border: it separates
                    the two halves without reading as a table cell. */}
                <span aria-hidden className="h-5 w-px shrink-0 bg-border/70" />
                <PhoneCell number={BUSINESS.phoneSecondary} label={callLabel} />
              </>
            )}
          </div>

          {/* Same weight and colour as the contact lines — it must not compete
              with the brand for attention. */}
          <Link
            to="/privacy"
            className={`${CONTACT} underline decoration-border underline-offset-4`}
          >
            {t("privacyTitle")}
          </Link>
        </div>
      </div>

      {/* Colophon: close enough to read as part of the footer block. */}
      <p className="mt-2.5 text-[11px] leading-relaxed text-muted-foreground/80">
        <span dir="auto" className="inline-block">{BUSINESS.tradeName}</span>
      </p>
    </footer>
  );
}
