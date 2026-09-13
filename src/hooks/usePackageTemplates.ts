import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useProviderProfile } from "./useProviderProfile";
import { pkgFrom, type PackageTemplateRow } from "@/integrations/supabase/packageTypes";

export interface PackageTemplateInput {
  id?: string;
  name: string;
  description: string | null;
  total_entries: number;
  validity_days: number;
  price: number;
  is_active: boolean;
}

/**
 * CRUD for the provider's package offerings (public.package_templates).
 *
 * Deliberately fetches INACTIVE templates too — this is the management list,
 * and a provider must be able to see and re-enable something they switched
 * off. The customer-facing side filters on is_active via RLS
 * ("Anyone can view active templates").
 */
export function usePackageTemplates() {
  const { profile } = useProviderProfile();
  const queryClient = useQueryClient();

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["package-templates"] });
    // A renamed or deactivated template changes what the customer-package list
    // renders, since that list resolves template names by id.
    queryClient.invalidateQueries({ queryKey: ["customer-packages"] });
  };

  const templatesQuery = useQuery({
    queryKey: ["package-templates", profile?.id],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      if (!profile) return [] as PackageTemplateRow[];
      const { data, error } = await pkgFrom("package_templates")
        .select("*")
        .eq("provider_id", profile.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as PackageTemplateRow[];
    },
    enabled: !!profile,
  });

  const upsertTemplate = useMutation({
    mutationFn: async (input: PackageTemplateInput) => {
      if (!profile) throw new Error("No provider profile");
      const payload = {
        name: input.name.trim(),
        description: input.description?.trim() || null,
        total_entries: input.total_entries,
        validity_days: input.validity_days,
        price: input.price,
        is_active: input.is_active,
        updated_at: new Date().toISOString(),
      };
      if (input.id) {
        const { error } = await pkgFrom("package_templates")
          .update(payload)
          .eq("id", input.id);
        if (error) throw error;
      } else {
        const { error } = await pkgFrom("package_templates")
          .insert({ provider_id: profile.id, ...payload });
        if (error) throw error;
      }
    },
    onSuccess: invalidate,
  });

  /**
   * Hard DELETE, but only when nothing depends on the template.
   *
   * customer_packages.template_id is a plain FK with no ON DELETE action, so
   * the database would reject a delete that orphans a sold package anyway.
   * Checking first turns that raw FK violation into a message the provider can
   * act on, and covers the softer case too: a package that is exhausted or
   * expired still needs its template row to render its name in history.
   */
  const deleteTemplate = useMutation({
    mutationFn: async (id: string) => {
      const { data: inUse, error: checkErr } = await pkgFrom("customer_packages")
        .select("id")
        .eq("template_id", id)
        .limit(1);
      if (checkErr) throw checkErr;
      if (inUse && inUse.length > 0) throw new Error("TEMPLATE_IN_USE");

      const { error } = await pkgFrom("package_templates").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const toggleActive = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await pkgFrom("package_templates")
        .update({ is_active, updated_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  return {
    templates: templatesQuery.data ?? [],
    isLoading: templatesQuery.isLoading,
    error: templatesQuery.error,
    upsertTemplate,
    deleteTemplate,
    toggleActive,
  };
}
