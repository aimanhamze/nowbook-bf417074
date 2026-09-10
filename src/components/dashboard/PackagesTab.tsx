import { useState } from "react";
import { Plus, Pencil, Trash2, Ticket, History, PlusCircle, CheckCircle2, CalendarClock, UserPlus, Ban, Search } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { format, parseISO } from "date-fns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
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
import { usePackageTemplates, type PackageTemplateInput } from "@/hooks/usePackageTemplates";
import { useCustomerPackages, type EnrichedCustomerPackage } from "@/hooks/useCustomerPackages";
import { usePackageActions, packageErrorKey } from "@/hooks/usePackageActions";
import { useProviderCustomers } from "@/hooks/useProviderCustomers";
import { isRegisteredKey } from "@/lib/customerKey";
import { PackageHistorySheet } from "@/components/dashboard/PackageHistorySheet";
import { packageStatusLabel, packageStatusClass } from "@/lib/packageStatus";
import { toast } from "sonner";
import { z } from "zod";

const templateSchema = z.object({
  name: z.string().min(1).max(100),
  total_entries: z.number().int().min(1).max(500),
  validity_days: z.number().int().min(1).max(3650),
  price: z.number().min(0).max(99999),
});

type EditState = PackageTemplateInput;

const BLANK: EditState = {
  name: "",
  description: "",
  total_entries: 10,
  validity_days: 90,
  price: 0,
  is_active: true,
};

/** Surface a DB-raised package error through the translated message. */
function usePackageErrorToast() {
  const { t } = useLang();
  return (err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    const key = packageErrorKey(message);
    toast.error(key ? t(key as never) : message);
  };
}

