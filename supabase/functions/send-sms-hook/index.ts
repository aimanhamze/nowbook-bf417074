// send-sms-hook — Supabase Auth "Send SMS" hook. Delivers the phone OTP that
// Supabase Auth generated; Auth still generates, stores and verifies the code.
// This function only carries the text to the handset.
//
// CONTRACT (https://supabase.com/docs/guides/auth/auth-hooks/send-sms-hook):
//   POST, Standard Webhooks signed, body { metadata, user, sms: { otp, phone } }
//   → 200 {}                                          delivered (or queued)
//   → 200 { error: { http_code, message } }           delivery failed
//   → 401 {}                                          signature invalid
//
// ERRORS ARE RETURNED AS HTTP 200 ON PURPOSE. Auth only parses the
// { error } body on a 200/202; any other status is replaced by a generic 500
// and our message is lost. The one exception is a bad signature: that caller
// is not Auth, so it gets a bare 401 and nothing else.
//
// Auth does NOT send an Authorization header, so this function must run with
// JWT verification off — see [functions.send-sms-hook] in supabase/config.toml.
//
// ROUTING:
//   Israeli mobile (normalizes to 9725XXXXXXXX)   → Shmor Makom
//     …and, when SHMOR_TEST_PHONES is set, only if listed there
//   everything else (07X, foreign, unlisted)      → fallback
// The fallback slot is reserved for Twilio and is NOT implemented yet: it
// reports not_configured, and the hook returns an error and logs loudly. With
// the hook enabled, Auth never calls its built-in SMS provider, so a number
// that reaches fallback today CANNOT log in. That is why the hook stays off on
// PROD until the Twilio fallback ships.
//
// TIME BUDGET: Supabase gives the whole hook invocation 5 s, and a cold start
// is spent before our timer starts. Everything here runs inside a hard
// HOOK_DEADLINE_MS from request arrival: one Shmor attempt, at most one retry
// (only for 5xx / timeout / network errors, only if enough time is left, and
// always with the SAME Idempotency-Key so Shmor never sends or charges twice),
// then fallback only if time remains.
//
// IDEMPOTENCY KEY: ehj-otp-<metadata.uuid>. Auth generates metadata.uuid once
// per OTP request and re-sends the same body on its own retries (read from the
// supabase/auth source; undocumented). webhook-id is a fallback only — Auth
// regenerates it on every attempt. The key is NEVER derived from the OTP: a
// hash of a 6-digit code plus a known phone number is trivially brute-forced,
// and the key leaves our system.
//
// SMS_DRY_RUN=true calls /v1/sms/estimate instead of /v1/sms: nothing is sent
// and nothing is charged, but the hook reports success — so the user receives
// no code. For scripted tests only, never with the hook enabled for real users.
//
// LOGGING: never logs the OTP, the message text, the Idempotency-Key, the
// Shmor API key or the hook secret. Phones appear as the last 4 digits only.
// Shmor's error `message` is not logged either — only its `code` and the HTTP
// status — because an upstream message may echo what we sent. Unexpected
// exceptions log their `name` only: a JSON.parse message can quote the body,
// and the body holds the OTP.

import { Webhook } from "https://esm.sh/standardwebhooks@1.0.0";

const FN = "send-sms-hook";

// ── Constants ────────────────────────────────────────────────────────────────

export const HOOK_DEADLINE_MS = 3500;
export const SHMOR_ATTEMPT_TIMEOUT_MS = 1500;
export const SHMOR_RETRY_MIN_REMAINING_MS = 1000;

export const SMS_MAX_CHARS = 201;
export const MESSAGE_TEMPLATE = "Your Ehjezly verification code is: {otp}";

const SHMOR_SEND_URL = "https://capabilities.shmormakom.com/v1/sms";
const SHMOR_ESTIMATE_URL = "https://capabilities.shmormakom.com/v1/sms/estimate";
const SHMOR_DEFAULT_SENDER = "Ehjezly";

// Shown to the user as the signInWithOtp error toast. Deliberately vague:
// which provider failed, and why, belongs in the logs, not in the browser.
const USER_MSG_UNAVAILABLE = "We could not send a verification code to this number. Please try again later.";
const USER_MSG_BAD_PAYLOAD = "Invalid SMS hook payload.";

// ── Helpers ──────────────────────────────────────────────────────────────────

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** A hook error Auth will relay to the client: HTTP 200, error in the body. */
function hookError(httpCode: number, message: string): Response {
  return json(200, { error: { http_code: httpCode, message } });
}

