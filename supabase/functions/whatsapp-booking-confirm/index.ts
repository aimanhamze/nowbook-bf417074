// whatsapp-booking-confirm — sends a Meta-approved WhatsApp template to the
// customer when their booking is confirmed, or when the PROVIDER cancels it.
//
// ⚠ NAME IS A MISNOMER. This function now serves two message kinds, not just
// confirmations. The slug is kept deliberately: renaming means redeploying under
// a new name and updating every call site, and churning a working production
// deployment is not worth the tidier label.
//
// CONTRACT:  POST { "booking_id": "<uuid>", "kind"?: "booking_confirm" | "booking_cancelled" }
//            → 200 { ok, result, ... }        ("kind" defaults to booking_confirm)
//
// Besides the booking id, the ONLY thing the body may carry is `kind`, which
// selects among the server-side constants in MESSAGE_KINDS below. Every value
// that ends up in the message — recipient phone, customer name, business name,
// date, time, service — is re-read from the database with the service role.
// Accepting message text or a phone number from the client would turn this
// endpoint into a way for any authenticated user to send arbitrary WhatsApp
// messages from the business's number: a Meta-ban-level risk, not a cost risk.
//
// FIVE INDEPENDENT GATES, in order. All must pass before a message is sent:
//   1. Caller is authorized FOR THIS KIND (see MESSAGE_KINDS.allowCustomerCaller)
//   2. bookings.status reads exactly the status this kind requires
//   3. provider_profiles.whatsapp_confirm_enabled is true — ONE flag governs both
//      kinds. Three switches for three message types is too many.
//   4. The recipient is on WHATSAPP_CONFIRM_PHONES (unset = nobody)
//   5. The UNIQUE index on whatsapp_send_log (booking_id, message_kind) has not
//      already been claimed — the real ceiling: one message per booking PER KIND,
//      ever. There is no rate cap and no automatic retry anywhere.
//
// WHY GATE 1 IS THE LOAD-BEARING ONE FOR CANCELLATIONS: `bookings` has no
// cancelled_by or cancelled_at column, so a row cancelled by the provider is
// byte-for-byte identical to one cancelled by the customer. Database state
// CANNOT distinguish them. The caller's identity is the only signal, which is
// why a customer may trigger their own confirmation but never a cancellation —
// otherwise they could send themselves "your appointment was cancelled".
//
// BEST-EFFORT: callers invoke this fire-and-forget. Nothing here can block,
// delay or fail the booking itself — the booking is confirmed or cancelled
// regardless, and the message is a side effect.
//
// NO SHARED MODULE: the SendPulse OAuth logic below is deliberately duplicated
// rather than factored out. A separate OTP function on another branch needs the
// same logic, and that branch may be discarded; coupling the two would make
// this feature's fate depend on it. For the same reason nothing here reads
// otp_requests or sendpulse_token_cache — the token cache lives in module scope.
//
// LOGGING: never logs the SendPulse client secret, the access token, or a full
// phone number. Phones appear as the last 4 digits only.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.99.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") ?? "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ── Message kinds ────────────────────────────────────────────────────────────
// All four templates are approved by Meta with an IDENTICAL 5-parameter body
// ({{1}} customer, {{2}} business, {{3}} date, {{4}} time, {{5}} service) and no
// buttons, which is what lets one send path serve both kinds.
//
// "booking_confirm_hebrow" is misspelled upstream; used verbatim because that is
// the name Meta approved.
//
// The key of this map IS the message_kind written to whatsapp_send_log, so the
// unique index on (booking_id, message_kind) gives one message per booking per
// kind with no extra logic.
const MESSAGE_KINDS = {
  booking_confirm: {
    requiredStatus: "confirmed",
    // A customer may trigger their own confirmation: the function derives every
    // value server-side and the unique index caps it at one message.
    allowCustomerCaller: true,
    wrongStatusReason: "NOT_CONFIRMED",
    templates: {
      he: { name: "booking_confirm_hebrow", languageCode: "he" },
      ar: { name: "booking_confirmation_arabic", languageCode: "ar" },
    },
  },
  booking_cancelled: {
    requiredStatus: "cancelled",
    // NEVER a customer. A customer who cancels their own booking passes the
    // status gate, so allowing them here would let them send themselves a
    // "your appointment was cancelled" notice. Provider-owner or admin only.
    allowCustomerCaller: false,
    wrongStatusReason: "NOT_CANCELLED",
    templates: {
      he: { name: "booking_cancelled_hebrew", languageCode: "he" },
      ar: { name: "booking_cancelled_arabic", languageCode: "ar" },
    },
  },
} as const;

