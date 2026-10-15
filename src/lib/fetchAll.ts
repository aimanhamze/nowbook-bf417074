import { addDays, differenceInCalendarDays, format, parseISO } from "date-fns";

/**
 * Helpers for reads that must return EVERY matching row.
 *
 * PostgREST caps each response at its max-rows setting (1000 on hosted
 * Supabase) and truncates SILENTLY — no error, no flag, no count. Any select or
 * set-returning RPC without its own paging returns at most that many rows, so a
 * busy provider's bookings quietly go missing. Use these instead of a bare
 * select whenever the row count is not bounded by the query itself.
 */

/**
 * Rows requested per page. Must stay BELOW the server cap: a page is "the last
 * one" when it comes back short, and a page truncated by the server would look
 * full-but-final if the two were equal.
 */
export const PAGE_SIZE = 500;

type PageResult<T> = PromiseLike<{ data: T[] | null; error: unknown }>;

/**
 * Fetch every row by offset paging. `page(from, to)` must apply `.range(from,
 * to)` and an ORDER BY ending in a unique column (normally `id`) — without a
 * unique sort key, rows sharing the other sort values can shift between pages
 * and be skipped or repeated. Throws the first error it meets.
 */
export async function fetchAllPages<T>(page: (from: number, to: number) => PageResult<T>): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await page(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) return rows;
  }
}

/** Ids per `.in()` request. Each id goes in the URL; hundreds exceed URL limits. */
export const IN_BATCH = 100;

/**
 * Run an `.in(col, ids)` lookup in batches and concatenate the results. Errors
 * are ignored (the batch contributes nothing) — these lookups only enrich rows
 * with names and balances, and a missing name must not blank a whole screen.
 */
export async function inBatches<T>(
  ids: string[],
  run: (batch: string[]) => PromiseLike<{ data: unknown }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += IN_BATCH) {
    const { data } = await run(ids.slice(i, i + IN_BATCH));
    out.push(...((data ?? []) as T[]));
  }
  return out;
}

/**
 * Fetch every row in an inclusive `yyyy-MM-dd` date window, for sources with NO
 * unique column to page on (e.g. get_provider_busy_slots, whose rows can be
 * exact duplicates — two group bookings at one slot). `run(from, to)` must
 * apply `.range(0, PAGE_SIZE - 1)`. A full response means the window may hold
 * more, so it is split in half and each half fetched again; a normal window
 * costs exactly one request.
 */
export async function fetchByDateWindow<T>(
  from: string,
  to: string,
  run: (from: string, to: string) => PageResult<T>,
): Promise<T[]> {
  const { data, error } = await run(from, to);
  if (error) throw error;
  const rows = data ?? [];
  if (rows.length < PAGE_SIZE) return rows;

  const days = differenceInCalendarDays(parseISO(to), parseISO(from));
  if (days <= 0) {
    // One day holding PAGE_SIZE+ rows for a single query. Cannot be split
    // further; say so loudly rather than truncate in silence.
    console.error(`fetchByDateWindow: ${from} returned a full page (${PAGE_SIZE}); results may be incomplete`);
    return rows;
  }
  const mid = format(addDays(parseISO(from), Math.floor(days / 2)), "yyyy-MM-dd");
  const next = format(addDays(parseISO(mid), 1), "yyyy-MM-dd");
  const [a, b] = await Promise.all([
    fetchByDateWindow(from, mid, run),
    fetchByDateWindow(next, to, run),
  ]);
  return [...a, ...b];
}
