// waitlist-dispatch — tells waiting customers that a slot opened up.
//
// CRON-DRIVEN (waitlist-dispatch-1min, migration 20261101000001 §10). There is
// no user and no caller to authorize; requests must carry x-cron-secret, which
// is compared in constant time. The platform JWT gate is satisfied by the ANON
// key that ships in the client bundle, which is not enough for a function that
// sends WhatsApp messages from the business number.
//
// ONE RUN:
//   1. waitlist_housekeeping()        expire past entries, fulfil booked ones
//   2. waitlist_claim_events(limit)   SQL closes hopeless events and leases the
//                                     rest (FOR UPDATE SKIP LOCKED rows only)
//   3. waitlist_candidates(ids)       every (entry, event) pair that passes the
//                                     SQL-side rules
//   4. opening hours, here            the shared resolver copy: shop + staff
//                                     hours, blocked days, monthly overrides,
//                                     staff time off, end before closing, the
//                                     slot grid, the break, latest_start_time
//   5. per entry, earliest slot first:
//        waitlist_claim_round()       re-checks everything incl. "is the slot
//                                     still open", then claims the round in
//                                     waitlist_send_log — BEFORE any channel
//        WhatsApp → bell → push
//      One message per entry per run, quoting the earliest slot that claims.
//   6. close each event with outcome notified:<n> or no_match
//
// ROLLOUT GATE: WHATSAPP_WAITLIST_PHONES gates EVERY channel. A customer whose
// number is not on it gets nothing at all — no WhatsApp, no bell, no push —
// and no round is claimed, so the entry stays eligible for when they are.
// Unset or empty = nobody. "*" = everyone. There is deliberately no fallback to
// another allowlist.
//
// NO SENDPULSE CONFIG (no credential pair, or no SENDPULSE_BOT_ID): WhatsApp
// is skipped — the ledger row is written 'skipped' / WHATSAPP_NOT_CONFIGURED
// and SendPulse is never contacted — while bell and push still go out and the
// event closes normally. DEV runs this way.
//
// TIMEZONE: no clock arithmetic over booking dates happens here. Quiet hours,
// staleness, lead time and the 60-minute spacing are SQL (AT TIME ZONE
// 'Asia/Jerusalem'). The only date handling here is weekday lookup for the
// resolver, from a Date built out of the YYYY-MM-DD components — correct in
// any runtime timezone, the same way the booking page does it.
//
// NO SHARED SENDPULSE MODULE: SendPulse code is duplicated from
// whatsapp-booking-reminder, following that function's rule that WhatsApp
// senders ship and roll back independently. Two deliberate differences:
// the template carries a URL button, and looseDigits handles 00972 correctly
// (the reminder's copy does not; that is its own ticket).
//
// LOGGING: never logs SendPulse credentials, the access token, the cron secret
// or a full phone number (last 4 digits only).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.99.3";
import {
  type DateOverrideRow,
  type MonthlySettings,
  narrowToStaff,
  NO_BLOCKED_DATES,
  resolveDayHours,
  staffDayWindow,
  type StaffWeeklyRow,
  type WeeklyRow,
} from "../_shared/availabilityResolver.ts";
import { sendPushToUser } from "../_shared/push.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") ?? "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

// ── Templates ────────────────────────────────────────────────────────────────
// Approved by Meta. Body {{1}} name, {{2}} business, {{3}} DD/MM/YYYY,
// {{4}} HH:MM. One dynamic URL button at index 0:
// https://www.ehjezly.co.il/provider/{{1}}, parameter = provider id.
// Language follows provider_profiles.whatsapp_message_language; there is no
// English template.
export const TEMPLATES = {
  he: { name: "waitlist_slot_available_hebrew", languageCode: "he" },
  ar: { name: "waitlist_slot_available_arabic", languageCode: "ar" },
} as const;

export type WhatsAppLang = keyof typeof TEMPLATES;
export type NotifyLang = "he" | "ar" | "en";

const DEFAULT_BATCH_LIMIT = 50;
const MAX_BATCH_LIMIT = 500;

// A waiting-list push is perishable: first to book wins. An offline phone that
// wakes up hours later should not be told about a slot that is long gone.
const PUSH_TTL_SECONDS = 3600;

const SENDPULSE_OAUTH_URL = "https://api.sendpulse.com/oauth/access_token";
const SENDPULSE_SEND_URL = "https://api.sendpulse.com/whatsapp/contacts/sendTemplateByPhone";
const TOKEN_EXPIRY_SKEW_SECONDS = 60;