type MessageKind = keyof typeof MESSAGE_KINDS;
type LanguageKey = keyof typeof MESSAGE_KINDS["booking_confirm"]["templates"];

/** Unknown/absent kind defaults to booking_confirm, preserving the old contract. */
function isMessageKind(value: unknown): value is MessageKind {
  return typeof value === "string" && Object.hasOwn(MESSAGE_KINDS, value);
}

const SENDPULSE_OAUTH_URL = "https://api.sendpulse.com/oauth/access_token";
const SENDPULSE_SEND_URL = "https://api.sendpulse.com/whatsapp/contacts/sendTemplateByPhone";
const TOKEN_EXPIRY_SKEW_SECONDS = 60;

// ── Helpers ──────────────────────────────────────────────────────────────────

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/**
 * Rejects a request at an entry gate, naming the gate in the log.
 *
 * Every gate below returns before bookingIdForLog is assigned, so the trailing
 * "request" log line reports booking_id "unknown" for all of them. Without a
 * gate name, a missing header, a rejected token, a malformed body and a bad
 * booking_id are indistinguishable in the logs — which is exactly what made a
 * production 401 take a day to identify.
 *
 * `gate` is a fixed identifier chosen here, never caller-controlled input: no
 * token, phone number or request content can reach the log through it.
 */
function reject(gate: string, status: number, body: unknown): Response {
  console.warn("whatsapp-booking-confirm: rejected", { gate, status });
  return json(status, body);
}

/** Safe for logs — last 4 digits only. Full numbers are PII. */
function maskPhone(value: string | null | undefined): string {
  const d = (value ?? "").replace(/\D/g, "");
  return d.length <= 4 ? "****" : `***${d.slice(-4)}`;
}

/**
 * Israeli phone → SendPulse format: digits only, 972-prefixed, no '+'.
 *
 * The repo has three byte-identical copies of a `toWhatsAppUrl` helper
 * (Bookings.tsx:36, CalendarTab.tsx:36, PendingTab.tsx:18) that produce the same
 * shape. They are fine for a wa.me link — a bad number just opens a dead page —
 * but they perform NO validation, so `toWhatsAppUrl("123")` yields "972123".
 * Handing that to SendPulse is a billable send to a garbage number and a hit to
 * the WhatsApp sender quality rating that affects all our traffic. Hence the
 * strict Israeli-mobile check here that those helpers lack.
 */
function toSendPulsePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let d = raw.replace(/\D/g, "");
  if (d.startsWith("00972")) d = d.slice(5);
  else if (d.startsWith("972")) d = d.slice(3);
  else if (d.startsWith("0")) d = d.slice(1);
  // `d` is now the 9-digit national number, e.g. 501234567.
  if (!/^[5-9]\d{8}$/.test(d)) return null;
  return `972${d}`;
}

/**
 * Normalizes an ALLOWLIST ENTRY to the same 972-prefixed digit form
 * toSendPulsePhone produces, so "+972-54-786-8325", "0547868325" and
 * "972547868325" in the env var all match the same recipient.
 *
 * Applied only to configuration, never to a customer's number: the recipient
 * has already passed toSendPulsePhone's strict validation by the time this is
 * used for comparison.
 */
function looseDigits(raw: string | null | undefined): string {
  const d = (raw ?? "").replace(/\D/g, "");
  if (d.startsWith("00972")) return d.slice(3);
  if (d.startsWith("972")) return d;
  if (d.startsWith("0")) return `972${d.slice(1)}`;
  return d ? `972${d}` : "";
}

/** Rollout gate. Unset or empty = nobody receives anything. "*" opens it up. */
function isAllowlisted(phoneDigits: string): boolean {
  const raw = Deno.env.get("WHATSAPP_CONFIRM_PHONES") ?? "";
  if (raw.trim() === "*") return true;
  for (const entry of raw.split(/[,\s;]+/)) {
    if (!entry) continue;
    if (looseDigits(entry) === phoneDigits) return true;
  }
  return false;
}

