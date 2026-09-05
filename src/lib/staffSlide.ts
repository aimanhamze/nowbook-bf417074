/**
 * Page-slide geometry for the Staff routes (/staff ↔ /staff/:id).
 *
 * Pure on purpose: the layout component (pages/StaffRoutes.tsx) only feeds
 * these functions the current path, the previous path, the RTL flag and the
 * window's scroll offset. Everything that decides WHICH WAY things move lives
 * here, where it can be pinned by tests — including the device back gesture,
 * which reaches us as a plain location change (popstate → shallower path) and
 * therefore resolves to "back" without any click handler being involved.
 */

export type SlideDirection = "forward" | "back" | "none";

/** 220ms ease-out: quick enough to read as a swap, slow enough to show direction. */
export const SLIDE_DURATION = 0.22;
export const SLIDE_EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

/** How far the page UNDER the moving one drifts, as a fraction of its width. */
const PARALLAX = 0.3;

/** /staff → 1, /staff/abc → 2. Trailing slashes and doubled slashes don't count. */
export function routeDepth(pathname: string): number {
  return pathname.split("/").filter(Boolean).length;
}

/**
 * Deeper path = forward, shallower = back, same depth = none (e.g. /staff/new
 * being replaced by /staff/<id> after a create — a crossfade, not a slide).
 *
 * Depth, not navigation type: a PUSH to /staff from the member page's back
 * arrow and a POP from the device back gesture are the same journey and must
 * look the same.
 */
export function slideDirection(prevPathname: string, nextPathname: string): SlideDirection {
  const prev = routeDepth(prevPathname);
  const next = routeDepth(nextPathname);
  if (next > prev) return "forward";
  if (next < prev) return "back";
  return "none";
}

export interface SlideCustom {
  dir: SlideDirection;
  /** Reading direction. Forward ENTERS from the inline end: right in LTR, left in RTL. */
  isRtl: boolean;
  /** window.scrollY at the moment the location changed; pins the exiting page. */
  exitScrollY: number;
}

/** "+100%" in LTR is the right edge; in RTL the same inline-end edge is "-100%". */
function edge(isRtl: boolean, fraction: number): string {
  const sign = isRtl ? -1 : 1;
  return `${Math.round(fraction * 100 * sign)}%`;
}

/**
 * Where the ENTERING page starts. Forward: fully off-screen at the inline end.
 * Back: a little toward the inline start, slightly faded (it was "under" the
 * page that is now leaving).
 */
export function slideInitial({ dir, isRtl }: SlideCustom) {
  if (dir === "none") return { x: 0, opacity: 0 };
  if (dir === "forward") return { x: edge(isRtl, 1), opacity: 1 };
  return { x: edge(isRtl, -PARALLAX), opacity: 0.85 };
}

/**
 * The resting state. Position and top are NOT set here: the panel's base style
 * is `position: relative; top: 0` (see SlideStack), so the page defines the
 * document height and scrolls the window, and only the exit variant ever
 * overrides them.
 */
export function slideAnimate({ dir }: SlideCustom) {
  return {
    x: 0,
    opacity: 1,
    zIndex: dir === "back" ? 1 : 2,
    transition: { duration: SLIDE_DURATION, ease: SLIDE_EASE },
  };
}

/**
 * Where the EXITING page goes, and how it is held while going.
 *
 * PINNED AT ITS SCROLL OFFSET: the leaving page is switched to absolute and
 * lifted by the scroll offset the window had when the route changed. The layout
 * then scrolls the window to the top for the new page, so the reader keeps
 * seeing exactly the part of the old page they were looking at while it slides.
 * `top` and `position` change instantly (duration 0 / non-animatable) — only
 * `x` and `opacity` move.
 *
 * Forward: the old page drifts a little toward the inline start, under the new
 * one. Back: the old page slides fully out at the inline end, over the new one.
 */
export function slideExit({ dir, isRtl, exitScrollY }: SlideCustom) {
  const base = {
    position: "absolute" as const,
    top: -exitScrollY,
    zIndex: dir === "back" ? 2 : 1,
    transition: { duration: SLIDE_DURATION, ease: SLIDE_EASE, top: { duration: 0 } },
  };
  if (dir === "none") return { ...base, x: 0, opacity: 0 };
  if (dir === "forward") return { ...base, x: edge(isRtl, -PARALLAX), opacity: 0.85 };
  return { ...base, x: edge(isRtl, 1), opacity: 1 };
}
