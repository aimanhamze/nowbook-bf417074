/**
 * THE canonical "how many minutes does this booking occupy?" answer.
 *
 * Before `bookings.duration_override` existed this sum was open-coded in five
 * places (the customer slot pipeline, both CalendarTab views, and the
 * reschedule sheet). They had already drifted apart on their fallbacks, which
 * is exactly the kind of split `customerKey.ts` was written to kill — so the
 * override lands here once rather than in five near-copies.
 *
 * Mirrors `prevent_booking_conflicts()` (migration 20260830000002), which
 * computes the same value as
 *   COALESCE(duration_override, COALESCE(NULLIF(SUM(ps.duration), 0), 30))
 * on both sides of every overlap test. Keep the two in step: the trigger is the
 * guarantee, this helper is the UX that agrees with it.
 *
 * Services missing from `services` contribute 0, matching the trigger's
 * `ps.id = ANY(service_ids)` join — a service deleted since the booking was
 * made simply isn't summed. Only when NOTHING resolves does the 30-minute
 * floor apply, same as the trigger's NULLIF(...,0) guard.
 *
 * NOTE: a falsy `duration_override` (0) deliberately falls through to the
 * service sum. The CHECK constraint `bookings_duration_override_range` forbids
 * 0 in the first place, so this only ever fires on a NULL/undefined.
 */
export function bookingDuration(
  booking: { duration_override?: number | null; service_ids?: string[] },
  services: { id: string; duration: number }[],
): number {
  if (booking.duration_override) return booking.duration_override;
  return (
    (booking.service_ids || []).reduce((sum, id) => {
      const svc = services.find((s) => s.id === id);
      return sum + (svc?.duration ?? 0);
    }, 0) || 30
  );
}
