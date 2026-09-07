import { Mail, Phone } from "lucide-react";
import { Link } from "react-router-dom";
import { useLang } from "@/contexts/LangContext";
import { BUSINESS, hasValue, telHref } from "@/lib/businessInfo";
import logoLight from "@/assets/e_logo_light.png";

/*
 * =============================================================================
 *  DELIBERATE EXCEPTION TO THE APP'S RTL RULE — THIS FOOTER IS AN LTR ISLAND
 * =============================================================================
 *
 * The root <footer> sets dir="ltr" and does NOT inherit the page direction.
 * The layout is therefore identical in Hebrew, Arabic and English: logo
 * top-left, address block left, trade name bottom-left, privacy link
 * bottom-right — in every language. Only the STRINGS switch language; their
 * positions never move.
 *
 * Why: this is a brand block, not UI. The wordmark is a Latin logo, the contact
 * details are LTR data (an email, +972 numbers), and the owner wants one fixed
 * signature that reads the same on every device and in every language, like a
 * letterhead. Mirroring it per language made three different footers out of
 * one brand.
 *
 * Consequences for anyone editing this file:
 *  - PHYSICAL properties (pl-/pr-/ml-/text-left/justify-between) are CORRECT
 *    and EXPECTED here. Do not "fix" them to ps-/pe-/text-start: under
 *    dir="ltr" they resolve identically, and physical makes the intent
 *    unmissable to the next reader.
 *  - Localised strings (trade name, privacy link) carry dir="auto"
 *    so Hebrew/Arabic glyphs keep their own reading order inside the LTR
 *    layout. Position is fixed; the text is not garbled.
 *  - The exception is scoped to SiteFooter only. /privacy, BottomNav and
 *    everything else keep the normal document direction.
 *
 * -----------------------------------------------------------------------------
 *
 * Design — V2, "warm charcoal". A full-bleed dark block that ends the page.
 * The surface takes the accent's hue (24°) and drives it down to a near-black,
 * hsl(24 30% 12%), so the footer is kin to the peach gradient above it. Set
 * left-aligned like a letterhead: logo, then the contact details as an
 * address block, icons paired tight to their labels. One hairline separates
 * the bottom bar, which gets room to breathe above the nav.
 *
 * Composition, top to bottom, all left-aligned:
 *   logo      the light variant of the login wordmark (see
 *             scripts/gen-logo-light.mjs) — cream word, orange mark. It
 *             already spells the name, so no text wordmark sits under it.
 *   contact   email, then both phones — side by side from 368px up with a
 *             short rule between; stacked below that (at 320px the pair needs
 *             313px and only 272px exist inside the padding)
 *   hairline
 *   bar       trade name left, privacy link right
 *
 * Public surface: trading name only — never BUSINESS.legalName, never the VAT
 * number. The second phone is optional and takes its cell and rule with it.
 *
 * Geometry: Index pads the page bottom with pb-28 (112px) so content clears
 * the 66px fixed BottomNav with 46px to spare. A dark block must not float
 * 46px above a light bar, so the footer takes that slack back with a negative
 * margin. It overshoots by exactly 1px so the block's empty bottom edge tucks
 * under the nav's own opaque 1px border-t: without that, fractional text
 * metrics leave a sub-pixel seam of gradient showing on 3× screens. The bar's
 * pb-3 keeps its 44px link boxes 12px clear of that seam. If BottomNav ever
 * gains safe-area padding, this offset must follow.
 */

/** (66px BottomNav − 1px seam overlap) − 7rem Index padding = −47px. See "Geometry". */
const CLOSE_NAV_GAP = "mb-[calc(65px_-_7rem)]";

// Breakpoint note: both phones fit on one row from 368px up (313px + 48px
// padding). The min-[368px]: classes below are written out in full on purpose
// — Tailwind's scanner only emits CSS for class names that appear literally.

const SURFACE = "bg-[hsl(24_30%_12%)]";
const CREAM = "text-[hsl(40_30%_96%)]";
const RULE = "bg-[hsl(40_30%_96%/0.12)]";