/**
 * "2026-08-15" → "15/08/2026". Numeric for BOTH languages: unambiguous, and it
 * avoids the bidi rendering problems a long-form month name causes inside a
 * mixed Hebrew/Arabic line.
 *
 * Pure string manipulation ON PURPOSE. booking_date and booking_time are stored
 * as Israel-local wall-clock values (see toLocalDateStr in
 * src/lib/availabilityResolver.ts:49), while this function runs in UTC. Passing
 * them through `new Date()` would shift them by the UTC offset and could show
 * the customer the wrong day.
 */
function formatBookingDate(bookingDate: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(bookingDate ?? "");
  if (!m) return null;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

/**
 * booking_time is TEXT with no format constraint, consistently 'HH:mm' in real
 * data. Passed through verbatim, trimmed defensively in case a longer value
 * ('14:30:00') ever appears. Never parsed into a Date.
 */
function formatBookingTime(bookingTime: string): string | null {
  const t = (bookingTime ?? "").trim().slice(0, 5);
  return /^\d{2}:\d{2}$/.test(t) ? t : null;
}

/** Service-role client. Bypasses RLS — never built from a caller-supplied key. */
function createAdminClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

// Derived from the factory, NOT from `typeof createClient` — the bare generic
// resolves its Database parameter to `unknown`, which collapses every table name
// to `never` and makes each query below a type error.
type Admin = ReturnType<typeof createAdminClient>;

// ── SendPulse ────────────────────────────────────────────────────────────────

// Module-scope token cache, per Edge Function instance. Deliberately NOT a DB
// table: see the header note about not coupling to the OTP branch.
let cachedToken: { token: string; expiresAt: number } | null = null;

interface SendPulseCreds {
  clientId: string;
  clientSecret: string;
  grantType: string;
}

/**
 * Accepts either the SENDPULSE_-prefixed pair or the bare client_id /
 * client_secret / grant_type secrets this project already has configured.
 * The prefixed pair wins, so renaming the bare ones later needs no code change.
 * Nothing here is ever logged.
 */
function loadSendPulseCreds(): SendPulseCreds {
  const id = Deno.env.get("SENDPULSE_CLIENT_ID");
  const secret = Deno.env.get("SENDPULSE_CLIENT_SECRET");
  if (id && secret) {
    return { clientId: id, clientSecret: secret, grantType: "client_credentials" };
  }

  const bareId = Deno.env.get("client_id");
  const bareSecret = Deno.env.get("client_secret");
  if (bareId && bareSecret) {
    return {
      clientId: bareId,
      clientSecret: bareSecret,
      grantType: Deno.env.get("grant_type") || "client_credentials",
    };
  }

  throw new Error("SENDPULSE_CREDENTIALS_NOT_CONFIGURED");
}

async function getAccessToken(): Promise<string> {
  const now = Date.now();
  const skewMs = TOKEN_EXPIRY_SKEW_SECONDS * 1000;

  if (cachedToken && cachedToken.expiresAt - skewMs > now) return cachedToken.token;

  const creds = loadSendPulseCreds();
  const res = await fetch(SENDPULSE_OAUTH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: creds.grantType,
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
    }),
  });

  if (!res.ok) throw new Error(`SENDPULSE_AUTH_FAILED:${res.status}`);

  // SendPulse has shipped both a flat body and a { data: {...} } envelope.
  const body = await res.json().catch(() => null);
  const payload = body?.data ?? body;
  const token: string | undefined = payload?.access_token;
  if (!token) throw new Error("SENDPULSE_AUTH_FAILED:no_token");

  const expiresIn = Number(payload?.expires_in) || 3600;
  cachedToken = { token, expiresAt: now + expiresIn * 1000 };
  return token;
}

interface SendResult {
  ok: boolean;
  messageId: string | null;
  status: number;
  reason?: string;
}

