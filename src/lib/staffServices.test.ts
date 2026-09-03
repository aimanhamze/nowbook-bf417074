import { describe, it, expect } from "vitest";
import { eligibleStaffForService } from "./staffServices";

const ana = { id: "staff-ana", name: "Ana" };
const ben = { id: "staff-ben", name: "Ben" };
const cara = { id: "staff-cara", name: "Cara" };
const staff = [ana, ben, cara];

const HAIRCUT = "svc-haircut";
const COLOUR = "svc-colour";

/** Builds the staff_id → Set(service_id) map the hooks produce. */
function assignments(entries: Record<string, string[]>): Map<string, Set<string>> {
  return new Map(Object.entries(entries).map(([k, v]) => [k, new Set(v)]));
}

describe("eligibleStaffForService", () => {
  // THE GUARANTEE that protects every existing provider. provider_staff_services
  // ships empty, so this is the state of every provider who never opens the
  // assignment UI — and their picker must be byte-identical to before Phase 3.
  describe("a provider with no assignments at all", () => {
    it("returns every staff member, untouched", () => {
      expect(eligibleStaffForService(staff, new Map(), HAIRCUT)).toEqual(staff);
    });

    it("returns them for any service, including one nobody has heard of", () => {
      expect(eligibleStaffForService(staff, new Map(), "svc-that-does-not-exist")).toEqual(staff);
    });

    it("preserves the query's order (display_order, then name)", () => {
      const reversed = [cara, ben, ana];
      expect(eligibleStaffForService(reversed, new Map(), HAIRCUT)).toEqual(reversed);
    });
  });

  describe("the inheritance rule", () => {
    it("includes a staff member ABSENT from the map — absence means unrestricted", () => {
      // Only Ana is restricted; Ben and Cara have no rows and so perform everything.
      const map = assignments({ [ana.id]: [COLOUR] });
      expect(eligibleStaffForService(staff, map, HAIRCUT)).toEqual([ben, cara]);
    });

    // Emptiness must never read as "performs nothing" — that inversion is the one
    // failure mode that silently removes a working staff member.
    it("includes a staff member PRESENT with an empty set", () => {
      const map = assignments({ [ana.id]: [] });
      expect(eligibleStaffForService(staff, map, HAIRCUT)).toEqual(staff);
    });

    it("includes a restricted member for a service they DO perform", () => {
      const map = assignments({ [ana.id]: [HAIRCUT] });
      expect(eligibleStaffForService(staff, map, HAIRCUT)).toEqual(staff);
    });

    it("excludes a restricted member for a service they do NOT perform", () => {
      const map = assignments({ [ana.id]: [COLOUR] });
      expect(eligibleStaffForService(staff, map, HAIRCUT)).not.toContain(ana);
    });

    it("assignment only ever restricts — it never adds anyone back", () => {
      const map = assignments({ [ana.id]: [HAIRCUT, COLOUR] });
      const result = eligibleStaffForService([ana], map, HAIRCUT);
      expect(result).toEqual([ana]);
      expect(result.length).toBeLessThanOrEqual(1);
    });
  });

  describe("no service chosen yet", () => {
    // Both flows render before a service is picked. Returning [] here would
    // flicker the staff step out of existence on first paint.
    it("passes the whole list through when serviceId is undefined", () => {
      const map = assignments({ [ana.id]: [COLOUR] });
      expect(eligibleStaffForService(staff, map, undefined)).toEqual(staff);
    });

    it("treats an empty-string serviceId the same way", () => {
      const map = assignments({ [ana.id]: [COLOUR] });
      expect(eligibleStaffForService(staff, map, "")).toEqual(staff);
    });
  });

  describe("everyone restricted away from the service", () => {
    // This drives the approved fallback: staffStepEnabled goes false, the step
    // disappears and the booking inserts staff_id NULL — the same graceful path
    // a provider with zero active staff already takes. The service stays bookable.
    it("returns an empty list rather than throwing or falling back to all", () => {
      const map = assignments({
        [ana.id]: [COLOUR],
        [ben.id]: [COLOUR],
        [cara.id]: [COLOUR],
      });
      expect(eligibleStaffForService(staff, map, HAIRCUT)).toEqual([]);
    });
  });

  describe("edge cases from real data", () => {
    it("ignores assignment rows for staff who are no longer in the active list", () => {
      // A deactivated member keeps their rows (is_active is a soft delete), but
      // they never reach this function — the caller passes activeStaff only.
      const map = assignments({ "staff-departed": [HAIRCUT], [ana.id]: [COLOUR] });
      expect(eligibleStaffForService(staff, map, HAIRCUT)).toEqual([ben, cara]);
    });

    it("ignores assignment rows pointing at a soft-deleted service", () => {
      // Ana is assigned to a service that has since been deactivated. That row
      // restricts her away from HAIRCUT just as any other non-matching row does.
      const map = assignments({ [ana.id]: ["svc-soft-deleted"] });
      expect(eligibleStaffForService(staff, map, HAIRCUT)).toEqual([ben, cara]);
    });

    it("does not mutate the input list", () => {
      const input = [...staff];
      const map = assignments({ [ana.id]: [COLOUR] });
      eligibleStaffForService(input, map, HAIRCUT);
      expect(input).toEqual(staff);
    });

    it("returns a new array, never the input reference", () => {
      // Callers derive from this on every render; handing back the same array
      // would make an accidental in-place sort corrupt the query cache.
      const map = new Map<string, Set<string>>();
      expect(eligibleStaffForService(staff, map, HAIRCUT)).not.toBe(staff);
    });

    it("handles an empty staff list", () => {
      expect(eligibleStaffForService([], assignments({ [ana.id]: [HAIRCUT] }), HAIRCUT)).toEqual([]);
    });
  });
});
