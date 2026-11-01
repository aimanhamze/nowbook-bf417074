// Unit tests for waitlist-dispatch's pure helpers. Run from the repo root:
//   deno test --no-lock --allow-env supabase/functions/waitlist-dispatch/
// (--no-lock: the root deno.lock is tracked and deno would rewrite it.)
//
// No network and no database. The SQL half (claim, match, slot-open, round
// claim) is covered by the migration's VERIFY §B; this covers what happens in
// TypeScript: the rollout gate, phone handling, language choice, copy, the
// exact SendPulse payload, and the opening-hours gate built on the shared
// resolver.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";

// index.ts calls Deno.serve at module scope. Stub it BEFORE the dynamic import
// so loading the module under test does not open a port.
// deno-lint-ignore no-explicit-any
(Deno as any).serve = () => ({ finished: Promise.resolve(), shutdown: () => Promise.resolve(), ref() {}, unref() {} });

const mod = await import("./index.ts");
const {
  TEMPLATES,
  maskPhone,
  secretMatches,
  toSendPulsePhone,
  looseDigits,
  parseAllowlist,
  isAllowlisted,
  formatSlotDate,
  formatSlotTime,
  whatsappLanguage,
  notifyLanguage,
  bellText,
  buildTemplatePayload,
  whatsappSkipCode,
  whatsappConfigured,
  slotFitsHours,
  groupByEntry,
} = mod;
type HoursContext = import("./index.ts").HoursContext;
type Candidate = import("./index.ts").Candidate;

// ── Rollout gate ─────────────────────────────────────────────────────────────

Deno.test("allowlist: unset, empty and blank mean nobody", () => {
  for (const raw of [undefined, null, "", "   ", " , ; "]) {
    const list = parseAllowlist(raw);
    assertFalse(isAllowlisted(list, "972501234567"), `raw=${JSON.stringify(raw)}`);
    assertFalse(isAllowlisted(list, null));
  }
});

Deno.test("allowlist: '*' means everyone, including customers with no phone", () => {
  const list = parseAllowlist(" * ");
  assert(isAllowlisted(list, "972501234567"));
  assert(isAllowlisted(list, null));
});

Deno.test("allowlist: every written form of a number matches, others do not", () => {
  const list = parseAllowlist("050-123-4567; +972 52 765 4321,00972537777777\n054 999 9999");
  for (const phone of ["972501234567", "972527654321", "972537777777", "972549999999"]) {
    assert(isAllowlisted(list, phone), phone);
  }
  assertFalse(isAllowlisted(list, "972501111111"));
  assertFalse(isAllowlisted(list, null), "a phoneless customer is never on a list");
});

Deno.test("looseDigits: 00972 keeps the country code (the reminder's copy drops it)", () => {
  assertEquals(looseDigits("00972501234567"), "972501234567");
  assertEquals(looseDigits("+972501234567"), "972501234567");
  assertEquals(looseDigits("0501234567"), "972501234567");
  assertEquals(looseDigits("501234567"), "972501234567");
  assertEquals(looseDigits(""), "");
});

Deno.test("toSendPulsePhone: Israeli mobile/VoIP shapes only", () => {
  assertEquals(toSendPulsePhone("050-123-4567"), "972501234567");
  assertEquals(toSendPulsePhone("+972 50 123 4567"), "972501234567");
  assertEquals(toSendPulsePhone("00972501234567"), "972501234567");
  assertEquals(toSendPulsePhone("0721234567"), "972721234567");
  assertEquals(toSendPulsePhone("021234567"), null, "landline");
  assertEquals(toSendPulsePhone("05012345"), null, "too short");
  assertEquals(toSendPulsePhone(null), null);
});

Deno.test("maskPhone shows the last 4 digits only", () => {
  assertEquals(maskPhone("972501234567"), "***4567");
  assertEquals(maskPhone("123"), "****");
  assertEquals(maskPhone(null), "****");
});

Deno.test("secretMatches: equal only for the exact secret", async () => {
  assert(await secretMatches("s3cret", "s3cret"));
  assertFalse(await secretMatches("s3cre", "s3cret"));
  assertFalse(await secretMatches("", "s3cret"));
});

// ── Language and copy ────────────────────────────────────────────────────────