// waitlist_claim_round reasons after which a LATER slot for the same entry may
// still claim. Every other refusal is about the entry itself, so stop.
const TRY_NEXT_SLOT = new Set(["SLOT_TAKEN", "TOO_LATE"]);

// ── Pure helpers (exported for index_test.ts) ────────────────────────────────

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function reject(gate: string, status: number, body: unknown): Response {
  console.warn("waitlist-dispatch: rejected", { gate, status });
  return json(status, body);
}

/** Safe for logs — last 4 digits only. Full numbers are PII. */
export function maskPhone(value: string | null | undefined): string {
  const d = (value ?? "").replace(/\D/g, "");
  return d.length <= 4 ? "****" : `***${d.slice(-4)}`;
}

/**
 * Constant-time secret comparison over SHA-256 digests, so neither the
 * contents nor the length of the secret leak through timing. Same as
 * whatsapp-booking-reminder.
 */
export async function secretMatches(provided: string, expected: string): Promise<boolean> {
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
 * Identical to whatsapp-booking-reminder: an account phone was OTP-verified.
 */
export function toSendPulsePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let d = raw.replace(/\D/g, "");
  if (d.startsWith("00972")) d = d.slice(5);
  else if (d.startsWith("972")) d = d.slice(3);
  else if (d.startsWith("0")) d = d.slice(1);
  if (!/^[5-9]\d{8}$/.test(d)) return null;
  return `972${d}`;
}

/**
 * Normalizes an ALLOWLIST ENTRY to the form toSendPulsePhone produces.
 * "00972…" drops the leading "00" (slice 2) — the reminder's copy slices 3 and
 * turns it into "72…", which never matches.
 */
export function looseDigits(raw: string | null | undefined): string {
  const d = (raw ?? "").replace(/\D/g, "");
  if (d.startsWith("00972")) return d.slice(2);
  if (d.startsWith("972")) return d;
  if (d.startsWith("0")) return `972${d.slice(1)}`;
  return d ? `972${d}` : "";
}

export type Allowlist = { all: true } | { all: false; phones: Set<string> };

/**
 * Unset, empty or blank = nobody. "*" = everyone. Otherwise numbers separated
 * by commas, semicolons or newlines. Spaces and dashes INSIDE a number are
 * fine ("+972 50-123 4567"); unlike the reminder's parser, a space does not
 * separate entries, so a number written with spaces is not split into junk.
 */
export function parseAllowlist(raw: string | null | undefined): Allowlist {
  const text = (raw ?? "").trim();
  if (text === "*") return { all: true };
  const phones = new Set<string>();
  for (const entry of text.split(/[,;\n\r]+/)) {
    const d = looseDigits(entry);
    if (d) phones.add(d);
  }
  return { all: false, phones };
}

/** A customer with no usable phone is reachable only when the list is "*". */
export function isAllowlisted(list: Allowlist, phoneDigits: string | null): boolean {
  if (list.all) return true;
  return phoneDigits !== null && list.phones.has(phoneDigits);
}

/**
 * Why WhatsApp is NOT attempted for this customer, or null to attempt it.
 * Customer data first (a permanent property of the account), then config.
 * Any code here makes waitlist_claim_round write the ledger row 'skipped' from
 * the start; bell and push still go out on the same claim.
 */
export function whatsappSkipCode(
  phoneDigits: string | null,
  name: string,
  whatsappConfigured: boolean,
): "INVALID_PHONE" | "NO_NAME" | "WHATSAPP_NOT_CONFIGURED" | null {
  if (!phoneDigits) return "INVALID_PHONE";
  if (!name) return "NO_NAME";
  if (!whatsappConfigured) return "WHATSAPP_NOT_CONFIGURED";
  return null;
}

/** "2026-11-06" → "06/11/2026". Pure string work. */
export function formatSlotDate(date: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date ?? "");
  return m ? `${m[3]}/${m[2]}/${m[1]}` : null;
}

/** Strict HH:MM (waitlist_candidates already normalises). */
export function formatSlotTime(time: string): string | null {
  const t = (time ?? "").trim();
  return /^\d{2}:\d{2}$/.test(t) ? t : null;
}

export function whatsappLanguage(providerLang: string | null | undefined): WhatsAppLang {
  return providerLang === "ar" ? "ar" : "he";
}

/**
 * Bell + push language: the entry's notify_lang (chosen at join time), else the
 * provider's WhatsApp language, else Hebrew. profiles.preferred_lang is never
 * consulted — the app never writes it.
 */
