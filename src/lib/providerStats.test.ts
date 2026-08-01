import { describe, it, expect } from "vitest";
import {
  classifyCohort,
  computeProviderStats,
  toLocalDateStr,
  type StatsBooking,
} from "./providerStats";

const TODAY = "2026-07-30";

let seq = 0;
function bk(over: Partial<StatsBooking> = {}): StatsBooking {
  seq += 1;
  return {
    id: `b${seq}`,
    user_id: null,
    linked_user_id: null,
    customer_phone: null,
    booking_date: "2026-06-10",
    booking_time: "10:00",
    total_price: 100,
    status: "confirmed",
    service_ids: [],
    created_at: "2026-06-01T09:00:00Z",
    ...over,
  };
}

const JUNE = ["2026-06-01", "2026-06-30"] as const;

describe("classifyCohort", () => {
  it("marks a customer NEW when their first-ever booking is inside the range", () => {
    const bookings = [bk({ user_id: "u1", booking_date: "2026-06-10" })];
    const r = classifyCohort(bookings, ...JUNE);
    expect(r).toMatchObject({ unique: 1, new: 1, returning: 0 });
  });

  it("marks a customer RETURNING when they first booked before the range", () => {
    const bookings = [
      bk({ user_id: "u1", booking_date: "2026-03-04" }),
      bk({ user_id: "u1", booking_date: "2026-06-10" }),
    ];
    const r = classifyCohort(bookings, ...JUNE);
    expect(r).toMatchObject({ unique: 1, new: 0, returning: 1 });
  });

  it("counts a customer once no matter how many times they booked in range", () => {
    const bookings = [
      bk({ user_id: "u1", booking_date: "2026-06-02" }),
      bk({ user_id: "u1", booking_date: "2026-06-12" }),
      bk({ user_id: "u1", booking_date: "2026-06-22" }),
    ];
    const r = classifyCohort(bookings, ...JUNE);
    expect(r).toMatchObject({ unique: 1, new: 1, returning: 0 });
  });

  // THE reproducibility guarantee: re-running a past month later must not
  // reclassify anyone. The old lifetime-count rule failed exactly here.
  it("is REPRODUCIBLE — later bookings never reclassify a past month", () => {
    const june = [bk({ user_id: "u1", booking_date: "2026-06-10" })];
    const before = classifyCohort(june, ...JUNE);

    const afterMoreVisits = classifyCohort(
      [
        ...june,
        bk({ user_id: "u1", booking_date: "2026-07-11" }),
        bk({ user_id: "u1", booking_date: "2026-08-15" }),
      ],
      ...JUNE
    );

    expect(before).toMatchObject({ new: 1, returning: 0 });
    expect(afterMoreVisits).toMatchObject({ unique: 1, new: 1, returning: 0 });
  });

  it("ignores cancelled bookings on both sides", () => {
    // Their only earlier booking was cancelled → they are NEW in June, and a
    // cancelled June booking alone does not make them active.
    const bookings = [
      bk({ user_id: "u1", booking_date: "2026-02-01", status: "cancelled" }),
      bk({ user_id: "u1", booking_date: "2026-06-10" }),
      bk({ user_id: "u2", booking_date: "2026-06-11", status: "cancelled" }),
    ];
    const r = classifyCohort(bookings, ...JUNE);
    expect(r).toMatchObject({ unique: 1, new: 1, returning: 0 });
    expect(r.newKeys).toEqual(["u:u1"]);
  });

  it("counts pending bookings as real visits", () => {
    const r = classifyCohort(
      [bk({ user_id: "u1", booking_date: "2026-06-10", status: "pending" })],
      ...JUNE
    );
    expect(r).toMatchObject({ unique: 1, new: 1 });
  });

  it("excludes customers active only outside the range", () => {
    const r = classifyCohort(
      [
        bk({ user_id: "u1", booking_date: "2026-05-31" }),
        bk({ user_id: "u2", booking_date: "2026-07-01" }),
      ],
      ...JUNE
    );
    expect(r.unique).toBe(0);
  });

  it("treats the range bounds as inclusive", () => {
    const r = classifyCohort(
      [
        bk({ user_id: "u1", booking_date: "2026-06-01" }),
        bk({ user_id: "u2", booking_date: "2026-06-30" }),
      ],
      ...JUNE
    );
    expect(r).toMatchObject({ unique: 2, new: 2 });
  });

  it("uses the unified key — phone variants are ONE returning customer", () => {
    const r = classifyCohort(
      [
        bk({ booking_date: "2026-01-15", customer_phone: "+972501234567" }),
        bk({ booking_date: "2026-06-10", customer_phone: "050-1234567" }),
        bk({ booking_date: "2026-06-20", customer_phone: "0501234567" }),
      ],
      ...JUNE
    );
    expect(r).toMatchObject({ unique: 1, new: 0, returning: 1 });
  });

  it("folds a linked walk-in into the account's history (the 47-row case)", () => {
    const r = classifyCohort(
      [
        // Their first visit was an app booking in March…
        bk({ user_id: "u1", booking_date: "2026-03-02" }),
        // …then the provider entered them as a walk-in the trigger linked.
        bk({ linked_user_id: "u1", customer_phone: "0509999999", booking_date: "2026-06-10" }),
      ],
      ...JUNE
    );
    // One customer, and RETURNING — not a brand-new walk-in.
    expect(r).toMatchObject({ unique: 1, new: 0, returning: 1 });
  });

  it("breaks a same-date first booking tie on created_at without changing the verdict", () => {
    const r = classifyCohort(
      [
        bk({ user_id: "u1", booking_date: "2026-06-10", created_at: "2026-06-05T12:00:00Z" }),
        bk({ user_id: "u1", booking_date: "2026-06-10", created_at: "2026-06-01T08:00:00Z" }),
      ],
      ...JUNE
    );
    expect(r).toMatchObject({ unique: 1, new: 1, returning: 0 });
  });

  it("returns zeroes for an empty history", () => {
    expect(classifyCohort([], ...JUNE)).toMatchObject({ unique: 0, new: 0, returning: 0 });
  });
});

