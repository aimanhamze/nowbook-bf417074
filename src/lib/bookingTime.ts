// ── booking_time normalisation ────────────────────────────────────────────────
//
// bookings.booking_time is a TEXT column holding "HH:MM". Every time the app
// GENERATES a time it is already zero-padded (useAllProviders.ts:604-606 builds
// slots with padStart), so nothing downstream ever had to defend against the
// unpadded form. Manual entry in the provider walk-in flow is the first source
// of hand-authored times, hence this helper.
//
// The DB is the LENIENT layer here, which is what makes an unpadded value
// dangerous rather than merely ugly: booking_time_to_minutes() uses split_part,
// so Postgres stores and compares "9:30" perfectly happily, and no trigger or
// constraint would reject it. The CLIENT is the strict one, and breaks silently
// in two places:
//
//   • Group capacity counting compares booking_time by EXACT string equality
//     (useAllProviders.ts:652: `b.booking_time === time`). "9:30" never matches
//     the grid's "09:30", so the slot reports capacity it does not have.
//   • Completed / past detection does new Date(`${date}T${time}`)
//     (CalendarTab.tsx:153 and :992). "…T9:30" is not a valid date string →
//     NaN → the comparison is always false → the booking never grays out.
//
// Both failures are silent. This normaliser is the only guard.

/**
 * Normalise a hand-entered time to zero-padded "HH:MM".
 * Returns null when the input is not a usable time (empty, partial, malformed,
 * or out of range) — callers treat null as "no time chosen" rather than
 * substituting a default, so a half-typed value can never be submitted.
 *
 * Accepts an optional seconds component ("09:30:00") because some browsers'
 * <input type="time"> emit it when `step` is finer than a minute; the seconds
 * are dropped, since booking_time is minute-resolution everywhere.
 */
export function normalizeBookingTime(raw: string): string | null {
  const m = /^\s*(\d{1,2}):(\d{2})(?::\d{2})?\s*$/.exec(raw);
  if (!m) return null;
  const hours = Number(m[1]);
  const minutes = Number(m[2]);
  if (hours > 23 || minutes > 59) return null;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}
