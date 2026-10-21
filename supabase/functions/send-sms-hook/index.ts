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
//   Israeli mobile (normalizes to 9725XXXXXXXX)   → Shmor Makom, then Twilio
//     …and, when SHMOR_TEST_PHONES is set, only if listed there
//   everything else (07X, foreign, unlisted)      → Twilio directly
// With the hook enabled, Auth never calls its built-in SMS provider, so the
// fallback calls Twilio's REST API itself (plain Messages API through a
// Messaging Service — not Twilio Verify, which would generate its own code).
// If the TWILIO_* vars are incomplete the fallback reports not_configured, the
// hook returns an error and logs loudly, and that number CANNOT log in.
//
// TIME BUDGET: Supabase gives the whole hook invocation 5 s, and a cold start
// is spent before our timer starts. Everything here runs inside a hard
// HOOK_DEADLINE_MS from request arrival: one Shmor attempt, at most one retry
// (only for 5xx / timeout / network errors, only if enough time is left, and
// always with the SAME Idempotency-Key so Shmor never sends or charges twice),
// then fallback only if at least FALLBACK_MIN_REMAINING_MS remain. Twilio gets
// exactly ONE attempt with whatever time is left: its message-create API has
// no idempotency key, so a retry after an ambiguous timeout could text the
// user twice.
//
// KNOWN DOUBLE-SEND WINDOW: if a Shmor attempt times out on OUR side but Shmor
// had already queued the message, the Twilio fallback sends the same code a
// second time. Same code, so harmless beyond the cost; accepted over leaving
// the user with no code at all.
//
// IDEMPOTENCY KEY: ehj-otp-<metadata.uuid>. Auth generates metadata.uuid once
// per OTP request and re-sends the same body on its own retries (read from the
// supabase/auth source; undocumented). webhook-id is a fallback only — Auth
// regenerates it on every attempt. The key is NEVER derived from the OTP: a
// hash of a 6-digit code plus a known phone number is trivially brute-forced,
// and the key leaves our system.
//
// SMS_DRY_RUN=true calls /v1/sms/estimate instead of /v1/sms, and SKIPS the
// Twilio call entirely (Twilio has no dry-run endpoint): nothing is sent and
// nothing is charged, but the hook reports success — so the user receives no
// code. For scripted tests only, never with the hook enabled for real users.
//
// LOGGING: never logs the OTP, the message text, the Idempotency-Key, the
// Shmor API key, any Twilio credential or the hook secret. Phones appear as
// the last 4 digits only. Neither Shmor's nor Twilio's error `message` is
// logged — only the provider's error `code` and the HTTP status — because an
// upstream message may echo what we sent (Twilio's quotes the To number). Unexpected
// exceptions log their `name` only: a JSON.parse message can quote the body,
// and the body holds the OTP.

import { Webhook } from "https://esm.sh/standardwebhooks@1.0.0";

const FN = "send-sms-hook";

// ── Constants ────────────────────────────────────────────────────────────────

export const HOOK_DEADLINE_MS = 3500;
export const SHMOR_ATTEMPT_TIMEOUT_MS = 1500;
export const SHMOR_RETRY_MIN_REMAINING_MS = 1000;
export const FALLBACK_MIN_REMAINING_MS = 500;

export const SMS_MAX_CHARS = 201;
export const MESSAGE_TEMPLATE = "Your Ehjezly verification code is: {otp}";

const SHMOR_SEND_URL = "https://capabilities.shmormakom.com/v1/sms";
const SHMOR_ESTIMATE_URL = "https://capabilities.shmormakom.com/v1/sms/estimate";
const SHMOR_DEFAULT_SENDER = "Ehjezly";

// https://www.twilio.com/docs/messaging/api/message-resource#create-a-message-resource
const twilioMessagesUrl = (accountSid: string) =>
  `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`;

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

/** "provider_error" = a terminal failure of a provider that is never retried (Twilio). */
export type FailureCategory = "retryable" | "fallback" | "config" | "deadline" | "provider_error";

export type SendOutcome =
  | { kind: "sent"; providerMessageId: string | null; dryRun?: boolean }
  | { kind: "failed"; category: FailureCategory; status: number | null; code: string }
  | { kind: "not_configured" };

export interface SmsProvider {
  name: string;
  send(req: SendRequest, deps: Deps): Promise<SendOutcome>;
}

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