describe("computeProviderStats — revenue", () => {
  const opts = { todayStr: TODAY };

  it("counts ONLY confirmed bookings in range", () => {
    const s = computeProviderStats(
      [
        bk({ booking_date: "2026-06-10", total_price: 100, status: "confirmed" }),
        bk({ booking_date: "2026-06-11", total_price: 50, status: "pending" }),
        bk({ booking_date: "2026-06-12", total_price: 999, status: "cancelled" }),
        bk({ booking_date: "2026-05-31", total_price: 700, status: "confirmed" }),
      ],
      [],
      [],
      ...JUNE,
      opts
    );
    expect(s.revenue.earned).toBe(100);
    expect(s.revenue.pending).toBe(50);
  });

  it("excludes future-dated bookings from earned but reports them as upcoming", () => {
    const s = computeProviderStats(
      [
        bk({ booking_date: "2026-07-10", total_price: 100 }),
        bk({ booking_date: "2026-08-05", total_price: 300 }),
      ],
      [],
      [],
      "2026-07-01",
      "2026-07-31",
      opts
    );
    expect(s.revenue.earned).toBe(100); // 07-10 is past; 08-05 is out of range
    expect(s.revenue.upcoming).toBe(300);
  });

  it("is a no-op for a window ending today (Statistics' case)", () => {
    const bookings = [
      bk({ booking_date: "2026-07-29", total_price: 80 }),
      bk({ booking_date: TODAY, total_price: 20 }),
    ];
    const s = computeProviderStats(bookings, [], [], "2026-07-01", TODAY, opts);
    expect(s.revenue.earned).toBe(100);
  });

  it("computes avgTicket over earned bookings only", () => {
    const s = computeProviderStats(
      [
        bk({ booking_date: "2026-06-10", total_price: 100 }),
        bk({ booking_date: "2026-06-11", total_price: 200 }),
        bk({ booking_date: "2026-06-12", total_price: 900, status: "cancelled" }),
      ],
      [],
      [],
      ...JUNE,
      opts
    );
    expect(s.customers.avgTicket).toBe(150);
  });

  it("returns zeroes, not NaN, on empty input", () => {
    const s = computeProviderStats([], [], [], ...JUNE, opts);
    expect(s.revenue.earned).toBe(0);
    expect(s.customers.avgTicket).toBe(0);
    expect(s.bookings.cancellationRate).toBe(0);
    expect(s.rating.avg).toBe(0);
  });
});

