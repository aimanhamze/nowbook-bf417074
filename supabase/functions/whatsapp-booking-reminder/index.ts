// whatsapp-booking-reminder — sends the Meta-approved WhatsApp reminder
// template ahead of a customer's appointment.
//
// CRON-DRIVEN. There is NO user, no Bearer identity and no caller to authorize.
// The function discovers its own work through get_due_whatsapp_reminders() and
// is protected by a shared secret instead.
//
// WHY A SHARED SECRET AND NOT THE EXISTING CONVENTION: the platform JWT gate is
// satisfied by the ANON key, which ships inside the client bundle. That is fine
// for booking-reminder, which only writes notification rows; it is not fine for
// a function that spends money sending WhatsApp messages from the business
// number. Requests without a valid x-cron-secret get 401 before any work.
//
// TIMEZONE — READ BEFORE EDITING:
//   There is deliberately NO date arithmetic in this file. booking_date and
//   booking_time are Israel wall-clock values and this runs in UTC, so every
//   window decision (including "the appointment has not already passed") is
//   made in SQL by the RPC, via AT TIME ZONE 'Asia/Jerusalem'.
//
//   That is safe to rely on because of the slot-key check below: the RPC
//   returns a message_kind embedding the exact date and time it judged, and
//   this function refuses to send if the booking's CURRENT date/time no longer
//   produce that same key. So a booking that moved after the query is dropped
//   rather than acted on with a stale decision — no clock maths required, and
//   time passing during a batch cannot turn a >=30-minutes-away appointment
//   into a past one.
//
//   Do not add new Date() arithmetic over booking_date/booking_time here. If a
//   new time-based rule is needed, put it in the RPC.
//
// NO SHARED MODULE: the SendPulse logic is duplicated from
// whatsapp-booking-confirm on purpose. These two functions ship, fail and roll
// back independently, and a shared module would couple them.
//
// LOGGING: never logs SendPulse credentials, the access token, or a full phone
// number. Phones appear as the last 4 digits only.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.99.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") ?? "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

// ── Templates ────────────────────────────────────────────────────────────────
// Approved by Meta, no buttons, identical 5-parameter body to the confirmation
// templates. The SAME template serves both the 24h and 1h lead times.
const TEMPLATES = {
  he: { name: "appointment_reminder_hebrew", languageCode: "he" },
  ar: { name: "appointment_reminder_arabic", languageCode: "ar" },
} as const;

type LanguageKey = keyof typeof TEMPLATES;

// 50, not 100: a booking costs ~8 DB round-trips plus a SendPulse call, so 100
// sequential sends can approach the function's wall-clock budget. Nothing is
// lost by going lower — a saturated batch is reported and the next tick picks
// up the remainder, and the one-sided window means a deferred reminder is still
// in range.
const DEFAULT_BATCH_LIMIT = 50;
const MAX_BATCH_LIMIT = 500; // hard ceiling, whatever the env var says

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
 * Constant-time secret comparison.
 *
 * Both sides are hashed first so the comparison is over fixed-length digests:
 * a plain byte loop would still leak the secret's LENGTH through an early
 * length check. The loop below always runs over all 32 bytes.
 */
async function secretMatches(provided: string, expected: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(provided)),
    crypto.subtle.digest("SHA-256", enc.encode(expected)),
  ]);
  const va = new Uint8Array(a);
  const vb = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < va.length; i++) diff |= va[i] ^ vb[i];
  return diff === 0;
}

/**
 * Israeli phone → SendPulse format: digits only, 972-prefixed, no '+'.
 * Strict on purpose — sending to a malformed number is a billable failure and
 * degrades the WhatsApp sender quality rating for all our traffic.
 */
function toSendPulsePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let d = raw.replace(/\D/g, "");
  if (d.startsWith("00972")) d = d.slice(5);
  else if (d.startsWith("972")) d = d.slice(3);
  else if (d.startsWith("0")) d = d.slice(1);
  if (!/^[5-9]\d{8}$/.test(d)) return null;
  return `972${d}`;
}

/** Normalizes an ALLOWLIST ENTRY to the same form toSendPulsePhone produces. */
function looseDigits(raw: string | null | undefined): string {
  const d = (raw ?? "").replace(/\D/g, "");
  if (d.startsWith("00972")) return d.slice(3);
  if (d.startsWith("972")) return d;
  if (d.startsWith("0")) return `972${d.slice(1)}`;
  return d ? `972${d}` : "";
}