export function notifyLanguage(
  entryLang: string | null | undefined,
  providerLang: string | null | undefined,
): NotifyLang {
  if (entryLang === "he" || entryLang === "ar" || entryLang === "en") return entryLang;
  return whatsappLanguage(providerLang);
}

/** Approved copy. Date DD/MM/YYYY, time HH:MM. */
export function bellText(
  lang: NotifyLang,
  business: string,
  date: string,
  time: string,
): { title: string; body: string } {
  switch (lang) {
    case "ar":
      return { title: `تفرّغ موعد في ${business}`, body: `${date} الساعة ${time}. الموعد لمن يحجز أولاً.` };
    case "en":
      return { title: `A slot opened up at ${business}`, body: `${date} at ${time}. First to book gets it.` };
    default:
      return { title: `התפנה תור ב־${business}`, body: `${date} בשעה ${time}. התור למי שמזמין ראשון.` };
  }
}

/**
 * The exact sendTemplateByPhone body. The button component must match the
 * approved template: sub_type url, index 0, one text parameter = provider id.
 */
export function buildTemplatePayload(
  botId: string | undefined,
  phoneDigits: string,
  template: { name: string; languageCode: string },
  params: [string, string, string, string],
  providerId: string,
) {
  return {
    bot_id: botId,
    phone: phoneDigits,
    template: {
      name: template.name,
      language: { policy: "deterministic", code: template.languageCode },
      components: [
        { type: "body", parameters: params.map((text) => ({ type: "text", text })) },
        { type: "button", sub_type: "url", index: 0, parameters: [{ type: "text", text: providerId }] },
      ],
    },
  };
}

/** "HH:MM" or "HH:MM:SS" → minutes; same parse as useAllProviders.parseTime. */
function minutesOf(time: string | null | undefined): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(time ?? "");
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

export interface HoursContext {
  settings: MonthlySettings;
  weeklyRows: WeeklyRow[];
  blockedDates: string[];
  overrides: DateOverrideRow[];
  slotInterval: number;
  /** staff_id → (day_of_week → row). A member ABSENT here has no hours rows. */
  staffHours: Map<string, Map<number, StaffWeeklyRow>>;
  /** staff_id → set of YYYY-MM-DD days off. */
  staffTimeOff: Map<string, Set<string>>;
}

export type HoursVerdict =
  | { ok: true }
  | { ok: false; reason: "BAD_DATE" | "CLOSED" | "OUTSIDE_HOURS" | "OFF_GRID" | "IN_BREAK" | "AFTER_LATEST_START" };

/**
 * Would the booking page list `slotTime` on `slotDate` for this service and
 * staff lane, as far as OPENING HOURS go? Mirrors getAvailableSlots:
 *   window = narrowToStaff(resolveDayHours(…), staffDayWindow(…)) when a staff
 *            member is selected, the shop window otherwise
 *   offered start times: t = window.start + k·slotInterval, t + duration <= end
 *   not starting inside the break, not after the service's latest_start_time
 * Overlap with other bookings is NOT checked here — waitlist_slot_is_open does
 * that at claim time.
 */
export function slotFitsHours(
  ctx: HoursContext,
  slotDate: string,
  slotTime: string,
  serviceDuration: number,
  latestStartTime: string | null,
  staffLane: string | null,
): HoursVerdict {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(slotDate);
  const t = minutesOf(slotTime);
  if (!m || t === null) return { ok: false, reason: "BAD_DATE" };
  // Local-component construction: getDay() and toLocalDateStr() inside the
  // resolver then agree with the calendar date in any runtime timezone.
  const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));

  const shop = resolveDayHours(date, ctx.settings, ctx.weeklyRows, ctx.blockedDates, ctx.overrides);
  const window = staffLane
    ? narrowToStaff(
      shop,
      staffDayWindow(date, ctx.staffHours.get(staffLane), ctx.staffTimeOff.get(staffLane) ?? NO_BLOCKED_DATES),
    )
    : shop;
  if (!window) return { ok: false, reason: "CLOSED" };

  const start = minutesOf(window.start_time);
  const end = minutesOf(window.end_time);
  if (start === null || end === null) return { ok: false, reason: "CLOSED" };
  if (t < start || t + serviceDuration > end) return { ok: false, reason: "OUTSIDE_HOURS" };

  const step = ctx.slotInterval > 0 ? ctx.slotInterval : 15;
  if ((t - start) % step !== 0) return { ok: false, reason: "OFF_GRID" };

  const breakStart = minutesOf(window.break_start);
  const breakEnd = minutesOf(window.break_end);
  if (breakStart !== null && breakEnd !== null && t >= breakStart && t < breakEnd) {
    return { ok: false, reason: "IN_BREAK" };
  }

  const latest = minutesOf(latestStartTime);
  if (latest !== null && t > latest) return { ok: false, reason: "AFTER_LATEST_START" };

  return { ok: true };
}

