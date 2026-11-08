import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useProviderProfile } from "./useProviderProfile";
import { academyFrom, academyRpc, type CourseRegistrationRow } from "@/integrations/supabase/academyTypes";
import { fetchAllPages } from "@/lib/fetchAll";
import { fetchCustomerContacts } from "@/lib/customerContacts";
import { registrationCounts } from "@/lib/academyRegistrations";
import { deliverCoursePush } from "@/lib/academyPushDelivery";
import { COURSE_SEATS_KEY, PUBLIC_COURSES_KEY } from "./usePublicCourses";

/**
 * Provider-side course registrations for the active academy branch.
 *
 * Reads go through the owner's own SELECT policy on course_registrations;
 * customer name/phone come from fetchCustomerContacts (display_name + phone
 * only). Writes are ONLY the RPCs: decide_course_registration (pending ->
 * confirmed / rejected) and cancel_course_registration (as the branch owner,
 * cancelled_by = 'provider'). Both update the cached list optimistically and
 * roll back if the RPC refuses. After success the customer gets a push
 * (fire-and-forget; the RPC already wrote their in-app row).
 */
export const ACADEMY_REGISTRATIONS_KEY = "academy-registrations";

export interface ProviderRegistration extends CourseRegistrationRow {
  customer_name: string | null;
  customer_phone: string | null;
}

type Snapshot = { previous: ProviderRegistration[] | undefined };

export function useAcademyRegistrations(enabled = true) {
  const { profile } = useProviderProfile();
  const queryClient = useQueryClient();
  const providerId = profile?.id;
  const key = [ACADEMY_REGISTRATIONS_KEY, providerId];

  const query = useQuery({
    queryKey: key,
    staleTime: 30 * 1000,
    enabled: !!providerId && enabled,
    queryFn: async (): Promise<ProviderRegistration[]> => {
      if (!providerId) return [];
      const rows = await fetchAllPages<CourseRegistrationRow>((from, to) =>
        academyFrom("course_registrations")
          .select("*")
          .eq("provider_id", providerId)
          .order("created_at")
          .order("id")
          .range(from, to) as unknown as PromiseLike<{ data: CourseRegistrationRow[] | null; error: unknown }>,
      );
      const contacts = await fetchCustomerContacts(rows.map((r) => r.user_id));
      return rows.map((r) => ({
        ...r,
        customer_name: contacts.get(r.user_id)?.name ?? null,
        customer_phone: contacts.get(r.user_id)?.phone ?? null,
      }));
    },
  });

  const registrations = useMemo(() => query.data ?? [], [query.data]);
  const counts = useMemo(() => registrationCounts(registrations), [registrations]);

  const patchLocal = (id: string, patch: Partial<ProviderRegistration>): Snapshot => {
    const previous = queryClient.getQueryData<ProviderRegistration[]>(key);
    queryClient.setQueryData<ProviderRegistration[]>(key, (rows) =>
      (rows ?? []).map((r) => (r.id === id ? { ...r, ...patch } : r)),
    );
    return { previous };
  };
  const rollback = (snap: Snapshot | undefined) => {
    if (snap?.previous) queryClient.setQueryData(key, snap.previous);
  };
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: [ACADEMY_REGISTRATIONS_KEY] });
    queryClient.invalidateQueries({ queryKey: [COURSE_SEATS_KEY] });
    queryClient.invalidateQueries({ queryKey: [PUBLIC_COURSES_KEY] });
  };

  const decide = useMutation({
    mutationFn: async (v: { registration: ProviderRegistration; decision: "confirmed" | "rejected"; courseName: string }) => {
      const { error } = await academyRpc("decide_course_registration", {
        p_registration_id: v.registration.id,
        p_decision: v.decision,
      });
      if (error) throw error;
    },
    onMutate: async (v) => {
      await queryClient.cancelQueries({ queryKey: key });
      return patchLocal(v.registration.id, { status: v.decision, decided_at: new Date().toISOString() });
    },
    onError: (_err, _v, snap) => rollback(snap),
    onSuccess: (_d, v) => {
      deliverCoursePush(v.decision === "confirmed" ? "confirmed" : "rejected", {
        courseName: v.courseName,
        providerId: v.registration.provider_id,
        customerUserId: v.registration.user_id,
      });
    },
    onSettled: refresh,
  });

  const cancelAsProvider = useMutation({
    mutationFn: async (v: { registration: ProviderRegistration; courseName: string }) => {
      const { error } = await academyRpc("cancel_course_registration", { p_registration_id: v.registration.id });
      if (error) throw error;
    },
    onMutate: async (v) => {
      await queryClient.cancelQueries({ queryKey: key });
      return patchLocal(v.registration.id, { status: "cancelled", cancelled_by: "provider" });
    },
    onError: (_err, _v, snap) => rollback(snap),
    onSuccess: (_d, v) => {
      deliverCoursePush("cancelled_by_provider", {
        courseName: v.courseName,
        providerId: v.registration.provider_id,
        customerUserId: v.registration.user_id,
      });
    },
    onSettled: refresh,
  });

  return { registrations, counts, isLoading: query.isLoading, decide, cancelAsProvider };
}
