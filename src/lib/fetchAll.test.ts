import { describe, it, expect, vi } from "vitest";
import { fetchAllPages, fetchByDateWindow, inBatches, PAGE_SIZE, IN_BATCH } from "./fetchAll";

/** A fake server that truncates every response at `cap`, like PostgREST max-rows. */
const capped = <T>(rows: T[], cap = 1000) => rows.slice(0, cap);

describe("fetchAllPages", () => {
  it("returns every row past the server cap, in order, with no repeats", async () => {
    const table = Array.from({ length: 2345 }, (_, i) => i);
    const page = vi.fn((from: number, to: number) =>
      Promise.resolve({ data: capped(table.slice(from, to + 1)), error: null }),
    );
    expect(await fetchAllPages(page)).toEqual(table);
    expect(page).toHaveBeenCalledTimes(Math.ceil(2345 / PAGE_SIZE));
  });

  it("makes one request for a small result", async () => {
    const page = vi.fn(() => Promise.resolve({ data: [1, 2, 3], error: null }));
    expect(await fetchAllPages(page)).toEqual([1, 2, 3]);
    expect(page).toHaveBeenCalledTimes(1);
  });

  it("asks for one more page when the last page is exactly full", async () => {
    const table = Array.from({ length: PAGE_SIZE }, (_, i) => i);
    const page = vi.fn((from: number, to: number) =>
      Promise.resolve({ data: table.slice(from, to + 1), error: null }),
    );
    expect(await fetchAllPages(page)).toHaveLength(PAGE_SIZE);
    expect(page).toHaveBeenCalledTimes(2);
  });

  it("throws the server error instead of returning a partial list", async () => {
    const err = { message: "boom" };
    await expect(fetchAllPages(() => Promise.resolve({ data: null, error: err }))).rejects.toBe(err);
  });
});

describe("inBatches", () => {
  it("splits ids into batches and concatenates the results", async () => {
    const ids = Array.from({ length: 250 }, (_, i) => `id-${i}`);
    const run = vi.fn((batch: string[]) => Promise.resolve({ data: batch.map((id) => ({ id })) }));
    const out = await inBatches<{ id: string }>(ids, run);
    expect(out.map((r) => r.id)).toEqual(ids);
    expect(run).toHaveBeenCalledTimes(Math.ceil(250 / IN_BATCH));
    for (const [batch] of run.mock.calls) expect(batch.length).toBeLessThanOrEqual(IN_BATCH);
  });

  it("makes no request for an empty id list", async () => {
    const run = vi.fn();
    expect(await inBatches([], run)).toEqual([]);
    expect(run).not.toHaveBeenCalled();
  });
});

describe("fetchByDateWindow", () => {
  // Busy-slot style rows: no unique column, and exact duplicates are real
  // (several group bookings at one slot) and must ALL be kept.
  type Slot = { booking_date: string; booking_time: string };
  const slotsOn = (date: string, n: number): Slot[] =>
    Array.from({ length: n }, () => ({ booking_date: date, booking_time: "10:00" }));
  const server = (all: Slot[]) =>
    vi.fn((from: string, to: string) =>
      Promise.resolve({
        data: all.filter((s) => s.booking_date >= from && s.booking_date <= to).slice(0, PAGE_SIZE),
        error: null,
      }),
    );

  it("is a single request when the window is under a page", async () => {
    const all = slotsOn("2026-10-20", 30);
    const run = server(all);
    expect(await fetchByDateWindow("2026-10-15", "2026-12-13", run)).toHaveLength(30);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("splits a full window and keeps every row, duplicates included", async () => {
    // 1,200 rows over 60 days, 20 identical rows per day.
    const all: Slot[] = [];
    for (let d = 0; d < 60; d++) {
      const date = new Date(Date.UTC(2026, 9, 15 + d)).toISOString().slice(0, 10);
      all.push(...slotsOn(date, 20));
    }
    const out = await fetchByDateWindow("2026-10-15", "2026-12-13", server(all));
    expect(out).toHaveLength(1200);
  });

  it("covers every day of the window exactly once across splits", async () => {
    const all: Slot[] = [];
    for (let d = 0; d < 61; d++) {
      const date = new Date(Date.UTC(2026, 9, 15 + d)).toISOString().slice(0, 10);
      all.push(...slotsOn(date, 10));
    }
    const out = await fetchByDateWindow("2026-10-15", "2026-12-14", server(all));
    expect(out).toHaveLength(610);
    const perDay = new Map<string, number>();
    for (const s of out) perDay.set(s.booking_date, (perDay.get(s.booking_date) ?? 0) + 1);
    expect([...perDay.values()].every((n) => n === 10)).toBe(true);
  });

  it("reports a single day that cannot be split instead of failing silently", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const out = await fetchByDateWindow("2026-10-20", "2026-10-20", server(slotsOn("2026-10-20", PAGE_SIZE + 5)));
    expect(out).toHaveLength(PAGE_SIZE);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("throws the server error", async () => {
    const err = { message: "boom" };
    await expect(
      fetchByDateWindow("2026-10-15", "2026-10-16", () => Promise.resolve({ data: null, error: err })),
    ).rejects.toBe(err);
  });
});
