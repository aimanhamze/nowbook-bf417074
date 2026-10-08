/**
 * "Is this page the first one the visitor saw in this tab?"
 *
 * A customer who opens a provider link from Instagram (or a QR code, a push
 * notification, a shared URL) has no in-app history: navigate(-1) leaves the
 * app or does nothing at all. On such an entry point the back control becomes
 * a Home control instead.
 *
 * Detection reads React Router's own history index, NOT history.length:
 *  - BrowserRouter stamps every entry it creates with `idx`, starting at 0 on
 *    the first load in the tab, and keeps it in history.state — so it survives
 *    a reload.
 *  - history.length counts entries from OTHER origins too (Instagram's
 *    l.instagram.com redirect, the feed itself), so it is >1 on a direct
 *    landing inside the in-app browser.
 *
 * The second signal is the marker /auth attaches when it sends a freshly
 * signed-in user on to where they were headed. That navigation REPLACES /auth,
 * so the entry behind it is usually the very page they are returning to —
 * "back" would only show the same page again before dead-ending.
 */

/** Location state /auth passes on its post-login navigate. */
export const ENTRY_STATE = { smartBackEntry: true } as const;

export function isEntryPoint(historyState: unknown, locationState: unknown): boolean {
  if ((locationState as { smartBackEntry?: unknown } | null)?.smartBackEntry === true) {
    return true;
  }
  const idx = (historyState as { idx?: unknown } | null)?.idx;
  // No index at all means the router never stamped this entry (it always does
  // for BrowserRouter) — treat it as an entry rather than risk a dead back.
  return typeof idx !== "number" || idx <= 0;
}
