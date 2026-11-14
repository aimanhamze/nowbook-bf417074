import { describe, it, expect, vi } from "vitest";
import {
  COURSE_EVENTS,
  FRESH_MS,
  decide,
  handleNotify,
  parseRequest,
  type CourseEvent,
  type Deps,
  type NotificationRow,
  type RegistrationFacts,
} from "../../supabase/functions/notify-course-registration/handler";

// Logic of the notify-course-registration Edge Function (its handler.ts has no
// Deno or network imports). Real atomicity of the claim comes from the
// course_push_log primary key (VERIFY §B); here the fake claim is a Set.

const REG = "11111111-1111-4111-8111-111111111111";
const CUSTOMER = "c0000000-0000-4000-8000-000000000001";
const OWNER = "00000000-0000-4000-8000-0000000000aa";
const STRANGER = "5e000000-0000-4000-8000-000000000005";
const NOW = Date.parse("2026-11-10T20:00:00Z");
const RECENT = "2026-11-10T19:58:00.123456+00:00";

const reg = (o: Partial<RegistrationFacts> = {}): RegistrationFacts => ({
  id: REG, user_id: CUSTOMER, owner_id: OWNER, status: "pending", cancelled_by: null,
  created_at: RECENT, updated_at: RECENT, ...o,
});

/** The registration as it is right after each event's RPC. */
const after: Record<CourseEvent, Partial<RegistrationFacts>> = {
  new: { status: "pending" },
  confirmed: { status: "confirmed" },
  rejected: { status: "rejected" },
  cancelled_by_provider: { status: "cancelled", cancelled_by: "provider" },
  cancelled_by_customer: { status: "cancelled", cancelled_by: "customer" },
};
const actor: Record<CourseEvent, string> = {
  new: CUSTOMER, confirmed: OWNER, rejected: OWNER, cancelled_by_provider: OWNER, cancelled_by_customer: CUSTOMER,
};
const recipient: Record<CourseEvent, string> = {
  new: OWNER, confirmed: CUSTOMER, rejected: CUSTOMER, cancelled_by_provider: CUSTOMER, cancelled_by_customer: OWNER,
};

function fakeDeps(state: {
  callerId: string | null;
  registration: RegistrationFacts | null;
  notification?: NotificationRow | null;
}) {
  const claims = new Set<string>();
  const notifQueries: Array<[string, string, string]> = [];
  const deps: Deps = {
    getUserId: vi.fn(async () => state.callerId),
    loadRegistration: vi.fn(async () => state.registration),
    findNotification: vi.fn(async (userId, type, createdAt) => {
      notifQueries.push([userId, type, createdAt]);
      return state.notification === undefined
        ? { id: "n-1", title: "RPC title", body: "RPC body", url: "/bookings" }
        : state.notification;
    }),
    claim: vi.fn(async (registrationId, event) => {
      const key = `${registrationId}:${event}`;
      if (claims.has(key)) return false;
      claims.add(key);
      return true;
    }),
    push: vi.fn(async () => ({ attempted: 1, sent: 1, failed: 0 })),
    now: () => NOW,
  };
  return { deps, notifQueries };
}

const call = (deps: Deps, body: unknown, authorization: string | null = "Bearer jwt") =>
  handleNotify({ authorization, body }, deps);

describe("parseRequest: the client sends only registration_id + event", () => {
  it("accepts every known event", () => {
    for (const event of COURSE_EVENTS) {
      expect(parseRequest({ registration_id: REG, event })).toEqual({ ok: true, registrationId: REG, event });
    }
  });

  it("refuses a title, body, url or target from the client", () => {
    for (const extra of ["title", "body", "url", "user_id", "provider_id", "type"]) {
      expect(parseRequest({ registration_id: REG, event: "new", [extra]: "x" })).toEqual({
        ok: false, error: "UNEXPECTED_FIELDS",
      });
    }
  });

  it("refuses unknown events, bad ids and non-objects", () => {
    expect(parseRequest({ registration_id: REG, event: "approved" })).toMatchObject({ error: "INVALID_EVENT" });
    expect(parseRequest({ registration_id: "abc", event: "new" })).toMatchObject({ error: "INVALID_REGISTRATION_ID" });
    expect(parseRequest(null)).toMatchObject({ error: "INVALID_BODY" });
    expect(parseRequest([REG, "new"])).toMatchObject({ error: "INVALID_BODY" });
  });
});

