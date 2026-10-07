/**
 * Pre-write session check for customer mutations.
 *
 * WHY THIS EXISTS: supabase-js attaches `session?.access_token ?? anonKey` to
 * every PostgREST request. When the access token is near expiry and the
 * refresh fails with a RETRYABLE error (network drop, 502/503/504 — common in
 * in-app browsers resuming from background), getSession() returns null but
 * supabase-js keeps the stored session and emits no event. AuthContext still
 * holds the user, ProtectedRoute still renders the page, and the write goes
 * out as `anon`: RLS rejects it, or — for an UPDATE — silently matches zero
 * rows.
 *
 * The AuthContext dead-session detector cannot catch this: it ignores
 * transport errors on purpose (a network blip must never sign anyone out).
 * So the check before a write needs a third outcome besides alive/dead:
 * "offline" — no usable token right now, do not send the write, do not sign
 * out either.
 */
import { isDeadSessionError, type AuthErrorLike } from "./sessionHealth";

export type LiveSessionStatus = "ok" | "offline" | "dead";

/** The slice of supabase.auth this check uses — injectable for tests. */
export interface LiveSessionAuth {
  getSession(): Promise<{
    data: { session: { user: { id: string } } | null };
    error: AuthErrorLike | null;
  }>;
  getUser(): Promise<{ error: AuthErrorLike | null }>;
}

function isTransportError(error: AuthErrorLike | null | undefined): boolean {
  return error?.name === "AuthRetryableFetchError";
}

/**
 * Decides whether a write may be sent as `expectedUserId` right now.
 *
 *  - "ok":      a token for this user is in hand and the server did not say
 *               the session is gone.
 *  - "offline": no usable token because the refresh could not reach the
 *               server. The session may still be fine — retry later.
 *  - "dead":    signing in again is the only way forward.
 */
export async function checkLiveSession(
  auth: LiveSessionAuth,
  expectedUserId: string,
): Promise<LiveSessionStatus> {
  // getSession() refreshes the token itself when it is within the expiry
  // margin, so a session returned here is one the write can use.
  let session: { user: { id: string } } | null;
  let sessionError: AuthErrorLike | null;
  try {
    const result = await auth.getSession();
    session = result.data.session;
    sessionError = result.error;
  } catch {
    return "offline";
  }

  if (!session) {
    // Retryable refresh failure: supabase-js kept the stored session, so it
    // may recover. Any other outcome (non-retryable refresh error — which
    // supabase-js has already cleared — or nothing stored at all) is final.
    return isTransportError(sessionError) ? "offline" : "dead";
  }

  // Another tab signed in as someone else: the write would go out under an
  // account the UI is not showing.
  if (session.user.id !== expectedUserId) return "dead";

  // Server-side check for a session deleted while its token is still valid.
  // Only a documented dead-session code counts; a transport failure here does
  // not block the write, because the token in hand is unexpired and RLS
  // verifies its signature alone.
  try {
    const { error } = await auth.getUser();
    if (isDeadSessionError(error)) return "dead";
  } catch {
    // Network failure — fall through, the token is usable.
  }
  return "ok";
}

/** The shape of a PostgREST failure as read off a supabase-js response. */
export interface WriteErrorLike {
  code?: string | null;
}

/**
 * True when a PostgREST write failure means the request was not made as a
 * signed-in user — the session died between the pre-check and the write.
 *
 *  - PGRST301 / PGRST302: the JWT was rejected (expired, malformed, missing).
 *  - 42501 with HTTP 401: an RLS/privilege refusal for the `anon` role.
 *    PostgREST answers 403 for the same code when the role is
 *    `authenticated`, which is a genuine policy refusal, not a dead session.
 */
export function isUnauthenticatedWriteError(
  error: WriteErrorLike | null | undefined,
  status?: number | null,
): boolean {
  if (!error) return false;
  if (error.code === "PGRST301" || error.code === "PGRST302") return true;
  return error.code === "42501" && status === 401;
}

/** Thrown by a mutation after the session problem has already been shown to
 *  the customer, so its onError knows to stay quiet. */
export class SessionHandledError extends Error {
  constructor() {
    super("SESSION_HANDLED");
    this.name = "SessionHandledError";
  }
}