Deno.test("WhatsApp language follows the provider; anything but 'ar' is Hebrew", () => {
  assertEquals(whatsappLanguage("ar"), "ar");
  assertEquals(whatsappLanguage("he"), "he");
  assertEquals(whatsappLanguage("en"), "he", "there is no English template");
  assertEquals(whatsappLanguage(null), "he");
  assertEquals(TEMPLATES.he, { name: "waitlist_slot_available_hebrew", languageCode: "he" });
  assertEquals(TEMPLATES.ar, { name: "waitlist_slot_available_arabic", languageCode: "ar" });
});

Deno.test("bell/push language: notify_lang, then the provider's WhatsApp language, then Hebrew", () => {
  assertEquals(notifyLanguage("en", "ar"), "en");
  assertEquals(notifyLanguage("he", "ar"), "he");
  assertEquals(notifyLanguage("ar", "he"), "ar");
  assertEquals(notifyLanguage(null, "ar"), "ar");
  assertEquals(notifyLanguage(null, "he"), "he");
  assertEquals(notifyLanguage(null, null), "he");
  assertEquals(notifyLanguage("fr", "ar"), "ar", "an unknown value is treated as unset");
});

Deno.test("bell copy: approved wording in all three languages", () => {
  assertEquals(bellText("he", "מספרה", "06/11/2026", "14:30"), {
    title: "התפנה תור ב־מספרה",
    body: "06/11/2026 בשעה 14:30. התור למי שמזמין ראשון.",
  });
  assertEquals(bellText("ar", "صالون", "06/11/2026", "14:30"), {
    title: "تفرّغ موعد في صالون",
    body: "06/11/2026 الساعة 14:30. الموعد لمن يحجز أولاً.",
  });
  assertEquals(bellText("en", "Salon", "06/11/2026", "14:30"), {
    title: "A slot opened up at Salon",
    body: "06/11/2026 at 14:30. First to book gets it.",
  });
});

Deno.test("English copy contains no Hebrew or Arabic letters", () => {
  const { title, body } = bellText("en", "Salon", "06/11/2026", "14:30");
  assertFalse(/[֐-׿؀-ۿ]/.test(title + body));
});

Deno.test("date and time formats", () => {
  assertEquals(formatSlotDate("2026-11-06"), "06/11/2026");
  assertEquals(formatSlotDate("bad"), null);
  assertEquals(formatSlotTime("09:05"), "09:05");
  assertEquals(formatSlotTime("9:05"), null);
});

// ── SendPulse payload ────────────────────────────────────────────────────────

Deno.test("template payload: exact body, language and URL button", () => {
  const providerId = "8d1f6c3a-0000-4000-8000-000000000001";
  const payload = buildTemplatePayload(
    "bot-123",
    "972501234567",
    TEMPLATES.he,
    ["דנה", "מספרה", "06/11/2026", "14:30"],
    providerId,
  );
  assertEquals(payload, {
    bot_id: "bot-123",
    phone: "972501234567",
    template: {
      name: "waitlist_slot_available_hebrew",
      language: { policy: "deterministic", code: "he" },
      components: [
        {
          type: "body",
          parameters: [
            { type: "text", text: "דנה" },
            { type: "text", text: "מספרה" },
            { type: "text", text: "06/11/2026" },
            { type: "text", text: "14:30" },
          ],
        },
        { type: "button", sub_type: "url", index: 0, parameters: [{ type: "text", text: providerId }] },
      ],
    },
  });
});

// ── WhatsApp skip ────────────────────────────────────────────────────────────

Deno.test("whatsapp skip: customer data first, then config; null = attempt", () => {
  assertEquals(whatsappSkipCode(null, "דנה", true), "INVALID_PHONE");
  assertEquals(whatsappSkipCode(null, "", false), "INVALID_PHONE");
  assertEquals(whatsappSkipCode("972501234567", "", true), "NO_NAME");
  assertEquals(whatsappSkipCode("972501234567", "", false), "NO_NAME");
  assertEquals(whatsappSkipCode("972501234567", "דנה", false), "WHATSAPP_NOT_CONFIGURED");
  assertEquals(whatsappSkipCode("972501234567", "דנה", true), null);
});