export interface Candidate {
  entry_id: string;
  user_id: string;
  event_id: number;
  freed_booking_id: string | null;
  provider_id: string;
  slot_date: string;
  slot_time: string;
  staff_lane: string | null;
  service_id: string;
  service_duration: number;
  latest_start_time: string | null;
  next_round: number;
  notify_lang: string | null;
}

/** Candidates grouped per entry, each group earliest slot first. */
export function groupByEntry(candidates: Candidate[]): Map<string, Candidate[]> {
  const groups = new Map<string, Candidate[]>();
  for (const c of candidates) {
    const list = groups.get(c.entry_id) ?? [];
    list.push(c);
    groups.set(c.entry_id, list);
  }
  for (const list of groups.values()) {
    list.sort((a, b) => a.slot_time.localeCompare(b.slot_time) || a.event_id - b.event_id);
  }
  return groups;
}

// ── Supabase ─────────────────────────────────────────────────────────────────

/** Service-role client. Bypasses RLS — never built from a caller-supplied key. */
function createAdminClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

type Admin = ReturnType<typeof createAdminClient>;

// ── SendPulse (duplicated from whatsapp-booking-reminder — see header) ──────

let cachedToken: { token: string; expiresAt: number } | null = null;

function loadSendPulseCreds(): { clientId: string; clientSecret: string; grantType: string } {
  const id = Deno.env.get("SENDPULSE_CLIENT_ID");
  const secret = Deno.env.get("SENDPULSE_CLIENT_SECRET");
  if (id && secret) return { clientId: id, clientSecret: secret, grantType: "client_credentials" };

  const bareId = Deno.env.get("client_id");
  const bareSecret = Deno.env.get("client_secret");
  if (bareId && bareSecret) {
    return { clientId: bareId, clientSecret: bareSecret, grantType: Deno.env.get("grant_type") || "client_credentials" };
  }
  throw new Error("SENDPULSE_CREDENTIALS_NOT_CONFIGURED");
}

/**
 * A full credential pair AND a bot id. Without the bot id SendPulse would be
 * called with bot_id: undefined and reject — a 'failed' row that looks like a
 * delivery problem. Checked once per run, before any round is claimed.
 */
export function whatsappConfigured(): boolean {
  try {
    loadSendPulseCreds();
  } catch {
    return false;
  }
  return !!Deno.env.get("SENDPULSE_BOT_ID");
}

async function getAccessToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt - TOKEN_EXPIRY_SKEW_SECONDS * 1000 > now) return cachedToken.token;

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

  const body = await res.json().catch(() => null);
  const payload = body?.data ?? body;
  const token: string | undefined = payload?.access_token;
  if (!token) throw new Error("SENDPULSE_AUTH_FAILED:no_token");

  cachedToken = { token, expiresAt: now + (Number(payload?.expires_in) || 3600) * 1000 };
  return token;
}

interface SendResult {
  ok: boolean;
  messageId: string | null;
  status: number;
  reason?: string;
}

async function sendTemplate(token: string, payload: unknown): Promise<SendResult> {
  const res = await fetch(SENDPULSE_SEND_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });

  const raw = await res.text();
  let body: Record<string, unknown> | null = null;
  try {
    body = raw ? JSON.parse(raw) as Record<string, unknown> : null;
  } catch {
    body = null;
  }

  // Success sits at the top level of the body; accept data.success too.
  const dataField = body?.data as Record<string, unknown> | undefined;
  const ok = res.ok && (body?.success === true || dataField?.success === true);

  const p = dataField ?? body ?? undefined;
  const idCandidate = p?.message_id ?? p?.wamid ?? (p?.message as Record<string, unknown> | undefined)?.id ?? p?.id;

  return {
    ok,
    messageId: typeof idCandidate === "string" && idCandidate ? idCandidate : null,
    status: res.status,
    reason: ok ? undefined : (raw.slice(0, 400) || `http_${res.status}`),
  };
}

// ── Provider context ─────────────────────────────────────────────────────────