/**
 * Rejects a request at an entry gate, naming the gate in the log.
 * `gate` is a fixed identifier chosen here, never caller-controlled input.
 */
function reject(gate: string, status: number, body: unknown): Response {
  console.warn(`${FN}: rejected`, { gate, status });
  return json(status, body);
}

/** Safe for logs — last 4 digits only. Full numbers are PII. */
export function maskPhone(value: string | null | undefined): string {
  const d = (value ?? "").replace(/\D/g, "");
  return d.length <= 4 ? "****" : `***${d.slice(-4)}`;
}

/**
 * Israeli MOBILE → 9725XXXXXXXX, or null if not Shmor-routable.
 *
 * Accepts exactly four shapes (spaces and dashes ignored):
 *   +9725XXXXXXXX   9725XXXXXXXX   009725XXXXXXXX   05XXXXXXXX
 * Anything else — 07X VoIP/landlines, foreign numbers, a trunk '0' after the
 * country code, wrong length — is not routable, because Shmor delivers to
 * Israeli mobiles only. Used for both the recipient and SHMOR_TEST_PHONES
 * entries, so the allowlist can never match a number the router would reject.
 *
 * Written fresh rather than reusing looseDigits from whatsapp-booking-confirm,
 * which mishandles 00972-prefixed input.
 */
export function normalizeIsraeliMobile(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.replace(/[\s-]/g, "");
  if (/^\+9725\d{8}$/.test(s)) return s.slice(1);
  if (/^9725\d{8}$/.test(s)) return s;
  if (/^009725\d{8}$/.test(s)) return s.slice(2);
  if (/^05\d{8}$/.test(s)) return `972${s.slice(1)}`;
  return null;
}

/**
 * SHMOR_TEST_PHONES → set of normalized numbers, or null when unset/empty
 * (no restriction). Entries that do not normalize are dropped, so a list made
 * only of typos routes NOBODY to Shmor — the safe direction.
 */
export function parseAllowlist(raw: string | null | undefined): Set<string> | null {
  if (!raw || !raw.trim()) return null;
  const set = new Set<string>();
  let invalid = 0;
  for (const entry of raw.split(/[,;\s]+/)) {
    if (!entry) continue;
    const n = normalizeIsraeliMobile(entry);
    if (n) set.add(n);
    else invalid++;
  }
  if (invalid > 0) console.warn(`${FN}: SHMOR_TEST_PHONES has invalid entries`, { invalid });
  return set;
}

export type Route =
  | { provider: "shmor"; to: string }
  | { provider: "fallback"; reason: "not_israeli_mobile" | "not_in_test_allowlist" };

export function routeFor(rawPhone: string, allowlistRaw: string | undefined): Route {
  const to = normalizeIsraeliMobile(rawPhone);
  if (!to) return { provider: "fallback", reason: "not_israeli_mobile" };
  const allow = parseAllowlist(allowlistRaw);
  if (allow && !allow.has(to)) return { provider: "fallback", reason: "not_in_test_allowlist" };
  return { provider: "shmor", to };
}

/** One text for every user, language and OTP flow. */
export function buildMessage(otp: string): string {
  return MESSAGE_TEMPLATE.replace("{otp}", otp);
}

export function idempotencyKey(metadataUuid: unknown, webhookId: string | null): string | null {
  if (typeof metadataUuid === "string" && metadataUuid) return `ehj-otp-${metadataUuid}`;
  if (webhookId) return `ehj-otp-${webhookId}`;
  return null;
}

// ── Providers ────────────────────────────────────────────────────────────────

export interface Deps {
  env: (name: string) => string | undefined;
  fetch: typeof fetch;
  now: () => number;
  timeoutSignal: (ms: number) => AbortSignal;
  fallback: SmsProvider;
}

export interface SendRequest {
  to: string;
  text: string;
  idempotencyKey: string;
  deadline: number;
}

export type FailureCategory = "retryable" | "fallback" | "config" | "deadline";

export type SendOutcome =
  | { kind: "sent"; providerMessageId: string | null; dryRun?: boolean }
  | { kind: "failed"; category: FailureCategory; status: number | null; code: string }
  | { kind: "not_configured" };

export interface SmsProvider {
  name: string;
  send(req: SendRequest, deps: Deps): Promise<SendOutcome>;
}

