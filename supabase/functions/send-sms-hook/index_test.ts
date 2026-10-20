// Unit tests for send-sms-hook. Run from the repo root:
//   npx -y deno test --allow-env supabase/functions/send-sms-hook/
//
// No network and no real timers: fetch, the clock and the per-attempt timeout
// signal are all injected through `Deps`.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { Webhook } from "https://esm.sh/standardwebhooks@1.0.0";

// index.ts calls Deno.serve at module scope. Stub it BEFORE the dynamic import
// so loading the module under test does not open a port.
// deno-lint-ignore no-explicit-any
(Deno as any).serve = () => ({ finished: Promise.resolve(), shutdown: () => Promise.resolve(), ref() {}, unref() {} });

const mod = await import("./index.ts");
const {
  normalizeIsraeliMobile,
  parseAllowlist,
  routeFor,
  buildMessage,
  idempotencyKey,
  classifyShmorError,
  handleHook,
  shmorProvider,
  maskPhone,
  MESSAGE_TEMPLATE,
  SMS_MAX_CHARS,
  HOOK_DEADLINE_MS,
} = mod;
type Deps = import("./index.ts").Deps;
type SmsProvider = import("./index.ts").SmsProvider;

// ── Fixtures ─────────────────────────────────────────────────────────────────

const SECRET_B64 = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
const HOOK_SECRET = `v1,whsec_${SECRET_B64}`;
const API_KEY = "test-shmor-api-key-DO-NOT-LOG";

// Distinctive values the no-leak test searches for in captured logs.
const OTP = "4815162342";
const ISRAELI = "972501239876"; // shape Auth sends: digits, no '+'
const UUID = "0d6f8e2a-5b1c-4c3e-9a7d-2f4b6c8e1a3b";

function makeBody(phone: string, otp = OTP, uuid: string | null = UUID): string {
  return JSON.stringify({
    metadata: uuid ? { uuid, time: new Date().toISOString(), name: "send-sms" } : { name: "send-sms" },
    user: { id: crypto.randomUUID(), phone, user_metadata: {}, app_metadata: {} },
    sms: { otp, phone },
  });
}

function signedRequest(
  body: string,
  opts: { secret?: string; at?: Date; badSig?: boolean; omitHeaders?: boolean } = {},
): Request {
  const id = crypto.randomUUID();
  const at = opts.at ?? new Date();
  let sig = new Webhook(opts.secret ?? SECRET_B64).sign(id, at, body);
  if (opts.badSig) sig = `v1,${btoa("not-the-signature-at-all-xxxxxxxx")}`;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (!opts.omitHeaders) {
    headers["webhook-id"] = id;
    headers["webhook-timestamp"] = String(Math.floor(at.getTime() / 1000));
    headers["webhook-signature"] = sig;
  }
  return new Request("http://localhost/send-sms-hook", { method: "POST", headers, body });
}

