import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildCoursePush, sendPushBody, type CoursePushEvent } from "./academyPush";

const ctx = { courseName: "Yoga 101", providerId: "prov-1", customerUserId: "user-9" };

describe("buildCoursePush", () => {
  it("new registration -> branch owner", () => {
    expect(buildCoursePush("new", ctx)).toEqual({
      target: { kind: "provider", providerId: "prov-1" },
      title: "בקשת הרשמה חדשה לקורס",
      body: "לקוח ביקש להירשם לקורס Yoga 101",
      url: "/dashboard",
      type: "course_registration_new",
    });
  });

  it.each<[CoursePushEvent, string, "provider" | "user"]>([
    ["confirmed", "course_registration_confirmed", "user"],
    ["rejected", "course_registration_rejected", "user"],
    ["cancelled_by_customer", "course_registration_cancelled", "provider"],
    ["cancelled_by_provider", "course_registration_cancelled", "user"],
  ])("%s -> type %s to the %s side", (event, type, side) => {
    const push = buildCoursePush(event, ctx);
    expect(push.type).toBe(type);
    expect(push.target.kind).toBe(side);
    if (push.target.kind === "user") expect(push.target.userId).toBe("user-9");
    else expect(push.target.providerId).toBe("prov-1");
    expect(push.body).toContain("Yoga 101");
  });

  it("customer-bound pushes open /bookings, provider-bound open /dashboard", () => {
    expect(buildCoursePush("confirmed", ctx).url).toBe("/bookings");
    expect(buildCoursePush("cancelled_by_provider", ctx).url).toBe("/bookings");
    expect(buildCoursePush("cancelled_by_customer", ctx).url).toBe("/dashboard");
  });

  it("sendPushBody is exactly what send-push reads", () => {
    const push = buildCoursePush("new", ctx);
    if (push.target.kind !== "provider") throw new Error("expected provider target");
    expect(sendPushBody(push as Parameters<typeof sendPushBody>[0])).toEqual({
      provider_id: "prov-1",
      title: "בקשת הרשמה חדשה לקורס",
      body: "לקוח ביקש להירשם לקורס Yoga 101",
      url: "/dashboard",
      type: "course_registration_new",
    });
  });

  // A push must read like its bell row. The rows are written by the RPCs, so
  // every title, body template and link here must appear verbatim in the
  // migration that defines them.
  it("matches the in-app rows the registration RPCs insert", () => {
    const sql = readFileSync(
      resolve(__dirname, "../../supabase/migrations/20261108000006_course_registration_rpcs.sql"),
      "utf8",
    );
    const events: CoursePushEvent[] = ["new", "confirmed", "rejected", "cancelled_by_customer", "cancelled_by_provider"];
    for (const event of events) {
      const push = buildCoursePush(event, { ...ctx, courseName: "%s" });
      expect(sql, `${event} title`).toContain(`'${push.title}'`);
      expect(sql, `${event} body`).toContain(`'${push.body}'`);
      expect(sql, `${event} url`).toContain(`'${push.url}'`);
      expect(sql, `${event} type`).toContain(`'${push.type}'`);
    }
  });
});
