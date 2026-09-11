import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { providerDesktopSheet } from "@/components/layout/providerDesktop";
import { useLang } from "@/contexts/LangContext";
import { usePackageTemplates } from "@/hooks/usePackageTemplates";
import { useProviderCustomers } from "@/hooks/useProviderCustomers";
import { usePackageActions, packageErrorKey } from "@/hooks/usePackageActions";
import { isRegisteredKey } from "@/lib/customerKey";
import { toast } from "sonner";

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
      const message = err instanceof Error ? err.message : String(err);
      const key = packageErrorKey(message);
      toast.error(key ? t(key as never) : message);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className={`rounded-t-3xl ${providerDesktopSheet}`}>
        <SheetHeader>
          <SheetTitle>{t("sellPackage")}</SheetTitle>
        </SheetHeader>

        <div className="space-y-4 py-4">
          {registered.length === 0 ? (
            <p className="py-4 text-center text-xs text-muted-foreground">
              {t("noRegisteredCustomers")}
            </p>
          ) : activeTemplates.length === 0 ? (
            // Nothing to sell. Saying so beats an empty dropdown.
            <p className="py-4 text-center text-xs text-muted-foreground">
              {t("noPackageTemplates")}
            </p>
          ) : (
            <>
              {presetCustomer ? (
                <div className="rounded-xl border border-border bg-secondary/40 px-3 py-2">
                  <p className="text-xs font-semibold">
                    {presetCustomer.name || presetCustomer.phone || "—"}
                  </p>
                  {presetCustomer.phone && (
                    <p className="text-[11px] text-muted-foreground">{presetCustomer.phone}</p>
                  )}
                </div>
              ) : (
                <div className="space-y-1.5">
                  <Label className="text-xs">{t("selectCustomer")}</Label>
                  <div className="relative">
                    <Search className="pointer-events-none absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground [inset-inline-start:0.65rem]" />
                    <Input
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder={t("searchCustomer")}
                      className="h-9 text-xs [padding-inline-start:2rem]"
                    />
                  </div>
                  <Select value={customerKey} onValueChange={setCustomerKey}>
                    <SelectTrigger>
                      <SelectValue placeholder={t("selectCustomer")} />
                    </SelectTrigger>
                    <SelectContent>
                      {filtered.length === 0 ? (
                        <div className="px-2 py-3 text-center text-[11px] text-muted-foreground">
                          {t("noCustomersMatch")}
                        </div>
                      ) : (
                        filtered.map((c) => (
                          <SelectItem key={c.key} value={c.key}>
                            <span className="flex flex-col items-start">
                              <span>{c.name || c.phone || "—"}</span>
                              <span className="text-[10px] text-muted-foreground">
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
              )}

              <div className="space-y-1.5">
                <Label className="text-xs">{t("selectPackageType")}</Label>
                <Select value={templateId} onValueChange={setTemplateId}>
                  <SelectTrigger>
                    <SelectValue placeholder={t("selectPackageType")} />
                  </SelectTrigger>
                  <SelectContent>
                    {activeTemplates.map((tpl) => (
                      <SelectItem key={tpl.id} value={tpl.id}>
                        {tpl.name} · {tpl.total_entries} {t("entriesShort")} · ₪{tpl.price}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <Button
                className="w-full"
                onClick={handleSave}
                disabled={sellPackage.isPending || !customerKey || !templateId}
              >
                {sellPackage.isPending ? "..." : t("save")}
              </Button>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