interface FetchCall {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

type Step =
  | { status: number; body?: unknown; ms?: number }
  | { throws: "TimeoutError" | "TypeError"; ms?: number };

/** Deterministic deps: a fake clock, a scripted fetch, and recorded timeouts. */
function makeDeps(steps: Step[], env: Record<string, string | undefined> = {}, fallback?: SmsProvider) {
  const clock = { t: 1_000_000 };
  const calls: FetchCall[] = [];
  const timeouts: number[] = [];
  const fallbackCalls: string[] = [];
  const queue = [...steps];

  const fullEnv: Record<string, string | undefined> = {
    SEND_SMS_HOOK_SECRET: HOOK_SECRET,
    SHMOR_API_KEY: API_KEY,
    ...env,
  };

  const deps: Deps = {
    env: (name) => fullEnv[name],
    now: () => clock.t,
    timeoutSignal: (ms) => {
      timeouts.push(ms);
      return new AbortController().signal;
    },
    fetch: (input, init) => {
      const headers = Object.fromEntries(new Headers(init?.headers).entries());
      calls.push({ url: String(input), headers, body: JSON.parse(String(init?.body)) });
      const step = queue.shift();
      if (!step) throw new Error("unexpected fetch");
      clock.t += step.ms ?? 50;
      if ("throws" in step) {
        return Promise.reject(
          step.throws === "TimeoutError" ? new DOMException("timed out", "TimeoutError") : new TypeError("network down"),
        );
      }
      return Promise.resolve(new Response(step.body === undefined ? "" : JSON.stringify(step.body), { status: step.status }));
    },
    fallback: fallback ?? {
      name: "twilio",
      send: (req) => {
        fallbackCalls.push(req.to);
        return Promise.resolve({ kind: "not_configured" });
      },
    },
  };
  return { deps, clock, calls, timeouts, fallbackCalls };
}

/** Every console line written while fn runs, flattened to strings. */
const ALL_LOGS: string[] = [];
async function captureConsole<T>(fn: () => Promise<T>): Promise<{ value: T; logs: string[] }> {
  const logs: string[] = [];
  const methods = ["log", "info", "warn", "error", "debug"] as const;
  const original = methods.map((m) => console[m]);
  for (const m of methods) {
    console[m] = (...args: unknown[]) => {
      logs.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
    };
  }
  try {
    return { value: await fn(), logs };
  } finally {
    methods.forEach((m, i) => (console[m] = original[i]));
    ALL_LOGS.push(...logs);
  }
}

async function run(req: Request, deps: Deps) {
  const { value: res, logs } = await captureConsole(() => handleHook(req, deps));
  const text = await res.text();
  return { res, body: text ? JSON.parse(text) : null, logs };
}

const SHMOR_OK: Step = { status: 202, body: { id: "sms_123", status: "queued" } };
const shmorErr = (status: number, code: string, ms?: number): Step => ({
  status,
  body: { error: { code, message: `upstream says ${code}` } },
  ms,
});

// ── Normalizer ───────────────────────────────────────────────────────────────

Deno.test("normalizeIsraeliMobile: the four accepted shapes map to 9725XXXXXXXX", () => {
  for (const input of ["+972501239876", "972501239876", "00972501239876", "0501239876", "050-123-9876", "+972 50 123 9876"]) {
    assertEquals(normalizeIsraeliMobile(input), "972501239876", input);
  }
});

Deno.test("normalizeIsraeliMobile: everything else is not Shmor-routable", () => {
  for (
    const input of [
      "0721234567", // 07X VoIP
      "972721234567",
      "+97225001234", // landline
      "+9720501239876", // trunk 0 after country code
      "050123987", // too short
      "05012398765", // too long
      "501239876", // bare national number
      "+14155550123", // foreign
      "447700900123",
      "",
      "abc",
      null,
      undefined,
    ]
  ) {
    assertEquals(normalizeIsraeliMobile(input as string), null, String(input));
  }
});

Deno.test("parseAllowlist: unset/empty means no restriction", () => {
  assertEquals(parseAllowlist(undefined), null);
  assertEquals(parseAllowlist(""), null);
  assertEquals(parseAllowlist("   "), null);
});

Deno.test("parseAllowlist: entries go through the same normalizer; invalid ones dropped", async () => {
  const { value } = await captureConsole(() =>
    Promise.resolve(parseAllowlist("+972501239876, 0547868325;00972521112222 0721234567 garbage"))
  );
  assertEquals([...value!].sort(), ["972501239876", "972521112222", "972547868325"]);
});

Deno.test("parseAllowlist: a list of only invalid entries routes nobody to Shmor", async () => {
  const { value } = await captureConsole(() => Promise.resolve(parseAllowlist("0721234567")));
  assertEquals(value!.size, 0);
});

// ── Routing ──────────────────────────────────────────────────────────────────

Deno.test("routeFor: Israeli mobile → shmor; 07X and foreign → fallback", () => {
  assertEquals(routeFor("972501239876", undefined), { provider: "shmor", to: "972501239876" });
  assertEquals(routeFor("972721234567", undefined), { provider: "fallback", reason: "not_israeli_mobile" });
  assertEquals(routeFor("14155550123", undefined), { provider: "fallback", reason: "not_israeli_mobile" });
});

Deno.test("routeFor: SHMOR_TEST_PHONES restricts Shmor to listed numbers only", async () => {
  await captureConsole(() => {
    assertEquals(routeFor("972501239876", "0501239876"), { provider: "shmor", to: "972501239876" });
    assertEquals(routeFor("972547868325", "0501239876"), { provider: "fallback", reason: "not_in_test_allowlist" });
    // A listed 07X number is still not routable — the allowlist never widens.
    assertEquals(routeFor("972721234567", "0721234567"), { provider: "fallback", reason: "not_israeli_mobile" });
    return Promise.resolve();
  });
});

// ── Template ─────────────────────────────────────────────────────────────────

Deno.test("template: exact text", () => {
  assertEquals(MESSAGE_TEMPLATE, "Your Ehjezly verification code is: {otp}");
  assertEquals(buildMessage("123456"), "Your Ehjezly verification code is: 123456");
});

Deno.test("template: <= 201 characters with a 10-digit OTP, single line", () => {
  const text = buildMessage("1234567890");
  assertEquals(text, "Your Ehjezly verification code is: 1234567890");
  assert([...text].length <= SMS_MAX_CHARS, `${[...text].length} chars`);
  assertFalse(/\r|\n/.test(text));
});

// ── Idempotency key ──────────────────────────────────────────────────────────

Deno.test("idempotencyKey: metadata.uuid first, webhook-id fallback, never the OTP", () => {
  assertEquals(idempotencyKey(UUID, "wh-1"), `ehj-otp-${UUID}`);
  assertEquals(idempotencyKey(undefined, "wh-1"), "ehj-otp-wh-1");
  assertEquals(idempotencyKey("", "wh-1"), "ehj-otp-wh-1");
  assertEquals(idempotencyKey(undefined, null), null);
});

// ── Error classification ─────────────────────────────────────────────────────

Deno.test("classifyShmorError: the mapping table", () => {
  assertEquals(classifyShmorError(500, "internal_error"), "retryable");
  assertEquals(classifyShmorError(503, null), "retryable");
  assertEquals(classifyShmorError(429, "rate_limited"), "fallback");
  assertEquals(classifyShmorError(400, "invalid_phone"), "fallback");
  assertEquals(classifyShmorError(400, "message_too_long"), "config");
  assertEquals(classifyShmorError(400, "invalid_sender"), "config");
  assertEquals(classifyShmorError(401, "unauthorized"), "config");
  assertEquals(classifyShmorError(402, "insufficient_credits"), "config");
  assertEquals(classifyShmorError(403, "sender_not_allowed"), "config");
  assertEquals(classifyShmorError(403, "account_disabled"), "config");
  assertEquals(classifyShmorError(418, "something_new"), "fallback");
});

// ── Signature ────────────────────────────────────────────────────────────────

Deno.test("signature: valid request is accepted", async () => {
  const { deps, calls } = makeDeps([SHMOR_OK]);
  const { res, body } = await run(signedRequest(makeBody(ISRAELI)), deps);
  assertEquals(res.status, 200);
  assertEquals(body, {});
  assertEquals(calls.length, 1);
});

for (
  const [name, opts] of [
    ["tampered signature", { badSig: true }],
    ["wrong secret", { secret: btoa("a-completely-different-secret-32b") }],
    ["timestamp older than 5 minutes", { at: new Date(Date.now() - 10 * 60 * 1000) }],
    ["missing webhook headers", { omitHeaders: true }],
  ] as const
) {
  Deno.test(`signature: rejects ${name} with a bare 401 and sends nothing`, async () => {
    const { deps, calls, fallbackCalls } = makeDeps([SHMOR_OK]);
    const { res, body } = await run(signedRequest(makeBody(ISRAELI), opts), deps);
    assertEquals(res.status, 401);
    assertEquals(body, {});
    assertEquals(calls.length, 0);
    assertEquals(fallbackCalls.length, 0);
  });
}

Deno.test("signature: body modified after signing is rejected", async () => {
  const { deps, calls } = makeDeps([SHMOR_OK]);
  const signed = signedRequest(makeBody(ISRAELI));
  const forged = new Request(signed.url, {
    method: "POST",
    headers: signed.headers,
    body: makeBody("972547868325"),
  });
  const { res } = await run(forged, deps);
  assertEquals(res.status, 401);
  assertEquals(calls.length, 0);
});

Deno.test("signature: missing SEND_SMS_HOOK_SECRET rejects everything", async () => {
  const { deps, calls } = makeDeps([SHMOR_OK], { SEND_SMS_HOOK_SECRET: undefined });
  const { res } = await run(signedRequest(makeBody(ISRAELI)), deps);
  assertEquals(res.status, 401);
  assertEquals(calls.length, 0);
});

// ── Happy path ───────────────────────────────────────────────────────────────

Deno.test("send: correct URL, headers and body to Shmor", async () => {
  const { deps, calls } = makeDeps([SHMOR_OK]);
  const { res } = await run(signedRequest(makeBody(ISRAELI)), deps);
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("content-type"), "application/json");
  assertEquals(calls[0].url, "https://capabilities.shmormakom.com/v1/sms");
  assertEquals(calls[0].headers["authorization"], `Bearer ${API_KEY}`);
  assertEquals(calls[0].headers["content-type"], "application/json");
  assertEquals(calls[0].headers["idempotency-key"], `ehj-otp-${UUID}`);
  assertEquals(calls[0].body, {
    to: "972501239876",
    sender: "Ehjezly",
    message: `Your Ehjezly verification code is: ${OTP}`,
  });
});