describe("computeProviderStats — bookings & cancellation rate", () => {
  const opts = { todayStr: TODAY };

  it("separates total (all statuses) from active (non-cancelled)", () => {
    const s = computeProviderStats(
      [
        bk({ booking_date: "2026-06-01", status: "confirmed" }),
        bk({ booking_date: "2026-06-02", status: "pending" }),
        bk({ booking_date: "2026-06-03", status: "cancelled" }),
        bk({ booking_date: "2026-06-04", status: "cancelled" }),
      ],
      [],
      [],
      ...JUNE,
      opts
    );
    expect(s.bookings.total).toBe(4);
    expect(s.bookings.active).toBe(2);
    expect(s.bookings.byStatus).toMatchObject({ confirmed: 1, pending: 1, cancelled: 2 });
    expect(s.bookings.cancellationRate).toBe(0.5);
  });
});

describe("computeProviderStats — services, busiest, rating", () => {
  const opts = { todayStr: TODAY };

  it("counts services per booking and resolves catalog names", () => {
    const s = computeProviderStats(
      [
        bk({ booking_date: "2026-06-10", service_ids: ["s1", "s2"] }),
        bk({ booking_date: "2026-06-11", service_ids: ["s1"] }),
      ],
      [
        { id: "s1", name: "תספורת" },
        { id: "s2", name: "זקן" },
      ],
      [],
      ...JUNE,
      opts
    );
    expect(s.topServices).toEqual([
      { id: "s1", name: "תספורת", count: 2 },
      { id: "s2", name: "זקן", count: 1 },
    ]);
    // Deliberately no revenue field — it could not reconcile to headline revenue.
    expect(s.topServices[0]).not.toHaveProperty("revenue");
  });

  it("falls back to the raw id for a service deleted from the catalog", () => {
    const s = computeProviderStats(
      [bk({ booking_date: "2026-06-10", service_ids: ["gone"] })],
      [],
      [],
      ...JUNE,
      opts
    );
    expect(s.topServices[0]).toMatchObject({ id: "gone", name: "gone", count: 1 });
  });

  it("buckets busiest weekday and hour over non-cancelled bookings", () => {
    const s = computeProviderStats(
      [
        // 2026-06-10 is a Wednesday (weekday 3).
        bk({ booking_date: "2026-06-10", booking_time: "09:30" }),
        bk({ booking_date: "2026-06-10", booking_time: "09:45" }),
        bk({ booking_date: "2026-06-11", booking_time: "14:00", status: "cancelled" }),
      ],
      [],
      [],
      ...JUNE,
      opts
    );
    expect(s.busiest.byWeekday[3].count).toBe(2);
    expect(s.busiest.byHour).toEqual([{ hour: 9, count: 2 }]);
  });

  it("reports all-time rating plus reviews written in range", () => {
    const s = computeProviderStats(
      [],
      [],
      [
        { rating: 5, created_at: "2026-06-15T10:00:00Z" },
        { rating: 3, created_at: "2026-01-02T10:00:00Z" },
      ],
      ...JUNE,
      opts
    );
    expect(s.rating.count).toBe(2);
    expect(s.rating.avg).toBe(4);
    expect(s.rating.periodCount).toBe(1);
  });

  it("sums booked hours from service durations", () => {
    const s = computeProviderStats(
      [bk({ booking_date: "2026-06-10", service_ids: ["s1", "s2"] })],
      [],
      [],
      ...JUNE,
      { ...opts, durations: new Map([["s1", 30], ["s2", 60]]) }
    );
    expect(s.bookedHours).toBe(1.5);
  });
});