interface ProviderInfo {
  id: string;
  businessName: string;
  whatsappLang: string | null;
  hours: HoursContext;
}

/**
 * Everything the resolver needs for one provider, limited to the dates in play.
 * Throws on any query error: the caller then leaves that provider's events
 * leased, and they are retried when the lease expires.
 */
async function loadProvider(admin: Admin, providerId: string, dates: string[]): Promise<ProviderInfo> {
  const [profile, weekly, blocked, overrides, staffHours, staffOff] = await Promise.all([
    admin.from("provider_profiles")
      .select("id, business_name, whatsapp_message_language, slot_interval_minutes, availability_mode, monthly_default_available, monthly_default_start, monthly_default_end")
      .eq("id", providerId).maybeSingle(),
    admin.from("provider_availability")
      .select("day_of_week, start_time, end_time, is_available, break_start, break_end")
      .eq("provider_id", providerId),
    admin.from("provider_blocked_dates").select("blocked_date").eq("provider_id", providerId).in("blocked_date", dates),
    admin.from("provider_date_overrides")
      .select("override_date, is_available, start_time, end_time, break_start, break_end")
      .eq("provider_id", providerId).in("override_date", dates),
    admin.from("provider_staff_availability")
      .select("staff_id, day_of_week, start_time, end_time, is_available")
      .eq("provider_id", providerId),
    admin.from("provider_staff_blocked_dates")
      .select("staff_id, blocked_date").eq("provider_id", providerId).in("blocked_date", dates),
  ]);

  for (const r of [profile, weekly, blocked, overrides, staffHours, staffOff]) {
    if (r.error) throw new Error(`PROVIDER_CONTEXT:${r.error.message}`);
  }
  if (!profile.data) throw new Error("PROVIDER_CONTEXT:provider_gone");
  const p = profile.data;

  // Same defaults as useAllProviders: weekly unless the row says monthly.
  const settings: MonthlySettings = {
    availability_mode: p.availability_mode === "monthly" ? "monthly" : "weekly",
    monthly_default_available: p.monthly_default_available ?? true,
    monthly_default_start: p.monthly_default_start ?? "09:00",
    monthly_default_end: p.monthly_default_end ?? "17:00",
  };

  const hoursByStaff = new Map<string, Map<number, StaffWeeklyRow>>();
  for (const row of staffHours.data ?? []) {
    const days = hoursByStaff.get(row.staff_id) ?? new Map<number, StaffWeeklyRow>();
    days.set(row.day_of_week, row);
    hoursByStaff.set(row.staff_id, days);
  }
  const offByStaff = new Map<string, Set<string>>();
  for (const row of staffOff.data ?? []) {
    const set = offByStaff.get(row.staff_id) ?? new Set<string>();
    set.add(String(row.blocked_date).slice(0, 10));
    offByStaff.set(row.staff_id, set);
  }

  return {
    id: p.id,
    businessName: (p.business_name ?? "").trim(),
    whatsappLang: p.whatsapp_message_language ?? null,
    hours: {
      settings,
      weeklyRows: (weekly.data ?? []) as WeeklyRow[],
      blockedDates: (blocked.data ?? []).map((b: { blocked_date: string }) => String(b.blocked_date).slice(0, 10)),
      overrides: (overrides.data ?? []).map((o: DateOverrideRow) => ({ ...o, override_date: String(o.override_date).slice(0, 10) })),
      slotInterval: Number(p.slot_interval_minutes) || 15,
      staffHours: hoursByStaff,
      staffTimeOff: offByStaff,
    },
  };
}

// ── Customer ─────────────────────────────────────────────────────────────────

/**
 * auth.users.phone is the canonical, OTP-verified number; profiles.phone is a
 * mirror and the fallback. display_name is the {{1}} greeting.
 */
async function loadCustomer(admin: Admin, userId: string): Promise<{ phoneDigits: string | null; name: string }> {
  const { data: authUser, error: authError } = await admin.auth.admin.getUserById(userId);
  if (authError) {
    console.warn("waitlist-dispatch: getUserById failed, falling back to profiles.phone", {
      user_id: userId,
      code: (authError as { code?: string }).code ?? null,
    });
  }
  const { data: profile } = await admin
    .from("profiles")
    .select("phone, display_name")
    .eq("user_id", userId)
    .maybeSingle();

  return {
    phoneDigits: toSendPulsePhone(authUser?.user?.phone || profile?.phone || null),
    name: (profile?.display_name ?? "").trim(),
  };
}

// ── One entry ────────────────────────────────────────────────────────────────