Deno.test("send: '+'-prefixed phone (older Auth) is normalized too", async () => {
  const { deps, calls } = makeDeps([SHMOR_OK]);
  await run(signedRequest(makeBody(`+${ISRAELI}`)), deps);
  assertEquals(calls[0].body.to, "972501239876");
});

Deno.test("send: SHMOR_SENDER overrides the default", async () => {
  const { deps, calls } = makeDeps([SHMOR_OK], { SHMOR_SENDER: "EhjezlyDev" });
  await run(signedRequest(makeBody(ISRAELI)), deps);
  assertEquals(calls[0].body.sender, "EhjezlyDev");
});

Deno.test("send: idempotency key falls back to webhook-id without metadata.uuid", async () => {
  const { deps, calls } = makeDeps([SHMOR_OK]);
  const req = signedRequest(makeBody(ISRAELI, OTP, null));
  const webhookId = req.headers.get("webhook-id");
  await run(req, deps);
  assertEquals(calls[0].headers["idempotency-key"], `ehj-otp-${webhookId}`);
});

Deno.test("SMS_DRY_RUN=true calls /v1/sms/estimate and reports success", async () => {
  const { deps, calls } = makeDeps([{ status: 200, body: { segments: 1 } }], { SMS_DRY_RUN: "true" });
  const { res, body } = await run(signedRequest(makeBody(ISRAELI)), deps);
  assertEquals(calls[0].url, "https://capabilities.shmormakom.com/v1/sms/estimate");
  assertEquals(res.status, 200);
  assertEquals(body, {});
});