describe("computeProviderStats — buckets & range", () => {
  const opts = { todayStr: TODAY };

  it("buckets a calendar month by DAY, one per day", () => {
    const s = computeProviderStats([], [], [], ...JUNE, opts);
    expect(s.revenue.bucketUnit).toBe("day");
    expect(s.revenue.buckets).toHaveLength(30);
    expect(s.revenue.buckets[0].key).toBe("2026-06-01");
    expect(s.revenue.buckets[29].key).toBe("2026-06-30");
  });

  it("buckets a 90-day window by MONTH (Statistics' 3-month period)", () => {
    const s = computeProviderStats([], [], [], "2026-05-02", "2026-07-30", opts);
    expect(s.revenue.bucketUnit).toBe("month");
    expect(s.revenue.buckets.map((b) => b.key)).toEqual(["2026-05", "2026-06", "2026-07"]);
  });

  it("keeps 7- and 30-day windows on day buckets", () => {
    expect(computeProviderStats([], [], [], "2026-07-24", TODAY, opts).revenue.bucketUnit).toBe("day");
    expect(computeProviderStats([], [], [], "2026-07-01", TODAY, opts).revenue.bucketUnit).toBe("day");
  });

  it("puts earned revenue in the right day bucket", () => {
    const s = computeProviderStats(
      [bk({ booking_date: "2026-06-03", total_price: 250 })],
      [],
      [],
      ...JUNE,
      opts
    );
    expect(s.revenue.buckets[2]).toMatchObject({ key: "2026-06-03", revenue: 250 });
    expect(s.revenue.buckets[0].revenue).toBe(0);
  });

  it("echoes the range back and is deterministic across repeated calls", () => {
    const args = [
      [bk({ user_id: "u1", booking_date: "2026-06-10" })],
      [],
      [],
      ...JUNE,
      opts,
    ] as const;
    const a = computeProviderStats(...args);
    const b = computeProviderStats(...args);
    expect(a.fromStr).toBe("2026-06-01");
    expect(a.toStr).toBe("2026-06-30");
    expect(a).toEqual(b);
  });
});

describe("computeProviderStats — customers", () => {
  const opts = { todayStr: TODAY };

  it("dedupes phone variants into one unique customer", () => {
    const s = computeProviderStats(
      [
        bk({ booking_date: "2026-06-10", customer_phone: "050-1234567" }),
        bk({ booking_date: "2026-06-20", customer_phone: "+972501234567" }),
      ],
      [],
      [],
      ...JUNE,
      opts
    );
    expect(s.customers.unique).toBe(1);
    expect(s.customers.walkins).toBe(1);
  });

  it("does not count a linked walk-in as a walk-in customer", () => {
    const s = computeProviderStats(
      [bk({ booking_date: "2026-06-10", linked_user_id: "u1", customer_phone: "0509999999" })],
      [],
      [],
      ...JUNE,
      opts
    );
    expect(s.customers.unique).toBe(1);
    expect(s.customers.walkins).toBe(0);
  });

  it("new + returning always equals unique", () => {
    const s = computeProviderStats(
      [
        bk({ user_id: "u1", booking_date: "2026-01-05" }),
        bk({ user_id: "u1", booking_date: "2026-06-05" }),
        bk({ user_id: "u2", booking_date: "2026-06-06" }),
        bk({ booking_date: "2026-06-07", customer_phone: "0507654321" }),
      ],
      [],
      [],
      ...JUNE,
      opts
    );
    expect(s.customers.unique).toBe(3);
    expect(s.customers.new + s.customers.returning).toBe(s.customers.unique);
    expect(s.customers.returning).toBe(1);
  });
});

describe("toLocalDateStr", () => {
  it("uses LOCAL date parts, not UTC (the Israel-timezone rollback bug)", () => {
    // 00:30 local on the 1st is still the previous day in UTC.
    expect(toLocalDateStr(new Date(2026, 5, 1, 0, 30))).toBe("2026-06-01");
    expect(toLocalDateStr(new Date(2026, 11, 31, 23, 59))).toBe("2026-12-31");
  });

  it("zero-pads month and day", () => {
    expect(toLocalDateStr(new Date(2026, 0, 5))).toBe("2026-01-05");
  });
});