Deno.test("whatsapp configured: needs a full credential pair AND SENDPULSE_BOT_ID", () => {
  const names = ["SENDPULSE_CLIENT_ID", "SENDPULSE_CLIENT_SECRET", "client_id", "client_secret", "SENDPULSE_BOT_ID"];
  const saved = new Map(names.map((n) => [n, Deno.env.get(n)]));
  const set = (vars: Record<string, string>) => {
    for (const n of names) Deno.env.delete(n);
    for (const [k, v] of Object.entries(vars)) Deno.env.set(k, v);
  };
  try {
    set({});
    assertFalse(whatsappConfigured(), "nothing set (DEV)");
    set({ SENDPULSE_CLIENT_ID: "id", SENDPULSE_CLIENT_SECRET: "secret" });
    assertFalse(whatsappConfigured(), "no bot id — would send bot_id: undefined");
    set({ SENDPULSE_BOT_ID: "bot" });
    assertFalse(whatsappConfigured(), "bot id without credentials");
    set({ SENDPULSE_CLIENT_ID: "id", SENDPULSE_BOT_ID: "bot" });
    assertFalse(whatsappConfigured(), "half a credential pair");
    set({ SENDPULSE_CLIENT_ID: "id", SENDPULSE_CLIENT_SECRET: "secret", SENDPULSE_BOT_ID: "bot" });
    assert(whatsappConfigured());
    set({ client_id: "id", client_secret: "secret", SENDPULSE_BOT_ID: "bot" });
    assert(whatsappConfigured(), "the bare client_id / client_secret names");
  } finally {
    for (const [n, v] of saved) v === undefined ? Deno.env.delete(n) : Deno.env.set(n, v);
  }
});

// ── Opening-hours gate ───────────────────────────────────────────────────────

// 2026-11-06 is a Friday (day_of_week 5); 2026-11-08 a Sunday (0).
function ctx(overrides: Partial<HoursContext> = {}): HoursContext {
  return {
    settings: { availability_mode: "weekly", monthly_default_available: true, monthly_default_start: "09:00", monthly_default_end: "17:00" },
    weeklyRows: [
      { day_of_week: 5, start_time: "09:00", end_time: "14:00", is_available: true, break_start: null, break_end: null },
      { day_of_week: 0, start_time: "09:00", end_time: "19:00", is_available: true, break_start: "13:00", break_end: "14:00" },
    ],
    blockedDates: [],
    overrides: [],
    slotInterval: 15,
    staffHours: new Map(),
    staffTimeOff: new Map(),
    ...overrides,
  };
}

Deno.test("hours: inside the window and on the grid is offered", () => {
  assertEquals(slotFitsHours(ctx(), "2026-11-06", "10:00", 30, null, null), { ok: true });
  assertEquals(slotFitsHours(ctx(), "2026-11-06", "13:30", 30, null, null), { ok: true }, "ends exactly at closing");
});

Deno.test("hours: before opening, running past closing, a closed weekday", () => {
  assertEquals(slotFitsHours(ctx(), "2026-11-06", "08:45", 30, null, null), { ok: false, reason: "OUTSIDE_HOURS" });
  assertEquals(slotFitsHours(ctx(), "2026-11-06", "13:45", 30, null, null), { ok: false, reason: "OUTSIDE_HOURS" });
  assertEquals(slotFitsHours(ctx(), "2026-11-07", "10:00", 30, null, null), { ok: false, reason: "CLOSED" });
});

Deno.test("hours: blocked date closes the day", () => {
  assertEquals(
    slotFitsHours(ctx({ blockedDates: ["2026-11-06"] }), "2026-11-06", "10:00", 30, null, null),
    { ok: false, reason: "CLOSED" },
  );
});

Deno.test("hours: off the provider's slot grid is not offered", () => {
  assertEquals(slotFitsHours(ctx(), "2026-11-06", "10:10", 30, null, null), { ok: false, reason: "OFF_GRID" });
  assertEquals(slotFitsHours(ctx({ slotInterval: 30 }), "2026-11-06", "10:15", 30, null, null), { ok: false, reason: "OFF_GRID" });
  assertEquals(slotFitsHours(ctx({ slotInterval: 30 }), "2026-11-06", "10:30", 30, null, null), { ok: true });
});

Deno.test("hours: starting inside the break is not offered; ending in it is", () => {
  assertEquals(slotFitsHours(ctx(), "2026-11-08", "13:00", 30, null, null), { ok: false, reason: "IN_BREAK" });
  assertEquals(slotFitsHours(ctx(), "2026-11-08", "13:45", 30, null, null), { ok: false, reason: "IN_BREAK" });
  assertEquals(slotFitsHours(ctx(), "2026-11-08", "12:45", 30, null, null), { ok: true }, "page checks the start only");
  assertEquals(slotFitsHours(ctx(), "2026-11-08", "14:00", 30, null, null), { ok: true });
});