interface Tally {
  entries: number;
  notified: number;
  whatsapp: { sent: number; failed: number; skipped: number };
  bell: { ok: number; failed: number };
  push: { sent: number; failed: number; users_without_subscription: number };
  reasons: Record<string, number>;
}

function count(tally: Tally, reason: string) {
  tally.reasons[reason] = (tally.reasons[reason] ?? 0) + 1;
}

/**
 * Notifies one entry about the earliest of its slots that still claims.
 * Returns the event id it was notified for, or null.
 */
async function processEntry(
  admin: Admin,
  slots: Candidate[],
  provider: ProviderInfo,
  allowlist: Allowlist,
  canSendWhatsApp: boolean,
  tally: Tally,
): Promise<number | null> {
  const first = slots[0];
  tally.entries += 1;

  const customer = await loadCustomer(admin, first.user_id);

  // ROLLOUT GATE — every channel. No claim: the entry stays eligible.
  if (!isAllowlisted(allowlist, customer.phoneDigits)) {
    count(tally, "NOT_ALLOWLISTED");
    return null;
  }
  if (!provider.businessName) {
    count(tally, "NO_BUSINESS_NAME");
    return null;
  }

  const waLang = whatsappLanguage(provider.whatsappLang);
  const template = TEMPLATES[waLang];
  // WhatsApp-only skips; bell and push still go out.
  const whatsappSkip = whatsappSkipCode(customer.phoneDigits, customer.name, canSendWhatsApp);

  // Earliest slot first; a slot taken since the match falls through to the next.
  let claimed: { logId: string; slot: Candidate } | null = null;
  for (const slot of slots) {
    const { data, error } = await admin.rpc("waitlist_claim_round", {
      p_entry_id: slot.entry_id,
      p_round: slot.next_round,
      p_event_id: slot.event_id,
      p_freed_booking_id: slot.freed_booking_id,
      p_slot_time: slot.slot_time,
      p_staff_lane: slot.staff_lane,
      p_phone_digits: customer.phoneDigits,
      p_template_name: template.name,
      p_language_code: template.languageCode,
      p_whatsapp_skip: whatsappSkip,
    });
    if (error) throw new Error(`CLAIM_ROUND:${error.message}`);
    const row = (Array.isArray(data) ? data[0] : data) as { log_id: string | null; reason: string | null } | null;
    if (row?.log_id) {
      claimed = { logId: row.log_id, slot };
      break;
    }
    const reason = row?.reason ?? "CLAIM_NO_RESULT";
    count(tally, reason);
    if (!TRY_NEXT_SLOT.has(reason)) return null;
  }
  if (!claimed) return null;

  tally.notified += 1;
  const { slot, logId } = claimed;
  const dateText = formatSlotDate(slot.slot_date) ?? slot.slot_date;
  const timeText = formatSlotTime(slot.slot_time) ?? slot.slot_time;

  // ── WhatsApp ───────────────────────────────────────────────────────────────
  if (whatsappSkip) {
    tally.whatsapp.skipped += 1;
    count(tally, `WHATSAPP_${whatsappSkip}`);
  } else {
    await sendWhatsApp(admin, logId, customer.phoneDigits!, template, [customer.name, provider.businessName, dateText, timeText], provider.id, tally);
  }

  // ── Bell ───────────────────────────────────────────────────────────────────
  const lang = notifyLanguage(slot.notify_lang, provider.whatsappLang);
  const text = bellText(lang, provider.businessName, dateText, timeText);
  const url = `/provider/${provider.id}`;

  const { error: bellError } = await admin.from("notifications").insert({
    user_id: slot.user_id,
    title: text.title,
    body: text.body,
    url,
    type: "waitlist_slot",
  });
  if (bellError) {
    tally.bell.failed += 1;
    console.error("waitlist-dispatch: bell insert failed", { entry_id: slot.entry_id, reason: bellError.message });
  } else {
    tally.bell.ok += 1;
  }

  // ── Push ───────────────────────────────────────────────────────────────────
  try {
    const push = await sendPushToUser(admin, slot.user_id, { ...text, url }, { ttlSeconds: PUSH_TTL_SECONDS });
    tally.push.sent += push.sent;
    tally.push.failed += push.failed;
    if (push.skipped === "NO_SUBSCRIPTIONS") tally.push.users_without_subscription += 1;
    if (push.skipped === "NO_VAPID_KEYS") count(tally, "PUSH_NO_VAPID_KEYS");
  } catch (err) {
    tally.push.failed += 1;
    console.error("waitlist-dispatch: push failed", {
      entry_id: slot.entry_id,
      reason: err instanceof Error ? err.message : String(err),
    });
  }

  console.log("waitlist-dispatch: notified", {
    entry_id: slot.entry_id,
    event_id: slot.event_id,
    round: slot.next_round,
    slot: `${slot.slot_date}T${slot.slot_time}`,
    phone: maskPhone(customer.phoneDigits),
    whatsapp: whatsappSkip ?? template.languageCode,
    notify_lang: lang,
  });
  return slot.event_id;
}

