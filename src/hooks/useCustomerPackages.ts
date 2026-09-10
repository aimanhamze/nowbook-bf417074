import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useProviderProfile } from "./useProviderProfile";
import {
  pkgFrom,
  type CustomerPackageRow,
  type PackageTemplateRow,
  type PackageUsageLogRow,
} from "@/integrations/supabase/packageTypes";

export interface EnrichedCustomerPackage extends CustomerPackageRow {
  customer_name: string | null;
  customer_phone: string | null;
  template_name: string | null;
  /**
   * True once the package is past its expiry date, computed at read time
   * rather than trusted from `status`.
   *
   * Nothing sweeps expired packages yet — that is a cron-driven job and
   * pg_cron is not installed on this project — so a package can sit at
   * status = 'active' with an expires_at in the past. Reading the date makes
   * the UI correct regardless of whether a sweep ever runs.
   */
  is_past_expiry: boolean;
}

/**
 * Every package this provider has sold, newest first, with the customer's name
 * and the template's name resolved.
 *
 * customer_id points at auth.users, so the display name and phone come from
 * `profiles` (keyed on user_id) exactly as useProviderBookings resolves them.
 * customer_packages.customer_id is NOT NULL, so unlike bookings there is no
 * walk-in case to handle here — a package always belongs to a real account.
 */
export function useCustomerPackages() {
  const { profile } = useProviderProfile();

  return useQuery({
    queryKey: ["customer-packages", profile?.id],
    queryFn: async () => {
      if (!profile) return [] as EnrichedCustomerPackage[];

      const { data, error } = await pkgFrom("customer_packages")
        .select("*")
        .eq("provider_id", profile.id)
        .order("purchased_at", { ascending: false });
      if (error) throw error;

      const packages = (data ?? []) as unknown as CustomerPackageRow[];
      if (packages.length === 0) return [] as EnrichedCustomerPackage[];

      const customerIds = [...new Set(packages.map((p) => p.customer_id))];
      const templateIds = [...new Set(packages.map((p) => p.template_id))];

      const [{ data: profiles }, { data: templates }] = await Promise.all([
        supabase
          .from("profiles")
          .select("user_id, display_name, phone")
          .in("user_id", customerIds),
        pkgFrom("package_templates").select("id, name").in("id", templateIds),
      ]);

      const profileMap = new Map(
        (profiles ?? []).map((p) => [p.user_id, p]),
      );
      const templateMap = new Map(
        ((templates ?? []) as unknown as Pick<PackageTemplateRow, "id" | "name">[])
          .map((tpl) => [tpl.id, tpl.name]),
      );

      const now = Date.now();
      return packages.map((p): EnrichedCustomerPackage => {
        const customer = profileMap.get(p.customer_id);
        return {
          ...p,
          customer_name: customer?.display_name ?? null,
          customer_phone: customer?.phone ?? null,
          template_name: templateMap.get(p.template_id) ?? null,
          is_past_expiry:
            p.expires_at != null && new Date(p.expires_at).getTime() < now,
        };
      });
    },
    enabled: !!profile,
  });
}

/**
 * The audit trail for one package, oldest first so it reads as a story.
 *
 * Only fetched when a history view is actually open (`enabled`), since this is
 * per-package detail nobody needs while browsing the list.
 */
export function usePackageHistory(customerPackageId: string | null) {
  return useQuery({
    queryKey: ["package-history", customerPackageId],
    queryFn: async () => {
      if (!customerPackageId) return [] as PackageUsageLogRow[];
      const { data, error } = await pkgFrom("package_usage_log")
        .select("*")
        .eq("customer_package_id", customerPackageId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as PackageUsageLogRow[];
    },
    enabled: !!customerPackageId,
  });
}

/**
 * The packages a given customer can still spend at this provider, for the
 * assign-to-booking dropdown.
 *
 * 'pending_activation' is included on purpose: handle_package_booking() accepts
 * both it and 'active', so a package the provider has not formally activated
 * yet still pays for a booking. Excluding it here would hide a package the
 * database would happily accept.
 */
export function useAssignablePackages(customerId: string | null) {
  const { profile } = useProviderProfile();

  return useQuery({
    queryKey: ["assignable-packages", profile?.id, customerId],
    queryFn: async () => {
      if (!profile || !customerId) return [] as EnrichedCustomerPackage[];
      const { data, error } = await pkgFrom("customer_packages")
        .select("*")
        .eq("provider_id", profile.id)
        .eq("customer_id", customerId)
        .in("status", ["pending_activation", "active"])
        .gt("entries_remaining", 0);
      if (error) throw error;

      const packages = (data ?? []) as unknown as CustomerPackageRow[];
      if (packages.length === 0) return [] as EnrichedCustomerPackage[];

      const { data: templates } = await pkgFrom("package_templates")
        .select("id, name")
        .in("id", [...new Set(packages.map((p) => p.template_id))]);
      const templateMap = new Map(
        ((templates ?? []) as unknown as Pick<PackageTemplateRow, "id" | "name">[])
          .map((tpl) => [tpl.id, tpl.name]),
      );

      const now = Date.now();
      return packages
        .map((p): EnrichedCustomerPackage => ({
          ...p,
          customer_name: null,
          customer_phone: null,
          template_name: templateMap.get(p.template_id) ?? null,
          is_past_expiry:
            p.expires_at != null && new Date(p.expires_at).getTime() < now,
        }))
        // handle_package_booking() raises PACKAGE_EXPIRED for these, so offering
        // them would only produce a failed assignment.
        .filter((p) => !p.is_past_expiry);
    },
    enabled: !!profile && !!customerId,
  });
}