// ── Twilio (fallback) ────────────────────────────────────────────────────────

/** Any phone → "+<digits>" for Twilio's To, or null if it cannot be E.164. */
export function toE164(raw: string): string | null {
  const il = normalizeIsraeliMobile(raw);
  if (il) return `+${il}`;
  const d = raw.replace(/\D/g, "");
  if (raw.trim().startsWith("0")) return null; // a national number with no country code
  return /^[1-9]\d{7,14}$/.test(d) ? `+${d}` : null;
}

interface TwilioConfig {
  accountSid: string;
  messagingServiceSid: string;
  username: string;
  password: string;
  authKind: "api_key" | "auth_token";
}

const TWILIO_ENV_NAMES = [
  "TWILIO_ACCOUNT_SID",
  "TWILIO_MESSAGING_SERVICE_SID",
  "TWILIO_API_KEY_SID",
  "TWILIO_API_KEY_SECRET",
  "TWILIO_AUTH_TOKEN",
] as const;

/**
 * Configured only with Account SID + Messaging Service SID + one auth pair.
 * The API key pair wins when both halves are set (it can be revoked without
 * rotating the account's master Auth Token); otherwise Account SID + Auth
 * Token. The Account SID is always the one in the URL.
 * https://www.twilio.com/docs/usage/requests-to-twilio
 */
export function loadTwilioConfig(env: Deps["env"]): TwilioConfig | null {
  const get = (name: string) => env(name)?.trim() || undefined;
  const accountSid = get("TWILIO_ACCOUNT_SID");
  const messagingServiceSid = get("TWILIO_MESSAGING_SERVICE_SID");
  const keySid = get("TWILIO_API_KEY_SID");
  const keySecret = get("TWILIO_API_KEY_SECRET");
  const authToken = get("TWILIO_AUTH_TOKEN");

  if (accountSid && messagingServiceSid) {
    if (keySid && keySecret) {
      return { accountSid, messagingServiceSid, username: keySid, password: keySecret, authKind: "api_key" };
    }
    if (authToken) {
      return { accountSid, messagingServiceSid, username: accountSid, password: authToken, authKind: "auth_token" };
    }
  }

  // Half a config is almost certainly a mistake, not an intentional "off".
  // Variable NAMES only — never values.
  const present = TWILIO_ENV_NAMES.filter((n) => get(n));
  if (present.length > 0) {
    console.error(`${FN}: CONFIG ERROR`, {
      provider: "twilio",
      code: "partial_config",
      missing: TWILIO_ENV_NAMES.filter((n) => !get(n)),
    });
  }
  return null;
}

