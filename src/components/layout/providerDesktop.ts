/**
 * Desktop-only (lg+) presentation for provider screens — Option A:
 * constrain + polish. On mobile every class here is inert (all lg:-prefixed),
 * so the phone experience is byte-for-byte the same.
 *
 * The pattern: the page root stays full-bleed and provides a warm backdrop,
 * while the content is capped to a centered column framed with hairline side
 * borders, a faint surface lift and a soft warm glow — the app presented as a
 * deliberate centered column rather than a stretched phone layout. Centering
 * and border-x are symmetric, so RTL (he/ar) and LTR render identically.
 *
 * BottomNav applies a matching lg: constraint (provider role only) so the bar
 * aligns with this column instead of stretching across the viewport.
 */

/** Page root (full-bleed backdrop). Moves the bottom-nav clearance into the
 *  column on desktop and gives bg-less pages the soft provider atmosphere.
 *  Pages that already set an inline atmosphere background keep it — the
 *  inline style wins over the arbitrary-property class. */
export const providerDesktopPage =
  "lg:pb-0 lg:[background:var(--bg-atmosphere-soft)]";

/** Content column: capped, centered, framed. */
export const providerDesktopColumn =
  "lg:mx-auto lg:max-w-2xl lg:min-h-screen lg:pb-24 lg:border-x lg:border-border/70 lg:bg-card/40 lg:shadow-[0_0_60px_-15px_hsl(24_50%_45%_/_0.18)]";

/** Bottom sheets opened from provider screens (new booking, service editor…):
 *  they are fixed with inset-x-0, so capping + mx-auto centers them over the
 *  column instead of stretching across the whole desktop viewport. */
export const providerDesktopSheet =
  "lg:mx-auto lg:max-w-2xl lg:border-x lg:border-border/70";