/** Fallback slot. Twilio lands in a later phase; until then nothing is sent. */
export const twilioFallback: SmsProvider = {
  name: "twilio",
  send: () => Promise.resolve({ kind: "not_configured" }),
};

/**
 * Shmor error → what to do next.
 *   5xx                                  retry once (same Idempotency-Key)
 *   429 rate_limited, 400 invalid_phone  fallback — retrying cannot help
 *   400 message_too_long/invalid_sender,
 *   401, 402, 403                        config error — fix our setup; fallback
 *   anything else                        fallback
 */
export function classifyShmorError(status: number, code: string | null): FailureCategory {
  if (status >= 500) return "retryable";
  if (status === 401 || status === 402 || status === 403) return "config";
  if (status === 400 && (code === "message_too_long" || code === "invalid_sender")) return "config";
  return "fallback";
}

async function shmorAttempt(
  req: SendRequest,
  deps: Deps,
  apiKey: string,
  timeoutMs: number,
): Promise<SendOutcome> {
  const dryRun = deps.env("SMS_DRY_RUN") === "true";
  const sender = deps.env("SHMOR_SENDER")?.trim() || SHMOR_DEFAULT_SENDER;

  let res: Response;
  let raw: string;
  try {
    res = await deps.fetch(dryRun ? SHMOR_ESTIMATE_URL : SHMOR_SEND_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": req.idempotencyKey,
      },
      body: JSON.stringify({ to: req.to, sender, message: req.text }),
      signal: deps.timeoutSignal(timeoutMs),
    });
    raw = await res.text();
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    const code = name === "TimeoutError" || name === "AbortError" ? "timeout" : "network";
    return { kind: "failed", category: "retryable", status: null, code };
  }

  let body: Record<string, unknown> | null = null;
  try {
    body = raw ? JSON.parse(raw) as Record<string, unknown> : null;
  } catch {
    body = null; // non-JSON body — handled by the status below
  }

  if (res.ok) {
    const id = body?.id;
    return { kind: "sent", providerMessageId: typeof id === "string" ? id : null, dryRun };
  }

  const errCode = (body?.error as Record<string, unknown> | undefined)?.code;
  const code = typeof errCode === "string" ? errCode : `http_${res.status}`;
  return { kind: "failed", category: classifyShmorError(res.status, code), status: res.status, code };
}

export const shmorProvider: SmsProvider = {
  name: "shmor",
  async send(req, deps) {
    const apiKey = deps.env("SHMOR_API_KEY");
    if (!apiKey) {
      console.error(`${FN}: CONFIG ERROR`, { provider: "shmor", code: "api_key_not_configured" });
      return { kind: "failed", category: "config", status: null, code: "api_key_not_configured" };
    }

    let attempt = 0;
    let outcome: SendOutcome = { kind: "failed", category: "deadline", status: null, code: "deadline" };

    while (attempt < 2) {
      const remaining = req.deadline - deps.now();
      // Attempt 1 needs any time at all; the retry needs a meaningful slice.
      if (attempt === 1 && remaining < SHMOR_RETRY_MIN_REMAINING_MS) break;
      if (remaining <= 0) break;

      attempt++;
      const startedAt = deps.now();
      outcome = await shmorAttempt(req, deps, apiKey, Math.min(SHMOR_ATTEMPT_TIMEOUT_MS, remaining));

      if (outcome.kind !== "failed") return outcome;

      const fields = {
        provider: "shmor",
        attempt,
        status: outcome.status,
        code: outcome.code,
        category: outcome.category,
        phone: maskPhone(req.to),
        latency_ms: deps.now() - startedAt,
      };
      if (outcome.category === "config") console.error(`${FN}: CONFIG ERROR`, fields);
      else console.warn(`${FN}: attempt failed`, fields);

      if (outcome.category !== "retryable") return outcome;
    }

    return outcome;
  },
};

// ── Handler ──────────────────────────────────────────────────────────────────

export const defaultDeps: Deps = {
  env: (name) => Deno.env.get(name),
  fetch: (input, init) => fetch(input, init),
  now: () => Date.now(),
  timeoutSignal: (ms) => AbortSignal.timeout(ms),
  fallback: twilioFallback,
};