export const twilioProvider: SmsProvider = {
  name: "twilio",
  async send(req, deps) {
    const cfg = loadTwilioConfig(deps.env);
    if (!cfg) return { kind: "not_configured" };

    if (deps.env("SMS_DRY_RUN") === "true") {
      return { kind: "sent", providerMessageId: null, dryRun: true };
    }

    const to = toE164(req.to);
    if (!to) return { kind: "failed", category: "provider_error", status: null, code: "invalid_destination" };

    const remaining = req.deadline - deps.now();
    if (remaining <= 0) return { kind: "failed", category: "deadline", status: null, code: "deadline" };

    // ONE attempt, no retry — see the TIME BUDGET note in the header.
    const startedAt = deps.now();
    let outcome: Extract<SendOutcome, { kind: "failed" }>;
    try {
      const res = await deps.fetch(twilioMessagesUrl(cfg.accountSid), {
        method: "POST",
        headers: {
          Authorization: `Basic ${btoa(`${cfg.username}:${cfg.password}`)}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ To: to, MessagingServiceSid: cfg.messagingServiceSid, Body: req.text }),
        signal: deps.timeoutSignal(remaining),
      });
      const raw = await res.text();
      let body: Record<string, unknown> | null = null;
      try {
        body = raw ? JSON.parse(raw) as Record<string, unknown> : null;
      } catch {
        body = null;
      }

      // 201 Created is Twilio's only success status for a POST that creates a
      // resource. https://www.twilio.com/docs/usage/twilios-response
      if (res.status === 201) {
        const sid = body?.sid;
        return { kind: "sent", providerMessageId: typeof sid === "string" ? sid : null };
      }

      const twilioCode = body?.code;
      const code = typeof twilioCode === "number" || typeof twilioCode === "string"
        ? String(twilioCode)
        : `http_${res.status}`;
      const category: FailureCategory = res.status === 401 || res.status === 403 ? "config" : "provider_error";
      outcome = { kind: "failed", category, status: res.status, code };
    } catch (err) {
      const name = err instanceof Error ? err.name : "";
      const code = name === "TimeoutError" || name === "AbortError" ? "timeout" : "network";
      outcome = { kind: "failed", category: "provider_error", status: null, code };
    }

    const fields = {
      provider: "twilio",
      auth: cfg.authKind,
      status: outcome.status,
      code: outcome.code,
      phone: maskPhone(req.to),
      latency_ms: deps.now() - startedAt,
    };
    if (outcome.category === "config") console.error(`${FN}: CONFIG ERROR`, fields);
    else console.warn(`${FN}: attempt failed`, fields);
    return outcome;
  },
};

// ── Handler ──────────────────────────────────────────────────────────────────

export const defaultDeps: Deps = {
  env: (name) => Deno.env.get(name),
  fetch: (input, init) => fetch(input, init),
  now: () => Date.now(),
  timeoutSignal: (ms) => AbortSignal.timeout(ms),
  fallback: twilioProvider,
};

export async function handleHook(req: Request, deps: Deps = defaultDeps): Promise<Response> {
  const startedAt = deps.now();
  const deadline = startedAt + HOOK_DEADLINE_MS;
  let phoneForLog = "unknown";
  let routeForLog = "none";
  let resultForLog = "rejected";
  let providerForLog = "none"; // which provider delivered, if any

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

    // Why the fallback ran: the router's reason, or the Shmor failure code.
    let fallbackReason: string = route.provider === "fallback" ? route.reason : "none";

    if (route.provider === "shmor") {
      const outcome = await shmorProvider.send({ to: route.to, text, idempotencyKey: key, deadline }, deps);
      if (outcome.kind === "sent") {
        resultForLog = outcome.dryRun ? "sent_dry_run" : "sent";
        providerForLog = "shmor";
        console.log(`${FN}: sent`, {
          provider: "shmor",
          dry_run: outcome.dryRun === true,
          provider_message_id: outcome.providerMessageId,
          phone: phoneForLog,
          latency_ms: deps.now() - startedAt,
        });
        return json(200, {});
      }
      const shmorCode = outcome.kind === "failed" ? outcome.code : outcome.kind;
      routeForLog = `shmor_failed:${shmorCode}`;
      fallbackReason = `shmor_${shmorCode}`;
    }

    // ── 4. Fallback, only if enough time remains ──
    if (deadline - deps.now() < FALLBACK_MIN_REMAINING_MS) {
      resultForLog = "deadline";
      console.error(`${FN}: DEADLINE EXCEEDED before fallback — OTP NOT DELIVERED`, {
        provider: deps.fallback.name,
        phone: phoneForLog,
        route: routeForLog,
        fallback_reason: fallbackReason,
        remaining_ms: deadline - deps.now(),
      });
      return hookError(503, USER_MSG_UNAVAILABLE);
    }

    const fb = await deps.fallback.send({ to: rawPhone, text, idempotencyKey: key, deadline }, deps);
    if (fb.kind === "sent") {
      resultForLog = fb.dryRun ? "sent_fallback_dry_run" : "sent_fallback";
      providerForLog = deps.fallback.name;
      console.log(`${FN}: sent`, {
        provider: deps.fallback.name,
        dry_run: fb.dryRun === true,
        provider_message_id: fb.providerMessageId,
        fallback_reason: fallbackReason,
        phone: phoneForLog,
        latency_ms: deps.now() - startedAt,
      });
      return json(200, {});
    }

    if (fb.kind === "not_configured") {
      resultForLog = "fallback_not_configured";
      console.error(`${FN}: FALLBACK_NOT_CONFIGURED — OTP NOT DELIVERED`, {
        provider: deps.fallback.name,
        phone: phoneForLog,
        route: routeForLog,
        fallback_reason: fallbackReason,
      });
    } else {
      resultForLog = "fallback_failed";
      console.error(`${FN}: fallback failed — OTP NOT DELIVERED`, {
        provider: deps.fallback.name,
        status: fb.status,
        code: fb.code,
        fallback_reason: fallbackReason,
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
      provider: providerForLog,
      result: resultForLog,
      latency_ms: deps.now() - startedAt,
    });
  }
}

Deno.serve((req) => handleHook(req));
