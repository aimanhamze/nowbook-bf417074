import { Mail, Phone } from "lucide-react";
import { Link } from "react-router-dom";
import { useLang } from "@/contexts/LangContext";
import { BUSINESS, hasValue, telHref } from "@/lib/businessInfo";
import logoLight from "@/assets/e_logo_light.png";

/**
 * Site footer — V2, "warm charcoal".
 *
 * A full-bleed dark block that ends the page. The surface takes the accent's
 * hue (24°) and drives it down to a near-black — hsl(24 30% 12%) — so the
 * footer is kin to the peach gradient above it rather than a cool slab
 * dropped onto a warm page. Where V1 centres, V2 is set start-aligned like a
 * letterhead: logo, name, then the contact details as an address block flush
 * under it, icons paired tight to their labels. One hairline separates the
 * bottom bar instead of a darker strip.
 *
 * Composition, top to bottom, all inline-start aligned:
 *   logo      the light variant of the login wordmark (see
 *             scripts/gen-logo-light.mjs) — cream word, orange mark
 *   name      the localised brand name, only where the logo doesn't already
 *             spell it (it says "ehjezly", so English skips this line)
 *   contact   email, then both phones on one row with a short rule between
 *   hairline
 *   bar       trade name at inline-start, privacy link at inline-end
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
 * pb-1 is a dead zone so its 44px link boxes end above that seam. If BottomNav
 * ever gains safe-area padding, this offset must follow.
 *
 * Phone numbers and the email are dir="ltr" (the "+" would reorder in he/ar);
 * the trade name is dir="auto" so it keeps its own direction on an English page.
 */

/** (66px BottomNav − 1px seam overlap) − 7rem Index padding = −47px. See "Geometry". */
const CLOSE_NAV_GAP = "mb-[calc(65px_-_7rem)]";

/** What the logo raster already reads as, in Latin. */
const LOGO_SPELLS = "ehjezly";

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
  const brand = t("footerBrand");
  const showName = brand.trim().toLowerCase() !== LOGO_SPELLS;
  const callLabel = t("footerCallAria");

  return (
    <footer className={`mt-14 ${CLOSE_NAV_GAP} ${SURFACE} ${CREAM}`}>
      <div className="mx-auto w-full max-w-md px-6 pb-7 pt-12 text-start">
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
        {showName && (
          <p className="mt-3 text-[15px] font-semibold leading-6 tracking-tight">{brand}</p>
        )}

        {/* Address block, flush start like a letterhead. The -ms-1/ps-1 pair
            keeps the icons optically on the logo's start edge while the tap
            box still extends 4px into the margin. */}
        <address className="mt-5 flex flex-col items-start not-italic text-[13px] text-[hsl(40_30%_96%/0.8)]">
          <a
            href={`mailto:${BUSINESS.email}`}
            aria-label={t("footerEmailAria")}
            className={`${LINK} -ms-1 ps-1 pe-2`}
          >
            <Mail aria-hidden className={ICON} />
            <span dir="ltr">{BUSINESS.email}</span>
          </a>
          <div className="flex items-center">
            {hasValue(BUSINESS.phonePrimary) && (
              <a
                href={telHref(BUSINESS.phonePrimary)}
                aria-label={`${callLabel} ${BUSINESS.phonePrimary}`}
                className={`${LINK} -ms-1 ps-1 pe-2`}
              >
                <Phone aria-hidden className={ICON} />
                <span dir="ltr">{BUSINESS.phonePrimary}</span>
              </a>
            )}
            {hasValue(BUSINESS.phoneSecondary) && (
              <>
                {/* A standalone rule, not a border on the link: a border-s on
                    a rounded link follows its corners and reads as a bracket. */}
                <span aria-hidden className="h-4 w-px shrink-0 bg-[hsl(40_30%_96%/0.15)]" />
                <a
                  href={telHref(BUSINESS.phoneSecondary)}
                  aria-label={`${callLabel} ${BUSINESS.phoneSecondary}`}
                  className={`${LINK} ps-2 pe-1`}
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
      <div className="mx-auto flex w-full max-w-md items-center justify-between gap-4 px-6 pb-1 text-[11px] text-[hsl(40_30%_96%/0.6)]">
        <span dir="auto" className="flex min-h-[44px] items-center">{BUSINESS.tradeName}</span>
        <Link
          to="/privacy"
          className={`${LINK} underline decoration-[hsl(40_30%_96%/0.3)] underline-offset-4`}
        >
          {t("privacyTitle")}
        </Link>
      </div>
    </footer>
  );
}
