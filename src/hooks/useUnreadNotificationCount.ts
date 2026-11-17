import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

// unread_notification_count is not in the generated types.ts yet (repo
// convention: cast until types are regenerated).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

/**
 * unread_notification_count() stops counting at this number. Every bell
 * renders `count > 9 ? "9+" : count`, so a cached value of UNREAD_COUNT_CAP
 * means "10 OR MORE" — never do arithmetic on it as if it were exact.
 */
export const UNREAD_COUNT_CAP = 10;

const REFETCH_INTERVAL_MS = 5 * 60 * 1000;
const STALE_MS = 60 * 1000;

export const unreadNotificationsKey = (userId: string | undefined) =>
  ["unread-notifications", userId] as const;

/**
 * The bell badge number — the ONE query behind every bell in the app
 * (BottomNav and the home header share the cache through the query key).
 *
 * Returns 0..9 exactly, or UNREAD_COUNT_CAP for "10 or more".
 *
 * How fresh: refetched when the app comes back into view or reconnects, after
 * the user's own actions (the existing ["unread-notifications"] invalidations
 * and the one fired when /notifications opens), and every 5 minutes as a
 * safety net while the app sits open. It used to poll every 30 seconds, which
 * was the single most expensive query in the database.
 *
 * Never runs for logged-out users or admins (an admin has no bell). Pass
 * `enabled: false` where no bell is on screen; the cached number is kept and
 * refreshed when a bell is shown again.
 */
export function useUnreadNotificationCount({ enabled = true }: { enabled?: boolean } = {}) {
  const { user, isAdmin, roleLoading } = useAuth();

  const { data = 0 } = useQuery({
    queryKey: unreadNotificationsKey(user?.id),
    staleTime: STALE_MS,
    queryFn: async (): Promise<number> => {
      const { data, error } = await db.rpc("unread_notification_count");
      if (error) return 0;
      return typeof data === "number" ? data : 0;
    },
    enabled: enabled && !!user && !roleLoading && !isAdmin,
    refetchInterval: REFETCH_INTERVAL_MS,
  });

  return data;
}