Deno.test("SMS_DRY_RUN other than 'true' sends for real", async () => {
  const { deps, calls } = makeDeps([SHMOR_OK], { SMS_DRY_RUN: "1" });
  await run(signedRequest(makeBody(ISRAELI)), deps);
  assertEquals(calls[0].url, "https://capabilities.shmormakom.com/v1/sms");
});

// ── Error handling ───────────────────────────────────────────────────────────

const UNAVAILABLE = {
  error: {
    http_code: 503,
    message: "We could not send a verification code to this number. Please try again later.",
  },
};

Deno.test("5xx: retries once with the SAME Idempotency-Key, then succeeds", async () => {
  const { deps, calls, fallbackCalls } = makeDeps([shmorErr(500, "internal_error"), SHMOR_OK]);
  const { res, body } = await run(signedRequest(makeBody(ISRAELI)), deps);
  assertEquals(calls.length, 2);
  assertEquals(calls[0].headers["idempotency-key"], calls[1].headers["idempotency-key"]);
  assertEquals(fallbackCalls.length, 0);
  assertEquals(res.status, 200);
  assertEquals(body, {});
});

Deno.test("5xx twice: no third attempt, goes to fallback", async () => {
  const { deps, calls, fallbackCalls } = makeDeps([shmorErr(500, "internal_error"), shmorErr(502, "internal_error")]);
  const { res, body } = await run(signedRequest(makeBody(ISRAELI)), deps);
  assertEquals(calls.length, 2);
  assertEquals(fallbackCalls.length, 1);
  assertEquals(res.status, 200);
  assertEquals(body, UNAVAILABLE);
});