/**
 * Rollout gate. WHATSAPP_REMINDER_PHONES gives reminders their own kill switch;
 * without one, emptying the shared confirmation allowlist would take
 * confirmations down too.
 *
 * The fallback uses ?? and NOT a truthiness check, deliberately: setting
 * WHATSAPP_REMINDER_PHONES to an EMPTY string must mean "no reminders to
 * anyone" and must NOT silently fall back to the confirmation allowlist. Only a
 * completely unset variable inherits.
 */
function isAllowlisted(phoneDigits: string): boolean {
  const raw =
    Deno.env.get("WHATSAPP_REMINDER_PHONES") ??
    Deno.env.get("WHATSAPP_CONFIRM_PHONES") ??
    "";
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
 * mixed Hebrew/Arabic line. Pure string manipulation — see the timezone note.
 */
function formatBookingDate(bookingDate: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(bookingDate ?? "");
  return m ? `${m[3]}/${m[2]}/${m[1]}` : null;
}

/**
 * booking_time is TEXT, consistently 'HH:mm'. Passed through verbatim, trimmed
 * defensively in case a longer value ever appears. Never parsed into a Date.
 */
function formatBookingTime(bookingTime: string): string | null {
  const t = (bookingTime ?? "").trim().slice(0, 5);
  return /^\d{2}:\d{2}$/.test(t) ? t : null;
}

/**
 * Rebuilds the slot key exactly as get_due_whatsapp_reminders does, from the
 * booking's CURRENT stored values. Used ONLY to compare against the key the RPC
 * returned — never to claim the ledger row, which always uses the RPC's value
 * verbatim.
 *
 * MUST STAY BYTE-IDENTICAL TO THE RPC:
 *   SQL: 'booking_reminder:' || to_char(b.booking_date, 'YYYY-MM-DD')
 *                            || 'T' || left(b.booking_time, 5)
 *
 * If these two ever diverge by a single character, EVERY booking skips as
 * SLOT_CHANGED and no reminder is ever sent — a policy skip, so no ledger row
 * is written and the failure would be near-invisible. Two defences:
 *   * booking_date is sliced to 10 chars. It is a DATE column, which PostgREST
 *     serialises as "YYYY-MM-DD", matching to_char exactly. The slice means
 *     that even if it were ever widened to a timestamp ("YYYY-MM-DDTHH:MM:SS")
 *     the key would still be built from the date part alone.
 *   * a mismatch is logged with both keys at the call site, so a systematic
 *     divergence is obvious in the first run's logs rather than silent.
 */
function slotKeyFor(bookingDate: string, bookingTime: string): string {
  const datePart = (bookingDate ?? "").slice(0, 10);
  const timePart = (bookingTime ?? "").slice(0, 5);
  return `booking_reminder:${datePart}T${timePart}`;
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

// Module-scope token cache, per Edge Function instance. Deliberately not a DB
// table: see the header note about not coupling to other branches.
let cachedToken: { token: string; expiresAt: number } | null = null;

interface SendPulseCreds {
  clientId: string;
  clientSecret: string;
  grantType: string;
}

/**
 * Accepts either the SENDPULSE_-prefixed pair or the bare client_id /
 * client_secret / grant_type secrets this project already has configured.
 * The prefixed pair wins. Nothing here is ever logged.
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
          { type: "body", parameters: params.map((text) => ({ type: "text", text })) },
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

  // Parsed defensively across the shapes SendPulse uses, and NEVER fabricated:
  // a missing id is recorded as missing and the send still counts as sent.
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
    // Verbatim on failure. Carries delivery diagnostics only — never message
    // content — so it is safe to log and makes a shape change obvious from one
    // log line instead of another billable test send.
    reason: ok ? undefined : (raw.slice(0, 400) || `http_${res.status}`),
  };
}

// ── Ledger ───────────────────────────────────────────────────────────────────

/**
 * Records an outcome decided before any send was attempted.
 *
 * WHICH SKIPS GET A ROW — a row permanently claims (booking, slot) via the
 * unique index, so this distinction matters:
 *   * DATA-quality skips (unusable phone, no name, no service, bad date/time)
 *     DO get a row, so the gap is auditable instead of invisible.
 *   * POLICY skips (cancelled since the query, provider opted out, walk-in,
 *     slot moved, not allowlisted) get NO row and return before this is called.
 *     All are reversible, and claiming would block the legitimate reminder that
 *     follows — most importantly the corrected one after a reschedule.
 */
async function logSkip(
  admin: Admin,
  bookingId: string,
  messageKind: string,
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
  if (error && error.code !== "23505") {
    console.error("whatsapp-booking-reminder: skip log failed", {
      booking_id: bookingId,
      reason: error.message,
    });
  }
}

// ── One booking ──────────────────────────────────────────────────────────────

type Outcome = "sent" | "skipped" | "failed" | "already_sent";

/**
 * Processes a single due booking. Every gate is re-read from the database here
 * — nothing from the RPC row is trusted except the message_kind, which is used
 * verbatim so the ledger claim and the RPC's anti-join can never disagree.
 */
async function processBooking(
  admin: Admin,
  bookingId: string,
  messageKind: string,
): Promise<{ outcome: Outcome; reason?: string }> {
  let claimId: string | null = null;
  let sendAccepted = false;

  try {
    // ── Re-read the booking ──────────────────────────────────────────────────
    const { data: booking, error: bookingError } = await admin
      .from("bookings")
      .select("id, status, provider_id, user_id, linked_user_id, service_ids, booking_date, booking_time")
      .eq("id", bookingId)
      .maybeSingle();

    if (bookingError) throw bookingError;
    if (!booking) return { outcome: "skipped", reason: "BOOKING_GONE" };

    // GATE: status, re-read at send time. Cancel/reject only flip this column,
    // so this single check covers every cancellation path in the app. Tested for
    // equality, never as "not pending" — 'completed' is also a valid status.
    if (booking.status !== "confirmed") {
      return { outcome: "skipped", reason: "NOT_CONFIRMED" };
    }

    // GATE: walk-ins never receive template messages — no opt-in, and a
    // provider-typed free-text phone.
    if (booking.user_id === null && booking.linked_user_id === null) {
      return { outcome: "skipped", reason: "WALKIN_EXCLUDED" };
    }

    // GATE: the booking has not moved since the RPC judged it.
    //
    // This is what lets the window live entirely in SQL. Reschedule changes
    // booking_date/booking_time and deliberately leaves status at 'confirmed',
    // so without this check a booking moved between query and send would get a
    // reminder stating the OLD time. Comparing the rebuilt key against the RPC's
    // key catches that exactly, with no clock arithmetic.
    //
    // The moved booking is not lost: its new slot produces a new key, and the
    // next cron run reminds for the corrected time.
    const currentKey = slotKeyFor(booking.booking_date, booking.booking_time);
    if (currentKey !== messageKind) {
      // Logged with BOTH keys, every time. For a genuine reschedule this is a
      // handful of lines. For a key-format divergence between this function and
      // the RPC it is every booking in the run — which is the difference
      // between a five-second diagnosis and an invisible feature that never
      // sends anything. The keys contain only a date and time, no PII.
      console.warn("whatsapp-booking-reminder: slot key mismatch", {
        booking_id: bookingId,
        rpc_key: messageKind,
        current_key: currentKey,
      });
      return { outcome: "skipped", reason: "SLOT_CHANGED" };
    }

    // ── Provider, re-read ────────────────────────────────────────────────────
    const { data: provider, error: providerError } = await admin
      .from("provider_profiles")
      .select("id, business_name, whatsapp_reminder_enabled, whatsapp_message_language")
      .eq("id", booking.provider_id)
      .maybeSingle();

    if (providerError) throw providerError;
    if (!provider) return { outcome: "skipped", reason: "PROVIDER_GONE" };

    // GATE: the provider may have opted out since the query.
    if (!provider.whatsapp_reminder_enabled) {
      return { outcome: "skipped", reason: "PROVIDER_OPTED_OUT" };
    }

    // Language is resolved SERVER-SIDE from the provider's stored preference,
    // shared with confirmations. The DB CHECK restricts it to he|ar; the
    // fallback covers only an unexpected value.
    const langKey: LanguageKey = provider.whatsapp_message_language === "ar" ? "ar" : "he";
    const template = TEMPLATES[langKey];

    // ── Recipient ────────────────────────────────────────────────────────────
    // auth.users.phone is the canonical, OTP-verified number; profiles.phone is
    // a mirror written at login and can lag or be absent. auth.users is not
    // reachable through PostgREST, hence the admin API.
    const accountId = booking.user_id ?? booking.linked_user_id;
    let rawPhone: string | null = null;

    if (accountId) {
      const { data: authUser, error: authUserError } = await admin.auth.admin
        .getUserById(accountId);

      if (authUserError) {
        console.warn("whatsapp-booking-reminder: getUserById failed, falling back to profiles.phone", {
          booking_id: bookingId,
          reason: authUserError.message,
        });
      }
      rawPhone = authUser?.user?.phone ?? null;

      if (!rawPhone) {
        const { data: profileRow, error: profileError } = await admin
          .from("profiles")
          .select("phone")
          .eq("user_id", accountId)
          .maybeSingle();

        if (profileError) {
          console.warn("whatsapp-booking-reminder: profiles.phone lookup failed", {
            booking_id: bookingId,
            reason: profileError.message,
          });
        }
        rawPhone = profileRow?.phone ?? null;
      }
    }

    // Data quality BEFORE the allowlist: a missing or malformed number must
    // leave a record, otherwise a phoneless customer is indistinguishable from
    // one merely out of rollout scope.
    const phoneDigits = toSendPulsePhone(rawPhone);
    if (!phoneDigits) {
      await logSkip(admin, bookingId, messageKind, provider.id, "INVALID_PHONE", null);
      return { outcome: "skipped", reason: "INVALID_PHONE" };
    }

    // GATE: allowlist. Reached only with a VALID number, so this expresses one
    // thing only — "valid, but not yet in rollout scope". No ledger row:
    // widening the allowlist IS the cutover, and a claim would block it.
    if (!isAllowlisted(phoneDigits)) {
      return { outcome: "skipped", reason: "NOT_ALLOWLISTED" };
    }

    // ── Message parameters ───────────────────────────────────────────────────
    // {{1}} customer name. No generic fallback by design: a nameless greeting
    // reads as a marketing blast and risks the sender quality rating for all
    // our traffic.
    const { data: customerProfile } = await admin
      .from("profiles")
      .select("display_name")
      .eq("user_id", accountId!)
      .maybeSingle();

    const customerName = (customerProfile?.display_name ?? "").trim();
    if (!customerName) {
      await logSkip(admin, bookingId, messageKind, provider.id, "NO_NAME", phoneDigits);
      return { outcome: "skipped", reason: "NO_NAME" };
    }

    // {{5}} first service only. service_ids is a uuid[] with no FK, and a
    // group-class booking carries an empty array.
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
      await logSkip(admin, bookingId, messageKind, provider.id, "NO_SERVICE", phoneDigits);
      return { outcome: "skipped", reason: "NO_SERVICE" };
    }

    const dateText = formatBookingDate(booking.booking_date);
    const timeText = formatBookingTime(booking.booking_time);
    if (!dateText || !timeText) {
      await logSkip(admin, bookingId, messageKind, provider.id, "BAD_DATETIME", phoneDigits);
      return { outcome: "skipped", reason: "BAD_DATETIME" };
    }

    const businessName = (provider.business_name ?? "").trim();
    if (!businessName) {
      await logSkip(admin, bookingId, messageKind, provider.id, "NO_BUSINESS_NAME", phoneDigits);
      return { outcome: "skipped", reason: "NO_BUSINESS_NAME" };
    }

    // ── Claim before sending ─────────────────────────────────────────────────
    // The INSERT is the lock. message_kind comes from the RPC VERBATIM so this
    // claim and the RPC's anti-join test the same key. Two overlapping cron runs
    // race here; the loser gets 23505 and returns without calling SendPulse.
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
      if (claimError.code === "23505") return { outcome: "already_sent" };
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
        .eq("id", claimId);
      console.error("whatsapp-booking-reminder: send threw", {
        booking_id: bookingId,
        phone: maskPhone(phoneDigits),
        reason,
      });
      return { outcome: "failed", reason: "SEND_ERROR" };
    }

    if (!sent.ok) {
      await admin
        .from("whatsapp_send_log")
        .update({
          status: "failed",
          error_code: (sent.reason ?? `http_${sent.status}`).slice(0, 200),
          updated_at: new Date().toISOString(),
        })
        .eq("id", claimId);
      console.error("whatsapp-booking-reminder: send rejected", {
        booking_id: bookingId,
        phone: maskPhone(phoneDigits),
        http_status: sent.status,
        reason: sent.reason,
      });
      // The claim stays. A rejected send is NOT retried automatically: a
      // "failure" that was actually delivered would otherwise duplicate a real
      // customer message. Re-sending requires deleting the ledger row by hand.
      return { outcome: "failed", reason: "SEND_REJECTED" };
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
      .eq("id", claimId);

    console.log("whatsapp-booking-reminder: sent", {
      booking_id: bookingId,
      provider_id: provider.id,
      phone: maskPhone(phoneDigits),
      language: template.languageCode,
      message_id: sent.messageId,
      missing_message_id: sent.messageId === null,
    });

    return { outcome: "sent" };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error("whatsapp-booking-reminder: booking failed", {
      booking_id: bookingId,
      reason,
    });

    // Resolve a claim that never reached a terminal status, so no row is left
    // stranded at 'sending'. Guarded by .eq("status","sending") so it can never
    // overwrite a state the happy path already wrote.
    //
    // sendAccepted decides which terminal state is TRUE, not which is
    // convenient: if SendPulse already took the message, the customer has it and
    // the row must say 'sent' even though our bookkeeping fell over.
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
        console.error("whatsapp-booking-reminder: claim recovery failed", {
          booking_id: bookingId,
          claim_id: claimId,
          reason: recoveryErr instanceof Error ? recoveryErr.message : String(recoveryErr),
        });
      }
    }

    return { outcome: "failed", reason: "UNHANDLED" };
  }
}

