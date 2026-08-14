// whatsapp-booking-confirm — sends the Meta-approved WhatsApp confirmation
// template to a customer whose booking has just become confirmed.
//
// CONTRACT:  POST { "booking_id": "<uuid>" }  → 200 { ok, result, ... }
//
// The request body carries a booking id and NOTHING ELSE. Every value that ends
// up in the message — recipient phone, customer name, business name, date, time,
// service — is re-read from the database with the service role. Accepting text
// or a phone number from the client would turn this endpoint into a way for any
// authenticated user to send arbitrary WhatsApp messages from the business's
// number, which is a Meta-ban-level risk, not merely a cost risk.
//
// FIVE INDEPENDENT GATES, in order. All must pass before a message is sent:
//   1. Caller is the booking's provider, an admin, or the booking's own customer
//   2. bookings.status reads exactly 'confirmed' from the DB
//   3. provider_profiles.whatsapp_confirm_enabled is true
//   4. The recipient is on WHATSAPP_CONFIRM_PHONES (unset = nobody)
//   5. The UNIQUE index on whatsapp_send_log (booking_id, message_kind) has not
//      already been claimed — this is the real ceiling: one message per booking,
//      ever. There is no rate cap and no automatic retry anywhere.
//
// BEST-EFFORT: callers invoke this fire-and-forget. Nothing here can block,
// delay or fail the booking itself — the booking is confirmed regardless, and
// the message is a side effect.
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

// ── Templates ────────────────────────────────────────────────────────────────
// Both are approved by Meta with an IDENTICAL 5-parameter body and no buttons.
// "booking_confirm_hebrow" is misspelled upstream; it is used verbatim because
// that is the name Meta approved.
const TEMPLATES = {
  he: { name: "booking_confirm_hebrow", languageCode: "he" },
  ar: { name: "booking_confirmation_arabic", languageCode: "ar" },
} as const;

type LanguageKey = keyof typeof TEMPLATES;

const MESSAGE_KIND = "booking_confirm";

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

