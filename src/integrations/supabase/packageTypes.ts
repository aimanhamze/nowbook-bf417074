// ─────────────────────────────────────────────────────────────────────────────
// Hand-written types for the membership/package tables.
//
// WHY THIS FILE EXISTS — and when to delete it.
//
// `types.ts` is generated, and it is generated from PROD, which is the real
// record of the live schema (it still carries objects that exist only there,
// e.g. provider_staff_availability and the otp_cleanup/invalidate/mark_sent
// functions). The package tables live on DEV only until Phase 1 is approved
// for PROD, so regenerating types.ts from DEV would ADD the package tables at
// the cost of DELETING those PROD-only entries — trading one gap for a worse
// one.
//
// So: no hand-edit of the generated file, and no premature regeneration.
// This module types the three new tables narrowly instead.
//
// DELETE THIS FILE once Phase 1 ships to PROD and `types.ts` is regenerated
// from there — at that point `supabase.from("package_templates")` is typed on
// its own and `pkgFrom` is dead weight.
// ─────────────────────────────────────────────────────────────────────────────
import { supabase } from "./client";

export type PackageStatus =
  | "pending_activation"
  | "active"
  | "exhausted"
  | "expired"
  | "cancelled";

export type PackageUsageAction =
  | "entry_deducted"
  | "entry_returned_cancellation"
  | "entry_returned_manual"
  | "entry_added_manual"
  | "package_activated"
  | "package_exhausted"
  | "package_expired"
  | "package_extended"
  | "package_cancelled"
  | "package_requested";

/** public.package_templates — what a provider offers. */
export interface PackageTemplateRow {
  id: string;
  provider_id: string;
  name: string;
  description: string | null;
  total_entries: number;
  validity_days: number;
  price: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

/** public.customer_packages — what a customer bought. */
export interface CustomerPackageRow {
  id: string;
  customer_id: string;
  provider_id: string;
  template_id: string;
  entries_remaining: number;
  total_entries: number;
  status: PackageStatus;
  /** Stamped on FIRST entry used, not at purchase. NULL until then. */
  activated_at: string | null;
  /** activated_at + the template's validity_days. NULL until first use. */
  expires_at: string | null;
  last_low_entry_notified_at: string | null;
  purchased_at: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

/** public.package_usage_log — append-only audit of every entry movement. */
export interface PackageUsageLogRow {
  id: string;
  customer_package_id: string;
  booking_id: string | null;
  action_type: PackageUsageAction;
  entries_before: number;
  entries_after: number;
  performed_by: string | null;
  note: string | null;
  created_at: string;
}

type PackageTable =
  | "package_templates"
  | "customer_packages"
  | "package_usage_log";

/**
 * Query builder for the package tables.
 *
 * The cast is confined to this one function — every call site still annotates
 * its own result with the row interfaces above, so nothing downstream is
 * `any`. Reads go through here; WRITES that touch entries_remaining must NOT:
 * use the `package_*` RPCs in usePackageActions, which move the balance and
 * append the ledger row in one transaction. package_usage_log has no INSERT
 * policy precisely so that rule cannot be bypassed from the client.
 */
export function pkgFrom(table: PackageTable) {
  return (supabase as unknown as {
    from: (t: PackageTable) => ReturnType<typeof supabase.from<never>>;
  }).from(table);
}

/**
 * Write `bookings.check_in_at` / `bookings.customer_package_id`.
 *
 * Both columns are Phase-1 additions and are absent from the generated types
 * for the same reason as the tables above, so a plain `supabase.from("bookings")
 * .update({ check_in_at })` does not type-check. Scoped to exactly these two
 * fields so it can never become a general-purpose untyped booking writer.
 *
 * Changing customer_package_id fires trg_handle_package_reschedule (returns the
 * old package's entry) and trg_handle_package_booking (deducts from the new
 * one). Setting check_in_at fires nothing — it only changes whether a LATER
 * cancellation refunds automatically.
 */
export function updateBookingPackageFields(
  bookingId: string,
  patch: { check_in_at?: string | null; customer_package_id?: string | null },
) {
  return (supabase as unknown as {
    from: (t: "bookings") => {
      update: (v: Record<string, unknown>) => {
        eq: (
          col: string,
          val: string,
        ) => PromiseLike<{ error: { message: string } | null }>;
      };
    };
  })
    .from("bookings")
    .update(patch)
    .eq("id", bookingId);
}

/** Typed wrapper for the provider-only package RPCs. */
export function pkgRpc(
  fn:
    | "package_activate"
    | "package_add_entries"
    | "package_return_entry"
    | "package_cancel"
    | "package_request_purchase",
  args: Record<string, unknown>,
) {
  return (supabase as unknown as {
    rpc: (name: string, params: Record<string, unknown>) => PromiseLike<{
      data: unknown;
      error: { message: string } | null;
    }>;
  }).rpc(fn, args);
}