/**
 * Sends the template for an already-claimed round and records the outcome on
 * the ledger row. Never throws. A rejected send is NOT retried: a "failure"
 * that was actually delivered would otherwise duplicate a customer message.
 */
async function sendWhatsApp(
  admin: Admin,
  logId: string,
  phoneDigits: string,
  template: { name: string; languageCode: string },
  params: [string, string, string, string],
  providerId: string,
  tally: Tally,
): Promise<void> {
  let accepted = false;
  try {
    const token = await getAccessToken();
    const sent = await sendTemplate(
      token,
      buildTemplatePayload(Deno.env.get("SENDPULSE_BOT_ID"), phoneDigits, template, params, providerId),
    );
    if (!sent.ok) {
      tally.whatsapp.failed += 1;
      await admin.from("waitlist_send_log")
        .update({ status: "failed", error_code: (sent.reason ?? `http_${sent.status}`).slice(0, 200) })
        .eq("id", logId);
      console.error("waitlist-dispatch: send rejected", {
        log_id: logId,
        phone: maskPhone(phoneDigits),
        http_status: sent.status,
        reason: sent.reason,
      });
      return;
    }
    accepted = true;
    tally.whatsapp.sent += 1;
    await admin.from("waitlist_send_log")
      .update({ status: "sent", sendpulse_message_id: sent.messageId, missing_message_id: sent.messageId === null })
      .eq("id", logId);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    if (!accepted) tally.whatsapp.failed += 1;
    console.error("waitlist-dispatch: send threw", { log_id: logId, phone: maskPhone(phoneDigits), reason });
    // Resolve the row truthfully, and only if nothing else already did.
    await admin.from("waitlist_send_log")
      .update(accepted
        ? { status: "sent", error_code: "TERMINAL_UPDATE_FAILED" }
        : { status: "failed", error_code: reason.slice(0, 200) })
      .eq("id", logId)
      .eq("status", "sending")
      .then(() => undefined, () => undefined);
  }
}

// ── One run ──────────────────────────────────────────────────────────────────