/** Loose digits, for allowlist comparison only — never for sending. */
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
  providerId: string | null,
  errorCode: string,
  phoneDigits: string | null,
): Promise<void> {
  const { error } = await admin.from("whatsapp_send_log").insert({
    booking_id: bookingId,
    message_kind: MESSAGE_KIND,
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

  try {
    // ── Caller authentication (anon client verifies the token) ───────────────
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return json(401, { error: "Unauthorized" });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const token = authHeader.replace("Bearer ", "");
    const userClient = createClient(supabaseUrl, anonKey);
    const { data: userData, error: userError } = await userClient.auth.getUser(token);
    if (userError || !userData?.user) {
      return json(401, { error: "Unauthorized" });
    }
    const callerId = userData.user.id;

    // ── Input: a booking id and nothing else ─────────────────────────────────
    let body: { booking_id?: unknown };
    try {
      body = await req.json();
    } catch {
      return json(400, { error: "Malformed JSON body" });
    }

    const bookingId = body.booking_id;
    if (typeof bookingId !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(bookingId)) {
      return json(400, { error: "booking_id (uuid) is required" });
    }
    bookingIdForLog = bookingId;

    const admin = createAdminClient();

    // ── Load the booking (service role — the source of truth) ────────────────
    const { data: booking, error: bookingError } = await admin
      .from("bookings")
      .select("id, status, provider_id, user_id, linked_user_id, service_ids, booking_date, booking_time, customer_name, customer_phone")
      .eq("id", bookingId)
      .maybeSingle();

    if (bookingError) throw bookingError;
    if (!booking) return json(404, { error: "Booking not found" });

    // ── GATE 1: authorization ────────────────────────────────────────────────
    // The caller must be the booking's own customer, the provider who owns it,
    // or an admin. Anyone else is rejected — being merely authenticated is not
    // enough.
    const isOwnCustomer =
      (booking.user_id !== null && booking.user_id === callerId) ||
      (booking.linked_user_id !== null && booking.linked_user_id === callerId);

    let authorized = isOwnCustomer;

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
      console.warn("whatsapp-booking-confirm: forbidden", { booking_id: bookingId });
      return json(403, { error: "Forbidden" });
    }

    // ── GATE 2: the booking really is confirmed ──────────────────────────────
    // Tested for equality, never as "not pending": bookings.status also allows
    // 'completed', and enforce_booking_approval_status silently rewrites an
    // inserted 'confirmed' to 'pending' for approval-required providers. No
    // ledger row — a pending booking may legitimately be approved later.
    if (booking.status !== "confirmed") {
      return json(200, { ok: true, result: "skipped", reason: "NOT_CONFIRMED" });
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
    const template = TEMPLATES[langKey];

    // ── Recipient ────────────────────────────────────────────────────────────
    // auth.users.phone is the canonical, OTP-VERIFIED number; profiles.phone is
    // a mirror written at login (Auth.tsx afterAuth) and can lag or be absent.
    // auth.users is not reachable through PostgREST, hence the admin API.
    const accountId = booking.user_id ?? booking.linked_user_id;
    let rawPhone: string | null = null;

    if (accountId) {
      const { data: authUser } = await admin.auth.admin.getUserById(accountId);
      rawPhone = authUser?.user?.phone ?? null;

      if (!rawPhone) {
        const { data: profileRow } = await admin
          .from("profiles")
          .select("phone")
          .eq("user_id", accountId)
          .maybeSingle();
        rawPhone = profileRow?.phone ?? null;
      }
    }

    // ── GATE 4: allowlist ────────────────────────────────────────────────────
    // Checked BEFORE strict validation and before any data-quality skip, so that
    // during rollout the ledger only ever accumulates rows for numbers we would
    // actually message. No row on failure — widening the allowlist is the
    // cutover, and a claim here would block it.
    const compareDigits = looseDigits(rawPhone);
    if (!compareDigits || !isAllowlisted(compareDigits)) {
      return json(200, { ok: true, result: "skipped", reason: "NOT_ALLOWLISTED" });
    }

    // ── Data quality (these DO write a ledger row) ───────────────────────────
    const phoneDigits = toSendPulsePhone(rawPhone);
    if (!phoneDigits) {
      await logSkip(admin, bookingId, provider.id, "INVALID_PHONE", null);
      return json(200, { ok: true, result: "skipped", reason: "INVALID_PHONE" });
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
      await logSkip(admin, bookingId, provider.id, "NO_NAME", phoneDigits);
      return json(200, { ok: true, result: "skipped", reason: "NO_NAME" });
    }

    // {{5}} service name — first service only. service_ids is a uuid[] with no
    // FK, and a group-class booking carries an empty array.
    const firstServiceId = Array.isArray(booking.service_ids) ? booking.service_ids[0] : null;
    let serviceName = "";
    if (firstServiceId) {
      const { data: service } = await admin
        .from("provider_services")
        .select("name")
        .eq("id", firstServiceId)
        .maybeSingle();
      serviceName = (service?.name ?? "").trim();
    }
    if (!serviceName) {
      await logSkip(admin, bookingId, provider.id, "NO_SERVICE", phoneDigits);
      return json(200, { ok: true, result: "skipped", reason: "NO_SERVICE" });
    }

    const dateText = formatBookingDate(booking.booking_date);
    const timeText = formatBookingTime(booking.booking_time);
    if (!dateText || !timeText) {
      await logSkip(admin, bookingId, provider.id, "BAD_DATETIME", phoneDigits);
      return json(200, { ok: true, result: "skipped", reason: "BAD_DATETIME" });
    }

    const businessName = (provider.business_name ?? "").trim();
    if (!businessName) {
      await logSkip(admin, bookingId, provider.id, "NO_BUSINESS_NAME", phoneDigits);
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
        message_kind: MESSAGE_KIND,
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
        phone: maskPhone(phoneDigits),
        http_status: sent.status,
        reason: sent.reason,
      });
      // The claim stays. A rejected send is NOT retried automatically: a
      // "failure" that was actually delivered would otherwise duplicate a real
      // customer message. Re-sending requires deleting the ledger row by hand.
      return json(200, { ok: false, result: "failed", reason: "SEND_REJECTED" });
    }

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
      reason,
    });
    // Internals never reach the browser; callers ignore this anyway.
    return json(500, { error: "Internal error" });
  } finally {
    console.log("whatsapp-booking-confirm: request", {
      booking_id: bookingIdForLog,
      latency_ms: Date.now() - startedAt,
    });
  }
});
