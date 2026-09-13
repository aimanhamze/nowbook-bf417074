import { Instagram, Mail, ShieldCheck } from "lucide-react";
import { Link } from "react-router-dom";
import { useLang } from "@/contexts/LangContext";
import { BUSINESS, hasValue } from "@/lib/businessInfo";
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
 * Contrast geometry — even after the 2026-09-09 pass that toned the waves
 * down to a hint (0.30→0.09, 0.18→0.06, and shorter — see CornerWave), no
 * text ever sits over more than ONE wave layer, so the worst case is still a
 * single layer: cream/65 copyright over it measures comfortably above AA.
 * Re-run the pixel check (waves.cjs in the working notes) if the wave paths,
 * opacities, or text opacities change again.
 *
 * Composition, top to bottom, all centred:
 *   logo      the light variant of the login wordmark (see
 *             scripts/gen-logo-light.mjs) — the centrepiece, h-12, sitting
 *             directly above the action row (no tagline underneath it)
 *   actions   three circular icon buttons with labels, thin rules between:
 *             Instagram (new tab) · email (label = the address) · privacy
 *             policy
 *   hairline
 *   trade name, then the copyright line as the quietest tier
 *
 * Centring — the row LOOKS centred only if the three DISCS are symmetric
 * around the middle; centring the row's total bounding box (justify-center)
 * is not the same thing when the items' own widths differ. Each action
 * centres its disc within its own box (flex-col items-center), so with
 * unequal box widths — Instagram's box was only as wide as "Instagram"
 * (~63px) while Privacy's was padded to fit Arabic (~100px) — the row's
 * bounding box came out centred (0px offset) while the discs themselves sat
 * ~9px left of true centre. Verified three independent ways (DOM rects,
 * per-language comparison, and a raw pixel scan of the rendered PNG) before
 * touching anything, so the fix targets the real cause: WING_MIN_W is now
 * applied to BOTH Instagram and Privacy, making them the same width. Email
 * stays in the middle at its own natural width. Three items where the two
 * outer ones are equal is a mirror-symmetric (palindromic) sequence of
 * widths, so centring the total automatically puts the middle disc exactly
 * on the true centre and the two outer discs symmetric around it — this
 * holds for ANY value shared by the two wings, not just this one, which is
 * why a shared constant is a structural fix rather than a tuned offset.
 *
 * Public surface: trading name only — never BUSINESS.legalName, never the VAT
 * number, and no phone number anywhere (the numbers live in the privacy
 * policy only).
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
 * whole <a> is the tap target — the 44px disc alone guarantees the width, and
 * the label makes it taller. Labels are 12px and must never truncate; the
 * row is sized to its content (see the fit note on the row below).
 * No min-w here on purpose: the privacy item carries its own, and two min-w
 * utilities on one element leave the winner to Tailwind's emission order.
 */
const ACTION =
  "group flex flex-col items-center gap-1.5 rounded-xl px-1 pb-1 pt-0.5 " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring " +
  "focus-visible:ring-offset-2 focus-visible:ring-offset-[hsl(24_30%_12%)]";
const DISC =
  "flex h-11 w-11 items-center justify-center rounded-full bg-[hsl(24_22%_18%)] " +
  "ring-1 ring-[hsl(40_30%_96%/0.08)] transition-colors group-hover:bg-[hsl(24_22%_22%)]";
const DISC_ICON = "h-[18px] w-[18px] text-[hsl(24_80%_55%)]";
const LABEL = "whitespace-nowrap text-[12px] leading-4 text-[hsl(40_30%_96%/0.7)] transition-colors group-hover:text-[hsl(40_30%_96%)]";
/**
 * Rule between actions, aligned with the discs rather than the labels. Shown
 * from 375px up only: below that the three items fit on one row solely
 * because the rules and their margins are gone (see the fit note on the row).
 * mx-1, not the more generous mx-3 an earlier pass used: with both wings now
 * WING_MIN_W wide (needed for centring — see the header comment), the row is
 * already close to the 375px budget, and the wider margin would push it over.
 * The breakpoint is 375, not the round-looking 368: at 368 the row (with
 * dividers) needs 320.83px against 320 available — 0.83px too wide, so it
 * silently wrapped to two lines right at that width. 375 has 6px to spare;
 * verified empirically across 320-414px, not just by this arithmetic.
 * Written out literally — Tailwind's scanner cannot see template-built names.
 */