async function sendTemplate(
  token: string,
  phoneDigits: string,
  template: { name: string; languageCode: string },
  params: string[],
): Promise<SendResult> {
  const res = await fetch(SENDPULSE_SEND_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      bot_id: Deno.env.get("SENDPULSE_BOT_ID"),
      phone: phoneDigits,
      template: {
        name: template.name,
        components: [
          {
            type: "body",
            parameters: params.map((text) => ({ type: "text", text })),
          },
        ],
        language: { policy: "deterministic", code: template.languageCode },
      },
    }),
  });

  const raw = await res.text();
  let body: Record<string, unknown> | null = null;
  try {
    body = raw ? JSON.parse(raw) as Record<string, unknown> : null;
  } catch {
    body = null; // non-JSON body — treated as a failure below
  }

  // The success flag sits at the TOP level of the body. The documented check
  // `response.data.success === true` is the axios idiom, where `response.data`
  // IS the body — reading it one level deeper reports failure for messages that
  // were actually delivered. Both positions are accepted here.
  const dataField = body?.data as Record<string, unknown> | undefined;
  const ok = res.ok && (body?.success === true || dataField?.success === true);

  // Parse the WhatsApp message id defensively across the shapes SendPulse uses.
  // Not needed yet; a future button-enabled template needs it to correlate
  // replies. NEVER fabricated — a missing id is recorded as missing, and the
  // send is still counted as successful.
  const payload = dataField ?? body ?? undefined;
  const idCandidate =
    payload?.message_id ??
    payload?.wamid ??
    (payload?.message as Record<string, unknown> | undefined)?.id ??
    payload?.id;

  return {
    ok,
    messageId: typeof idCandidate === "string" && idCandidate ? idCandidate : null,
    status: res.status,
    // The response verbatim on failure. It carries delivery diagnostics only —
    // never message content — so it is safe to log and makes a shape change
    // obvious from one log line instead of another billable test send.
    reason: ok ? undefined : (raw.slice(0, 400) || `http_${res.status}`),
  };
}

// ── Ledger ───────────────────────────────────────────────────────────────────

/**
 * Records an outcome that was decided before any send was attempted.
 *
 * WHICH SKIPS GET A ROW — this distinction matters, because a row permanently
 * claims the booking via the UNIQUE index:
 *   * DATA-quality skips (no name, unusable phone, no service) DO get a row.
 *     They are logged so the gap is auditable rather than invisible.
 *   * POLICY skips (not confirmed yet, provider not opted in, not allowlisted,
 *     walk-in) get NO row and return before this is ever called. All of those
 *     states are reversible, and claiming the booking would permanently block
 *     the legitimate send that follows when the provider opts in or the
 *     allowlist widens.
 *
 * To deliberately allow a re-send after fixing the underlying data, delete the
 * row for that booking. There is no automatic retry.
 */
async function logSkip(
  admin: Admin,
  bookingId: string,
  messageKind: MessageKind,
  providerId: string | null,
  errorCode: string,
  phoneDigits: string | null,
): Promise<void> {
  const { error } = await admin.from("whatsapp_send_log").insert({
    booking_id: bookingId,
    message_kind: messageKind,
    provider_id: providerId,
    phone_digits: phoneDigits,
    status: "skipped",
    error_code: errorCode,
  });
  // A unique violation here just means another invocation already claimed it.
  if (error && error.code !== "23505") {
    console.error("whatsapp-booking-confirm: skip log failed", {
      booking_id: bookingId,
      reason: error.message,
    });
  }
}

