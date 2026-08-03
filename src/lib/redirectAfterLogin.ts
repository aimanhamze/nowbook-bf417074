/** Remembers where an unauthenticated user was headed so /auth can send them
 *  back there instead of dumping them on the home page.
 *
 *  Stored in sessionStorage so it dies with the tab and never leaks between
 *  browsing sessions. Every read consumes the value — the redirect must fire
 *  exactly once. */

const KEY = "redirectAfterLogin";

/** Never restore the login flow itself — that would bounce the user in a loop. */
const EXCLUDED = ["/auth", "/reset-password"];

function isExcluded(path: string): boolean {
  return EXCLUDED.some((p) => path === p || path.startsWith(`${p}?`) || path.startsWith(`${p}/`));
}

/** Save the destination to return to after login.
 *  Defaults to the current location (path + query + hash) when omitted. */
export function saveRedirectAfterLogin(path?: string): void {
  const target =
    path ?? `${window.location.pathname}${window.location.search}${window.location.hash}`;

  // Same-origin app paths only: "//evil.com" is a protocol-relative URL, not a route.
  if (!target.startsWith("/") || target.startsWith("//")) return;
  if (isExcluded(target)) return;

  try {
    sessionStorage.setItem(KEY, target);
  } catch {
    // Storage can be unavailable (private mode, blocked cookies) — fall back to
    // the existing behaviour of landing on the home page.
  }
}

/** Read and clear the saved destination. Returns null when there is none. */
export function consumeRedirectAfterLogin(): string | null {
  try {
    const target = sessionStorage.getItem(KEY);
    if (target) sessionStorage.removeItem(KEY);
    return target;
  } catch {
    return null;
  }
}
