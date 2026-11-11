// notify-course-registration — the decision logic, free of Deno and network.
//
// index.ts wires the real dependencies (JWT check, service-role reads, the
// course_push_log claim, Web Push). The unit tests (src/lib/
// notifyCourseRegistration.test.ts) wire fakes. No imports on purpose: Vitest
// loads this file directly.
//
// Contract:
//   * The client sends ONLY { registration_id, event }. Any other key — a
//     title, body, url, user id — is refused, so the client can never choose
//     what is pushed or to whom.
//   * The caller (from the verified JWT) must be the party that performs the
//     event: the registration's customer for 'new' / 'cancelled_by_customer',
//     the branch owner for 'confirmed' / 'rejected' / 'cancelled_by_provider'.
//     Anyone else gets REGISTRATION_NOT_FOUND, as the RPCs do, so ids cannot
//     be probed.
//   * The event must match the registration as it is NOW (status and
//     cancelled_by), and must be fresh (within FRESH_MS of the change).
//   * What is pushed is EXACTLY the notifications row the RPC wrote: same
//     recipient, same type, and created_at equal to the registration's
//     created_at ('new') or updated_at (every other event). The RPC inserts
//     that row in the same transaction as the change, and now() is constant
//     inside a transaction, so the two timestamps are identical. This
//     function never inserts a notifications row.
//   * At most one push per registration + event: a course_push_log claim is
//     taken before sending; a second call finds the claim and sends nothing.

export const COURSE_EVENTS = [
  "new",
  "confirmed",
  "rejected",
  "cancelled_by_provider",
  "cancelled_by_customer",
] as const;
export type CourseEvent = (typeof COURSE_EVENTS)[number];

type Party = "customer" | "owner";

interface EventRule {
  /** Who performs the event (must be the caller). */
  actor: Party;
  /** Who receives the push. */
  recipient: Party;
  /** notifications.type the RPC wrote. */
  type: string;
  status: "pending" | "confirmed" | "rejected" | "cancelled";
  cancelledBy: "customer" | "provider" | null;
  /** Which registration timestamp equals the notification's created_at. */
  anchor: "created_at" | "updated_at";
}

export const EVENT_RULES: Record<CourseEvent, EventRule> = {
  new: {
    actor: "customer", recipient: "owner", type: "course_registration_new",
    status: "pending", cancelledBy: null, anchor: "created_at",
  },
  confirmed: {
    actor: "owner", recipient: "customer", type: "course_registration_confirmed",
    status: "confirmed", cancelledBy: null, anchor: "updated_at",
  },
  rejected: {
    actor: "owner", recipient: "customer", type: "course_registration_rejected",
    status: "rejected", cancelledBy: null, anchor: "updated_at",
  },
  cancelled_by_provider: {
    actor: "owner", recipient: "customer", type: "course_registration_cancelled",
    status: "cancelled", cancelledBy: "provider", anchor: "updated_at",
  },
  cancelled_by_customer: {
    actor: "customer", recipient: "owner", type: "course_registration_cancelled",
    status: "cancelled", cancelledBy: "customer", anchor: "updated_at",
  },
};

/** How long after the change a push may still be sent. */
export const FRESH_MS = 10 * 60 * 1000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface RegistrationFacts {
  id: string;
  user_id: string;
  status: string;
  cancelled_by: string | null;
  created_at: string;
  updated_at: string;
  /** provider_profiles.user_id of the registration's branch (null if unowned). */
  owner_id: string | null;
}

export interface NotificationRow {
  id: string;
  title: string;
  body: string | null;
  url: string | null;
}

export interface PushOutcome {
  attempted: number;
  sent: number;
  failed: number;
  skipped?: string;
}

export interface Deps {
  /** Verified user id for the bearer token, or null. */
  getUserId(token: string): Promise<string | null>;
  loadRegistration(id: string): Promise<RegistrationFacts | null>;
  /** The notification with exactly this recipient, type and created_at. */
  findNotification(userId: string, type: string, createdAt: string): Promise<NotificationRow | null>;
  /** Atomic claim; false when this registration + event was already claimed. */
  claim(registrationId: string, event: CourseEvent, notificationId: string): Promise<boolean>;
  push(userId: string, message: { title: string; body: string; url: string }): Promise<PushOutcome>;
  now(): number;
}

