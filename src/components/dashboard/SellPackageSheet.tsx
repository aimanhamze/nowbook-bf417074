import { useEffect, useState } from "react";
import { Search, UserPlus } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useLang } from "@/contexts/LangContext";
import { usePackageTemplates } from "@/hooks/usePackageTemplates";
import { useProviderCustomers } from "@/hooks/useProviderCustomers";
import { usePackageActions, packageErrorKey } from "@/hooks/usePackageActions";
import { isRegisteredKey } from "@/lib/customerKey";
import { toast } from "sonner";
import { supabaseErrorMessage } from "@/lib/supabaseError";
import { EditSheet, Field } from "./SettingsRows";

/**
 * Sell a package to one of the provider's existing customers.
 *
 * Self-contained (fetches its own templates and customers) so it can be opened
 * from both the packages tab and the customers page without either owning the
 * other's state. `presetCustomerKey` pre-selects and hides the picker, which is
 * the customers-page path — you already said who you mean by tapping their row.
 */
export function SellPackageSheet({
  open,
  onOpenChange,
  presetCustomerKey,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  presetCustomerKey?: string | null;
}) {
  const { t } = useLang();
  const { templates } = usePackageTemplates();
  const { data: allCustomers = [] } = useProviderCustomers();
  const { sellPackage } = usePackageActions();

  const [customerKey, setCustomerKey] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [search, setSearch] = useState("");

  // Reset on every open so a previous selection never leaks into the next sale.
  useEffect(() => {
    if (open) {
      setCustomerKey(presetCustomerKey ?? "");
      setTemplateId("");
      setSearch("");
    }
  }, [open, presetCustomerKey]);

  // A package needs an account to belong to (customer_packages.customer_id is
  // NOT NULL against auth.users), so phone-only walk-ins cannot hold one.
  const registered = allCustomers.filter((c) => isRegisteredKey(c.key));

  const term = search.trim().toLowerCase();
  const digits = search.replace(/\D/g, "");
  const filtered = registered.filter((c) => {
    if (!term) return true;
    const byName = (c.name || "").toLowerCase().includes(term);
    const byPhone = digits.length > 0 && (c.phone || "").replace(/\D/g, "").includes(digits);
    return byName || byPhone;
  });

  const activeTemplates = templates.filter((tpl) => tpl.is_active);
  const presetCustomer = presetCustomerKey
    ? registered.find((c) => c.key === presetCustomerKey)
    : undefined;

  const handleSave = async () => {
    if (!customerKey || !templateId) return;
    try {
      await sellPackage.mutateAsync({
        // "u:<uuid>" -> the account id. See lib/customerKey for the format.
        customerId: customerKey.slice(2),
        templateId,
      });
      toast.success(t("packageSoldToast"));
      onOpenChange(false);
    } catch (err) {
      // supabase-js throws plain objects, not Errors (see lib/supabaseError).
    const message = supabaseErrorMessage(err, "");
      const key = packageErrorKey(message);
      toast.error(key ? t(key as never) : t("bsSaveError"));
    }
  };

  const canSell = registered.length > 0 && activeTemplates.length > 0;

  // Same shell as the other dashboard editors. The Save button only appears
  // when there is something to sell, exactly as before.
  return (
    <EditSheet
      open={open}
      onClose={() => { if (!sellPackage.isPending) onOpenChange(false); }}
      icon={UserPlus}
      title={t("sellPackage")}
      onSave={canSell ? handleSave : undefined}
      saving={sellPackage.isPending}
      saveDisabled={!customerKey || !templateId}
    >
      {registered.length === 0 ? (
        <p className="py-4 text-center text-sm text-foreground/60">{t("noRegisteredCustomers")}</p>
      ) : activeTemplates.length === 0 ? (
        // Nothing to sell. Saying so beats an empty dropdown.
        <p className="py-4 text-center text-sm text-foreground/60">{t("noPackageTemplates")}</p>
      ) : (
        <>
          {presetCustomer ? (
            <div className="rounded-2xl border border-foreground/10 bg-white px-4 py-3">
              <p className="text-sm font-semibold">{presetCustomer.name || presetCustomer.phone || "—"}</p>
              {presetCustomer.phone && (
                <p dir="ltr" className="text-start text-xs text-foreground/60 [unicode-bidi:plaintext]">{presetCustomer.phone}</p>
              )}
            </div>
          ) : (
            <Field label={t("selectCustomer")}>
              <div className="space-y-2">
                <div className="relative">
                  <Search className="pointer-events-none absolute top-1/2 h-4 w-4 -translate-y-1/2 text-foreground/40 [inset-inline-start:0.85rem]" />
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder={t("searchCustomer")}
                    aria-label={t("searchCustomer")}
                    className="h-12 rounded-xl [padding-inline-start:2.5rem]"
                  />
                </div>
                <Select value={customerKey} onValueChange={setCustomerKey}>
                  <SelectTrigger className="h-12 rounded-xl" aria-label={t("selectCustomer")}>
                    <SelectValue placeholder={t("selectCustomer")} />
                  </SelectTrigger>
                  <SelectContent>
                    {filtered.length === 0 ? (
                      <div className="px-2 py-3 text-center text-xs text-muted-foreground">
                        {t("noCustomersMatch")}
                      </div>
                    ) : (
                      filtered.map((c) => (
                        <SelectItem key={c.key} value={c.key} className="min-h-11">
                          <span className="flex flex-col items-start">
                            <span>{c.name || c.phone || "—"}</span>
                            <span className="text-[11px] text-muted-foreground">
                              {c.phone}
                              {c.lastVisit ? ` · ${t("lastVisit")} ${c.lastVisit}` : ""}
                            </span>
                          </span>
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              </div>
            </Field>
          )}

          <Field label={t("selectPackageType")}>
            <Select value={templateId} onValueChange={setTemplateId}>
              <SelectTrigger className="h-12 rounded-xl" aria-label={t("selectPackageType")}>
                <SelectValue placeholder={t("selectPackageType")} />
              </SelectTrigger>
              <SelectContent>
                {activeTemplates.map((tpl) => (
                  <SelectItem key={tpl.id} value={tpl.id} className="min-h-11">
                    {tpl.name} · {tpl.total_entries} {t("entriesShort")} · ₪{tpl.price}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </>
      )}
    </EditSheet>
  );
}
