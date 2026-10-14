// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { buildCalendarItems } from "./CalendarTab";
import type { EnrichedBooking } from "@/hooks/useProviderBookings";
import type { ClassScheduleEntry } from "@/hooks/useProviderClassSchedule";

/**
 * Fitness-studio class bookings must never vanish from the provider calendar.
 * Before the fix, only bookings matching an ACTIVE schedule row for that
 * weekday rendered; every other class booking was dropped by a
 * `!class_schedule_id` filter while still holding its spot.
 */

// 2026-10-18 is a Sunday (day_of_week 0).
const SUNDAY = new Date(2026, 9, 18);
const DATE = "2026-10-18";

const cls = (over: Partial<ClassScheduleEntry> = {}): ClassScheduleEntry => ({
  id: "cls-1",
  provider_id: "pp",
  day_of_week: 0,
  start_time: "18:00:00",
  duration_minutes: 50,
  class_name: "Pilates",
  class_type: "group",
  max_capacity: 10,
  is_active: true,
  color: "#f97316",
  created_at: null,
  updated_at: null,
  ...over,
});

let n = 0;
const booking = (over: Partial<EnrichedBooking> = {}): EnrichedBooking => ({
  id: `b-${++n}`,
  user_id: "u",
  linked_user_id: null,
  provider_id: "pp",
  service_ids: [],
  booking_date: DATE,
  booking_time: "18:00",
  total_price: 0,
  status: "confirmed",
  treatment_notes: null,
  customer_notes: null,
  created_at: "",
  updated_at: "",
  customer_name: "Dana",
  customer_phone: null,
  customer_avatar: null,
  service_names: [],
  is_group_service: false,
  service_capacity: 1,
  class_schedule_id: "cls-1",
  class_name: "Pilates",
  class_entry: cls(),
  staff_id: null,
  staff_name: null,
  duration_override: null,
  check_in_at: null,
  customer_package_id: "pkg",
  package_name: null,
  package_entries_remaining: null,
  package_total_entries: null,
  ...over,
});

const build = (bookings: EnrichedBooking[], schedule: ClassScheduleEntry[]) =>
  buildCalendarItems(SUNDAY, bookings, schedule, true, "group");

/** Every booking id the calendar renders for the day, in any item shape. */
const renderedIds = (items: ReturnType<typeof build>) =>
  items.flatMap((it) => (it.type === "private" ? [it.booking.id] : it.bookings.map((b) => b.id)));

describe("buildCalendarItems — fitness studio class bookings", () => {
  it("puts a booking for an active class into that class's slot (unchanged behaviour)", () => {
    const b = booking();
    const items = build([b], [cls()]);
    expect(items).toHaveLength(1);
    expect(items[0].type).toBe("class_slot");
    expect(renderedIds(items)).toEqual([b.id]);
  });

  it("still shows bookings when the provider's active schedule is empty", () => {
    const bs = [booking(), booking(), booking()];
    const items = build(bs, []);
    expect(renderedIds(items).sort()).toEqual(bs.map((b) => b.id).sort());
    expect(items).toHaveLength(1);
    expect(items[0].type === "class_slot" && items[0].classEntry.max_capacity).toBe(10);
  });

  it("still shows bookings for a deactivated class", () => {
    const b = booking({ class_entry: cls({ is_active: false }) });
    const items = build([b], [cls({ is_active: false })]);
    expect(renderedIds(items)).toEqual([b.id]);
  });

  it("still shows bookings whose class moved to another weekday, at the booked time", () => {
    const moved = cls({ day_of_week: 2, start_time: "09:00:00" });
    const b = booking({ class_entry: moved });
    const items = build([b], [moved]);
    expect(renderedIds(items)).toEqual([b.id]);
    expect(items[0].type === "class_slot" && items[0].classEntry.start_time).toBe("18:00");
  });

  it("falls back to a plain card when the class row is unreadable", () => {
    const b = booking({ class_entry: null, class_name: null });
    const items = build([b], []);
    expect(items).toEqual([{ type: "private", booking: b }]);
  });

  it("does not double-render a booking already in an active slot", () => {
    const b = booking();
    expect(renderedIds(build([b], [cls()]))).toEqual([b.id]);
  });

  it("still shows non-class bookings", () => {
    const b = booking({ class_schedule_id: null, class_entry: null, class_name: null, service_ids: ["s"] });
    expect(build([b], [cls()]).some((it) => it.type === "private" && it.booking.id === b.id)).toBe(true);
  });
});