// ── Entry point ──────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  const startedAt = Date.now();

  try {
    // ── Caller gate ──────────────────────────────────────────────────────────
    // Refuse to run at all if the secret is not configured. Failing closed
    // matters here: an unset secret must never mean "open to everyone".
    const expectedSecret = Deno.env.get("CRON_SECRET");
    if (!expectedSecret) {
      console.error("whatsapp-booking-reminder: CRON_SECRET is not configured");
      return json(500, { error: "Server misconfigured" });
    }

    const providedSecret = req.headers.get("x-cron-secret") ?? "";
    if (!(await secretMatches(providedSecret, expectedSecret))) {
      console.warn("whatsapp-booking-reminder: rejected unauthenticated invocation");
      return json(401, { error: "Unauthorized" });
    }

    // ── Batch size ───────────────────────────────────────────────────────────
    // An unbounded query is a cost runaway. Clamped to a hard ceiling so a
    // mistyped env var cannot uncap it.
    const configured = Number(Deno.env.get("WHATSAPP_REMINDER_BATCH_LIMIT"));
    const batchLimit = Number.isFinite(configured) && configured > 0
      ? Math.min(Math.floor(configured), MAX_BATCH_LIMIT)
      : DEFAULT_BATCH_LIMIT;

    const admin = createAdminClient();

    // ── Discover due bookings ────────────────────────────────────────────────
    // The RPC owns every time-based decision (both lead-time windows, the
    // not-in-the-past guard) and the ledger anti-join. See the timezone note at
    // the top of this file.
    const { data: due, error: dueError } = await admin.rpc("get_due_whatsapp_reminders", {
      p_limit: batchLimit,
    });
    if (dueError) throw dueError;

    const rows = (Array.isArray(due) ? due : []) as Array<{
      r_booking_id: string;
      r_provider_id: string;
      r_message_kind: string;
    }>;

    // Sequential on purpose: bounded, predictable pressure on the SendPulse API,
    // and no risk of two concurrent sends racing for the same claim. The batch
    // cap is what keeps the run inside the function's time budget.
    const tally: Record<Outcome, number> = { sent: 0, skipped: 0, failed: 0, already_sent: 0 };
    const skipReasons: Record<string, number> = {};

    for (const row of rows) {
      const result = await processBooking(admin, row.r_booking_id, row.r_message_kind);
      tally[result.outcome] += 1;
      if (result.reason) {
        skipReasons[result.reason] = (skipReasons[result.reason] ?? 0) + 1;
      }
    }

    // A full batch means more work is waiting; the next tick picks it up.
    const saturated = rows.length >= batchLimit;
    if (saturated) {
      console.warn("whatsapp-booking-reminder: batch limit reached, work deferred to next run", {
        batch_limit: batchLimit,
      });
    }

    console.log("whatsapp-booking-reminder: run complete", {
      due: rows.length,
      ...tally,
      reasons: skipReasons,
      saturated,
      latency_ms: Date.now() - startedAt,
    });

    return json(200, { ok: true, due: rows.length, ...tally, saturated });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error("whatsapp-booking-reminder: run failed", { reason });
    return json(500, { error: "Internal error" });
  }
});
