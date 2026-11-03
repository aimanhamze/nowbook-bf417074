import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useLang } from "@/contexts/LangContext";
import { useLiveSessionGuard } from "@/hooks/useLiveSessionGuard";
import { SessionHandledError, isUnauthenticatedWriteError } from "@/lib/liveSession";
import { waitlistJoinErrorKey, type TimeWindow } from "@/lib/waitlistDay";
import type { Lang } from "@/lib/translations";

/** Today as "YYYY-MM-DD" in the device's zone (same rule as useMyUpcomingAt). */
function todayYmd(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export interface WaitlistEntry {
  id: string;
  provider_id: string;
  entry_date: string;
  service_id: string;
  staff_id: string | null;
  wants_morning: boolean;
  wants_afternoon: boolean;
  wants_evening: boolean;
  created_at: string;
  provider: { id: string; business_name: string; avatar_image: string | null } | null;
  service: { name: string } | null;
  staff: { name: string } | null;
}

/** The windows an entry asked for, in display order. */
export function entryWindows(e: Pick<WaitlistEntry, "wants_morning" | "wants_afternoon" | "wants_evening">): TimeWindow[] {
  return [
    ...(e.wants_morning ? (["morning"] as const) : []),
    ...(e.wants_afternoon ? (["afternoon"] as const) : []),
    ...(e.wants_evening ? (["evening"] as const) : []),
  ];
}

// waitlist_entries / the RPCs are not in the generated types.ts yet (repo
// convention: cast until types are regenerated after apply).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

/**
 * The signed-in customer's ACTIVE waiting-list entries from today on, soonest
 * first, with provider / service / staff names in the same request. RLS lets a
 * customer read only their own rows.
 *
 * One query for every screen (/bookings, the provider page row, the booking
 * page) — they share this key. It lives under ["bookings", ...] so anything
 * that refreshes bookings refreshes this too.
 *
 * `enabled` lets a screen opt out entirely: the booking page and the provider
 * page pass provider.waitlistEnabled, so a provider without the waiting list
 * costs no request at all.
 */
export function useMyWaitlist(enabled = true) {
  const { user, isProvider, isAdmin, roleLoading } = useAuth();
  return useQuery({
    queryKey: ["bookings", "waitlist", user?.id],
    enabled: enabled && !!user && !roleLoading && !isProvider && !isAdmin,
    queryFn: async (): Promise<WaitlistEntry[]> => {
      if (!user) return [];
      const { data, error } = await db
        .from("waitlist_entries")
        .select(
          "id, provider_id, entry_date, service_id, staff_id, wants_morning, wants_afternoon, wants_evening, created_at," +
            " provider:provider_profiles!waitlist_entries_provider_id_fkey(id, business_name, avatar_image)," +
            " service:provider_services!waitlist_entries_service_fk(name)," +
            " staff:provider_staff!waitlist_entries_staff_fk(name)",
        )
        .eq("user_id", user.id)
        .eq("status", "active")
        .gte("entry_date", todayYmd())
        .order("entry_date", { ascending: true })
        .limit(20);
      if (error) throw error;
      return (data || []) as WaitlistEntry[];
    },
  });
}

/** A join refusal carrying the RPC's code (or "GENERIC"). */
export class WaitlistJoinError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "WaitlistJoinError";
  }
}

export interface JoinWaitlistInput {
  providerId: string;
  /** yyyy-MM-dd */
  date: string;
  serviceId: string;
  /** null = "anyone" */
  staffId: string | null;
  windows: readonly TimeWindow[];
  lang: Lang;
  /** Runs before a dead session is signed out — save the draft here. */
  onDeadSession?: () => void;
}

export function useJoinWaitlist() {
  const { t } = useLang();
  const queryClient = useQueryClient();
  const { ensureLiveSession, endDeadSession } = useLiveSessionGuard();

  return useMutation({
    mutationFn: async (input: JoinWaitlistInput) => {
      const deadOpts = { message: "waitlistSessionEnded" as const, onDead: input.onDeadSession };
      if (!(await ensureLiveSession(deadOpts))) throw new SessionHandledError();

      const { data, error, status } = await db.rpc("waitlist_join", {
        p_provider_id: input.providerId,
        p_entry_date: input.date,
        p_service_id: input.serviceId,
        p_staff_id: input.staffId,
        p_morning: input.windows.includes("morning"),
        p_afternoon: input.windows.includes("afternoon"),
        p_evening: input.windows.includes("evening"),
        p_lang: input.lang,
      });
      if (error) {
        if (isUnauthenticatedWriteError(error, status)) {
          await endDeadSession(deadOpts);
          throw new SessionHandledError();
        }
        throw new WaitlistJoinError("GENERIC");
      }
      const row = (Array.isArray(data) ? data[0] : data) as { entry_id: string | null; code: string } | undefined;
      if (!row || row.code !== "OK") throw new WaitlistJoinError(row?.code ?? "GENERIC");
      return row.entry_id as string;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bookings", "waitlist"] });
      toast.success(t("waitlistJoined"));
    },
    onError: (err) => {
      if (err instanceof SessionHandledError) return;
      // ALREADY_ON_LIST / ALREADY_BOOKED mean our picture is stale: refresh it.
      queryClient.invalidateQueries({ queryKey: ["bookings"] });
      toast.error(t(waitlistJoinErrorKey(err instanceof WaitlistJoinError ? err.code : null)));
    },
  });
}

export function useLeaveWaitlist() {
  const { t } = useLang();
  const queryClient = useQueryClient();
  const { ensureLiveSession, endDeadSession } = useLiveSessionGuard();

  return useMutation({
    mutationFn: async (entryId: string) => {
      if (!(await ensureLiveSession())) throw new SessionHandledError();
      const { data, error, status } = await db.rpc("waitlist_leave", { p_entry_id: entryId });
      if (error) {
        if (isUnauthenticatedWriteError(error, status)) {
          await endDeadSession();
          throw new SessionHandledError();
        }
        throw new Error("LEAVE_FAILED");
      }
      if (data !== "OK") throw new Error("LEAVE_FAILED");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bookings", "waitlist"] });
      toast.success(t("waitlistLeft"));
    },
    onError: (err) => {
      if (err instanceof SessionHandledError) return;
      queryClient.invalidateQueries({ queryKey: ["bookings", "waitlist"] });
      toast.error(t("waitlistLeaveError"));
    },
  });
}
