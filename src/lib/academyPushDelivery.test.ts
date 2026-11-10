import { describe, it, expect, vi, beforeEach } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke } } }));

import { deliverCoursePush, type CoursePushEvent } from "./academyPushDelivery";

const REG = "11111111-1111-4111-8111-111111111111";
const flush = () => new Promise((r) => setTimeout(r, 0));
const EVENTS: CoursePushEvent[] = ["new", "confirmed", "rejected", "cancelled_by_customer", "cancelled_by_provider"];

describe("deliverCoursePush", () => {
  beforeEach(() => {
    invoke.mockReset();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("every event: one notify-course-registration call with ONLY registration_id + event", async () => {
    invoke.mockResolvedValue({ error: null });
    for (const event of EVENTS) deliverCoursePush(event, REG);
    await flush();
    expect(invoke).toHaveBeenCalledTimes(EVENTS.length);
    EVENTS.forEach((event, i) => {
      expect(invoke.mock.calls[i]).toEqual([
        "notify-course-registration",
        { body: { registration_id: REG, event } },
      ]);
    });
  });

  it("never uses notify-user or send-push for courses", async () => {
    invoke.mockResolvedValue({ error: null });
    for (const event of EVENTS) deliverCoursePush(event, REG);
    await flush();
    const names = invoke.mock.calls.map((c) => c[0]);
    expect(names).not.toContain("notify-user");
    expect(names).not.toContain("send-push");
  });

  it("never throws, even when the function errors or the call rejects", async () => {
    invoke.mockResolvedValueOnce({ error: { message: "boom" } });
    expect(() => deliverCoursePush("cancelled_by_customer", REG)).not.toThrow();
    invoke.mockRejectedValueOnce(new Error("network"));
    expect(() => deliverCoursePush("new", REG)).not.toThrow();
    await flush();
    expect(console.warn).toHaveBeenCalledTimes(2);
  });
});