// ── Entry point ──────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  const startedAt = Date.now();
  let bookingIdForLog = "unknown";
  // Carried on the trailing request log line. A cancellation is the message type
  // most likely to matter to a customer about to arrive at a closed salon, so a
  // failure must be attributable to the right kind without guesswork.
  let kindForLog = "unknown";

  // Held in outer scope so the catch below can still resolve a claim that was
  // created but never reached a terminal status. `sendAccepted` distinguishes
  // "we never sent" from "SendPulse took it and the bookkeeping afterwards
  // threw" — recording the latter as 'failed' would be an audit lie about a
  // message the customer actually received.
  let claimId: string | null = null;
  let sendAccepted = false;

  try {
    // ── Caller authentication (anon client verifies the token) ───────────────
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return reject("missing_auth_header", 401, { error: "Unauthorized" });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const token = authHeader.replace("Bearer ", "");
    const userClient = createClient(supabaseUrl, anonKey);
    const { data: userData, error: userError } = await userClient.auth.getUser(token);
    if (userError || !userData?.user) {
      // The distinguishing case: a token WAS sent and the auth server rejected
      // it. supabase.functions.invoke falls back to the anon key when there is
      // no valid session, and the anon key is a well-formed JWT that satisfies
      // the platform gateway but is not a user token — so it lands here.
      // getUser's own message is safe to log; it never echoes the token.
      // `code` is the field to key on — Supabase's own guidance is never to
      // string-match the message. It also settles WHY a session is dead:
      //   session_not_found          -> the session row is gone
      //   refresh_token_already_used -> refresh-token reuse detection revoked
      //                                 the whole family (the open question)
      // The message is kept alongside it purely as human context.
      console.warn("whatsapp-booking-confirm: getUser rejected the token", {
        gate: "get_user_rejected",
        status: 401,
        code: (userError as { code?: string } | null)?.code ?? null,
        reason: userError?.message ?? "no user for token",
      });
      return reject("get_user_rejected", 401, { error: "Unauthorized" });
    }
    const callerId = userData.user.id;

    // ── Input: a booking id, and optionally which kind of message ────────────
    let body: { booking_id?: unknown; kind?: unknown };
    try {
      body = await req.json();
    } catch {
      return reject("malformed_json_body", 400, { error: "Malformed JSON body" });
    }

    // `kind` is resolved BEFORE booking_id so the trailing request log names the
    // kind even when the id turns out to be unusable.
    //
    // Safe to accept from the client: it only selects among the server-side
    // constants in MESSAGE_KINDS and cannot inject content. An unknown value is
    // rejected rather than defaulted, so a typo can never silently send the
    // wrong message type; an ABSENT value defaults to booking_confirm, which
    // preserves the original contract for existing callers.
    const rawKind = body.kind ?? "booking_confirm";
    if (!isMessageKind(rawKind)) {
      console.warn("whatsapp-booking-confirm: unknown message kind", {
        gate: "invalid_kind",
        status: 400,
        received_type: typeof rawKind,
      });
      return reject("invalid_kind", 400, { error: "kind is not a known message kind" });
    }
    const messageKind: MessageKind = rawKind;
    const kindConfig = MESSAGE_KINDS[messageKind];
    kindForLog = messageKind;

    const bookingId = body.booking_id;
    if (typeof bookingId !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(bookingId)) {
      // The received TYPE is logged, never the value: a caller-supplied value
      // could be anything, and this line must stay safe to read in production.
      console.warn("whatsapp-booking-confirm: booking_id unusable", {
        gate: "invalid_booking_id",
        status: 400,
        received_type: bookingId === null ? "null" : typeof bookingId,
      });
      return reject("invalid_booking_id", 400, { error: "booking_id (uuid) is required" });
    }
    bookingIdForLog = bookingId;

    const admin = createAdminClient();

    // ── Load the booking (service role — the source of truth) ────────────────
    const { data: booking, error: bookingError } = await admin
      .from("bookings")
      .select("id, status, provider_id, user_id, linked_user_id, service_ids, class_schedule_id, booking_date, booking_time, customer_name, customer_phone")
      .eq("id", bookingId)
      .maybeSingle();

    if (bookingError) throw bookingError;
    if (!booking) return json(404, { error: "Booking not found" });

    // ── GATE 1: authorization, per kind ──────────────────────────────────────
    // The provider who owns the booking and admins may trigger any kind. The
    // booking's own customer may trigger ONLY kinds with allowCustomerCaller.
    //
    // This is the load-bearing gate for cancellations. `bookings` records no
    // cancelled_by, so a customer's own cancellation is indistinguishable in the
    // database from the provider's — meaning a customer allowed through here
    // could send themselves "your appointment was cancelled". Being merely
    // authenticated is never enough for any kind.
    const isOwnCustomer =
      (booking.user_id !== null && booking.user_id === callerId) ||
      (booking.linked_user_id !== null && booking.linked_user_id === callerId);

    let authorized = kindConfig.allowCustomerCaller && isOwnCustomer;

    if (!authorized) {
      const { data: ownedProvider } = await admin
        .from("provider_profiles")
        .select("id")
        .eq("id", booking.provider_id)
        .eq("user_id", callerId)
        .maybeSingle();
      authorized = !!ownedProvider;
    }

    if (!authorized) {
      const { data: adminRole } = await admin
        .from("user_roles")
        .select("role")
        .eq("user_id", callerId)
        .eq("role", "admin")
        .maybeSingle();
      authorized = !!adminRole;
    }

    if (!authorized) {
      // `kind` and whether the caller was the customer are both logged: a
      // customer attempting booking_cancelled is the specific abuse this gate
      // exists to stop, and it should be visible when it happens.
      console.warn("whatsapp-booking-confirm: forbidden", {
        gate: "not_authorized_for_kind",
        status: 403,
        booking_id: bookingId,
        kind: messageKind,
        was_own_customer: isOwnCustomer,
      });
      return json(403, { error: "Forbidden" });
    }

    // ── GATE 2: the booking is in the status this kind requires ───────────────
    // Tested for EQUALITY, never as a negation: bookings.status also allows
    // 'completed', and enforce_booking_approval_status silently rewrites an
    // inserted 'confirmed' to 'pending' for approval-required providers. So
    // "not pending" would wrongly admit a completed booking.
    //   booking_confirm   -> 'confirmed'
    //   booking_cancelled -> 'cancelled'
    // No ledger row: a pending booking may legitimately be approved later, and a
    // confirmed one may later be cancelled — each then earns its own message.
    if (booking.status !== kindConfig.requiredStatus) {
      return json(200, {
        ok: true,
        result: "skipped",
        reason: kindConfig.wrongStatusReason,
      });
    }

    // Walk-ins are excluded from v1: the customer never opted in to receive
    // template messages, and the provider-typed free-text phone is the least
    // reliable number in the schema. No ledger row, so enabling them later is
    // purely a policy change.
    if (booking.user_id === null && booking.linked_user_id === null) {
      return json(200, { ok: true, result: "skipped", reason: "WALKIN_EXCLUDED" });
    }

    // ── GATE 3: provider opted in ────────────────────────────────────────────
    const { data: provider, error: providerError } = await admin
      .from("provider_profiles")
      .select("id, business_name, whatsapp_confirm_enabled, whatsapp_message_language")
      .eq("id", booking.provider_id)
      .maybeSingle();

    if (providerError) throw providerError;
    if (!provider) return json(404, { error: "Provider not found" });

    if (!provider.whatsapp_confirm_enabled) {
      return json(200, { ok: true, result: "skipped", reason: "PROVIDER_OPTED_OUT" });
    }

    // Language is resolved SERVER-SIDE from the provider's stored preference and
    // is never taken from the request. The DB CHECK restricts it to he|ar; the
    // fallback covers only an unexpected value.
    const langKey: LanguageKey =
      provider.whatsapp_message_language === "ar" ? "ar" : "he";
    const template = kindConfig.templates[langKey];

    // ── Recipient ────────────────────────────────────────────────────────────
    // auth.users.phone is the canonical, OTP-VERIFIED number; profiles.phone is
    // a mirror written at login (Auth.tsx afterAuth) and can lag or be absent.
    // auth.users is not reachable through PostgREST, hence the admin API.
    const accountId = booking.user_id ?? booking.linked_user_id;
    let rawPhone: string | null = null;

    if (accountId) {
      // getUserById can fail independently of the database (GoTrue admin API
      // hiccup, deleted user). That must NOT abort the send — it degrades to
      // the profiles mirror. The error is logged rather than swallowed, because
      // a persistent failure here would silently push every send onto the
      // less-reliable fallback and look like a data-quality problem instead.
      const { data: authUser, error: authUserError } = await admin.auth.admin
        .getUserById(accountId);

      if (authUserError) {
        console.warn("whatsapp-booking-confirm: getUserById failed, falling back to profiles.phone", {
          booking_id: bookingId,
          code: (authUserError as { code?: string }).code ?? null,
          reason: authUserError.message,
        });
      }

      rawPhone = authUser?.user?.phone ?? null;

      // Fallback covers email-only accounts (no verified phone on auth.users)
      // and the getUserById failure above.
      if (!rawPhone) {
        const { data: profileRow, error: profileError } = await admin
          .from("profiles")
          .select("phone")
          .eq("user_id", accountId)
          .maybeSingle();

        if (profileError) {
          console.warn("whatsapp-booking-confirm: profiles.phone lookup failed", {
            booking_id: bookingId,
            reason: profileError.message,
          });
        }
        rawPhone = profileRow?.phone ?? null;
      }
    }

    // ── Recipient data quality (DOES write a ledger row) ─────────────────────
    // Deliberately BEFORE the allowlist. A missing or malformed number is a
    // data-quality fact that must leave a record: without one, a customer with
    // no phone at all is indistinguishable from a customer who is simply out of
    // rollout scope, and the problem stays invisible. Covers both NULL (nothing
    // on auth.users or profiles) and unparseable values.
    const phoneDigits = toSendPulsePhone(rawPhone);
    if (!phoneDigits) {
      await logSkip(admin, bookingId, messageKind, provider.id, "INVALID_PHONE", null);
      return json(200, { ok: true, result: "skipped", reason: "INVALID_PHONE" });
    }

    // ── GATE 4: allowlist ────────────────────────────────────────────────────
    // Reaches here only with a VALID Israeli mobile, so this gate expresses one
    // thing and one thing only: "valid, but not yet in rollout scope". No ledger
    // row — widening the allowlist IS the cutover, and a claim here would block
    // the legitimate send that follows.
    if (!isAllowlisted(phoneDigits)) {
      return json(200, { ok: true, result: "skipped", reason: "NOT_ALLOWLISTED" });
    }

    // {{1}} customer name. No generic fallback by design: a nameless greeting
    // reads as a marketing blast and risks the sender quality rating for all our
    // traffic. NameGate means a logged-in customer almost always has a name.
    const { data: customerProfile } = await admin
      .from("profiles")
      .select("display_name")
      .eq("user_id", accountId!)
      .maybeSingle();

    const customerName = (customerProfile?.display_name ?? "").trim();
    if (!customerName) {
      await logSkip(admin, bookingId, messageKind, provider.id, "NO_NAME", phoneDigits);
      return json(200, { ok: true, result: "skipped", reason: "NO_NAME" });
    }

    // {{5}} service name. Two mutually exclusive sources, decided by
    // class_schedule_id — the same signal useProviderBookings.ts:110 keys off:
    //   * group class    -> provider_class_schedule.class_name. These bookings
    //     carry an EMPTY service_ids array, so the class name is the ONLY
    //     source. Reading service_ids[0] regardless is what silently skipped
    //     every class booking as NO_SERVICE.
    //   * everything else -> provider_services via service_ids[0]. service_ids
    //     is a uuid[] with no FK, so a missing row is possible and handled.
    // class_name is NOT NULL but has no non-empty constraint, so it is trimmed
    // and an empty value falls through to the NO_SERVICE skip below.
    // The BOOKING's own booking_time stays the time source in both branches —
    // provider_class_schedule.start_time is 'HH:MM:SS' and is never read.
    //
    // KEEP THIS BLOCK BYTE-IDENTICAL TO THE ONE IN whatsapp-booking-reminder.
    // If the two diverge, classes work for one message type and not the other.
    let serviceName = "";
    if (booking.class_schedule_id) {
      const { data: classRow } = await admin
        .from("provider_class_schedule")
        .select("class_name")
        .eq("id", booking.class_schedule_id)
        .maybeSingle();
      serviceName = (classRow?.class_name ?? "").trim();
    } else {
      const firstServiceId = Array.isArray(booking.service_ids) ? booking.service_ids[0] : null;
      if (firstServiceId) {
        const { data: service } = await admin
          .from("provider_services")
          .select("name")
          .eq("id", firstServiceId)
          .maybeSingle();
        serviceName = (service?.name ?? "").trim();
      }
    }
    if (!serviceName) {
      await logSkip(admin, bookingId, messageKind, provider.id, "NO_SERVICE", phoneDigits);
      return json(200, { ok: true, result: "skipped", reason: "NO_SERVICE" });
    }

    const dateText = formatBookingDate(booking.booking_date);
    const timeText = formatBookingTime(booking.booking_time);
    if (!dateText || !timeText) {
      await logSkip(admin, bookingId, messageKind, provider.id, "BAD_DATETIME", phoneDigits);
      return json(200, { ok: true, result: "skipped", reason: "BAD_DATETIME" });
    }

    const businessName = (provider.business_name ?? "").trim();
    if (!businessName) {
      await logSkip(admin, bookingId, messageKind, provider.id, "NO_BUSINESS_NAME", phoneDigits);
      return json(200, { ok: true, result: "skipped", reason: "NO_BUSINESS_NAME" });
    }

    // ── GATE 5: claim before sending ─────────────────────────────────────────
    // The INSERT is the lock. Two concurrent confirmations race on the UNIQUE
    // index (booking_id, message_kind); the loser gets 23505 and returns without
    // calling SendPulse. This is what makes a double-click, a retry, or both
    // invoke sites firing unable to send twice.
    const { data: claim, error: claimError } = await admin
      .from("whatsapp_send_log")
      .insert({
        booking_id: bookingId,
        message_kind: messageKind,
        provider_id: provider.id,
        phone_digits: phoneDigits,
        template_name: template.name,
        language_code: template.languageCode,
        status: "sending",
      })
      .select("id")
      .single();

    if (claimError) {
      if (claimError.code === "23505") {
        return json(200, { ok: true, result: "already_sent" });
      }
      throw claimError;
    }
    claimId = claim.id;

    // ── Send ─────────────────────────────────────────────────────────────────
    const params = [customerName, businessName, dateText, timeText, serviceName];

    let sent: SendResult;
    try {
      const accessToken = await getAccessToken();
      sent = await sendTemplate(accessToken, phoneDigits, template, params);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      await admin
        .from("whatsapp_send_log")
        .update({ status: "failed", error_code: reason.slice(0, 200), updated_at: new Date().toISOString() })
        .eq("id", claim.id);
      console.error("whatsapp-booking-confirm: send threw", {
        booking_id: bookingId,
        kind: messageKind,
        phone: maskPhone(phoneDigits),
        reason,
      });
      return json(200, { ok: false, result: "failed", reason: "SEND_ERROR" });
    }

    if (!sent.ok) {
      await admin
        .from("whatsapp_send_log")
        .update({
          status: "failed",
          error_code: (sent.reason ?? `http_${sent.status}`).slice(0, 200),
          updated_at: new Date().toISOString(),
        })
        .eq("id", claim.id);
      console.error("whatsapp-booking-confirm: send rejected", {
        booking_id: bookingId,
        kind: messageKind,
        phone: maskPhone(phoneDigits),
        http_status: sent.status,
        reason: sent.reason,
      });
      // The claim stays. A rejected send is NOT retried automatically: a
      // "failure" that was actually delivered would otherwise duplicate a real
      // customer message. Re-sending requires deleting the ledger row by hand.
      return json(200, { ok: false, result: "failed", reason: "SEND_REJECTED" });
    }

    // Set BEFORE the bookkeeping update: from here on the customer has the
    // message, whatever happens to our record of it.
    sendAccepted = true;

    await admin
      .from("whatsapp_send_log")
      .update({
        status: "sent",
        sendpulse_message_id: sent.messageId,
        missing_message_id: sent.messageId === null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", claim.id);

    console.log("whatsapp-booking-confirm: sent", {
      booking_id: bookingId,
      kind: messageKind,
      provider_id: provider.id,
      phone: maskPhone(phoneDigits),
      language: template.languageCode,
      message_id: sent.messageId,
      missing_message_id: sent.messageId === null,
    });

    return json(200, {
      ok: true,
      result: "sent",
      message_id: sent.messageId,
      missing_message_id: sent.messageId === null,
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error("whatsapp-booking-confirm: unhandled error", {
      booking_id: bookingIdForLog,
      kind: kindForLog,
      reason,
    });

    // Resolve a claim that never reached a terminal status, so no row is left
    // stranded at 'sending'. Guarded by .eq("status","sending") so this can
    // never overwrite a state the happy path already wrote.
    //
    // `sendAccepted` decides which terminal state is TRUE, not which is
    // convenient: if SendPulse already took the message, the customer has it
    // and the row must say 'sent' even though our bookkeeping fell over.
    // Blanket-writing 'failed' here would misreport a delivered message.
    if (claimId) {
      try {
        const recovery = sendAccepted
          ? { status: "sent", error_code: "TERMINAL_UPDATE_FAILED" }
          : { status: "failed", error_code: "UNHANDLED_ERROR" };
        await createAdminClient()
          .from("whatsapp_send_log")
          .update({ ...recovery, updated_at: new Date().toISOString() })
          .eq("id", claimId)
          .eq("status", "sending");
      } catch (recoveryErr) {
        // The database itself is unreachable. The row stays 'sending' and is
        // picked up by the stuck-claim sweep in the VERIFY file; there is
        // nothing further this process can do.
        console.error("whatsapp-booking-confirm: claim recovery failed", {
          booking_id: bookingIdForLog,
          claim_id: claimId,
          reason: recoveryErr instanceof Error ? recoveryErr.message : String(recoveryErr),
        });
      }
    }

    // Internals never reach the browser; callers ignore this anyway.
    return json(500, { error: "Internal error" });
  } finally {
    console.log("whatsapp-booking-confirm: request", {
      booking_id: bookingIdForLog,
      kind: kindForLog,
      latency_ms: Date.now() - startedAt,
    });
  }
});