Deno.test("network error is retried like a 5xx", async () => {
  const { deps, calls } = makeDeps([{ throws: "TypeError" }, SHMOR_OK]);
  const { body } = await run(signedRequest(makeBody(ISRAELI)), deps);
  assertEquals(calls.length, 2);
  assertEquals(body, {});
});

for (const [status, code] of [[429, "rate_limited"], [400, "invalid_phone"]] as const) {
  Deno.test(`${status} ${code}: no retry, straight to fallback`, async () => {
    const { deps, calls, fallbackCalls } = makeDeps([shmorErr(status, code)]);
    const { res, body, logs } = await run(signedRequest(makeBody(ISRAELI)), deps);
    assertEquals(calls.length, 1);
    assertEquals(fallbackCalls.length, 1);
    assertEquals(res.status, 200);
    assertEquals(body, UNAVAILABLE);
    assert(logs.some((l) => l.includes("FALLBACK_NOT_CONFIGURED")));
  });
}

for (
  const [status, code] of [
    [400, "message_too_long"],
    [400, "invalid_sender"],
    [401, "unauthorized"],
    [402, "insufficient_credits"],
    [403, "sender_not_allowed"],
    [403, "account_disabled"],
  ] as const
) {
  Deno.test(`${status} ${code}: config error logged loudly, no retry, fallback`, async () => {
    const { deps, calls, fallbackCalls } = makeDeps([shmorErr(status, code)]);
    const { body, logs } = await run(signedRequest(makeBody(ISRAELI)), deps);
    assertEquals(calls.length, 1);
    assertEquals(fallbackCalls.length, 1);
    assertEquals(body, UNAVAILABLE);
    assert(logs.some((l) => l.includes("CONFIG ERROR") && l.includes(code)));
  });
}

Deno.test("missing SHMOR_API_KEY: config error, Shmor never called, fallback", async () => {
  const { deps, calls, fallbackCalls } = makeDeps([], { SHMOR_API_KEY: undefined });
  const { body, logs } = await run(signedRequest(makeBody(ISRAELI)), deps);
  assertEquals(calls.length, 0);
  assertEquals(fallbackCalls.length, 1);
  assertEquals(body, UNAVAILABLE);
  assert(logs.some((l) => l.includes("CONFIG ERROR") && l.includes("api_key_not_configured")));
});

Deno.test("07X number: never sent to Shmor, fallback not configured → hook error", async () => {
  const { deps, calls, fallbackCalls } = makeDeps([]);
  const { res, body, logs } = await run(signedRequest(makeBody("972721234567")), deps);
  assertEquals(calls.length, 0);
  assertEquals(fallbackCalls, ["972721234567"]);
  assertEquals(res.status, 200);
  assertEquals(body, UNAVAILABLE);
  assert(logs.some((l) => l.includes("FALLBACK_NOT_CONFIGURED") && l.includes("not_israeli_mobile")));
});

