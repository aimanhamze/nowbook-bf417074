import { useEffect, useState, useSyncExternalStore } from "react";

/**
 * Is the on-screen keyboard (probably) open?
 *
 * With `interactive-widget=resizes-content` (index.html), Chrome on Android
 * shrinks the layout when the keyboard opens, so every `fixed bottom-0` bar
 * (bottom nav, the provider page's Book button) would ride up ON TOP of the
 * keyboard and cover what the user is typing into. Those bars hide while this
 * is true.
 *
 * Heuristic, by design: a text-entry element has focus on a touch device.
 * That is true on both platforms the moment the keyboard is asked for (iOS
 * Safari does not resize the layout, so measuring the viewport would miss
 * it), and it never fires on desktop. Pickers (date/time/select/checkbox…)
 * are not text entry: Android shows a dialog, not the keyboard, for those.
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

let open = false;
const listeners = new Set<() => void>();

function recompute() {
  const next = coarse() && isTextEntry(document.activeElement);
  if (next !== open) {
    open = next;
    listeners.forEach((l) => l());
  }
}

// focusout fires before focus lands on the next element; read activeElement
// once the move has finished so tabbing between fields doesn't flicker.
const onFocusOut = () => setTimeout(recompute, 0);

function subscribe(listener: () => void) {
  if (listeners.size === 0) {
    document.addEventListener("focusin", recompute);
    document.addEventListener("focusout", onFocusOut);
  }
  listeners.add(listener);
  recompute();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      document.removeEventListener("focusin", recompute);
      document.removeEventListener("focusout", onFocusOut);
    }
  };
}

export function useKeyboardOpen(): boolean {
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
