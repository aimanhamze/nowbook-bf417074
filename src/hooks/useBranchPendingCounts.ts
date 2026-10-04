import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useProviderProfile } from "@/hooks/useProviderProfile";
import { usePendingCount } from "@/hooks/useProviderBookings";

/**
 * Multi-branch: pending-bookings count for EVERY branch of the owner, for the
 * branch sheet's rows and the "another branch has pending" dot on the chip.
 *
 * ONE query for all branches (`.in("provider_id", ids)`, grouped client-side) —
 * never one per branch. The bookings SELECT policy's provider arm is
 * EXISTS (pp.id = bookings.provider_id AND pp.user_id = auth.uid()), so it
 * returns every branch's rows (confirmed live on prod and dev, 2026-10-04).
 *
 * The ACTIVE branch's number comes from usePendingCount — the same source as
 * the bottom-nav badge — so the two can never disagree. The grouped query only
 * supplies the other branches.
 *
 * Only called from BranchChip, which only exists for owners with 2+ branches:
 * single-branch owners never mount this, so never issue the query.
 */
export function useBranchPendingCounts() {
  const { user } = useAuth();
  const { profile, branches } = useProviderProfile();
  const activePending = usePendingCount();
  const ids = branches.map((b) => b.id);

  const others = useQuery({
    queryKey: ["branch-pending-counts", user?.id, ids.join(",")],
    enabled: !!user && ids.length > 1,
    staleTime: 30 * 1000,
    // Same cadence as the bottom-nav badge (useProviderBookings).
    refetchInterval: 30000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bookings")
        .select("provider_id")
        .in("provider_id", ids)
        .eq("status", "pending");
      if (error) throw error;
      const counts: Record<string, number> = {};
      for (const row of data ?? []) counts[row.provider_id] = (counts[row.provider_id] ?? 0) + 1;
      return counts;
    },
  });

  const countFor = (branchId: string): number =>
    branchId === profile?.id ? activePending : others.data?.[branchId] ?? 0;

  const otherBranchesPending = branches.some((b) => b.id !== profile?.id && countFor(b.id) > 0);

  return { countFor, otherBranchesPending };
}