Deno.test("foreign number: fallback, not Shmor", async () => {
  const { deps, calls, fallbackCalls } = makeDeps([]);
  const { body } = await run(signedRequest(makeBody("14155550123")), deps);
  assertEquals(calls.length, 0);
  assertEquals(fallbackCalls.length, 1);
  assertEquals(body, UNAVAILABLE);
});

Deno.test("unlisted Israeli mobile with SHMOR_TEST_PHONES set: fallback", async () => {
  const { deps, calls, fallbackCalls } = makeDeps([], { SHMOR_TEST_PHONES: "0547868325" });
  const { body } = await run(signedRequest(makeBody(ISRAELI)), deps);
  assertEquals(calls.length, 0);
  assertEquals(fallbackCalls.length, 1);
  assertEquals(body, UNAVAILABLE);
});

Deno.test("fallback that sends: hook succeeds", async () => {
  const sending: SmsProvider = {
    name: "fake",
    send: () => Promise.resolve({ kind: "sent", providerMessageId: "fb_1" }),
  };
  const { deps } = makeDeps([], {}, sending);
  const { body } = await run(signedRequest(makeBody("14155550123")), deps);
  assertEquals(body, {});
});

Deno.test("bad payload: missing/invalid OTP → hook error 400 as HTTP 200", async () => {
  for (const otp of ["", "12ab56", "12345678901"]) {
    const { deps, calls } = makeDeps([SHMOR_OK]);
    const { res, body } = await run(signedRequest(makeBody(ISRAELI, otp)), deps);
    assertEquals(res.status, 200);
    assertEquals(body, { error: { http_code: 400, message: "Invalid SMS hook payload." } });
    assertEquals(calls.length, 0);
  }
});

Deno.test("non-POST is rejected", async () => {
  const { deps } = makeDeps([]);
  const { res } = await run(new Request("http://localhost/send-sms-hook", { method: "GET" }), deps);
  assertEquals(res.status, 405);
});

// ── Deadline ─────────────────────────────────────────────────────────────────

Deno.test("deadline: first attempt gets a 1500 ms timeout", async () => {
  const { deps, timeouts } = makeDeps([SHMOR_OK]);
  await run(signedRequest(makeBody(ISRAELI)), deps);
  assertEquals(timeouts, [1500]);
});

Deno.test("deadline: timeout at 1500 ms leaves 2000 ms → retry with 1500 ms, same key", async () => {
  const { deps, timeouts, calls } = makeDeps([{ throws: "TimeoutError", ms: 1500 }, SHMOR_OK]);
  const { body } = await run(signedRequest(makeBody(ISRAELI)), deps);
  assertEquals(timeouts, [1500, 1500]);
  assertEquals(calls[0].headers["idempotency-key"], calls[1].headers["idempotency-key"]);
  assertEquals(body, {});
});

Deno.test("deadline: retry timeout is capped by what is left", async () => {
  // 2300 ms spent → 1200 ms left (>= 1000) → retry capped at 1200.
  const { deps, timeouts } = makeDeps([{ throws: "TimeoutError", ms: 2300 }, SHMOR_OK]);
  await run(signedRequest(makeBody(ISRAELI)), deps);
  assertEquals(timeouts, [1500, 1200]);
});

Deno.test("deadline: < 1000 ms left → no retry, fallback still runs", async () => {
  // 2600 ms spent → 900 ms left.
  const { deps, calls, fallbackCalls } = makeDeps([{ throws: "TimeoutError", ms: 2600 }]);
  const { body } = await run(signedRequest(makeBody(ISRAELI)), deps);
  assertEquals(calls.length, 1);
  assertEquals(fallbackCalls.length, 1);
  assertEquals(body, UNAVAILABLE);
});

Deno.test("deadline: no time left after Shmor → fallback is skipped", async () => {
  // 2300 + 1200 = 3500 ms = the whole budget.
  const { deps, calls, fallbackCalls } = makeDeps([
    { throws: "TimeoutError", ms: 2300 },
    { throws: "TimeoutError", ms: 1200 },
  ]);
  const { res, body, logs } = await run(signedRequest(makeBody(ISRAELI)), deps);
  assertEquals(calls.length, 2);
  assertEquals(fallbackCalls.length, 0);
  assertEquals(res.status, 200);
  assertEquals(body, UNAVAILABLE);
  assert(logs.some((l) => l.includes("DEADLINE EXCEEDED")));
});