export async function handleHook(req: Request, deps: Deps = defaultDeps): Promise<Response> {
  const startedAt = deps.now();
  const deadline = startedAt + HOOK_DEADLINE_MS;
  let phoneForLog = "unknown";
  let routeForLog = "none";
  let resultForLog = "rejected";

  try {
    if (req.method !== "POST") return reject("method", 405, {});

    // ── 1. Signature, before anything else is trusted ──
    const rawSecret = deps.env("SEND_SMS_HOOK_SECRET");
    if (!rawSecret) {
      console.error(`${FN}: CONFIG ERROR`, { code: "hook_secret_not_configured" });
      return json(401, {});
    }

    const payloadText = await req.text();
    let payload: Record<string, unknown>;
    try {
      const wh = new Webhook(rawSecret.replace("v1,whsec_", ""));
      payload = wh.verify(payloadText, Object.fromEntries(req.headers)) as Record<string, unknown>;
    } catch {
      return reject("signature", 401, {});
    }

    // ── 2. Payload ──
    const sms = (payload?.sms ?? {}) as Record<string, unknown>;
    const user = (payload?.user ?? {}) as Record<string, unknown>;
    const metadata = (payload?.metadata ?? {}) as Record<string, unknown>;

    // sms.phone is the destination; during a phone change user.phone is still
    // the OLD number. user.phone is only a fallback for older Auth versions.
    const rawPhone = typeof sms.phone === "string" && sms.phone
      ? sms.phone
      : typeof user.phone === "string" ? user.phone : "";
    const otp = typeof sms.otp === "string" ? sms.otp : "";
    const key = idempotencyKey(metadata.uuid, req.headers.get("webhook-id"));

    if (!rawPhone || !/^\d{4,10}$/.test(otp) || !key) {
      resultForLog = "bad_payload";
      console.warn(`${FN}: rejected`, { gate: "payload", status: 200 });
      return hookError(400, USER_MSG_BAD_PAYLOAD);
    }
    phoneForLog = maskPhone(rawPhone);

    const text = buildMessage(otp);

    // ── 3. Route ──
    const route = routeFor(rawPhone, deps.env("SHMOR_TEST_PHONES"));
    routeForLog = route.provider === "shmor" ? "shmor" : `fallback:${route.reason}`;

    if (route.provider === "shmor") {
      const outcome = await shmorProvider.send({ to: route.to, text, idempotencyKey: key, deadline }, deps);
      if (outcome.kind === "sent") {
        resultForLog = outcome.dryRun ? "sent_dry_run" : "sent";
        console.log(`${FN}: sent`, {
          provider: "shmor",
          dry_run: outcome.dryRun === true,
          provider_message_id: outcome.providerMessageId,
          phone: phoneForLog,
        });
        return json(200, {});
      }
      routeForLog = `shmor_failed:${outcome.kind === "failed" ? outcome.code : outcome.kind}`;
    }

    // ── 4. Fallback, only if time remains ──
    if (deps.now() >= deadline) {
      resultForLog = "deadline";
      console.error(`${FN}: DEADLINE EXCEEDED before fallback`, { phone: phoneForLog, route: routeForLog });
      return hookError(503, USER_MSG_UNAVAILABLE);
    }

    const fb = await deps.fallback.send({ to: rawPhone, text, idempotencyKey: key, deadline }, deps);
    if (fb.kind === "sent") {
      resultForLog = "sent_fallback";
      console.log(`${FN}: sent`, {
        provider: deps.fallback.name,
        provider_message_id: fb.providerMessageId,
        phone: phoneForLog,
      });
      return json(200, {});
    }

    if (fb.kind === "not_configured") {
      resultForLog = "fallback_not_configured";
      console.error(`${FN}: FALLBACK_NOT_CONFIGURED — OTP NOT DELIVERED`, {
        provider: deps.fallback.name,
        phone: phoneForLog,
        route: routeForLog,
      });
    } else {
      resultForLog = "fallback_failed";
      console.error(`${FN}: fallback failed — OTP NOT DELIVERED`, {
        provider: deps.fallback.name,
        status: fb.status,
        code: fb.code,
        phone: phoneForLog,
      });
    }
    return hookError(503, USER_MSG_UNAVAILABLE);
  } catch (err) {
    resultForLog = "unhandled";
    // Name only — see the LOGGING note in the header.
    console.error(`${FN}: unhandled error`, { name: err instanceof Error ? err.name : "unknown" });
    return hookError(500, USER_MSG_UNAVAILABLE);
  } finally {
    console.log(`${FN}: request`, {
      phone: phoneForLog,
      route: routeForLog,
      result: resultForLog,
      latency_ms: deps.now() - startedAt,
    });
  }
}

Deno.serve((req) => handleHook(req));
