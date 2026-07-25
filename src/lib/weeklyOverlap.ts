// Sub-column assignment for time-overlapping calendar blocks (the standard
// "side-by-side events" layout every calendar app uses).
//
// Given a day's items as [start, end) minute intervals, each item receives
//   { col, cols }
// where `col` is its 0-based sub-column inside its overlap cluster and `cols`
// is the cluster's total sub-column count. The caller turns that into
//   insetInlineStart = (col / cols) * 100%,  width = 100% / cols.
//
// Guarantees:
//   * An item that overlaps nothing → { col: 0, cols: 1 } — i.e. full width,
//     geometrically identical to the pre-fix constant layout. This is what
//     keeps non-overlapping views (every non-staff provider, most filtered
//     views) pixel-identical.
//   * Within a connected overlap cluster, `cols` = the cluster's maximum
//     simultaneous item count (greedy lowest-free-column assignment), and
//     every member shares that `cols` so the cluster forms an even grid.
//   * Deterministic: items are processed by (start asc, input index asc), so
//     layout is stable across renders regardless of caller-side ordering.
//
// Pure and framework-free so it can be unit-tested directly.

export interface OverlapInterval {
  /** Start in minutes (inclusive). */
  start: number;
  /** End in minutes (exclusive). Ends exactly at another item's start ≠ overlap. */
  end: number;
}

export interface OverlapSlot {
  col: number;
  cols: number;
}

export function assignOverlapColumns(items: OverlapInterval[]): OverlapSlot[] {
  const result: OverlapSlot[] = items.map(() => ({ col: 0, cols: 1 }));
  if (items.length === 0) return result;

  // Defensive: a zero/negative-duration item still occupies its start minute,
  // matching the grid's minimum block height.
  const endOf = (it: OverlapInterval) => Math.max(it.end, it.start + 1);

  // Stable processing order: by start, then original index.
  const order = items
    .map((_, i) => i)
    .sort((a, b) => items[a].start - items[b].start || a - b);

  // Sweep. `active` holds items whose interval covers the current start;
  // `cluster` accumulates the connected component until a gap closes it.
  let active: { col: number; end: number }[] = [];
  let cluster: number[] = [];
  let clusterMaxEnd = -Infinity;

  const closeCluster = () => {
    if (cluster.length === 0) return;
    const cols = Math.max(...cluster.map((i) => result[i].col)) + 1;
    for (const i of cluster) result[i].cols = cols;
    cluster = [];
  };

  for (const idx of order) {
    const it = items[idx];

    // A gap before this item ends the current cluster: nothing already placed
    // can overlap anything from here on.
    if (cluster.length > 0 && it.start >= clusterMaxEnd) {
      closeCluster();
      active = [];
      clusterMaxEnd = -Infinity;
    }

    // Drop finished items, then take the lowest free sub-column.
    active = active.filter((a) => a.end > it.start);
    const used = new Set(active.map((a) => a.col));
    let col = 0;
    while (used.has(col)) col++;

    result[idx].col = col;
    active.push({ col, end: endOf(it) });
    cluster.push(idx);
    clusterMaxEnd = Math.max(clusterMaxEnd, endOf(it));
  }
  closeCluster();

  return result;
}