Deno.test("deadline: first attempt is capped when less than 1500 ms remain", async () => {
  const { deps, timeouts } = makeDeps([SHMOR_OK]);
  const deadline = deps.now() + 1200;
  await captureConsole(() =>
    shmorProvider.send({ to: ISRAELI, text: buildMessage(OTP), idempotencyKey: "k", deadline }, deps)
  );
  assertEquals(timeouts, [1200]);
});

Deno.test("deadline: already past → Shmor is not called", async () => {
  const { deps, calls } = makeDeps([SHMOR_OK]);
  const { value } = await captureConsole(() =>
    shmorProvider.send({ to: ISRAELI, text: buildMessage(OTP), idempotencyKey: "k", deadline: deps.now() }, deps)
  );
  assertEquals(calls.length, 0);
  assertEquals(value.kind, "failed");
});

Deno.test("deadline: constant is 3500 ms", () => {
  assertEquals(HOOK_DEADLINE_MS, 3500);
});

// ── Unhandled ────────────────────────────────────────────────────────────────

Deno.test("unhandled error: hook error 500, logs the error name only", async () => {
  const boom: SmsProvider = {
    name: "boom",
    send: () => {
      throw new Error(`exploded while sending ${OTP}`);
    },
  };
  const { deps } = makeDeps([], {}, boom);
  const { res, body, logs } = await run(signedRequest(makeBody("14155550123")), deps);
  assertEquals(res.status, 200);
  assertEquals(body.error.http_code, 500);
  assert(logs.some((l) => l.includes("unhandled error") && l.includes('"name":"Error"')));
});

// ── No leaks (runs last; also scans every log line captured above) ─────────

Deno.test("no-leak: logs never contain the OTP, message, key, secrets or full phone", async () => {
  // A dedicated sweep through every outcome, on top of everything captured so far.
  const scenarios: Array<[Step[], Record<string, string | undefined>, string]> = [
    [[SHMOR_OK], {}, ISRAELI],
    [[{ status: 200, body: {} }], { SMS_DRY_RUN: "true" }, ISRAELI],
    [[shmorErr(500, "internal_error"), shmorErr(500, "internal_error")], {}, ISRAELI],
    [[{ throws: "TimeoutError", ms: 2300 }, { throws: "TypeError", ms: 1200 }], {}, ISRAELI],
    [[shmorErr(401, "unauthorized")], {}, ISRAELI],
    [[shmorErr(400, "message_too_long")], {}, ISRAELI],
    [[], { SHMOR_API_KEY: undefined }, ISRAELI],
    [[], { SHMOR_TEST_PHONES: "0547868325" }, ISRAELI],
    [[], {}, "972721234567"],
    [[], {}, "14155550123"],
  ];
  for (const [steps, env, phone] of scenarios) {
    const { deps } = makeDeps(steps, env);
    await run(signedRequest(makeBody(phone)), deps);
  }
  const { deps } = makeDeps([]);
  await run(signedRequest(makeBody(ISRAELI), { badSig: true }), deps);

  assert(ALL_LOGS.length > 50, `expected many captured lines, got ${ALL_LOGS.length}`);
  const forbidden = [
    OTP,
    buildMessage(OTP),
    "verification code is",
    UUID,
    "ehj-otp-",
    API_KEY,
    SECRET_B64,
    "whsec_",
    ISRAELI,
    "501239876",
    "upstream says", // Shmor's error message is never logged
  ];
  for (const needle of forbidden) {
    const hit = ALL_LOGS.find((l) => l.includes(needle));
    assertEquals(hit, undefined, `log leaked "${needle}": ${hit}`);
  }
  // Masked form is what we expect instead.
  assert(ALL_LOGS.some((l) => l.includes(maskPhone(ISRAELI))));
});
