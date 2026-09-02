/**
 * Pull a human-readable message out of whatever supabase-js threw.
 *
 * THE TRAP THIS EXISTS FOR: `PostgrestError` is exported as a class, so
 * `err instanceof Error` LOOKS like a safe guard — but the object the client
 * actually hands back on a failed request is a plain `Object` parsed from the
 * response body, not an instance of that class. Verified against
 * @supabase/postgrest-js 2.99.3:
 *
 *   const { error } = await supabase.from('bookings').update({ nope: 1 })...
 *   error instanceof Error        // false
 *   error.constructor.name        // 'Object'
 *   error.code                    // 'PGRST204'
 *
 * So `err instanceof Error ? err.message : fallback` silently discards EVERY
 * PostgREST error and shows the fallback instead — which is exactly how a
 * production schema-cache failure reached a user as a bare "error saving".
 * Duck-type on `.message` instead; never gate on `instanceof`.
 */
export function supabaseErrorMessage(err: unknown, fallback: string): string {
  if (typeof err === "object" && err !== null) {
    const message = (err as { message?: unknown }).message;
    if (typeof message === "string" && message.trim() !== "") return message;
  }
  if (typeof err === "string" && err.trim() !== "") return err;
  return fallback;
}

/** PostgREST/Postgres error code, when the thrown value carries one. */
export function supabaseErrorCode(err: unknown): string | null {
  if (typeof err === "object" && err !== null) {
    const code = (err as { code?: unknown }).code;
    if (typeof code === "string" && code !== "") return code;
  }
  return null;
}
