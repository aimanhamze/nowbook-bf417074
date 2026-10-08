import { useEffect, useRef, type CSSProperties, type ReactNode, type RefObject } from "react";
import {
  motion,
  useMotionValue,
  useMotionValueEvent,
  useReducedMotion,
  useScroll,
  useTransform,
  type MotionValue,
} from "framer-motion";

/**
 * Provider page top bar. Collapses the way profile pages do on iOS: the
 * round buttons stay pinned while a frosted bar fades in behind them, and a
 * small avatar takes over from the big one as it slides under the bar.
 *
 * Everything is driven by motion values off window scroll — no React state,
 * so scrolling never re-renders this component or the page.
 */

// Big avatar geometry in ProviderDetail: the info card sits -mt-12 (48px)
// over the cover, the avatar -top-14 (56px) above the card, 112px tall.
const AVATAR_SIZE = 112;
const AVATAR_TOP_FROM_COVER_BOTTOM = 48 + 56;

interface CollapsingHeaderProps {
  /** The cover block — its bottom edge locates the big avatar. */
  coverRef: RefObject<HTMLElement>;
  /** The big avatar; dimmed imperatively as it slides under the bar. */
  bigAvatarRef: RefObject<HTMLElement>;
  /** Small avatar content (image or initial), shown in a 32px circle. */
  avatar: ReactNode;
  /** Inline-start buttons (back/home). */
  start: ReactNode;
  /** Inline-end buttons (share, favourite). */
  end: ReactNode;
}

export function CollapsingHeader({ coverRef, bigAvatarRef, avatar, start, end }: CollapsingHeaderProps) {
  const reduceMotion = useReducedMotion();
  const barRef = useRef<HTMLDivElement>(null);
  const { scrollY } = useScroll();
  const avatarTop = useMotionValue(Number.POSITIVE_INFINITY);
  const barBottom = useMotionValue(64);

  useEffect(() => {
    const cover = coverRef.current;
    const bar = barRef.current;
    if (!cover || !bar) return;
    const measure = () => {
      avatarTop.set(cover.getBoundingClientRect().bottom + window.scrollY - AVATAR_TOP_FROM_COVER_BOTTOM);
      barBottom.set(bar.getBoundingClientRect().height);
    };
    measure();
    // Cover height settles when its image loads; bar height when the
    // safe-area inset resolves (rotation, standalone launch).
    const ro = new ResizeObserver(measure);
    ro.observe(cover);
    ro.observe(bar);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [coverRef, avatarTop, barBottom]);

  // 0 → big avatar fully below the bar, 1 → fully tucked under it.
  const progress = useTransform<number, number>([scrollY, avatarTop, barBottom], ([y, top, bottom]) =>
    Math.min(1, Math.max(0, (y + bottom - top) / AVATAR_SIZE)),
  );
  // Reduced motion: nothing scrubs or slides — the bar is simply on or off.
  const stepped = useTransform(progress, (v) => (v >= 0.5 ? 1 : 0));
  const p = reduceMotion ? stepped : progress;

  const barOpacity = useTransform(p, [0, 0.45], [0, 1]);
  // Transparent bar must not swallow taps on the cover photo.
  const barPointer = useTransform(p, (v) => (v > 0.05 ? "auto" : "none"));
  const miniOpacity = useTransform(p, [0.3, 0.85], [0, 1]);
  const miniY = useTransform(p, [0.3, 0.85], reduceMotion ? [0, 0] : [14, 0]);
  const miniScale = useTransform(p, [0.3, 0.85], reduceMotion ? [1, 1] : [0.8, 1]);
  const floatOpacity = useTransform(p, [0, 0.45], [1, 0]);

  // The handoff: big avatar dims as the small one arrives. Written straight
  // to the DOM so it costs no render.
  useMotionValueEvent(p, "change", (v) => {
    const el = bigAvatarRef.current;
    if (el) el.style.opacity = String(reduceMotion ? 1 : 1 - Math.min(1, v * 2));
  });

  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-40">
      <motion.div
        aria-hidden
        style={{ opacity: barOpacity, pointerEvents: barPointer }}
        className="absolute inset-0 border-b border-[hsl(25_30%_25%/0.08)] bg-white/75 shadow-[0_8px_24px_-18px_rgba(120,70,30,0.35)] backdrop-blur-xl backdrop-saturate-150 [@media(prefers-reduced-transparency:reduce)]:bg-white/95 [@media(prefers-reduced-transparency:reduce)]:backdrop-blur-none"
      />
      <div
        ref={barRef}
        className="relative flex items-center justify-between px-4 pb-3 pt-[calc(env(safe-area-inset-top,0px)+0.75rem)]"
      >
        <ButtonGroup float={floatOpacity}>{start}</ButtonGroup>
        {/* Centred on the 40px button row; physical left/margin are
            symmetric so it is centred in RTL and LTR alike. */}
        <motion.div
          aria-hidden
          style={{ opacity: miniOpacity, y: miniY, scale: miniScale }}
          className="absolute bottom-4 left-1/2 -ml-4 h-8 w-8 overflow-hidden rounded-full bg-gradient-to-br from-accent/25 to-secondary shadow-[0_2px_8px_-2px_rgba(40,20,10,0.3)] ring-2 ring-white"
        >
          {avatar}
        </motion.div>
        <ButtonGroup float={floatOpacity}>{end}</ButtonGroup>
      </div>
    </div>
  );
}

/** Exposes `--float` (1 over the cover photo, 0 on the solid bar) to the
 *  HeaderIconButtons inside, so they cross-fade their chrome in CSS. */
function ButtonGroup({ children, float }: { children: ReactNode; float: MotionValue<number> }) {
  return (
    <motion.div style={{ "--float": float } as unknown as CSSProperties} className="pointer-events-auto flex gap-2">
      {children}
    </motion.div>
  );
}

/**
 * 40px round header button with a 44px tap area (::after, as BranchChip).
 * Two stacked fills cross-fade on `--float`: frosted white with a shadow over
 * the cover photo, a quiet warm tint once the bar is solid white behind it.
 */
export function HeaderIconButton({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...props}
      className="relative flex h-10 w-10 items-center justify-center rounded-full text-foreground transition-transform after:absolute after:-inset-0.5 after:rounded-full after:content-[''] active:scale-95"
    >
      <span
        aria-hidden
        style={{ opacity: "var(--float, 1)" }}
        className="absolute inset-0 rounded-full bg-white/85 shadow-[0_4px_16px_rgba(0,0,0,0.08)] ring-1 ring-white/40 backdrop-blur-md"
      />
      <span
        aria-hidden
        style={{ opacity: "calc(1 - var(--float, 1))" }}
        className="absolute inset-0 rounded-full bg-[hsl(25_35%_30%/0.07)]"
      />
      <span className="relative flex">{children}</span>
    </button>
  );
}
