/**
 * In-app browser detection. Most customers open provider links from inside
 * Instagram's in-app browser, which behaves differently from Safari/Chrome:
 * its own cookie jar (not signed in to Google), and file downloads such as an
 * .ics that may never reach the Calendar app.
 *
 * Kept tiny and pure so the planned "open in browser" banner can reuse it.
 * Instagram puts "Instagram <version>" in its user agent on iOS and Android.
 */
export function isInstagramInAppBrowser(
  userAgent: string = typeof navigator === "undefined" ? "" : navigator.userAgent,
): boolean {
  return /\bInstagram\b/i.test(userAgent);
}
