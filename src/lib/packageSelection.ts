// ─────────────────────────────────────────────────────────────────────────────
// "Which of this customer's packages do we show?"
//
// A customer accumulates packages over time — bought, spent, cancelled, bought
// again. Two surfaces need to collapse that history to ONE representative row:
// the packages tab list and the customers page badge. They must agree, or the
// same person appears active in one place and cancelled in the other.
// ─────────────────────────────────────────────────────────────────────────────
import type { PackageStatus } from "@/integrations/supabase/packageTypes";

/** The fields these helpers read. Structural, so any package-shaped row fits. */
export interface SelectablePackage {
  customer_id: string;
  status: PackageStatus;
  purchased_at: string;
}

/**
 * Lower number wins.
 *
 * Deliberately NOT plain recency: a customer who bought a package today and
 * had an older one cancelled should read as "active", and someone whose only
 * live package is pending should not be represented by a cancelled one from
 * last year. Cancelled ranks last precisely so it only ever surfaces when
 * there is genuinely nothing else.
 */
const STATUS_RANK: Record<PackageStatus, number> = {
  active: 0,
  pending_activation: 1,
  exhausted: 2,
  expired: 3,
  cancelled: 4,
};

/** Rank first, then most recent within the same rank. */
export function comparePackages(a: SelectablePackage, b: SelectablePackage): number {
  const rank = STATUS_RANK[a.status] - STATUS_RANK[b.status];
  if (rank !== 0) return rank;
  return b.purchased_at.localeCompare(a.purchased_at);
}

/** The single package that represents this set, or null for an empty set. */
export function pickPrimaryPackage<T extends SelectablePackage>(packages: T[]): T | null {
  if (packages.length === 0) return null;
  return [...packages].sort(comparePackages)[0];
}

/**
 * Group by customer, each group pre-sorted by the same rule.
 *
 * Keyed on `"u:" + customer_id` so it lines up with lib/customerKey, which is
 * what the customers page and the sell dropdown already key on. Packages
 * always belong to a registered account (customer_packages.customer_id is NOT
 * NULL against auth.users), so the "u:" branch is the only one reachable.
 */
export function groupPackagesByCustomerKey<T extends SelectablePackage>(
  packages: T[],
): Map<string, T[]> {
  const byCustomer = new Map<string, T[]>();
  for (const pkg of packages) {
    const key = `u:${pkg.customer_id}`;
    const existing = byCustomer.get(key);
    if (existing) existing.push(pkg);
    else byCustomer.set(key, [pkg]);
  }
  for (const list of byCustomer.values()) list.sort(comparePackages);
  return byCustomer;
}
