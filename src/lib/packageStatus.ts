// ─────────────────────────────────────────────────────────────────────────────
// Display state for a customer package.
//
// Kept here rather than inline in a component because two surfaces need the
// same answer — the packages tab list and the badge on a booking card — and
// they must never disagree about whether a package reads as expired.
//
// The important rule: an EXPIRED package is one whose expires_at has passed,
// regardless of what the `status` column says. Nothing sweeps expired packages
// yet (that needs a scheduled job, and pg_cron is not installed on this
// project), so rows sit at status = 'active' well past their expiry date.
// Reading the date keeps the UI honest whether or not a sweep ever runs.
// ─────────────────────────────────────────────────────────────────────────────
import type { PackageStatus } from "@/integrations/supabase/packageTypes";

/** The fields these helpers read. Structural, so any package-shaped row fits. */
export interface PackageStatusFields {
  status: PackageStatus;
  entries_remaining: number;
  expires_at: string | null;
}

export type PackageDisplayStatus =
  | "pendingActivation"
  | "packageActive"
  | "packageExhausted"
  | "packageExpired"
  | "packageCancelled";

/** Past its expiry date, whatever the status column currently holds. */
export function isPastExpiry(pkg: PackageStatusFields, now: number = Date.now()): boolean {
  return pkg.expires_at != null && new Date(pkg.expires_at).getTime() < now;
}

/**
 * The translation key naming this package's state.
 *
 * Precedence — expired first, because an expired package cannot be spent even
 * with entries left, and handle_package_booking() raises PACKAGE_EXPIRED
 * before it ever checks the balance. Showing "active" on a row the database
 * will refuse is the one outcome worth ruling out.
 */
export function packageStatusLabel(
  pkg: PackageStatusFields,
  now: number = Date.now(),
): PackageDisplayStatus {
  // Cancelled outranks everything: a provider-cancelled package is dead
  // regardless of its balance or expiry date.
  if (pkg.status === "cancelled") return "packageCancelled";
  if (pkg.status === "expired" || isPastExpiry(pkg, now)) return "packageExpired";
  if (pkg.status === "exhausted" || pkg.entries_remaining <= 0) return "packageExhausted";
  if (pkg.status === "pending_activation") return "pendingActivation";
  return "packageActive";
}

const BADGE_CLASSES: Record<PackageDisplayStatus, string> = {
  pendingActivation: "bg-amber-50 text-amber-700 border-amber-200",
  packageActive: "bg-emerald-50 text-emerald-700 border-emerald-200",
  packageExhausted: "bg-secondary text-muted-foreground border-border",
  packageExpired: "bg-rose-50 text-rose-700 border-rose-200",
  packageCancelled: "bg-rose-100 text-rose-800 border-rose-300",
};

export function packageStatusClass(pkg: PackageStatusFields, now: number = Date.now()): string {
  return BADGE_CLASSES[packageStatusLabel(pkg, now)];
}

/**
 * Whether this package can still pay for a new booking.
 *
 * Mirrors handle_package_booking exactly: 'active' only. A package awaiting
 * activation is NOT spendable — payment happens outside the app, so activating
 * is how the provider confirms they were paid.
 */
export function isSpendable(pkg: PackageStatusFields, now: number = Date.now()): boolean {
  return (
    pkg.status === "active" &&
    pkg.entries_remaining > 0 &&
    !isPastExpiry(pkg, now)
  );
}
