/**
 * Per-staff services (Phase 3): which staff members may be offered for a
 * given service.
 *
 * THE INHERITANCE RULE — everything here rests on it:
 *   a staff member with ZERO assignment rows performs ALL of the provider's
 *   services. Assignment only ever RESTRICTS. "Unrestricted" is stored as the
 *   ABSENCE of rows, never as a full set of rows.
 *
 * That asymmetry is the entire safety property of the feature. provider_staff_services
 * ships empty, so every provider who never opens the assignment UI has an empty
 * map here, every member falls through the "absent → include" branch, and the
 * result is the input list unchanged. Inverting this — treating "no rows" as
 * "performs nothing" — would empty the staff picker for every existing provider
 * at once, which is why the absent and empty cases below are spelled out
 * separately and tested separately rather than collapsed into one condition.
 *
 * Pure and provider-agnostic on purpose: the customer flow (BookAppointment)
 * and the walk-in sheet (NewBookingSheet) must filter IDENTICALLY, and the only
 * way to guarantee that is for both to call the same function rather than each
 * re-deriving the rule from the map.
 */

/** Minimal shape this module needs — the real staff rows carry name/display_order too. */
export interface StaffMemberLike {
  id: string;
}

/**
 * Filters `staff` down to those who perform `serviceId`.
 *
 * @param staff            active staff, already ordered by the caller's query
 * @param servicesByStaff  staff_id → set of assigned service_ids. A staff id
 *                         MISSING from this map is unrestricted (see above).
 * @param serviceId        the service being booked. `undefined` means "no
 *                         service chosen yet" — there is nothing to filter by,
 *                         so the list passes through untouched. This is not a
 *                         defensive nicety: both flows render before a service
 *                         is picked, and returning [] there would flicker the
 *                         staff step out of existence on every first paint.
 *
 * Order is preserved (display_order, then name) — filtering never reshuffles
 * the picker.
 */
export function eligibleStaffForService<T extends StaffMemberLike>(
  staff: readonly T[],
  servicesByStaff: ReadonlyMap<string, ReadonlySet<string>>,
  serviceId: string | undefined
): T[] {
  if (!serviceId) return [...staff];

  return staff.filter((member) => {
    const assigned = servicesByStaff.get(member.id);

    // ABSENT from the map → unrestricted → performs everything.
    if (assigned === undefined) return true;

    // PRESENT but EMPTY → also unrestricted. The writer (useProviderStaffServices)
    // deletes the rows outright rather than storing an empty set, so this should
    // be unreachable from our own data. It is handled explicitly anyway because
    // the alternative reading — "assigned to nothing, so show them for nothing" —
    // is the one failure mode that silently removes a working staff member, and
    // a map built by any future caller must not be able to trip it.
    if (assigned.size === 0) return true;

    return assigned.has(serviceId);
  });
}