export interface HandlerResult {
  status: number;
  body: Record<string, unknown>;
}

const fail = (status: number, error: string): HandlerResult => ({ status, body: { error } });

export function parseRequest(
  raw: unknown,
): { ok: true; registrationId: string; event: CourseEvent } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "INVALID_BODY" };
  const obj = raw as Record<string, unknown>;
  const extra = Object.keys(obj).filter((k) => k !== "registration_id" && k !== "event");
  if (extra.length > 0) return { ok: false, error: "UNEXPECTED_FIELDS" };
  const { registration_id, event } = obj;
  if (typeof registration_id !== "string" || !UUID.test(registration_id)) {
    return { ok: false, error: "INVALID_REGISTRATION_ID" };
  }
  if (typeof event !== "string" || !(COURSE_EVENTS as readonly string[]).includes(event)) {
    return { ok: false, error: "INVALID_EVENT" };
  }
  return { ok: true, registrationId: registration_id, event: event as CourseEvent };
}

/**
 * Authorization + consistency, no I/O. Returns who gets the push and which
 * notification row to repeat, or the refusal.
 */
export function decide(
  reg: RegistrationFacts | null,
  callerId: string,
  event: CourseEvent,
  nowMs: number,
):
  | { ok: true; recipientId: string; type: string; anchor: string }
  | { ok: false; status: number; error: string } {
  if (!reg) return { ok: false, status: 404, error: "REGISTRATION_NOT_FOUND" };
  const rule = EVENT_RULES[event];

  const isCustomer = reg.user_id === callerId;
  const isOwner = reg.owner_id !== null && reg.owner_id === callerId;
  if (!isCustomer && !isOwner) return { ok: false, status: 404, error: "REGISTRATION_NOT_FOUND" };
  const callerIsActor = rule.actor === "customer" ? isCustomer : isOwner;
  if (!callerIsActor) return { ok: false, status: 403, error: "NOT_EVENT_ACTOR" };

  if (reg.status !== rule.status || (reg.cancelled_by ?? null) !== rule.cancelledBy) {
    return { ok: false, status: 409, error: "EVENT_STATUS_MISMATCH" };
  }

  const recipientId = rule.recipient === "customer" ? reg.user_id : reg.owner_id;
  if (!recipientId) return { ok: false, status: 409, error: "NO_RECIPIENT" };

  const anchor = reg[rule.anchor];
  const at = Date.parse(anchor);
  if (!Number.isFinite(at) || nowMs - at > FRESH_MS) {
    return { ok: false, status: 409, error: "STALE_EVENT" };
  }

  return { ok: true, recipientId, type: rule.type, anchor };
}

export async function handleNotify(
  input: { authorization: string | null; body: unknown },
  deps: Deps,
): Promise<HandlerResult> {
  const auth = input.authorization;
  if (!auth?.startsWith("Bearer ")) return fail(401, "UNAUTHORIZED");
  const callerId = await deps.getUserId(auth.slice("Bearer ".length));
  if (!callerId) return fail(401, "UNAUTHORIZED");

  // `=== false` (not `!x.ok`) so the union narrows under the app's
  // non-strict tsconfig too, not only under Deno.
  const req = parseRequest(input.body);
  if (req.ok === false) return fail(400, req.error);

  const reg = await deps.loadRegistration(req.registrationId);
  const verdict = decide(reg, callerId, req.event, deps.now());
  if (verdict.ok === false) return fail(verdict.status, verdict.error);

  const row = await deps.findNotification(verdict.recipientId, verdict.type, verdict.anchor);
  if (!row) return fail(409, "NOTIFICATION_NOT_FOUND");

  const claimed = await deps.claim(req.registrationId, req.event, row.id);
  if (!claimed) return { status: 200, body: { sent: 0, duplicate: true } };

  const result = await deps.push(verdict.recipientId, {
    title: row.title,
    body: row.body ?? "",
    url: row.url ?? "/",
  });
  return { status: 200, body: { ...result, duplicate: false } };
}
