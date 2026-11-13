import * as SheetPrimitive from "@radix-ui/react-dialog";
import { cva, type VariantProps } from "class-variance-authority";
import { X } from "lucide-react";
import * as React from "react";

import { useLang } from "@/contexts/LangContext";
import { isTextEntry } from "@/hooks/useKeyboardOpen";
import { cn } from "@/lib/utils";

const Sheet = SheetPrimitive.Root;

const SheetTrigger = SheetPrimitive.Trigger;

const SheetClose = SheetPrimitive.Close;

const SheetPortal = SheetPrimitive.Portal;

const SheetOverlay = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Overlay
    className={cn(
      "fixed inset-0 z-50 bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className,
    )}
    {...props}
    ref={ref}
  />
));
SheetOverlay.displayName = SheetPrimitive.Overlay.displayName;

const sheetVariants = cva(
  "fixed z-50 gap-4 bg-background p-6 shadow-lg transition ease-in-out focus:outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:duration-300 data-[state=open]:duration-500",
  {
    variants: {
      side: {
        top: "inset-x-0 top-0 border-b data-[state=closed]:slide-out-to-top data-[state=open]:slide-in-from-top",
        // Keyboard-aware (see useKeyboardAwareSheet): sits above the keyboard
        // (--kb-inset, iOS) and never taller than the VISIBLE area (--vvh),
        // scrolling inside instead. Without JS / VisualViewport the fallbacks
        // are the plain bottom edge and 100dvh. A sheet that sets its own
        // max-h must use the same var (max-h-[calc(var(--vvh,100dvh)*0.9)]).
        bottom:
          "inset-x-0 bottom-[var(--kb-inset,0px)] max-h-[calc(var(--vvh,100dvh)*0.92)] overflow-y-auto border-t data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom",
        left: "inset-y-0 left-0 h-full w-3/4 border-r data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left sm:max-w-sm",
        right:
          "inset-y-0 right-0 h-full w-3/4  border-l data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right sm:max-w-sm",
      },
    },
    defaultVariants: {
      side: "right",
    },
  },
);

interface SheetContentProps
  extends React.ComponentPropsWithoutRef<typeof SheetPrimitive.Content>,
    VariantProps<typeof sheetVariants> {
  /**
   * Focus the first field when the sheet opens. Off by default: on a phone
   * that pops the keyboard over a form the user hasn't seen yet. The sheet
   * itself takes focus instead (keeps the focus trap and screen readers in
   * the dialog), and the keyboard opens only when a field is tapped.
   */
  autoFocusOnOpen?: boolean;
  /** Hide the corner ✕ — for a view that puts its own back + action at the
   *  top (e.g. the new-appointment sheet's new-customer view). Esc and the
   *  overlay still close the sheet. */
  hideClose?: boolean;
}

/**
 * Bottom sheets vs the on-screen keyboard.
 *
 * Android Chrome resizes the layout itself (interactive-widget=resizes-content
 * in index.html). iOS Safari ignores that and lays the keyboard over the page,
 * so the VisualViewport tells us how much of the layout viewport the keyboard
 * hides: --kb-inset lifts the sheet by that much and --vvh caps its height to
 * what is visible. On Android the same formula gives 0 and the shrunken
 * height. The focused field is kept in view inside the sheet's scroller.
 * Listeners live only while the sheet is mounted.
 */