const DIVIDER = `hidden min-[375px]:block mx-1 mt-[10px] h-6 w-px shrink-0 self-start ${RULE}`;

/**
 * Shared minimum width for the two OUTER actions (Instagram, Privacy) — the
 * actual centring fix, not a cosmetic constant. See "Centring" in the header
 * comment: making the two wings equal width is what makes the row symmetric,
 * regardless of the shared value's size, so this is set to the widest content
 * either wing ever needs to hold — Arabic "سياسة الخصوصية" (~98px natural) —
 * so neither wing clips. Email, the middle item, is untouched and keeps its
 * own natural width. Re-measure this if either wing's label changes; verify
 * the row still holds one line at 375px afterwards (see the fit note below).
 */
const WING_MIN_W = "min-w-[100px]";

/**
 * Corner waves — texture, not a shape competing with the text. A previous
 * pass (0.30/0.18 opacity, 96px/20px tall) read as a heavy, distinct band
 * across the bottom rather than a hint of colour. Both layers are now
 * smaller in every dimension and much fainter:
 *   back   40px tall (was 96), 2/5 of the footer's width (was 1/2), tapering
 *          to zero at the centre so the two sides never overlap
 *   swell  12px tall (was 20), under half the footer's width (was 62%),
 *          hugging the bottom edge under every glyph
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
        className={`pointer-events-none absolute bottom-0 h-10 w-2/5 ${place}`}
      >
        <path d="M0 120 V18 C 40 4, 80 8, 112 44 C 140 76, 168 104, 200 120 Z" fill={WAVE_FILL} fillOpacity="0.09" />
      </svg>
      <svg
        aria-hidden
        viewBox="0 0 200 20"
        preserveAspectRatio="none"
        className={`pointer-events-none absolute bottom-0 h-3 w-[45%] ${place}`}
      >
        <path d="M0 20 V6 C 50 0, 110 4, 150 12 C 170 16, 186 19, 200 20 Z" fill={WAVE_FILL} fillOpacity="0.06" />
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
        {/* Action row, sitting directly under the logo now that the tagline is
            gone (mt-9, not the tighter mt-8 the tagline's own margin used to
            leave). Sized to content and centred — NOT equal columns — so
            email (the widest, uncapped) gets the room it needs and the row
            never truncates. Instagram and Privacy share WING_MIN_W (see its
            comment: that equality is what makes the row actually centred, not
            just its bounding box). No column gap: the rules carry their own
            mx-1, and when they hide the discs' px-1 keeps the items apart.
            Measured fit at 12px labels, WIDEST case (Arabic, both wings at
            WING_MIN_W): 375px holds all three with the rules (321px of
            327px); below ~351px the three boxes alone (no rules — hidden
            under 368px) no longer fit (303px needed), and flex-wrap drops the
            last item to its own centred second line rather than shrinking or
            truncating anything. */}
        <nav aria-label={t("footerContact")} className="mt-9 flex flex-wrap items-start justify-center gap-y-3">
          {hasValue(BUSINESS.instagramUrl) && (
            <>
              {/* External profile: new tab, and rel guards the opener. */}
              <a
                href={BUSINESS.instagramUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={`${ACTION} ${WING_MIN_W}`}
              >
                <span className={DISC}><Instagram aria-hidden className={DISC_ICON} /></span>
                <span dir="ltr" className={LABEL}>{t("footerInstagram")}</span>
              </a>
              <span aria-hidden className={DIVIDER} />
            </>
          )}

          <a href={`mailto:${BUSINESS.email}`} className={ACTION}>
            <span className={DISC}><Mail aria-hidden className={DISC_ICON} /></span>
            <span dir="ltr" className={LABEL}>{BUSINESS.email}</span>
          </a>

          <span aria-hidden className={DIVIDER} />
          <Link to="/privacy" className={`${ACTION} ${WING_MIN_W}`}>
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