describe("authorization", () => {
  it("no or bad token -> 401, nothing read", async () => {
    const { deps } = fakeDeps({ callerId: null, registration: reg() });
    expect((await call(deps, { registration_id: REG, event: "new" }, null)).status).toBe(401);
    expect((await call(deps, { registration_id: REG, event: "new" }, "Basic x")).status).toBe(401);
    expect((await call(deps, { registration_id: REG, event: "new" })).status).toBe(401);
    expect(deps.loadRegistration).not.toHaveBeenCalled();
    expect(deps.push).not.toHaveBeenCalled();
  });

  it("a stranger gets REGISTRATION_NOT_FOUND for every event (ids cannot be probed)", () => {
    for (const event of COURSE_EVENTS) {
      expect(decide(reg(after[event]), STRANGER, event, NOW)).toEqual({
        ok: false, status: 404, error: "REGISTRATION_NOT_FOUND",
      });
    }
  });

  it("only the party that performs the event may announce it", () => {
    for (const event of COURSE_EVENTS) {
      const other = actor[event] === CUSTOMER ? OWNER : CUSTOMER;
      expect(decide(reg(after[event]), actor[event], event, NOW)).toMatchObject({ ok: true, recipientId: recipient[event] });
      expect(decide(reg(after[event]), other, event, NOW)).toEqual({ ok: false, status: 403, error: "NOT_EVENT_ACTOR" });
    }
  });

  it("an unknown registration -> 404", async () => {
    const { deps } = fakeDeps({ callerId: CUSTOMER, registration: null });
    expect(await call(deps, { registration_id: REG, event: "new" })).toEqual({
      status: 404, body: { error: "REGISTRATION_NOT_FOUND" },
    });
  });
});

describe("event / status consistency", () => {
  it("every event is refused unless the registration is in that event's state", () => {
    for (const event of COURSE_EVENTS) {
      for (const state of COURSE_EVENTS) {
        if (state === event) continue;
        const verdict = decide(reg(after[state]), actor[event], event, NOW);
        // 'new' and 'cancelled_by_customer' share the customer; the owner
        // events share the owner — so the refusal is the status mismatch,
        // not the actor check.
        if (verdict.ok === false && verdict.error === "NOT_EVENT_ACTOR") continue;
        expect(verdict).toEqual({ ok: false, status: 409, error: "EVENT_STATUS_MISMATCH" });
      }
    }
  });

  it("cancelled_by must match: a customer cancel cannot be pushed as a provider cancel, and vice versa", () => {
    expect(decide(reg(after.cancelled_by_customer), OWNER, "cancelled_by_provider", NOW)).toMatchObject({
      error: "EVENT_STATUS_MISMATCH",
    });
    expect(decide(reg(after.cancelled_by_provider), CUSTOMER, "cancelled_by_customer", NOW)).toMatchObject({
      error: "EVENT_STATUS_MISMATCH",
    });
  });

  it("an old change is not pushed", () => {
    const old = new Date(NOW - FRESH_MS - 1000).toISOString();
    expect(decide(reg({ ...after.confirmed, updated_at: old }), OWNER, "confirmed", NOW)).toMatchObject({
      error: "STALE_EVENT",
    });
  });

  it("an unowned branch has no recipient for owner-bound events", () => {
    expect(decide(reg({ owner_id: null }), CUSTOMER, "new", NOW)).toMatchObject({ error: "NO_RECIPIENT" });
  });
});

