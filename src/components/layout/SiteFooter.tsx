import { Link } from "react-router-dom";
import { useLang } from "@/contexts/LangContext";
import { BUSINESS, hasValue, telHref } from "@/lib/businessInfo";
import logoLight from "@/assets/e_logo_light.png";

/**
 * Site footer — V1, "ink block".
 *
 * A full-bleed dark block that ends the page. The surface is the app's own
 * `--foreground` token (hsl 220 15% 13%) used as ground instead of ink, so the
 * footer is the page's text colour turned into a slab — related to everything
 * above it, not an arbitrary dark. The bottom bar steps three points darker.
 *
 * Composition, top to bottom, all centred:
 *   logo      the light variant of the login wordmark (see
 *             scripts/gen-logo-light.mjs) — cream word, orange mark
 *   name      the localised brand name, only where the logo doesn't already
 *             spell it (it says "ehjezly", so English skips this line)
 *   contact   an address block: email, then both phones on one row
 *   bar       trade name at inline-start, privacy link at inline-end
 *
 * Public surface: trading name only — never BUSINESS.legalName, never the VAT
 * number. The second phone is optional and takes its half of the row with it.
 *
 * Geometry: Index pads the page bottom with pb-28 (112px) so content clears
 * the 66px fixed BottomNav with 46px to spare. A dark block must not float
 * 46px above a light bar, so the footer takes that slack back with a negative
 * margin. It overshoots by exactly 1px so the block's empty bottom edge tucks
 * under the nav's own opaque 1px border-t: without that, fractional text
 * metrics leave a sub-pixel seam of gradient showing on 3× screens. No content
 * is within 14px of that edge (the bar centres its text in a 44px row). If
 * BottomNav ever gains safe-area padding, this offset must follow.
 *
 * Phone numbers and the email are dir="ltr" (the "+" would reorder in he/ar);
 * the trade name is dir="auto" so it keeps its own direction on an English page.
 */

/** (66px BottomNav − 1px seam overlap) − 7rem Index padding = −47px. See "Geometry". */
const CLOSE_NAV_GAP = "mb-[calc(65px_-_7rem)]";

/** What the logo raster already reads as, in Latin. */
const LOGO_SPELLS = "ehjezly";

const SURFACE = "bg-[hsl(220_15%_13%)]";
const BAR = "bg-[hsl(220_15%_10%)]";
const CREAM = "text-[hsl(40_30%_96%)]";

const LINK =
  "inline-flex min-h-[44px] items-center justify-center rounded-lg transition-colors " +
  "hover:text-[hsl(40_30%_96%)] focus-visible:outline-none focus-visible:ring-2 " +
  "focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-[hsl(220_15%_13%)]";

export function SiteFooter() {
  const { t } = useLang();
  const brand = t("footerBrand");
  const showName = brand.trim().toLowerCase() !== LOGO_SPELLS;
  const callLabel = t("footerCallAria");

  return (
    <footer className={`mt-14 ${CLOSE_NAV_GAP} ${SURFACE} ${CREAM}`}>
      <div className="mx-auto w-full max-w-sm px-6 pb-9 pt-12 text-center">
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
          className="mx-auto block h-11 w-auto select-none"
        />
        {showName && (
          <p className="mt-3 text-[15px] font-semibold leading-6 tracking-tight">{brand}</p>
        )}

        {/* Address block: one tight group. Rows are 44px for the tap target;
            the type inside is set small so the block still reads as compact. */}
        <address className="mt-5 flex flex-col items-center not-italic text-[13px] text-[hsl(40_30%_96%/0.8)]">
          <a href={`mailto:${BUSINESS.email}`} aria-label={t("footerEmailAria")} className={`${LINK} w-full`}>
            <span dir="ltr">{BUSINESS.email}</span>
          </a>
          <div className="flex w-full items-center justify-center">
            {hasValue(BUSINESS.phonePrimary) && (
              <a
                href={telHref(BUSINESS.phonePrimary)}
                aria-label={`${callLabel} ${BUSINESS.phonePrimary}`}
                className={`${LINK} flex-1 px-2`}
              >
                <span dir="ltr">{BUSINESS.phonePrimary}</span>
              </a>
            )}
            {hasValue(BUSINESS.phoneSecondary) && (
              <>
                <span aria-hidden className="h-4 w-px shrink-0 bg-[hsl(40_30%_96%/0.15)]" />
                <a
                  href={telHref(BUSINESS.phoneSecondary)}
                  aria-label={`${callLabel} ${BUSINESS.phoneSecondary}`}
                  className={`${LINK} flex-1 px-2`}
                >
                  <span dir="ltr">{BUSINESS.phoneSecondary}</span>
                </a>
              </>
            )}
          </div>
        </address>
      </div>

      {/* Bottom bar: the quiet strip. Its bottom edge is the nav's top edge; the
          pb-1 is a dead zone so the 44px link boxes end above the seam. */}
      <div className={`${BAR} pb-1`}>
        <div className="mx-auto flex w-full max-w-sm items-center justify-between gap-4 px-6 text-[11px] text-[hsl(40_30%_96%/0.6)]">
          <span dir="auto" className="flex min-h-[44px] items-center">{BUSINESS.tradeName}</span>
          <Link
            to="/privacy"
            className={`${LINK} underline decoration-[hsl(40_30%_96%/0.3)] underline-offset-4 focus-visible:ring-offset-[hsl(220_15%_10%)]`}
          >
            {t("privacyTitle")}
          </Link>
        </div>
      </div>
    </footer>
  );
}