function useKeyboardAwareSheet(node: HTMLElement | null, enabled: boolean) {
  React.useEffect(() => {
    if (!node || !enabled) return;
    const vv = window.visualViewport;
    let raf = 0;
    let focusTimer: ReturnType<typeof setTimeout> | undefined;

    const measure = () => {
      if (!vv) return;
      const hidden = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      node.style.setProperty("--kb-inset", `${Math.round(hidden)}px`);
      node.style.setProperty("--vvh", `${Math.round(vv.height)}px`);
    };
    const revealFocused = () => {
      const el = document.activeElement;
      if (isTextEntry(el) && node.contains(el)) el.scrollIntoView({ block: "nearest" });
    };
    const onViewport = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        measure();
        revealFocused();
      });
    };
    // The keyboard animates in after focus; reveal again once it has settled
    // (covers browsers that don't fire a viewport resize for it).
    const onFocusIn = (e: FocusEvent) => {
      if (!isTextEntry(e.target as Element)) return;
      clearTimeout(focusTimer);
      focusTimer = setTimeout(revealFocused, 350);
    };

    measure();
    vv?.addEventListener("resize", onViewport);
    vv?.addEventListener("scroll", onViewport);
    node.addEventListener("focusin", onFocusIn);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(focusTimer);
      vv?.removeEventListener("resize", onViewport);
      vv?.removeEventListener("scroll", onViewport);
      node.removeEventListener("focusin", onFocusIn);
    };
  }, [node, enabled]);
}

const SheetContent = React.forwardRef<React.ElementRef<typeof SheetPrimitive.Content>, SheetContentProps>(
  ({ side = "right", className, children, autoFocusOnOpen = false, hideClose = false, onOpenAutoFocus, ...props }, ref) => {
    const { t } = useLang();
    const [node, setNode] = React.useState<HTMLDivElement | null>(null);
    // A ref as well as state: Radix fires onOpenAutoFocus during mount, before
    // the state update from the ref callback has re-rendered.
    const nodeRef = React.useRef<HTMLDivElement | null>(null);
    const setRefs = React.useCallback(
      (el: HTMLDivElement | null) => {
        nodeRef.current = el;
        setNode(el);
        if (typeof ref === "function") ref(el);
        else if (ref) ref.current = el;
      },
      [ref],
    );
    useKeyboardAwareSheet(node, side === "bottom");

    return (
      <SheetPortal>
        <SheetOverlay />
        <SheetPrimitive.Content
          ref={setRefs}
          className={cn(sheetVariants({ side }), className)}
          onOpenAutoFocus={(e) => {
            onOpenAutoFocus?.(e);
            if (e.defaultPrevented || autoFocusOnOpen) return;
            e.preventDefault();
            nodeRef.current?.focus({ preventScroll: true });
          }}
          {...props}
        >
          {children}
          {/* Logical end (left in he/ar, right in en), a 44px target, and a
              translated label. SheetHeader reserves room for it (pe-10). */}
          {!hideClose && (
          <SheetPrimitive.Close
            aria-label={t("closeBtn")}
            className="absolute end-2 top-2 flex h-11 w-11 items-center justify-center rounded-full text-foreground/60 transition-colors hover:bg-foreground/[0.06] hover:text-foreground active:bg-foreground/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:pointer-events-none"
          >
            <X className="h-5 w-5" aria-hidden />
          </SheetPrimitive.Close>
          )}
        </SheetPrimitive.Content>
      </SheetPortal>
    );
  },
);
SheetContent.displayName = SheetPrimitive.Content.displayName;

const SheetHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  // pe-10 keeps the title clear of the close button (end-2 + 44px = 52px from
  // the edge; the title starts at the sheet's 20–24px padding).
  <div className={cn("flex flex-col space-y-2 pe-10 text-center sm:text-start", className)} {...props} />
);
SheetHeader.displayName = "SheetHeader";

const SheetFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2", className)} {...props} />
);
SheetFooter.displayName = "SheetFooter";

const SheetTitle = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Title>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Title ref={ref} className={cn("text-lg font-semibold text-foreground", className)} {...props} />
));
SheetTitle.displayName = SheetPrimitive.Title.displayName;

const SheetDescription = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Description>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Description ref={ref} className={cn("text-sm text-muted-foreground", className)} {...props} />
));
SheetDescription.displayName = SheetPrimitive.Description.displayName;

export {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetOverlay,
  SheetPortal,
  SheetTitle,
  SheetTrigger,
};
