import { describe, it, expect, vi, beforeEach } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke } } }));

import { deliverCoursePush } from "./academyPushDelivery";

const ctx = { courseName: "Yoga", providerId: "prov-1", customerUserId: "user-9" };
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("deliverCoursePush", () => {
  beforeEach(() => {
    invoke.mockReset();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
  });

  it("provider-bound: one send-push call with the provider-addressed body", async () => {
    invoke.mockResolvedValue({ error: null });
    deliverCoursePush("new", ctx);
    await flush();
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("send-push", {
      body: {
        provider_id: "prov-1",
        title: "בקשת הרשמה חדשה לקורס",
        body: "לקוח ביקש להירשם לקורס Yoga",
        url: "/dashboard",
        type: "course_registration_new",
      },
    });
  });

  it("never throws, even when the function errors or the call rejects", async () => {
    invoke.mockResolvedValueOnce({ error: { message: "boom" } });
    expect(() => deliverCoursePush("cancelled_by_customer", ctx)).not.toThrow();
    invoke.mockRejectedValueOnce(new Error("network"));
    expect(() => deliverCoursePush("new", ctx)).not.toThrow();
    await flush();
    expect(console.warn).toHaveBeenCalled();
  });

  it("customer-bound: no call (transport pending) and never notify-user, which would duplicate the RPC's row", async () => {
    deliverCoursePush("confirmed", ctx);
    deliverCoursePush("rejected", ctx);
    deliverCoursePush("cancelled_by_provider", ctx);
    await flush();
    expect(invoke).not.toHaveBeenCalled();
  });
});
