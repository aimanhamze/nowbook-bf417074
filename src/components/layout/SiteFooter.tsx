import { Mail, Phone, ShieldCheck } from "lucide-react";
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
 * The layout is therefore identical in Hebrew, Arabic and English: the same
 * centred stack, the same icon order left to right, in every language. Only
 * the STRINGS switch language; their positions never move.
 *
 * Why: this is a brand block, not UI. The wordmark is a Latin logo, the
 * contact details are LTR data, and the owner wants one fixed signature that
 * reads the same on every device and in every language. Mirroring it per
 * language made three different footers out of one brand.
 *
 * Consequences for anyone editing this file:
 *  - PHYSICAL properties (left-/right-/pl-/pr-) are CORRECT and EXPECTED here.
 *    Do not "fix" them to logical ones: under dir="ltr" they resolve the same,
 *    and physical makes the intent unmissable to the next reader.
 *  - Localised strings (tagline, labels, trade name, copyright) carry
 *    dir="auto" so Hebrew/Arabic glyphs keep their own reading order inside
 *    the LTR layout. Position is fixed; the text is not garbled.
 *  - The exception is scoped to SiteFooter only. /privacy, BottomNav and
 *    everything else keep the normal document direction.
 *
 * -----------------------------------------------------------------------------
 *
 * Design — a centred signature on the warm charcoal: the accent's hue driven
 * down to near-black so the block is kin to the peach gradient above it. The
 * surface is a shallow vertical gradient (hsl 24 26% 15% at the top, down to
 * hsl 24 34% 9% at the bottom) so the block has depth instead of reading flat.
 * Two orange waves rise from each bottom corner, drawn inline as SVG (no image
 * asset): a tall back wave that is the readable shape, and a low swell that
 * hugs the bottom edge.
 *
 * Contrast geometry — the waves are sized so that NO text ever sits over more
 * than ONE wave layer, because the numbers say two layers cannot be made
 * legible: cream/70 over two stacked layers is 4.65:1 at best, and four
 * layers (where both sides' tails would meet) fails for any cream. So:
 *   - each tall wave is exactly half the width; the two meet at the centre
 *     and never overlap;
 *   - the low swell is 20px tall; every glyph ends ≥24px above the bottom,
 *     so the swell is under nothing but the tall wave's foot.
 * With one layer as the worst case, copyright cream/65 measures 5.27:1 and
 * the trade name cream/75 higher still. Re-run the pixel check if the wave
 * paths, opacities, or text opacities change.
 *
 * Composition, top to bottom, all centred:
 *   logo      the light variant of the login wordmark (see
 *             scripts/gen-logo-light.mjs) — the centrepiece, h-12
 *   tagline   one quiet line
 *   actions   three circular icon buttons with labels, thin rules between:
 *             email (label = the address) · contact (tel: to the primary
 *             number, label = the word only — the number is never shown) ·
 *             privacy policy
 *   hairline
 *   trade name, then the copyright line as the quietest tier
 *
 * Public surface: trading name only — never BUSINESS.legalName, never the VAT
 * number, and no phone number is displayed (it lives behind the Contact
 * button and in the privacy policy).
 *
 * Geometry: Index pads the page bottom with pb-28 (112px) so content clears
 * the 66px fixed BottomNav with 46px to spare. A dark block must not float
 * 46px above a light bar, so the footer takes that slack back with a negative
 * margin. It overshoots by exactly 1px so the block's empty bottom edge tucks
 * under the nav's own opaque 1px border-t: without that, fractional text
 * metrics leave a sub-pixel seam of gradient showing on 3× screens. The
 * bottom padding keeps every glyph well clear of that seam. If BottomNav ever
 * gains safe-area padding, this offset must follow.
 */

/** (66px BottomNav − 1px seam overlap) − 7rem Index padding = −47px. See "Geometry". */
const CLOSE_NAV_GAP = "mb-[calc(65px_-_7rem)]";

/** Top-lighter → bottom-darker charcoal. The lightest stop sits under the
    logo and tagline; the waves sit over the darkest. */
const SURFACE = "bg-[linear-gradient(180deg,hsl(24_26%_15%)_0%,hsl(24_30%_12%)_55%,hsl(24_34%_9%)_100%)]";
const CREAM = "text-[hsl(40_30%_96%)]";
const RULE = "bg-[hsl(40_30%_96%/0.12)]";

/**
 * One action: a lifted charcoal disc with the accent icon, label beneath. The
 * whole <a> is the tap target — never smaller than the 44px disc, and taller
 * once the label is counted. Labels are 12px and must never truncate; the
 * row is sized to its content (see the fit note on the row below).
 */
const ACTION =
  "group flex min-w-[44px] flex-col items-center gap-1.5 rounded-xl px-1 pb-1 pt-0.5 " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring " +
  "focus-visible:ring-offset-2 focus-visible:ring-offset-[hsl(24_30%_12%)]";
const DISC =
  "flex h-11 w-11 items-center justify-center rounded-full bg-[hsl(24_22%_18%)] " +
  "ring-1 ring-[hsl(40_30%_96%/0.08)] transition-colors group-hover:bg-[hsl(24_22%_22%)]";
const DISC_ICON = "h-[18px] w-[18px] text-[hsl(24_80%_55%)]";
const LABEL = "whitespace-nowrap text-[12px] leading-4 text-[hsl(40_30%_96%/0.7)] transition-colors group-hover:text-[hsl(40_30%_96%)]";
/**
 * Rule between actions, aligned with the discs rather than the labels. Shown
 * from 368px up only: below that the three items fit on one row solely
 * because the rules and their margins are gone (see the fit note on the row).
 * Written out literally — Tailwind's scanner cannot see template-built names.
 */
const DIVIDER = `hidden min-[368px]:block mx-3 mt-[10px] h-6 w-px shrink-0 self-start ${RULE}`;

/**
 * Minimum widths for the two word-labelled actions, set to the widest of the
 * three translations (Arabic) so the disc positions are byte-identical in
 * he/ar/en instead of drifting with each label's natural width. Re-measure
 * if those strings change. Email keeps its natural width (the widest label).
 */
const CONTACT_MIN_W = "min-w-[56px]";
const PRIVACY_MIN_W = "min-w-[100px]";

/**
 * Corner waves. Two SVGs per side (see "Contrast geometry" in the header):
 *   back   96px tall (crest level with the hairline), exactly half the
 *          footer's width, tapering to zero at the centre so the two sides
 *          never overlap — this is the shape
 *   swell  low, 20px, hugging the bottom edge under every glyph
 * The left/right classes are written literally on purpose — Tailwind's
 * scanner cannot see template-built names.
 */
const WAVE_FILL = "hsl(24 80% 55%)";
function CornerWave({ side }: { side: "left" | "right" }) {
  const place = side === "left" ? "left-0" : "right-0 -scale-x-100";
  return (
    <>
      <svg
        aria-hidden
        viewBox="0 0 200 120"
        preserveAspectRatio="none"
        className={`pointer-events-none absolute bottom-0 h-24 w-1/2 ${place}`}
      >
        <path d="M0 120 V18 C 40 4, 80 8, 112 44 C 140 76, 168 104, 200 120 Z" fill={WAVE_FILL} fillOpacity="0.30" />
      </svg>
      <svg
        aria-hidden
        viewBox="0 0 200 20"
        preserveAspectRatio="none"
        className={`pointer-events-none absolute bottom-0 h-5 w-[62%] ${place}`}
      >
        <path d="M0 20 V6 C 50 0, 110 4, 150 12 C 170 16, 186 19, 200 20 Z" fill={WAVE_FILL} fillOpacity="0.18" />
      </svg>
    </>
  );
}

export function SiteFooter() {
  const { t } = useLang();
  const year = String(new Date().getFullYear());

  return (
    // dir="ltr": the LTR island. Read the header comment before changing this.
    <footer dir="ltr" className={`relative mt-14 overflow-hidden ${CLOSE_NAV_GAP} ${SURFACE} ${CREAM}`}>
      <CornerWave side="left" />
      <CornerWave side="right" />

      <div className="relative mx-auto w-full max-w-md px-6 pt-12 text-center">
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
          className="mx-auto block h-12 w-auto select-none"
        />
        <p dir="auto" className="mt-3 text-[13px] leading-5 text-[hsl(40_30%_96%/0.65)]">
          {t("footerTagline")}
        </p>

        {/* Action row. Sized to content and centred — NOT equal columns — so
            the email label (the widest) gets the room it needs and the row
            never truncates. Measured fit at 12px labels: 375px holds all three
            with the rules (309px of 327px); 320px holds all three only with
            the rules hidden (267px of 272px). flex-wrap stays as the safety
            net: if a device font renders a label wider, the last item drops
            to a second centred row rather than anything shrinking or
            truncating. */}
        <nav aria-label={t("footerContact")} className="mt-8 flex flex-wrap items-start justify-center gap-x-1 gap-y-3">
          <a href={`mailto:${BUSINESS.email}`} className={ACTION}>
            <span className={DISC}><Mail aria-hidden className={DISC_ICON} /></span>
            <span dir="ltr" className={LABEL}>{BUSINESS.email}</span>
          </a>

          {hasValue(BUSINESS.phonePrimary) && (
            <>
              <span aria-hidden className={DIVIDER} />
              {/* The visible label is the word only; the accessible name adds
                  the number so a screen-reader user knows what will dial. */}
              <a
                href={telHref(BUSINESS.phonePrimary)}
                aria-label={`${t("footerCallAria")} ${BUSINESS.phonePrimary}`}
                className={`${ACTION} ${CONTACT_MIN_W}`}
              >
                <span className={DISC}><Phone aria-hidden className={DISC_ICON} /></span>
                <span dir="auto" className={LABEL}>{t("footerContact")}</span>
              </a>
            </>
          )}

          <span aria-hidden className={DIVIDER} />
          <Link to="/privacy" className={`${ACTION} ${PRIVACY_MIN_W}`}>
            <span className={DISC}><ShieldCheck aria-hidden className={DISC_ICON} /></span>
            <span dir="auto" className={LABEL}>{t("privacyTitle")}</span>
          </Link>
        </nav>

        <div aria-hidden className={`mt-8 h-px ${RULE}`} />

        <p dir="auto" className="mt-5 text-[12px] leading-4 text-[hsl(40_30%_96%/0.75)]">
          {BUSINESS.tradeName}
        </p>
        <p dir="auto" className="mt-1.5 pb-6 text-[11px] leading-4 text-[hsl(40_30%_96%/0.65)]">
          {t("footerCopyright").replace("{year}", year)}
        </p>
      </div>
    </footer>
  );
}
