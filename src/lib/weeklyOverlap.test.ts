import { describe, it, expect } from "vitest";
import { assignOverlapColumns } from "./weeklyOverlap";

// Minutes helper for readable cases.
const m = (h: number, min = 0) => h * 60 + min;

describe("assignOverlapColumns", () => {
  it("returns an empty array for no items", () => {
    expect(assignOverlapColumns([])).toEqual([]);
  });

  it("gives every non-overlapping item { col: 0, cols: 1 } (full width — the pre-fix geometry)", () => {
    const slots = assignOverlapColumns([
      { start: m(9), end: m(10) },
      { start: m(10), end: m(11) }, // touching ends are NOT an overlap
      { start: m(14), end: m(14, 30) },
    ]);
    expect(slots).toEqual([
      { col: 0, cols: 1 },
      { col: 0, cols: 1 },
      { col: 0, cols: 1 },
    ]);
  });

  it("splits two same-time items into {0,2} and {1,2}", () => {
    const slots = assignOverlapColumns([
      { start: m(9), end: m(10) },
      { start: m(9), end: m(10) },
    ]);
    expect(slots).toEqual([
      { col: 0, cols: 2 },
      { col: 1, cols: 2 },
    ]);
  });

  it("three simultaneous items (the barbershop case) → three thirds", () => {
    const slots = assignOverlapColumns([
      { start: m(9), end: m(10) },
      { start: m(9), end: m(10) },
      { start: m(9), end: m(10) },
    ]);
    expect(slots).toEqual([
      { col: 0, cols: 3 },
      { col: 1, cols: 3 },
      { col: 2, cols: 3 },
    ]);
  });

  it("chain cluster: A∩B, B∩C, A∦C — everyone shares cols=2 and C reuses column 0", () => {
    const slots = assignOverlapColumns([
      { start: m(9), end: m(10) },        // A
      { start: m(9, 30), end: m(10, 30) }, // B overlaps A and C
      { start: m(10), end: m(11) },        // C overlaps only B
    ]);
    expect(slots).toEqual([
      { col: 0, cols: 2 }, // A
      { col: 1, cols: 2 }, // B
      { col: 0, cols: 2 }, // C — A has ended, its column is free again
    ]);
  });

  it("fully nested: a short item inside a long one splits both", () => {
    const slots = assignOverlapColumns([
      { start: m(9), end: m(12) },        // long
      { start: m(10), end: m(10, 30) },   // nested inside
    ]);
    expect(slots).toEqual([
      { col: 0, cols: 2 },
      { col: 1, cols: 2 },
    ]);
  });

  it("independent clusters size independently (a pair does not widen a loner)", () => {
    const slots = assignOverlapColumns([
      { start: m(9), end: m(10) },
      { start: m(9), end: m(10) },
      { start: m(13), end: m(14) }, // far away — its own cluster of one
    ]);
    expect(slots).toEqual([
      { col: 0, cols: 2 },
      { col: 1, cols: 2 },
      { col: 0, cols: 1 },
    ]);
  });

  it("is deterministic regardless of input order (start asc, then input index)", () => {
    // Same intervals, shuffled: the later-starting item must always get the
    // result of the sweep order, not the input order.
    const a = assignOverlapColumns([
      { start: m(9, 30), end: m(10, 30) },
      { start: m(9), end: m(10) },
    ]);
    // Sweep order is 9:00 first → it takes col 0; 9:30 overlaps → col 1.
    expect(a).toEqual([
      { col: 1, cols: 2 },
      { col: 0, cols: 2 },
    ]);
  });

  it("guards zero-duration items (still occupy their start minute)", () => {
    const slots = assignOverlapColumns([
      { start: m(9), end: m(9) },
      { start: m(9), end: m(9, 15) },
    ]);
    expect(slots).toEqual([
      { col: 0, cols: 2 },
      { col: 1, cols: 2 },
    ]);
  });
});
