import { useQuery } from "@tanstack/react-query";
import { useProviderProfile } from "./useProviderProfile";
import { academyFrom, type AcademyCourseSessionRow } from "@/integrations/supabase/academyTypes";
import { fetchAllPages } from "@/lib/fetchAll";
import { academyCalendarSessionsKey, type DateRange } from "@/lib/academyCalendar";

/**
 * The branch's course sessions inside ONE visible date range (a day, a week
 * or the displayed month), cached per range. Never the whole history: paging
 * back and forth re-uses each range's cache entry, and fetchAllPages makes a
 * busy month safe past PostgREST's 1000-row cap.
 */
export function useAcademyCalendarSessions(range: DateRange, enabled = true) {
  const { profile } = useProviderProfile();
  const providerId = profile?.id;
  const query = useQuery({
    queryKey: academyCalendarSessionsKey(providerId, range),
    staleTime: 60 * 1000,
    placeholderData: (previous) => previous,
    enabled: !!providerId && enabled,
    queryFn: async (): Promise<AcademyCourseSessionRow[]> => {
      if (!providerId) return [];
      return fetchAllPages<AcademyCourseSessionRow>(
        (from, to) =>
          academyFrom("academy_course_sessions")
            .select("*")
            .eq("provider_id", providerId)
            .gte("session_date", range.from)
            .lte("session_date", range.to)
            .order("session_date")
            .order("start_time")
            .order("id")
            .range(from, to) as unknown as PromiseLike<{ data: AcademyCourseSessionRow[] | null; error: unknown }>,
      );
    },
  });
  return { sessions: query.data ?? [], isLoading: query.isLoading, isFetching: query.isFetching };
}