Deno.test("hours: the service's latest_start_time", () => {
  assertEquals(slotFitsHours(ctx(), "2026-11-06", "12:00", 30, "11:30", null), { ok: false, reason: "AFTER_LATEST_START" });
  assertEquals(slotFitsHours(ctx(), "2026-11-06", "11:30", 30, "11:30:00", null), { ok: true });
});

Deno.test("hours: monthly mode uses the override for the date", () => {
  const monthly = ctx({
    settings: { availability_mode: "monthly", monthly_default_available: true, monthly_default_start: "09:00", monthly_default_end: "17:00" },
    overrides: [{ override_date: "2026-11-06", is_available: true, start_time: "15:00", end_time: "20:00", break_start: null, break_end: null }],
  });
  assertEquals(slotFitsHours(monthly, "2026-11-06", "10:00", 30, null, null), { ok: false, reason: "OUTSIDE_HOURS" });
  assertEquals(slotFitsHours(monthly, "2026-11-06", "18:00", 30, null, null), { ok: true });
  assertEquals(slotFitsHours(monthly, "2026-11-07", "10:00", 30, null, null), { ok: true }, "no override → monthly default");
});

Deno.test("hours: staff lane narrows to the member's hours; the grid starts at the narrowed open", () => {
  const staffed = ctx({
    staffHours: new Map([["X", new Map([[5, { day_of_week: 5, start_time: "10:10", end_time: "12:00", is_available: true }]])]]),
  });
  assertEquals(slotFitsHours(staffed, "2026-11-06", "09:30", 30, null, "X"), { ok: false, reason: "OUTSIDE_HOURS" });
  assertEquals(slotFitsHours(staffed, "2026-11-06", "10:10", 30, null, "X"), { ok: true });
  assertEquals(slotFitsHours(staffed, "2026-11-06", "10:15", 30, null, "X"), { ok: false, reason: "OFF_GRID" });
  assertEquals(slotFitsHours(staffed, "2026-11-06", "11:40", 30, null, "X"), { ok: false, reason: "OUTSIDE_HOURS" });
  // A member with no rows works all shop hours; no lane ignores staff rows.
  assertEquals(slotFitsHours(staffed, "2026-11-06", "09:30", 30, null, "Y"), { ok: true });
  assertEquals(slotFitsHours(staffed, "2026-11-06", "09:30", 30, null, null), { ok: true });
});

Deno.test("hours: a configured member missing that weekday is off; time off closes their day", () => {
  const staffed = ctx({
    staffHours: new Map([["X", new Map([[0, { day_of_week: 0, start_time: "09:00", end_time: "19:00", is_available: true }]])]]),
    staffTimeOff: new Map([["Y", new Set(["2026-11-06"])]]),
  });
  assertEquals(slotFitsHours(staffed, "2026-11-06", "10:00", 30, null, "X"), { ok: false, reason: "CLOSED" });
  assertEquals(slotFitsHours(staffed, "2026-11-06", "10:00", 30, null, "Y"), { ok: false, reason: "CLOSED" });
  assertEquals(slotFitsHours(staffed, "2026-11-06", "10:00", 30, null, "W"), { ok: true });
});

// ── Grouping ─────────────────────────────────────────────────────────────────

Deno.test("one entry, several freed slots: earliest first", () => {
  const base: Candidate = {
    entry_id: "E1", user_id: "U1", event_id: 1, freed_booking_id: null, provider_id: "P",
    slot_date: "2026-11-06", slot_time: "12:00", staff_lane: null, service_id: "S",
    service_duration: 30, latest_start_time: null, next_round: 1, notify_lang: null,
  };
  const groups = groupByEntry([
    { ...base, event_id: 3, slot_time: "16:00" },
    { ...base, event_id: 2, slot_time: "09:30" },
    { ...base, entry_id: "E2", event_id: 4, slot_time: "11:00" },
    { ...base, event_id: 5, slot_time: "09:30" },
  ]);
  assertEquals(groups.size, 2);
  assertEquals(groups.get("E1")!.map((c) => [c.slot_time, c.event_id]), [["09:30", 2], ["09:30", 5], ["16:00", 3]]);
  assertEquals(groups.get("E2")!.map((c) => c.event_id), [4]);
});