async function runDispatch(admin: Admin, batchLimit: number) {
  const tally: Tally = {
    entries: 0,
    notified: 0,
    whatsapp: { sent: 0, failed: 0, skipped: 0 },
    bell: { ok: 0, failed: 0 },
    push: { sent: 0, failed: 0, users_without_subscription: 0 },
    reasons: {},
  };

  // 1. Housekeeping. A failure is logged, not fatal: claim_round re-checks
  //    "already booked" itself, and the 15-minute SQL cron also runs this.
  const { data: hk, error: hkError } = await admin.rpc("waitlist_housekeeping");
  if (hkError) console.error("waitlist-dispatch: housekeeping failed", { reason: hkError.message });

  // 2. Lease events.
  const { data: events, error: claimError } = await admin.rpc("waitlist_claim_events", { p_limit: batchLimit });
  if (claimError) throw new Error(`CLAIM_EVENTS:${claimError.message}`);
  const eventIds: number[] = (events ?? []).map((e: { id: number }) => e.id);
  if (eventIds.length === 0) {
    return { claimed: 0, housekeeping: hk?.[0] ?? null, ...tally };
  }

  // 3. SQL-side matching.
  const { data: rawCandidates, error: candError } = await admin.rpc("waitlist_candidates", { p_event_ids: eventIds });
  if (candError) throw new Error(`CANDIDATES:${candError.message}`);
  const candidates = (rawCandidates ?? []) as Candidate[];

  // 4. Opening hours, per provider.
  const datesByProvider = new Map<string, Set<string>>();
  for (const c of candidates) {
    const set = datesByProvider.get(c.provider_id) ?? new Set<string>();
    set.add(c.slot_date);
    datesByProvider.set(c.provider_id, set);
  }
  const providers = new Map<string, ProviderInfo>();
  const failedEvents = new Map<number, string>(); // left leased → retried
  for (const [providerId, dates] of datesByProvider) {
    try {
      providers.set(providerId, await loadProvider(admin, providerId, [...dates]));
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.error("waitlist-dispatch: provider context failed", { provider_id: providerId, reason });
      for (const c of candidates) if (c.provider_id === providerId) failedEvents.set(c.event_id, reason);
    }
  }

  const fitting: Candidate[] = [];
  for (const c of candidates) {
    const provider = providers.get(c.provider_id);
    if (!provider) continue;
    const verdict = slotFitsHours(provider.hours, c.slot_date, c.slot_time, c.service_duration, c.latest_start_time, c.staff_lane);
    if (verdict.ok) fitting.push(c);
    else count(tally, `HOURS_${verdict.reason}`);
  }

  // 5. Notify, one entry at a time.
  const notifiedPerEvent = new Map<number, number>();
  const allowlist = parseAllowlist(Deno.env.get("WHATSAPP_WAITLIST_PHONES"));
  const canSendWhatsApp = whatsappConfigured();
  if (!canSendWhatsApp && fitting.length > 0) {
    console.warn("waitlist-dispatch: SendPulse credentials or SENDPULSE_BOT_ID not configured — WhatsApp skipped");
  }
  for (const slots of groupByEntry(fitting).values()) {
    try {
      const eventId = await processEntry(
        admin,
        slots,
        providers.get(slots[0].provider_id)!,
        allowlist,
        canSendWhatsApp,
        tally,
      );
      if (eventId !== null) notifiedPerEvent.set(eventId, (notifiedPerEvent.get(eventId) ?? 0) + 1);
    } catch (err) {
      // The claim (if any) protects against a duplicate; leave the events
      // leased so a retry can reach the entries this failure skipped.
      const reason = err instanceof Error ? err.message : String(err);
      console.error("waitlist-dispatch: entry failed", { entry_id: slots[0].entry_id, reason });
      for (const s of slots) failedEvents.set(s.event_id, reason);
    }
  }

  // 6. Close what finished; record the error on what did not.
  const finished = eventIds.filter((id) => !failedEvents.has(id));
  const nowIso = new Date().toISOString();
  for (const id of finished) {
    const n = notifiedPerEvent.get(id) ?? 0;
    const { error } = await admin.from("waitlist_events")
      .update({ processed_at: nowIso, outcome: n > 0 ? `notified:${n}` : "no_match", last_error: null })
      .eq("id", id)
      .is("processed_at", null);
    if (error) console.error("waitlist-dispatch: event close failed", { event_id: id, reason: error.message });
  }
  for (const [id, reason] of failedEvents) {
    await admin.from("waitlist_events").update({ last_error: reason.slice(0, 500) }).eq("id", id);
  }

  return {
    claimed: eventIds.length,
    candidates: candidates.length,
    fitting_hours: fitting.length,
    closed: finished.length,
    left_for_retry: failedEvents.size,
    saturated: eventIds.length >= batchLimit,
    housekeeping: hk?.[0] ?? null,
    ...tally,
  };
}

// ── Entry point ──────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  const startedAt = Date.now();
  try {
    // Fail closed: an unset secret must never mean "open to everyone".
    const expectedSecret = Deno.env.get("CRON_SECRET");
    if (!expectedSecret) {
      console.error("waitlist-dispatch: CRON_SECRET is not configured");
      return reject("cron_secret_not_configured", 500, { error: "Server misconfigured" });
    }
    if (!(await secretMatches(req.headers.get("x-cron-secret") ?? "", expectedSecret))) {
      console.warn("waitlist-dispatch: cron secret rejected", {
        gate: "cron_secret_mismatch",
        status: 401,
        header_present: req.headers.has("x-cron-secret"),
      });
      return reject("cron_secret_mismatch", 401, { error: "Unauthorized" });
    }

    const configured = Number(Deno.env.get("WAITLIST_BATCH_LIMIT"));
    const batchLimit = Number.isFinite(configured) && configured > 0
      ? Math.min(Math.floor(configured), MAX_BATCH_LIMIT)
      : DEFAULT_BATCH_LIMIT;

    const summary = await runDispatch(createAdminClient(), batchLimit);
    console.log("waitlist-dispatch: run complete", { ...summary, latency_ms: Date.now() - startedAt });
    return json(200, { ok: true, ...summary });
  } catch (err) {
    console.error("waitlist-dispatch: run failed", { reason: err instanceof Error ? err.message : String(err) });
    return json(500, { error: "Internal error" });
  }
});
