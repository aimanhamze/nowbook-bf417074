/**
 * Classifies Supabase Auth errors into "this session is definitively dead" vs
 * everything else.
 *
 * WHY THIS EXISTS: a Supabase access token can be cryptographically valid,
 * unexpired and correctly-roled while the session behind it no longer exists.
 * The API gateway, PostgREST and Storage only verify the SIGNATURE, so RLS
 * reads and writes keep succeeding from the token's claims alone. GoTrue's
 * /auth/v1/user is the only component that checks auth.sessions — so every
 * Edge Function using the getUser(token) pattern fails immediately while the
 * database still answers normally, and the refresh at expiry then fails too
 * because there is no session to refresh.
 *
 * THE SAFETY PROPERTY: this returns true ONLY for the four codes Supabase
 * documents as meaning the session is gone. Everything else — above all
 * transport failures, which surface as AuthRetryableFetchError — returns
 * false. Getting that backwards would sign users out whenever the network
 * blips, which is far worse than the bug being fixed.
 *
 * Keyed on `error.code`, never the message: Supabase's guidance is explicitly
 * "Always use error.code and error.name to identify errors, not string
 * matching on error messages."
 */

/** Codes that mean the session no longer exists server-side. */
const DEAD_SESSION_CODES = new Set([
  // The session this request relates to no longer exists.
  "session_not_found",
  // The session expired server-side.
  "session_expired",
  // The session containing the refresh token was not found.
  "refresh_token_not_found",
  // Refresh-token reuse detection revoked the whole family. Seeing this in the
  // wild is what would confirm reuse detection as the root cause.
  "refresh_token_already_used",
]);

/** The shape we read off a Supabase AuthError; everything is optional. */
export interface AuthErrorLike {
  code?: string | null;
  name?: string | null;
  status?: number | null;
}

/**
 * True only when the error definitively means "the session is gone, signing in
 * again is the only way forward".
 *
 * Deliberately conservative: an unrecognised code, a missing code, or any
 * network/transport error returns false. A false negative costs one more failed
 * request; a false positive logs a working user out.
 */
export function isDeadSessionError(error: AuthErrorLike | null | undefined): boolean {
  if (!error) return false;

  // Transport failures carry no session meaning whatsoever. Checked explicitly
  // rather than relying on them simply lacking a code, so a future supabase-js
  // that attaches a code to retryable errors cannot silently start logging
  // people out when they go offline.
  if (error.name === "AuthRetryableFetchError") return false;

  return typeof error.code === "string" && DEAD_SESSION_CODES.has(error.code);
}
