import { describe, expect, it } from "vitest";
import type { Tables } from "@/integrations/supabase/types";
import type { Provider } from "@/lib/mock-data";
import { bookingActionState } from "./bookingActions";

const NOW = new Date("2030-01-01T08:00:00");

const booking = (over: Partial<Tables<"bookings">> = {}) =>
  ({
    id: "b",
    booking_date: "2030-01-02",
    booking_time: "10:00",
    status: "confirmed",
    class_schedule_id: null,
    ...over,
  }) as Tables<"bookings">;

const provider = (over: Partial<Provider> = {}) =>
  ({ allowCustomerReschedule: true, category: "salon", ...over }) as Provider;

const state = (b: Tables<"bookings">, opts: { linked?: boolean; hours?: number; p?: Provider | null } = {}) =>
  bookingActionState({
    booking: b,
    linkedWalkin: opts.linked ?? false,
    cancellationNoticeHours: opts.hours ?? 5,
    provider: opts.p === undefined ? provider() : opts.p,
    now: NOW,
  });

describe("bookingActionState", () => {
  it("outside the cutoff: cancel and reschedule", () => {
    expect(state(booking())).toMatchObject({ isActive: true, canCancel: true, canCallToCancel: false, canReschedule: true });
  });

  it("inside the cutoff: call-to-cancel only", () => {
    const s = state(booking({ booking_date: "2030-01-01", booking_time: "11:00" }));
    expect(s).toMatchObject({ canCancel: false, canCallToCancel: true, canReschedule: false });
  });

  it("a cutoff of 0 is always cancellable while active", () => {
    const s = state(booking({ booking_date: "2030-01-01", booking_time: "08:30" }), { hours: 0 });
    expect(s).toMatchObject({ canCancel: true, canCallToCancel: false });
  });

  it("linked walk-ins get no cancel affordance at all", () => {
    expect(state(booking(), { linked: true })).toMatchObject({ isActive: true, canCancel: false, canCallToCancel: false, canReschedule: false });
  });

  it("pending: cancel yes, reschedule no", () => {
    expect(state(booking({ status: "pending" }))).toMatchObject({ canCancel: true, canReschedule: false });
  });

  it("classes, studios and opted-out providers cannot reschedule", () => {
    expect(state(booking({ class_schedule_id: "c" })).canReschedule).toBe(false);
    expect(state(booking(), { p: provider({ category: "fitness_studio" }) }).canReschedule).toBe(false);
    expect(state(booking(), { p: provider({ allowCustomerReschedule: false }) }).canReschedule).toBe(false);
    expect(state(booking(), { p: null }).canReschedule).toBe(false);
  });

  it("past or cancelled bookings offer nothing", () => {
    expect(state(booking({ booking_date: "2029-12-31" }))).toMatchObject({ isPast: true, isActive: false, canCancel: false });
    expect(state(booking({ status: "cancelled" }))).toMatchObject({ isActive: false, canCancel: false, canCallToCancel: false });
  });
});
