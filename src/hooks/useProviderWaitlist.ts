import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useProviderProfile } from "@/hooks/useProviderProfile";

// The RPCs are not in the generated types.ts yet (repo convention: cast until
// types are regenerated).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

/**
 * Waiting customers per day for the signed-in provider's ACTIVE branch, today
 * onward: a Map "yyyy-MM-dd" → count. waitlist_provider_counts returns rows
 * only to the owner of that branch, and only while its waiting list is on.
 *
 * Runs nothing at all unless the branch has the waiting list on, so a
 * provider without it sees zero change and costs zero requests.
 */
export function useProviderWaitlistCounts() {
  const { profile } = useProviderProfile();
  const providerId = profile?.id;
  const enabled = !!providerId && (profile as { waitlist_enabled?: boolean } | null)?.waitlist_enabled === true;

  const query = useQuery({
    queryKey: ["provider-waitlist", "counts", providerId],
    enabled,
    staleTime: 60 * 1000,
    queryFn: async (): Promise<Map<string, number>> => {
      const { data, error } = await db.rpc("waitlist_provider_counts", { p_provider_id: providerId });
      if (error) throw error;
      const map = new Map<string, number>();
      for (const row of (data || []) as { entry_date: string; waiting: number }[]) {
        map.set(row.entry_date, row.waiting);
      }
      return map;
    },
  });

  const counts = enabled ? query.data ?? EMPTY : EMPTY;
  const total = sum(counts);
  /** A FRESH total, for decisions (the turn-off confirmation): the cached one
   *  may be a minute old or still loading. Throws if the request fails. */
  const fetchTotal = async (): Promise<number> => {
    if (!enabled) return 0;
    const res = await query.refetch({ throwOnError: true });
    return sum(res.data ?? EMPTY);
  };
  return { enabled, counts, total, fetchTotal, isLoading: enabled && query.isLoading };
}

function sum(m: Map<string, number>): number {
  let n = 0;
  for (const v of m.values()) n += v;
  return n;
}

const EMPTY: Map<string, number> = new Map();
