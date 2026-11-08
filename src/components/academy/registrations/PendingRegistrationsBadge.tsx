import { useAcademyRegistrations } from "@/hooks/useAcademyRegistrations";

/**
 * Amber count of pending course requests, for the dashboard's Registrations
 * tab. Its own component so only an academy dashboard (the only one with that
 * tab) mounts the registrations query. Shares the cache with the tab itself,
 * so an approve/reject updates the badge at once.
 */
export function PendingRegistrationsBadge() {
  const { counts } = useAcademyRegistrations();
  if (counts.pending === 0) return null;
  return (
    <span
      aria-label={String(counts.pending)}
      className="inline-flex min-w-[18px] items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-bold leading-[18px] text-white"
    >
      {counts.pending}
    </span>
  );
}
