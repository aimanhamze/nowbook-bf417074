import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import {
  pkgFrom,
  pkgRpc,
  type PackageTemplateRow,
  type CustomerPackageRow,
} from "@/integrations/supabase/packageTypes";

/**
 * Package offerings a CUSTOMER can see on a provider's profile.
 *
 * Reads through the "Anyone can view active templates" policy, which filters to
 * is_active = true in the database — the extra `.eq` here is belt-and-braces so
 * the intent is readable at the call site.
 *
 * Packages are a fitness_studio feature (group classes only), so the caller is
 * expected to gate on category before rendering; a non-fitness provider simply
 * has no rows.
 */
export function useProviderPackages(providerId: string | undefined) {
  return useQuery({
    queryKey: ["public-package-templates", providerId],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      if (!providerId) return [] as PackageTemplateRow[];
      const { data, error } = await pkgFrom("package_templates")
        .select("*")
        .eq("provider_id", providerId)
        .eq("is_active", true)
        .order("price", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as PackageTemplateRow[];
    },
    enabled: !!providerId,
  });
}

/**
 * The signed-in customer's own packages at one provider.
 *
 * Backs the "you already have a request pending" state on the profile page, so
 * the purchase button can be disabled before the RPC rejects with
 * PACKAGE_ALREADY_PENDING rather than after.
 */
export function useMyPackagesAt(providerId: string | undefined) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["my-packages-at", providerId, user?.id],
    queryFn: async () => {
      if (!providerId || !user) return [] as CustomerPackageRow[];
      const { data, error } = await pkgFrom("customer_packages")
        .select("*")
        .eq("provider_id", providerId)
        .eq("customer_id", user.id);
      if (error) throw error;
      return (data ?? []) as unknown as CustomerPackageRow[];
    },
    enabled: !!providerId && !!user,
  });
}

export interface MyPackage extends CustomerPackageRow {
  provider_name: string | null;
  template_name: string | null;
}

/**
 * Every package the signed-in customer holds, across all providers, with the
 * provider and template names resolved.
 *
 * Reads through the customer's own "Customer views own packages" policy — no
 * provider involvement, no RPC. Exhausted, expired and cancelled packages are
 * excluded: this backs a "what can I still use" strip, not a history view.
 * Ordering puts the most-recently-bought first.
 */
export function useMyPackages() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["my-packages", user?.id],
    queryFn: async () => {
      if (!user) return [] as MyPackage[];

      const { data, error } = await pkgFrom("customer_packages")
        .select("*")
        .eq("customer_id", user.id)
        .in("status", ["pending_activation", "active"])
        .order("purchased_at", { ascending: false });
      if (error) throw error;

      const rows = (data ?? []) as unknown as CustomerPackageRow[];
      if (rows.length === 0) return [] as MyPackage[];

      // provider_profiles is public-read; package_templates is public-read for
      // active rows. A template the provider later deactivated resolves to
      // null and the card falls back to showing just the balance.
      const [{ data: providers }, { data: templates }] = await Promise.all([
        supabase
          .from("provider_profiles")
          .select("id, business_name")
          .in("id", [...new Set(rows.map((r) => r.provider_id))]),
        pkgFrom("package_templates")
          .select("id, name")
          .in("id", [...new Set(rows.map((r) => r.template_id))]),
      ]);

      const providerMap = new Map(
        (providers ?? []).map((p) => [p.id, p.business_name as string]),
      );
      const templateMap = new Map(
        ((templates ?? []) as unknown as { id: string; name: string }[])
          .map((tpl) => [tpl.id, tpl.name]),
      );

      return rows.map((r): MyPackage => ({
        ...r,
        provider_name: providerMap.get(r.provider_id) ?? null,
        template_name: templateMap.get(r.template_id) ?? null,
      }));
    },
    enabled: !!user,
  });
}

/**
 * Ask the provider to sell you a package.
 *
 * Goes through package_request_purchase() rather than an INSERT: customers have
 * no write policy on customer_packages, and a direct insert would let them pick
 * their own entries_remaining, total_entries and status. The RPC copies every
 * value from the template server-side, forces status = 'pending_activation',
 * refuses a second outstanding request, and notifies the provider.
 *
 * Payment happens outside the app — the provider activates once they have it.
 */
export function useRequestPackage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (templateId: string) => {
      const { error } = await pkgRpc("package_request_purchase", {
        p_template_id: templateId,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["my-packages-at"] });
      queryClient.invalidateQueries({ queryKey: ["customer-packages"] });
    },
  });
}
