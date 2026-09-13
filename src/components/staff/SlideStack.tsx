import { useLayoutEffect, useRef, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { slideAnimate, slideDirection, slideExit, slideInitial, type SlideCustom, type SlideDirection } from "@/lib/staffSlide";

interface Props {
  pathname: string;
  isRtl: boolean;
  reduceMotion: boolean;
  children: ReactNode;
}

/**
 * The native-style page-slide shell used by pages/StaffRoutes.tsx. Separated
 * from the routes so it can be exercised in a test with stand-in pages and a
 * MemoryRouter — whose `navigate(-1)` is the same POP the device back gesture
 * produces.
 *
 * DIRECTION comes from path depth (lib/staffSlide.ts), so a PUSH from the back
 * arrow and a POP from the device back gesture animate identically. The
 * horizontal sign comes from the RTL flag the caller reads from LangContext,
 * the same source every directional icon in the app uses.
 *
 * SCROLL PINNING: at the render where the pathname changes, window.scrollY is
 * still the OLD page's offset. It is captured then, the exiting page is switched
 * to absolute and lifted by that amount (see slideExit), and the window is
 * scrolled to the top for the new page in a layout effect — before paint, so
 * nothing jumps.
 *
 * REDUCED MOTION collapses to a plain keyed swap: no AnimatePresence, no
 * transform, no fade. Instant, exactly as before this file existed.
 */
export function SlideStack({ pathname, isRtl, reduceMotion, children }: Props) {
  const prevPathRef = useRef(pathname);
  const dirRef = useRef<SlideDirection>("none");
  const exitScrollRef = useRef(0);

  if (pathname !== prevPathRef.current) {
    dirRef.current = slideDirection(prevPathRef.current, pathname);
    exitScrollRef.current = typeof window !== "undefined" ? window.scrollY : 0;
    prevPathRef.current = pathname;
  }

  useLayoutEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  if (reduceMotion) {
    return <div key={pathname}>{children}</div>;
  }

  const custom: SlideCustom = { dir: dirRef.current, isRtl, exitScrollY: exitScrollRef.current };

  return (
    <div className="relative w-full [overflow-x:clip]">
      <AnimatePresence initial={false} custom={custom}>
        <motion.div
          key={pathname}
          data-slide-panel={pathname}
          custom={custom}
          variants={{ initial: slideInitial, animate: slideAnimate, exit: slideExit }}
          initial="initial"
          animate="animate"
          exit="exit"
          // Base flow position. The exit variant switches it to absolute and
          // lifts it by the scroll offset; giving it a start value here is what
          // lets Framer set that change instantly instead of warning about it.
          style={{ position: "relative", top: 0 }}
          className="w-full start-0 will-change-transform"
        >
          {children}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