const LINK =
  "inline-flex min-h-[44px] items-center gap-2 rounded-lg transition-colors " +
  "hover:text-[hsl(40_30%_96%)] focus-visible:outline-none focus-visible:ring-2 " +
  "focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-[hsl(24_30%_12%)]";

/** Icon sits tight against its label; accent at 80% clears 4:1 on this ground. */
const ICON = "h-3.5 w-3.5 shrink-0 text-[hsl(24_80%_55%/0.8)]";

export function SiteFooter() {
  const { t } = useLang();
  const callLabel = t("footerCallAria");

  return (
    // dir="ltr": the LTR island. Read the header comment before changing this.
    <footer dir="ltr" className={`mt-14 ${CLOSE_NAV_GAP} ${SURFACE} ${CREAM}`}>
      <div className="mx-auto w-full max-w-md px-6 pb-9 pt-12 text-left">
        {/* width/height are the asset's intrinsic px — reserves the box before
            the lazy image arrives, so the footer never shifts on load. */}
        <img
          src={logoLight}
          alt={t("footerLogoAlt")}
          width={369}
          height={130}
          loading="lazy"
          decoding="async"
          draggable={false}
          className="block h-10 w-auto select-none"
        />
        {/* Address block, flush left like a letterhead. The -ml-1/pl-1 pair
            keeps the icons optically on the logo's left edge while the tap
            box still extends 4px into the margin. */}
        <address className="mt-4 flex flex-col items-start not-italic text-[13px] text-[hsl(40_30%_96%/0.8)]">
          <a
            href={`mailto:${BUSINESS.email}`}
            aria-label={t("footerEmailAria")}
            className={`${LINK} -ml-1 pl-1 pr-2`}
          >
            <Mail aria-hidden className={ICON} />
            <span dir="ltr">{BUSINESS.email}</span>
          </a>
          <div className="flex flex-col items-start min-[368px]:flex-row min-[368px]:items-center">
            {hasValue(BUSINESS.phonePrimary) && (
              <a
                href={telHref(BUSINESS.phonePrimary)}
                aria-label={`${callLabel} ${BUSINESS.phonePrimary}`}
                className={`${LINK} -ml-1 pl-1 pr-1`}
              >
                <Phone aria-hidden className={ICON} />
                <span dir="ltr">{BUSINESS.phonePrimary}</span>
              </a>
            )}
            {hasValue(BUSINESS.phoneSecondary) && (
              <>
                {/* A standalone rule, not a border on the link: a border on a
                    rounded link follows its corners and reads as a bracket.
                    Hidden when the phones stack. */}
                <span aria-hidden className={`hidden h-4 w-px shrink-0 ml-1 ${RULE} min-[368px]:block`} />
                <a
                  href={telHref(BUSINESS.phoneSecondary)}
                  aria-label={`${callLabel} ${BUSINESS.phoneSecondary}`}
                  className={`${LINK} -ml-1 pl-1 pr-1 min-[368px]:ml-0 min-[368px]:pl-2`}
                >
                  <Phone aria-hidden className={ICON} />
                  <span dir="ltr">{BUSINESS.phoneSecondary}</span>
                </a>
              </>
            )}
          </div>
        </address>
      </div>

      {/* One hairline, inset to the text margin, then the quiet bar. */}
      <div aria-hidden className={`mx-6 h-px ${RULE}`} />
      <div className="mx-auto flex w-full max-w-md items-center justify-between gap-4 px-6 pb-3 pt-1 text-[11px] text-[hsl(40_30%_96%/0.6)]">
        <span dir="auto" className="flex min-h-[44px] items-center">{BUSINESS.tradeName}</span>
        <Link
          to="/privacy"
          dir="auto"
          className={`${LINK} underline decoration-[hsl(40_30%_96%/0.3)] underline-offset-4`}
        >
          {t("privacyTitle")}
        </Link>
      </div>
    </footer>
  );
}
