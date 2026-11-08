/**
 * Push payloads for the four course notification types.
 *
 * The in-app `notifications` rows are written by the registration RPCs
 * themselves (migration 20261108000006). A push is ONLY a delivery of the same
 * message to the device, so these payloads repeat the RPCs' exact title, body,
 * link and type — a push and its bell row always read the same — and nothing
 * here inserts a row.
 *
 * Who gets it:
 *   new                    -> branch owner   (customer registered)
 *   cancelled_by_customer  -> branch owner
 *   confirmed / rejected   -> customer       (owner decided)
 *   cancelled_by_provider  -> customer
 */

export type CoursePushEvent =
  | "new"
  | "confirmed"
  | "rejected"
  | "cancelled_by_customer"
  | "cancelled_by_provider";

export type CoursePushType =
  | "course_registration_new"
  | "course_registration_confirmed"
  | "course_registration_rejected"
  | "course_registration_cancelled";

export type CoursePushTarget = { kind: "provider"; providerId: string } | { kind: "user"; userId: string };

export interface CoursePush {
  target: CoursePushTarget;
  title: string;
  body: string;
  url: string;
  type: CoursePushType;
}

export interface CoursePushContext {
  courseName: string;
  /** provider_profiles.id of the course's branch. */
  providerId: string;
  /** The registering customer's auth user id. */
  customerUserId: string;
}

export function buildCoursePush(event: CoursePushEvent, ctx: CoursePushContext): CoursePush {
  const name = ctx.courseName;
  const toProvider: CoursePushTarget = { kind: "provider", providerId: ctx.providerId };
  const toCustomer: CoursePushTarget = { kind: "user", userId: ctx.customerUserId };
  switch (event) {
    case "new":
      return {
        target: toProvider,
        title: "בקשת הרשמה חדשה לקורס",
        body: `לקוח ביקש להירשם לקורס ${name}`,
        url: "/dashboard",
        type: "course_registration_new",
      };
    case "confirmed":
      return {
        target: toCustomer,
        title: "ההרשמה לקורס אושרה ✅",
        body: `ההרשמה שלך לקורס ${name} אושרה`,
        url: "/bookings",
        type: "course_registration_confirmed",
      };
    case "rejected":
      return {
        target: toCustomer,
        title: "בקשת ההרשמה לקורס נדחתה",
        body: `בקשת ההרשמה שלך לקורס ${name} נדחתה`,
        url: "/bookings",
        type: "course_registration_rejected",
      };
    case "cancelled_by_customer":
      return {
        target: toProvider,
        title: "הרשמה לקורס בוטלה ❌",
        body: `לקוח ביטל את ההרשמה לקורס ${name}`,
        url: "/dashboard",
        type: "course_registration_cancelled",
      };
    case "cancelled_by_provider":
      return {
        target: toCustomer,
        title: "ההרשמה לקורס בוטלה ❌",
        body: `ההרשמה שלך לקורס ${name} בוטלה על ידי הספק`,
        url: "/bookings",
        type: "course_registration_cancelled",
      };
  }
}

/** The request body send-push expects (delivery-only, provider-addressed). */
export function sendPushBody(push: CoursePush & { target: { kind: "provider"; providerId: string } }) {
  return {
    provider_id: push.target.providerId,
    title: push.title,
    body: push.body,
    url: push.url,
    type: push.type,
  };
}