describe("what is pushed", () => {
  it("looks up the RPC's row by recipient, type and the exact registration timestamp", async () => {
    const created = "2026-11-10T19:55:00.000001+00:00";
    const updated = "2026-11-10T19:59:00.000002+00:00";
    const cases: Array<[CourseEvent, string, string]> = [
      ["new", "course_registration_new", created],
      ["confirmed", "course_registration_confirmed", updated],
      ["rejected", "course_registration_rejected", updated],
      ["cancelled_by_provider", "course_registration_cancelled", updated],
      ["cancelled_by_customer", "course_registration_cancelled", updated],
    ];
    for (const [event, type, anchor] of cases) {
      const { deps, notifQueries } = fakeDeps({
        callerId: actor[event],
        registration: reg({ ...after[event], created_at: created, updated_at: updated }),
      });
      await call(deps, { registration_id: REG, event });
      expect(notifQueries).toEqual([[recipient[event], type, anchor]]);
    }
  });

  it("pushes exactly the row's title/body/url to the recipient", async () => {
    const { deps } = fakeDeps({
      callerId: OWNER,
      registration: reg(after.confirmed),
      notification: { id: "n-9", title: "ההרשמה לקורס אושרה ✅", body: "ההרשמה שלך לקורס X אושרה", url: "/bookings" },
    });
    const res = await call(deps, { registration_id: REG, event: "confirmed" });
    expect(res.status).toBe(200);
    expect(deps.push).toHaveBeenCalledWith(CUSTOMER, {
      title: "ההרשמה לקורס אושרה ✅", body: "ההרשמה שלך לקורס X אושרה", url: "/bookings",
    });
  });

  it("no matching notification row -> nothing claimed, nothing pushed", async () => {
    const { deps } = fakeDeps({ callerId: OWNER, registration: reg(after.confirmed), notification: null });
    expect(await call(deps, { registration_id: REG, event: "confirmed" })).toEqual({
      status: 409, body: { error: "NOTIFICATION_NOT_FOUND" },
    });
    expect(deps.claim).not.toHaveBeenCalled();
    expect(deps.push).not.toHaveBeenCalled();
  });

  it("a refused request never pushes", async () => {
    const { deps } = fakeDeps({ callerId: STRANGER, registration: reg(after.confirmed) });
    await call(deps, { registration_id: REG, event: "confirmed" });
    expect(deps.findNotification).not.toHaveBeenCalled();
    expect(deps.push).not.toHaveBeenCalled();
  });
});

describe("no duplicates", () => {
  it("the same registration + event is pushed once, however often it is called", async () => {
    const { deps } = fakeDeps({ callerId: OWNER, registration: reg(after.confirmed) });
    const first = await call(deps, { registration_id: REG, event: "confirmed" });
    const second = await call(deps, { registration_id: REG, event: "confirmed" });
    expect(first.body).toMatchObject({ sent: 1, duplicate: false });
    expect(second).toEqual({ status: 200, body: { sent: 0, duplicate: true } });
    expect(deps.push).toHaveBeenCalledTimes(1);
  });

  it("concurrent calls push once", async () => {
    const { deps } = fakeDeps({ callerId: CUSTOMER, registration: reg(after.new) });
    const results = await Promise.all(
      Array.from({ length: 5 }, () => call(deps, { registration_id: REG, event: "new" })),
    );
    expect(results.filter((r) => r.body.duplicate === false)).toHaveLength(1);
    expect(deps.push).toHaveBeenCalledTimes(1);
  });

  it("a different event on the same registration is its own push", async () => {
    const state = { callerId: CUSTOMER as string | null, registration: reg(after.new) };
    const { deps } = fakeDeps(state);
    await call(deps, { registration_id: REG, event: "new" });
    state.registration = reg(after.cancelled_by_customer);
    await call(deps, { registration_id: REG, event: "cancelled_by_customer" });
    expect(deps.push).toHaveBeenCalledTimes(2);
  });
});
