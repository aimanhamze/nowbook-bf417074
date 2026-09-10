import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useProviderProfile } from "./useProviderProfile";
import {
  pkgFrom,
  pkgRpc,
  updateBookingPackageFields,
  type PackageTemplateRow,
} from "@/integrations/supabase/packageTypes";

/**
 * Provider-side actions on a sold package.
 *
 * Everything that moves a balance goes through a `package_*` RPC rather than a
 * table write. package_usage_log has SELECT policies only — no INSERT policy —
 * so the ledger can be written solely by SECURITY DEFINER code. That is what
 * keeps entries_remaining and the audit trail from drifting apart: the RPC
 * takes the row lock, moves the balance and appends the log row in one
 * transaction, and a client that skipped the RPC could do neither.
 *
 * Check-in and package assignment are ordinary column writes and stay on the
 * table, guarded by the provider's own RLS policy on bookings.
 */
export function usePackageActions() {
  const queryClient = useQueryClient();
  const { profile } = useProviderProfile();

  // A balance change is visible in three places: the packages tab list, the
  // open history sheet, and the badge drawn on each booking card.
  const invalidatePackages = () => {
    queryClient.invalidateQueries({ queryKey: ["customer-packages"] });
    queryClient.invalidateQueries({ queryKey: ["package-history"] });
    queryClient.invalidateQueries({ queryKey: ["assignable-packages"] });
    queryClient.invalidateQueries({ queryKey: ["provider-bookings-enriched"] });
  };

  /**
   * Sell a package to a customer — the row every other action operates on.
   *
   * A plain insert, not an RPC: the provider's own RLS policy already scopes it
   * ("Provider manages own customer packages"), and no balance moves, so there
   * is nothing for the ledger to record yet. The clock does NOT start here —
   * activated_at/expires_at stay NULL until the first entry is spent, which is
   * handle_package_booking()'s job.
   *
   * entries_remaining and total_entries are SNAPSHOT from the template, so
   * later edits to the template never silently change a package already sold.
   */
  const sellPackage = useMutation({
    mutationFn: async (input: { customerId: string; templateId: string }) => {
      if (!profile) throw new Error("No provider profile");

      const { data, error: tplError } = await pkgFrom("package_templates")
        .select("total_entries")
        .eq("id", input.templateId)
        .single();
      if (tplError) throw new Error(tplError.message);
      const tpl = data as unknown as Pick<PackageTemplateRow, "total_entries">;

      const { error } = await pkgFrom("customer_packages").insert({
        customer_id: input.customerId,
        provider_id: profile.id,
        template_id: input.templateId,
        entries_remaining: tpl.total_entries,
        total_entries: tpl.total_entries,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: invalidatePackages,
  });

  /**
   * Provider cancels a sold package.
   *
   * Destructive by design: entries go to 0 and are NOT returned, and every
   * FUTURE confirmed booking on that package is cancelled. Past visits are left
   * alone — they already happened. The RPC marks the package 'cancelled' before
   * touching the bookings so the ordinary refund path skips them; otherwise
   * each cancellation would hand the forfeited entries straight back.
   */
  const cancelPackage = useMutation({
    mutationFn: async (input: { packageId: string; note?: string }) => {
      const { error } = await pkgRpc("package_cancel", {
        p_package_id: input.packageId,
        p_note: input.note?.trim() || null,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: invalidatePackages,
  });

  const activatePackage = useMutation({
    mutationFn: async (packageId: string) => {
      const { error } = await pkgRpc("package_activate", {
        p_package_id: packageId,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: invalidatePackages,
  });

  /** Grant entries, extend the expiry, or both. The RPC rejects (0, 0). */
  const addEntries = useMutation({
    mutationFn: async (input: {
      packageId: string;
      entries: number;
      extendDays: number;
      note?: string;
    }) => {
      const { error } = await pkgRpc("package_add_entries", {
        p_package_id: input.packageId,
        p_entries: input.entries,
        p_extend_days: input.extendDays,
        p_note: input.note?.trim() || null,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: invalidatePackages,
  });

  /**
   * Return an entry for a booking that was already checked in.
   *
   * handle_package_cancellation() deliberately skips checked-in bookings, so
   * this is the provider's judgement call and is logged as such.
   */
  const returnEntry = useMutation({
    mutationFn: async (input: { bookingId: string; note?: string }) => {
      const { error } = await pkgRpc("package_return_entry", {
        p_booking_id: input.bookingId,
        p_note: input.note?.trim() || null,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: invalidatePackages,
  });

  /** Mark arrival. Idempotent from the UI's side: the button is hidden once set. */
  const checkIn = useMutation({
    mutationFn: async (bookingId: string) => {
      const { error } = await updateBookingPackageFields(bookingId, {
        check_in_at: new Date().toISOString(),
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: invalidatePackages,
  });

  const undoCheckIn = useMutation({
    mutationFn: async (bookingId: string) => {
      const { error } = await updateBookingPackageFields(bookingId, {
        check_in_at: null,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: invalidatePackages,
  });

  /**
   * Point a booking at a package, move it to a different one, or detach it.
   *
   * The balance side is entirely the database's job: changing the column fires
   * trg_handle_package_reschedule (returns the entry to the OLD package) and
   * trg_handle_package_booking (deducts from the NEW one). Both raise on a
   * problem — PACKAGE_EXHAUSTED, PACKAGE_EXPIRED, PACKAGE_NOT_YOURS — which
   * surfaces here as a failed mutation, so the UI must show the error rather
   * than assume success.
   */
  const assignPackage = useMutation({
    mutationFn: async (input: {
      bookingId: string;
      packageId: string | null;
    }) => {
      const { error } = await updateBookingPackageFields(input.bookingId, {
        customer_package_id: input.packageId,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: invalidatePackages,
  });

  return {
    sellPackage,
    cancelPackage,
    activatePackage,
    addEntries,
    returnEntry,
    checkIn,
    undoCheckIn,
    assignPackage,
  };
}

/**
 * Turn a package error raised by the DB into a translation key.
 *
 * The triggers and RPCs raise bare, stable strings (PACKAGE_EXHAUSTED, …)
 * exactly as the existing booking triggers do with LEAD_TIME_VIOLATION and
 * DUPLICATE_USER_BOOKING, and CalendarTab already string-matches those. Falls
 * back to null so the caller can show the raw message for anything unmapped.
 */
export function packageErrorKey(message: string): string | null {
  if (message.includes("PACKAGES_FOR_CLASSES_ONLY")) return "packagesForClassesOnly";
  if (message.includes("PACKAGE_ALREADY_CANCELLED")) return "packageAlreadyCancelled";
  if (message.includes("PACKAGE_ALREADY_PENDING")) return "packageAlreadyPending";
  if (message.includes("TEMPLATE_NOT_AVAILABLE")) return "packageNotAvailable";
  if (message.includes("PACKAGES_FOR_FITNESS_ONLY")) return "packagesForClassesOnly";
  if (message.includes("NOT_AUTHENTICATED")) return "signInToManage";
  if (message.includes("PACKAGE_EXHAUSTED")) return "packageExhaustedError";
  if (message.includes("PACKAGE_EXPIRED")) return "packageExpiredError";
  if (message.includes("PACKAGE_NOT_YOURS")) return "packageNotYoursError";
  if (message.includes("PACKAGE_WRONG_PROVIDER")) return "packageNotYoursError";
  if (message.includes("PACKAGE_NOT_ACTIVE")) return "packageNotActiveError";
  if (message.includes("PACKAGE_NOT_PENDING")) return "packageNotPendingError";
  if (message.includes("PACKAGE_FORBIDDEN")) return "packageForbiddenError";
  if (message.includes("BOOKING_HAS_NO_PACKAGE")) return "packageNoneOnBooking";
  if (message.includes("NOTHING_TO_APPLY")) return "packageNothingToApply";
  if (message.includes("TEMPLATE_IN_USE")) return "packageTemplateInUse";
  return null;
}
