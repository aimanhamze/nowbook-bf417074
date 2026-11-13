import { useEffect, useState, useSyncExternalStore } from "react";
import { useLocation } from "react-router-dom";

/**
 * Is the on-screen keyboard open?
 *
 * With `interactive-widget=resizes-content` (index.html), Chrome on Android
 * shrinks the layout when the keyboard opens, so every `fixed bottom-0` bar
 * (bottom nav, the provider page's Book button) would ride up ON TOP of the
 * keyboard and cover what the user is typing into. Those bars hide while this
 * is true.
 *
 * True only when ALL hold, on a touch device:
 *  - a text-entry element has focus AND is still in the page (a field
 *    removed while focused — the login form unmounting on navigation — fires
 *    no blur/focusout, so focus events alone could leave this stuck);
 *  - the visual viewport is actually shorter than the tallest it has been
 *    (by a keyboard's worth), so the bars return the moment the keyboard is
 *    really gone, including Android's back button, which keeps focus.
 *    Without VisualViewport, focus alone decides.
 * Re-checked on focus moves, on every viewport resize, and on every route
 * change (useKeyboardOpen reads the location), so it can't stay stuck.
 * Pickers (date/time/select/checkbox…) are not text entry: Android shows a
 * dialog, not the keyboard, for those.
 */

const NON_TEXT_INPUTS = new Set([
  "button", "checkbox", "color", "date", "datetime-local", "file", "hidden", "image",
  "month", "radio", "range", "reset", "submit", "time", "week",
]);

export function isTextEntry(el: Element | null): el is HTMLElement {
  if (!el || !(el instanceof HTMLElement)) return false;
  if (el.isContentEditable) return true;
  if (el instanceof HTMLTextAreaElement) return !el.readOnly && !el.disabled;
  if (el instanceof HTMLInputElement) return !NON_TEXT_INPUTS.has(el.type) && !el.readOnly && !el.disabled;
  return false;
}

const coarse = () =>
  typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;

// A keyboard shortens the visual viewport by far more than this; browser
// toolbars collapsing/expanding by less.
const KEYBOARD_MIN_PX = 120;

let open = false;
let tallest = 0;
let lastWidth = 0;
const listeners = new Set<() => void>();

/** null = no VisualViewport (focus alone decides). Keeps the baseline fresh:
 *  the tallest height seen at the current width (a rotation resets it). */
function viewportShortened(): boolean | null {
  const vv = typeof window !== "undefined" ? window.visualViewport : null;
  if (!vv) return null;
  if (Math.abs(vv.width - lastWidth) > 1) {
    lastWidth = vv.width;
    tallest = vv.height;
  }
  tallest = Math.max(tallest, vv.height);
  return vv.height < tallest - KEYBOARD_MIN_PX;
}

function recompute() {
  const shortened = viewportShortened();
  const el = document.activeElement;
  const typing = coarse() && isTextEntry(el) && el.isConnected;
  const next = typing && (shortened === null ? true : shortened);
  if (next !== open) {
    open = next;
    listeners.forEach((l) => l());
  }
}

/** Re-check now (route changes call this; safe to call any time). */
export function recheckKeyboardOpen() {
  recompute();
}

// focusout fires before focus lands on the next element; read activeElement
// once the move has finished so tabbing between fields doesn't flicker.
const onFocusOut = () => setTimeout(recompute, 0);

function subscribe(listener: () => void) {
  if (listeners.size === 0) {
    document.addEventListener("focusin", recompute);
    document.addEventListener("focusout", onFocusOut);
    window.visualViewport?.addEventListener("resize", recompute);
  }
  listeners.add(listener);
  recompute();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      document.removeEventListener("focusin", recompute);
      document.removeEventListener("focusout", onFocusOut);
      window.visualViewport?.removeEventListener("resize", recompute);
    }
  };
}

export function useKeyboardOpen(): boolean {
  const { pathname } = useLocation();
  // A navigation can remove the focused field without any focus event.
  useEffect(() => {
    recompute();
  }, [pathname]);
  return useSyncExternalStore(subscribe, () => open, () => false);
}

/**
 * The on-screen keyboard is up, MEASURED: the visual viewport is clearly
 * shorter than the tallest it has been since `enabled` turned on. Works on
 * Android (the layout resizes) and iOS (it doesn't), and turns false again
 * when the keyboard is dismissed with Android's back button, which keeps
 * focus in the field. Without VisualViewport it reports true, so focus alone
 * decides.
 */
export function useVisualKeyboardUp(enabled = true): boolean {
  const [up, setUp] = useState(false);
  useEffect(() => {
    if (!enabled) {
      setUp(false);
      return;
    }
    const vv = window.visualViewport;
    if (!vv) {
      setUp(true);
      return;
    }
    let tallest = vv.height;
    const onResize = () => {
      tallest = Math.max(tallest, vv.height);
      setUp(vv.height < tallest - 120);
    };
    vv.addEventListener("resize", onResize);
    return () => vv.removeEventListener("resize", onResize);
  }, [enabled]);
  return up;
}