export function PackagesTab() {
  const { t } = useLang();
  const { templates, isLoading, upsertTemplate, deleteTemplate, toggleActive } = usePackageTemplates();
  const { data: customerPackages = [], isLoading: pkgLoading } = useCustomerPackages();
  const { activatePackage, addEntries, sellPackage, cancelPackage } = usePackageActions();
  const { data: allCustomers = [] } = useProviderCustomers();
  // A package needs an account to belong to (customer_packages.customer_id is
  // NOT NULL against auth.users), so phone-only walk-ins cannot hold one.
  const registeredCustomers = allCustomers.filter((c) => isRegisteredKey(c.key));
  const showError = usePackageErrorToast();

  const [editing, setEditing] = useState<EditState | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [historyFor, setHistoryFor] = useState<EnrichedCustomerPackage | null>(null);
  const [addingTo, setAddingTo] = useState<EnrichedCustomerPackage | null>(null);
  const [addForm, setAddForm] = useState({ entries: 0, days: 0, note: "" });
  const [selling, setSelling] = useState(false);
  const [sellForm, setSellForm] = useState({ customerKey: "", templateId: "" });
  const [customerSearch, setCustomerSearch] = useState("");
  const [pendingCancel, setPendingCancel] = useState<EnrichedCustomerPackage | null>(null);

  // DECISION 2: the list is already limited to people who have booked here
  // (useProviderCustomers derives it from this provider's bookings). Search
  // narrows by name or phone; digits are compared loosely so "050-111" matches
  // a number stored as "0501112233".
  const searchTerm = customerSearch.trim().toLowerCase();
  const searchDigits = customerSearch.replace(/\D/g, "");
  const filteredCustomers = registeredCustomers.filter((c) => {
    if (!searchTerm) return true;
    const byName = (c.name || "").toLowerCase().includes(searchTerm);
    const byPhone = searchDigits.length > 0
      && (c.phone || "").replace(/\D/g, "").includes(searchDigits);
    return byName || byPhone;
  });

  const handleSaveTemplate = async () => {
    if (!editing) return;
    const parsed = templateSchema.safeParse({
      name: editing.name.trim(),
      total_entries: editing.total_entries,
      validity_days: editing.validity_days,
      price: editing.price,
    });
    if (!parsed.success) {
      toast.error(t("packageFormInvalid"));
      return;
    }
    try {
      await upsertTemplate.mutateAsync({ ...editing, name: editing.name.trim() });
      toast.success(t("packageSaved"));
      setEditing(null);
    } catch (err) {
      showError(err);
    }
  };

  const handleDelete = async () => {
    if (!pendingDeleteId) return;
    try {
      await deleteTemplate.mutateAsync(pendingDeleteId);
      toast.success(t("packageDeleted"));
    } catch (err) {
      showError(err);
    } finally {
      setPendingDeleteId(null);
    }
  };

  const handleSellPackage = async () => {
    if (!sellForm.customerKey || !sellForm.templateId) return;
    try {
      await sellPackage.mutateAsync({
        // "u:<uuid>" -> the account id. See lib/customerKey for the format.
        customerId: sellForm.customerKey.slice(2),
        templateId: sellForm.templateId,
      });
      toast.success(t("packageSoldToast"));
      setSelling(false);
      setSellForm({ customerKey: "", templateId: "" });
    } catch (err) {
      showError(err);
    }
  };

  const handleCancelPackage = async () => {
    if (!pendingCancel) return;
    try {
      await cancelPackage.mutateAsync({ packageId: pendingCancel.id });
      toast.success(t("packageCancelled"));
    } catch (err) {
      showError(err);
    } finally {
      setPendingCancel(null);
    }
  };

  const handleAddEntries = async () => {
    if (!addingTo) return;
    try {
      await addEntries.mutateAsync({
        packageId: addingTo.id,
        entries: addForm.entries,
        extendDays: addForm.days,
        note: addForm.note,
      });
      toast.success(t("entriesAddedToast"));
      setAddingTo(null);
      setAddForm({ entries: 0, days: 0, note: "" });
    } catch (err) {
      showError(err);
    }
  };

  return (
    <div className="space-y-8 pb-8">
      {/* ── Package templates ─────────────────────────────────────────── */}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-bold text-foreground">{t("packageTemplates")}</h2>
          <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={() => setEditing({ ...BLANK })}>
            <Plus className="h-3.5 w-3.5" />
            {t("createPackage")}
          </Button>
        </div>

        {isLoading ? (
          <div className="h-20 animate-pulse rounded-2xl bg-secondary/60" />
        ) : templates.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-border/70 p-6 text-center text-xs text-muted-foreground">
            {t("noPackageTemplates")}
          </p>
        ) : (
          <div className="space-y-2">
            <AnimatePresence initial={false}>
              {templates.map((tpl, i) => (
                <motion.div
                  key={tpl.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ delay: i * 0.03, duration: 0.2 }}
                  className={`rounded-2xl border border-border bg-card p-4 ${tpl.is_active ? "" : "opacity-60"}`}
                >
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{tpl.name}</p>
                      {tpl.description && (
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">{tpl.description}</p>
                      )}
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Ticket className="h-3 w-3" />
                          {tpl.total_entries} {t("entriesShort")}
                        </span>
                        <span className="flex items-center gap-1">
                          <CalendarClock className="h-3 w-3" />
                          {tpl.validity_days} {t("daysUnit")}
                        </span>
                        <span className="font-medium text-foreground">₪{tpl.price}</span>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Switch
                        checked={tpl.is_active}
                        onCheckedChange={(v) =>
                          toggleActive.mutate(
                            { id: tpl.id, is_active: v },
                            { onError: showError },
                          )
                        }
                        aria-label={t("packageActive")}
                      />
                      <button
                        onClick={() =>
                          setEditing({
                            id: tpl.id,
                            name: tpl.name,
                            description: tpl.description ?? "",
                            total_entries: tpl.total_entries,
                            validity_days: tpl.validity_days,
                            price: tpl.price,
                            is_active: tpl.is_active,
                          })
                        }
                        className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                        aria-label={t("editPackage")}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => setPendingDeleteId(tpl.id)}
                        className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                        aria-label={t("deleteAction")}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </section>

      {/* ── Customer packages ─────────────────────────────────────────── */}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-bold text-foreground">{t("customerPackages")}</h2>
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1.5 text-xs"
            onClick={() => {
              setSellForm({ customerKey: "", templateId: "" });
              setCustomerSearch("");
              setSelling(true);
            }}
          >
            <UserPlus className="h-3.5 w-3.5" />
            {t("sellPackage")}
          </Button>
        </div>

        {pkgLoading ? (
          <div className="h-20 animate-pulse rounded-2xl bg-secondary/60" />
        ) : customerPackages.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-border/70 p-6 text-center text-xs text-muted-foreground">
            {t("noPackages")}
          </p>
        ) : (
          <div className="space-y-2">
            {customerPackages.map((pkg, i) => (
              <motion.div
                key={pkg.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.03, duration: 0.2 }}
                className="space-y-3 rounded-2xl border border-border bg-card p-4"
              >
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">
                      {pkg.customer_name || pkg.customer_phone || "—"}
                    </p>
                    {pkg.customer_phone && (
                      <a
                        href={`tel:${pkg.customer_phone}`}
                        className="text-xs text-muted-foreground transition-colors hover:text-foreground"
                      >
                        {pkg.customer_phone}
                      </a>
                    )}
                    <p className="mt-1 truncate text-xs text-muted-foreground">{pkg.template_name || "—"}</p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1.5">
                    <Badge variant="outline" className={`text-[10px] ${packageStatusClass(pkg)}`}>
                      {t(packageStatusLabel(pkg) as never)}
                    </Badge>
                    <span className="text-sm font-bold tabular-nums">
                      {pkg.entries_remaining}/{pkg.total_entries}
                    </span>
                  </div>
                </div>

                <p className="text-[11px] text-muted-foreground">
                  {pkg.expires_at
                    ? `${t("expiresOn")} ${format(parseISO(pkg.expires_at), "dd/MM/yyyy")}`
                    : t("notActivated")}
                </p>

                <div className="flex flex-wrap gap-1.5">
                  {pkg.status === "pending_activation" && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 gap-1 border-emerald-300 text-[11px] text-emerald-700 hover:bg-emerald-50"
                      disabled={activatePackage.isPending}
                      onClick={() =>
                        activatePackage.mutate(pkg.id, {
                          onSuccess: () => toast.success(t("packageActivatedToast")),
                          onError: showError,
                        })
                      }
                    >
                      <CheckCircle2 className="h-3 w-3" />
                      {t("activatePackage")}
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 gap-1 text-[11px]"
                    onClick={() => {
                      setAddForm({ entries: 0, days: 0, note: "" });
                      setAddingTo(pkg);
                    }}
                  >
                    <PlusCircle className="h-3 w-3" />
                    {t("addEntries")}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 gap-1 text-[11px]"
                    onClick={() => setHistoryFor(pkg)}
                  >
                    <History className="h-3 w-3" />
                    {t("packageHistory")}
                  </Button>
                  {/* Cancelling a dead package would be a no-op the RPC
                      rejects, so only offer it while the package is live. */}
                  {pkg.status !== "cancelled" && pkg.status !== "expired" && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 gap-1 border-rose-300 text-[11px] text-rose-700 hover:bg-rose-50"
                      onClick={() => setPendingCancel(pkg)}
                    >
                      <Ban className="h-3 w-3" />
                      {t("cancelPackage")}
                    </Button>
                  )}
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </section>

      {/* ── Create / edit template ────────────────────────────────────── */}
      <Sheet open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <SheetContent side="bottom" className={`max-h-[92vh] overflow-y-auto rounded-t-3xl ${providerDesktopSheet}`}>
          <SheetHeader>
            <SheetTitle>{editing?.id ? t("editPackage") : t("createPackage")}</SheetTitle>
          </SheetHeader>
          {editing && (
            <div className="space-y-4 py-4">
              <div className="space-y-1.5">
                <Label className="text-xs">{t("packageName")}</Label>
                <Input
                  value={editing.name}
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                  maxLength={100}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">{t("packageDescription")}</Label>
                <Input
                  value={editing.description ?? ""}
                  onChange={(e) => setEditing({ ...editing, description: e.target.value })}
                  maxLength={200}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">{t("totalEntries")}</Label>
                  <Input
                    type="number"
                    min={1}
                    value={editing.total_entries}
                    onChange={(e) => setEditing({ ...editing, total_entries: Number(e.target.value) })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">{t("validityDays")}</Label>
                  <Input
                    type="number"
                    min={1}
                    value={editing.validity_days}
                    onChange={(e) => setEditing({ ...editing, validity_days: Number(e.target.value) })}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">{t("packagePrice")} ₪</Label>
                <Input
                  type="number"
                  min={0}
                  value={editing.price}
                  onChange={(e) => setEditing({ ...editing, price: Number(e.target.value) })}
                />
              </div>
              <div className="flex items-center justify-between rounded-xl border border-border bg-secondary/40 p-3">
                <Label className="text-xs">{t("packageActive")}</Label>
                <Switch
                  checked={editing.is_active}
                  onCheckedChange={(v) => setEditing({ ...editing, is_active: v })}
                />
              </div>
              <Button className="w-full" onClick={handleSaveTemplate} disabled={upsertTemplate.isPending}>
                {upsertTemplate.isPending ? "..." : t("save")}
              </Button>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* ── Add entries / extend ─────────────────────────────────────── */}
      <Sheet open={!!addingTo} onOpenChange={(open) => !open && setAddingTo(null)}>
        <SheetContent side="bottom" className={`rounded-t-3xl ${providerDesktopSheet}`}>
          <SheetHeader>
            <SheetTitle>{t("addEntries")}</SheetTitle>
          </SheetHeader>
          {addingTo && (
            <div className="space-y-4 py-4">
              <p className="text-xs text-muted-foreground">
                {addingTo.customer_name || addingTo.customer_phone} · {addingTo.template_name}
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">{t("entriesToAdd")}</Label>
                  <Input
                    type="number"
                    min={0}
                    value={addForm.entries}
                    onChange={(e) => setAddForm({ ...addForm, entries: Number(e.target.value) })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">{t("daysToExtend")}</Label>
                  <Input
                    type="number"
                    min={0}
                    value={addForm.days}
                    onChange={(e) => setAddForm({ ...addForm, days: Number(e.target.value) })}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">{t("noteOptional")}</Label>
                <Input
                  value={addForm.note}
                  onChange={(e) => setAddForm({ ...addForm, note: e.target.value })}
                  maxLength={200}
                />
              </div>
              <Button
                className="w-full"
                onClick={handleAddEntries}
                disabled={addEntries.isPending || (addForm.entries <= 0 && addForm.days <= 0)}
              >
                {addEntries.isPending ? "..." : t("save")}
              </Button>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* ── Sell a package to a customer ─────────────────────────────── */}
      <Sheet open={selling} onOpenChange={(open) => !open && setSelling(false)}>
        <SheetContent side="bottom" className={`rounded-t-3xl ${providerDesktopSheet}`}>
          <SheetHeader>
            <SheetTitle>{t("sellPackage")}</SheetTitle>
          </SheetHeader>
          <div className="space-y-4 py-4">
            {registeredCustomers.length === 0 ? (
              <p className="py-4 text-center text-xs text-muted-foreground">
                {t("noRegisteredCustomers")}
              </p>
            ) : (
              <>
                <div className="space-y-1.5">
                  <Label className="text-xs">{t("selectCustomer")}</Label>
                  <div className="relative">
                    <Search className="pointer-events-none absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground [inset-inline-start:0.65rem]" />
                    <Input
                      value={customerSearch}
                      onChange={(e) => setCustomerSearch(e.target.value)}
                      placeholder={t("searchCustomer")}
                      className="h-9 text-xs [padding-inline-start:2rem]"
                    />
                  </div>
                  <Select
                    value={sellForm.customerKey}
                    onValueChange={(v) => setSellForm({ ...sellForm, customerKey: v })}
                  >
                    <SelectTrigger><SelectValue placeholder={t("selectCustomer")} /></SelectTrigger>
                    <SelectContent>
                      {filteredCustomers.length === 0 ? (
                        <div className="px-2 py-3 text-center text-[11px] text-muted-foreground">
                          {t("noCustomersMatch")}
                        </div>
                      ) : (
                        filteredCustomers.map((c) => (
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
                <div className="space-y-1.5">
                  <Label className="text-xs">{t("selectPackageType")}</Label>
                  <Select
                    value={sellForm.templateId}
                    onValueChange={(v) => setSellForm({ ...sellForm, templateId: v })}
                  >
                    <SelectTrigger><SelectValue placeholder={t("selectPackageType")} /></SelectTrigger>
                    <SelectContent>
                      {templates.filter((tpl) => tpl.is_active).map((tpl) => (
                        <SelectItem key={tpl.id} value={tpl.id}>
                          {tpl.name} · {tpl.total_entries} {t("entriesShort")} · ₪{tpl.price}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  className="w-full"
                  onClick={handleSellPackage}
                  disabled={sellPackage.isPending || !sellForm.customerKey || !sellForm.templateId}
                >
                  {sellPackage.isPending ? "..." : t("save")}
                </Button>
              </>
            )}
          </div>
        </SheetContent>
      </Sheet>

      <PackageHistorySheet pkg={historyFor} onClose={() => setHistoryFor(null)} />

      <AlertDialog open={!!pendingCancel} onOpenChange={(open) => !open && setPendingCancel(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("cancelPackageTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("cancelPackageDesc")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={handleCancelPackage}>
              {t("cancelPackage")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!pendingDeleteId} onOpenChange={(open) => !open && setPendingDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("deletePackageTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("deletePackageDesc")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>{t("deleteAction")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
