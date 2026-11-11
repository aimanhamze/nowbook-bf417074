import { useState } from "react";
import {
  Ban, CalendarClock, CheckCircle2, History, Minus, Pencil, Phone, Plus, PlusCircle, Ticket, Trash2, UserPlus,
} from "lucide-react";
import { motion } from "framer-motion";
import { format, parseISO } from "date-fns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { SettingsSwitch } from "@/components/dashboard/SettingsSwitch";
import { useLang } from "@/contexts/LangContext";
import { usePackageTemplates, type PackageTemplateInput } from "@/hooks/usePackageTemplates";
import { useCustomerPackages, type EnrichedCustomerPackage } from "@/hooks/useCustomerPackages";
import { usePackageActions, packageErrorKey } from "@/hooks/usePackageActions";
import { PackageHistorySheet } from "@/components/dashboard/PackageHistorySheet";
import { SellPackageSheet } from "@/components/dashboard/SellPackageSheet";
import { groupPackagesByCustomerKey } from "@/lib/packageSelection";
import { packageStatusLabel, packageStatusClass } from "@/lib/packageStatus";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { z } from "zod";
import { DangerRow, EditSheet, Field, IconTile, NavRow, SettingsGroup } from "./SettingsRows";
import { DIVIDER, GROUP_HEADING, LIST, ROW } from "./settingsList";

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

/** A DB-raised package error through its translated message; anything the
 *  mapping does not know becomes a generic "couldn't save" — never raw text. */
function usePackageErrorToast() {
  const { t } = useLang();
  return (err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    const key = packageErrorKey(message);
    toast.error(key ? t(key as never) : t("bsSaveError"));
  };
}

const pct = (remaining: number, total: number) =>
  total > 0 ? Math.min(100, Math.max(0, Math.round((remaining / total) * 100))) : 0;

// Fitness studios only (Dashboard's isSectionVisible). Every write goes to the
// active branch through the same hooks as before.
export function PackagesTab() {
  const { t } = useLang();
  const { templates, isLoading, upsertTemplate, deleteTemplate, toggleActive } = usePackageTemplates();
  const { data: customerPackages = [], isLoading: pkgLoading } = useCustomerPackages();
  const { activatePackage, addEntries, cancelPackage } = usePackageActions();
  const showError = usePackageErrorToast();

  const [editing, setEditing] = useState<EditState | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [historyFor, setHistoryFor] = useState<EnrichedCustomerPackage | null>(null);
  const [addingTo, setAddingTo] = useState<EnrichedCustomerPackage | null>(null);
  const [addForm, setAddForm] = useState({ entries: 0, days: 0, note: "" });
  const [selling, setSelling] = useState(false);
  const [detailKey, setDetailKey] = useState<string | null>(null);
  const [pendingCancel, setPendingCancel] = useState<EnrichedCustomerPackage | null>(null);

  // One row per CUSTOMER, not per package. Someone who has bought, spent and
  // re-bought would otherwise fill the list with their own history. The rule
  // lives in lib/packageSelection so the customers page badge agrees with it.
  const byCustomer = groupPackagesByCustomerKey(customerPackages);
  const customerRows = [...byCustomer.entries()].map(([key, all]) => ({
    key,
    primary: all[0],   // groupPackagesByCustomerKey pre-sorts by the shared rule
    older: all.slice(1),
  }));
  const detail = detailKey ? customerRows.find((r) => r.key === detailKey) ?? null : null;

  const entriesDays = (entries: number, days: number) =>
    `${entries} ${t("entriesShort")} · ${days} ${t("daysUnit")}`;

  const handleSaveTemplate = async () => {
    if (!editing || upsertTemplate.isPending) return;
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
      setEditing((e) => (e?.id === pendingDeleteId ? null : e));
    } catch (err) {
      showError(err);
    } finally {
      setPendingDeleteId(null);
    }
  };

  const handleToggleActive = (id: string, is_active: boolean) => {
    if (toggleActive.isPending) return;
    toggleActive.mutate(
      { id, is_active },
      { onSuccess: () => toast.success(t("bsSaved")), onError: showError },
    );
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

  const handleActivate = (pkg: EnrichedCustomerPackage) => {
    if (activatePackage.isPending) return;
    activatePackage.mutate(pkg.id, {
      onSuccess: () => toast.success(t("packageActivatedToast")),
      onError: showError,
    });
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

  // Sheets are not stacked: an action in the package sheet closes it first.
  const openAddEntries = (pkg: EnrichedCustomerPackage) => {
    setDetailKey(null);
    setAddForm({ entries: 0, days: 0, note: "" });
    setAddingTo(pkg);
  };
  const openHistory = (pkg: EnrichedCustomerPackage) => {
    setDetailKey(null);
    setHistoryFor(pkg);
  };

  const addInvalid = addingTo
    ? addingTo.entries_remaining + addForm.entries < 0 || addingTo.total_entries + addForm.entries <= 0
    : false;

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="space-y-6 pb-6">
      <h2 className="text-lg font-semibold">{t("setupRowPackages")}</h2>

      {/* ── Package types ─────────────────────────────────────────────── */}
      <section className="space-y-2">
        <div className="flex min-h-[28px] items-end justify-between gap-3">
          <h3 className={GROUP_HEADING}>{t("packageTemplates")}</h3>
          <HeadingButton icon={Plus} label={t("createPackage")} onClick={() => setEditing({ ...BLANK })} />
        </div>
        {isLoading ? (
          <div className={cn(LIST, "h-20 animate-pulse")} />
        ) : templates.length === 0 ? (
          <p className={cn(LIST, "p-6 text-center text-sm text-foreground/60")}>{t("noPackageTemplates")}</p>
        ) : (
          <ul className={LIST}>
            {templates.map((tpl, i) => (
              // The row opens the editor; the switch beside it (not inside it)
              // saves active/hidden immediately, as before.
              <li key={tpl.id} className={cn("flex items-center", i > 0 && DIVIDER)}>
                <button
                  type="button"
                  aria-haspopup="dialog"
                  onClick={() => setEditing({
                    id: tpl.id,
                    name: tpl.name,
                    description: tpl.description ?? "",
                    total_entries: tpl.total_entries,
                    validity_days: tpl.validity_days,
                    price: tpl.price,
                    is_active: tpl.is_active,
                  })}
                  className={cn(ROW, "min-w-0 flex-1 pe-2")}
                >
                  <IconTile icon={Ticket} className={tpl.is_active ? undefined : "bg-foreground/[0.06] text-foreground/40"} />
                  <span className={cn("min-w-0 flex-1", !tpl.is_active && "opacity-60")}>
                    <span className="block truncate text-sm font-semibold leading-snug">{tpl.name}</span>
                    <span className="mt-0.5 block truncate text-xs leading-snug text-foreground/70">
                      {entriesDays(tpl.total_entries, tpl.validity_days)} · ₪{tpl.price}
                    </span>
                    {!tpl.is_active && (
                      <span className="mt-0.5 block text-xs font-medium text-foreground/60">{t("pkHidden")}</span>
                    )}
                  </span>
                </button>
                <span className="flex shrink-0 items-center pe-4">
                  <SettingsSwitch
                    checked={tpl.is_active}
                    onCheckedChange={(v) => handleToggleActive(tpl.id, v)}
                    aria-label={`${t("packageActive")} · ${tpl.name}`}
                  />
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── Customer packages ─────────────────────────────────────────── */}
      <section className="space-y-2">
        <div className="flex min-h-[28px] items-end justify-between gap-3">
          <h3 className={GROUP_HEADING}>{t("customerPackages")}</h3>
          <HeadingButton icon={UserPlus} label={t("sellPackage")} onClick={() => setSelling(true)} />
        </div>
        {pkgLoading ? (
          <div className={cn(LIST, "h-20 animate-pulse")} />
        ) : customerPackages.length === 0 ? (
          <p className={cn(LIST, "p-6 text-center text-sm text-foreground/60")}>{t("noPackages")}</p>
        ) : (
          <ul className={LIST}>
            {customerRows.map(({ key, primary: pkg }, i) => (
              <li key={key} className={i > 0 ? DIVIDER : undefined}>
                <button type="button" aria-haspopup="dialog" onClick={() => setDetailKey(key)} className={cn(ROW, "items-start")}>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-sm font-semibold leading-snug">
                        {pkg.customer_name || pkg.customer_phone || "—"}
                      </span>
                      <Badge variant="outline" className={cn("shrink-0 text-[10px]", packageStatusClass(pkg))}>
                        {t(packageStatusLabel(pkg) as never)}
                      </Badge>
                    </span>
                    <span className="mt-0.5 flex items-center gap-2 text-xs text-foreground/70">
                      <span className="min-w-0 flex-1 truncate">{pkg.template_name || "—"}</span>
                      <span dir="ltr" className="shrink-0 font-semibold tabular-nums text-foreground">
                        {pkg.entries_remaining}<span className="font-medium text-foreground/50">/{pkg.total_entries}</span>
                      </span>
                    </span>
                    {/* Balance at a glance; clamped so it never overflows. */}
                    <span className="mt-2 block h-1.5 w-full overflow-hidden rounded-full bg-foreground/[0.07]">
                      <span className="block h-full rounded-full bg-accent" style={{ width: `${pct(pkg.entries_remaining, pkg.total_entries)}%` }} />
                    </span>
                  </span>
                </button>
                {/* Time-critical, so it stays on the row: until the provider
                    activates, the customer cannot spend a single entry
                    (enforce_class_requires_package). */}
                {pkg.status === "pending_activation" && (
                  <div className="px-4 pb-3">
                    <ActivateButton busy={activatePackage.isPending} label={t("activatePackage")} onClick={() => handleActivate(pkg)} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── One customer's package ────────────────────────────────────── */}
      <EditSheet
        open={!!detail}
        onClose={() => setDetailKey(null)}
        icon={Ticket}
        title={detail ? detail.primary.customer_name || detail.primary.customer_phone || "—" : ""}
        description={detail?.primary.template_name || undefined}
      >
        {detail && (() => {
          const pkg = detail.primary;
          const live = pkg.status !== "cancelled" && pkg.status !== "expired";
          return (
            <>
              <div className="rounded-2xl bg-foreground/[0.04] p-4">
                <div className="flex items-start justify-between gap-3">
                  <p dir="ltr" className="text-3xl font-bold leading-none tabular-nums">
                    {pkg.entries_remaining}<span className="text-base font-medium text-foreground/50">/{pkg.total_entries}</span>
                  </p>
                  <Badge variant="outline" className={cn("text-[11px]", packageStatusClass(pkg))}>
                    {t(packageStatusLabel(pkg) as never)}
                  </Badge>
                </div>
                <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-foreground/[0.08]">
                  <div className="h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${pct(pkg.entries_remaining, pkg.total_entries)}%` }} />
                </div>
                {/* The badge already says "awaiting activation"; otherwise show
                    the expiry, or that an active package's clock hasn't started. */}
                {pkg.status !== "pending_activation" && (
                  <p className="mt-2 flex items-center gap-1.5 text-xs text-foreground/60">
                    <CalendarClock className="h-3.5 w-3.5" />
                    {pkg.expires_at ? `${t("expiresOn")} ${format(parseISO(pkg.expires_at), "dd/MM/yyyy")}` : t("notActivated")}
                  </p>
                )}
              </div>

              {pkg.status === "pending_activation" && (
                <ActivateButton busy={activatePackage.isPending} label={t("activatePackage")} onClick={() => handleActivate(pkg)} />
              )}

              <SettingsGroup plain>
                {pkg.customer_phone && (
                  <a href={`tel:${pkg.customer_phone}`} className={ROW}>
                    <Phone className="h-[18px] w-[18px] shrink-0 text-accent" />
                    <span dir="ltr" className="flex-1 text-start text-sm font-semibold tabular-nums [unicode-bidi:plaintext]">{pkg.customer_phone}</span>
                  </a>
                )}
                <NavRow icon={PlusCircle} title={t("adjustEntries")} onClick={() => openAddEntries(pkg)} />
                <NavRow icon={History} title={t("packageHistory")} onClick={() => openHistory(pkg)} />
              </SettingsGroup>

              {detail.older.length > 0 && (
                <SettingsGroup plain title={`${t("pkOlder")} (${detail.older.length})`}>
                  {detail.older.map((prev) => (
                    <button key={prev.id} type="button" onClick={() => openHistory(prev)} className={ROW}
                      aria-label={`${t("packageHistory")} · ${prev.template_name || "—"}`}>
                      <Badge variant="outline" className={cn("shrink-0 text-[10px]", packageStatusClass(prev))}>
                        {t(packageStatusLabel(prev) as never)}
                      </Badge>
                      <span className="min-w-0 flex-1 truncate text-sm text-foreground/80">{prev.template_name || "—"}</span>
                      <span dir="ltr" className="shrink-0 text-xs tabular-nums text-foreground/60">{prev.entries_remaining}/{prev.total_entries}</span>
                      <History className="h-4 w-4 shrink-0 text-foreground/40" />
                    </button>
                  ))}
                </SettingsGroup>
              )}

              {/* Cancelling a dead package is a no-op the RPC rejects, so it is
                  only offered while the package is live. */}
              {live && (
                <SettingsGroup plain>
                  <DangerRow icon={Ban} label={t("cancelPackage")} onClick={() => setPendingCancel(pkg)} />
                </SettingsGroup>
              )}
            </>
          );
        })()}
      </EditSheet>

      {/* ── Create / edit a package type ─────────────────────────────── */}
      <EditSheet
        open={!!editing}
        onClose={() => { if (!upsertTemplate.isPending) setEditing(null); }}
        icon={editing?.id ? Pencil : Plus}
        title={editing?.id ? t("editPackage") : t("createPackage")}
        onSave={handleSaveTemplate}
        saving={upsertTemplate.isPending}
      >
        {editing && (
          <>
            <Field label={t("packageName")} htmlFor="pk-name">
              <Input id="pk-name" value={editing.name} maxLength={100} className="h-12 rounded-xl"
                onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
            </Field>
            <Field label={t("packageDescription")} htmlFor="pk-desc">
              <Input id="pk-desc" value={editing.description ?? ""} maxLength={200} className="h-12 rounded-xl"
                onChange={(e) => setEditing({ ...editing, description: e.target.value })} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t("totalEntries")} htmlFor="pk-entries">
                <NumberInput id="pk-entries" min={1} unit={t("entriesShort")} value={editing.total_entries}
                  onChange={(v) => setEditing({ ...editing, total_entries: v })} />
              </Field>
              <Field label={t("validityDays")} htmlFor="pk-days">
                <NumberInput id="pk-days" min={1} unit={t("daysUnit")} value={editing.validity_days}
                  onChange={(v) => setEditing({ ...editing, validity_days: v })} />
              </Field>
            </div>
            <Field label={t("packagePrice")} htmlFor="pk-price">
              <NumberInput id="pk-price" min={0} unit="₪" value={editing.price}
                onChange={(v) => setEditing({ ...editing, price: v })} />
            </Field>
            <label className="flex min-h-[56px] cursor-pointer items-center gap-3 rounded-2xl border border-foreground/10 bg-white px-4 py-3">
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold">{t("pkActiveTitle")}</span>
                <span className="mt-0.5 block text-xs leading-snug text-foreground/70">{t("pkActiveHelp")}</span>
              </span>
              <SettingsSwitch checked={editing.is_active} aria-label={t("pkActiveTitle")}
                onCheckedChange={(v) => setEditing({ ...editing, is_active: v })} />
            </label>
            {editing.id && (
              <div className="border-t border-foreground/[0.08] pt-4">
                <Button type="button" variant="ghost" className="h-11 w-full gap-2 rounded-2xl text-red-600 hover:bg-red-50 hover:text-red-700"
                  onClick={() => setPendingDeleteId(editing.id!)}>
                  <Trash2 className="h-4 w-4" />
                  {t("pkDeleteTemplate")}
                </Button>
              </div>
            )}
          </>
        )}
      </EditSheet>

      {/* ── Add / remove entries, extend ─────────────────────────────── */}
      <EditSheet
        open={!!addingTo}
        onClose={() => { if (!addEntries.isPending) setAddingTo(null); }}
        icon={PlusCircle}
        title={t("adjustEntries")}
        description={addingTo ? `${addingTo.customer_name || addingTo.customer_phone} · ${addingTo.template_name}` : undefined}
        onSave={handleAddEntries}
        saving={addEntries.isPending}
        saveDisabled={(addForm.entries === 0 && addForm.days <= 0) || addInvalid}
      >
        {addingTo && (
          <>
            <Field label={t("entriesChange")} htmlFor="pk-change">
              {/* Signed: positive grants, negative removes. Steppers because
                  typing a minus sign on a phone number pad is awkward. */}
              <div className="flex items-center gap-2" dir="ltr">
                <Button type="button" variant="outline" className="h-12 w-12 shrink-0 rounded-xl p-0"
                  onClick={() => setAddForm({ ...addForm, entries: addForm.entries - 1 })} aria-label={t("removeEntries")}>
                  <Minus className="h-5 w-5" />
                </Button>
                <Input id="pk-change" type="number" value={addForm.entries}
                  onChange={(e) => setAddForm({ ...addForm, entries: Number(e.target.value) })}
                  className="h-12 rounded-xl text-center text-lg font-semibold tabular-nums" />
                <Button type="button" variant="outline" className="h-12 w-12 shrink-0 rounded-xl p-0"
                  onClick={() => setAddForm({ ...addForm, entries: addForm.entries + 1 })} aria-label={t("addEntries")}>
                  <Plus className="h-5 w-5" />
                </Button>
              </div>
            </Field>
            {addForm.entries !== 0 && (
              <p className={cn("text-xs", addInvalid ? "font-medium text-red-600" : "text-foreground/60")}>
                {addingTo.entries_remaining + addForm.entries < 0
                  ? t("notEnoughEntries")
                  : addingTo.total_entries + addForm.entries <= 0
                    ? t("cannotEmptyPackage")
                    : (
                      <span dir="ltr" className="tabular-nums">
                        {addingTo.entries_remaining}/{addingTo.total_entries} → {addingTo.entries_remaining + addForm.entries}/{addingTo.total_entries + addForm.entries}
                      </span>
                    )}
              </p>
            )}
            <Field label={t("daysToExtend")} htmlFor="pk-extend">
              <NumberInput id="pk-extend" min={0} unit={t("daysUnit")} value={addForm.days}
                onChange={(v) => setAddForm({ ...addForm, days: v })} />
            </Field>
            <Field label={t("noteOptional")} htmlFor="pk-note">
              <Input id="pk-note" value={addForm.note} maxLength={200} className="h-12 rounded-xl"
                onChange={(e) => setAddForm({ ...addForm, note: e.target.value })} />
            </Field>
          </>
        )}
      </EditSheet>

      <SellPackageSheet open={selling} onOpenChange={setSelling} />

      <PackageHistorySheet pkg={historyFor} onClose={() => setHistoryFor(null)} />

      <AlertDialog open={!!pendingCancel} onOpenChange={(open) => !open && setPendingCancel(null)}>
        <AlertDialogContent className="w-[calc(100%-2rem)] max-w-sm rounded-3xl">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("cancelPackageTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("cancelPackageDesc")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:space-x-0">
            <AlertDialogCancel className="mt-0 h-11 rounded-2xl">{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={handleCancelPackage} className="h-11 rounded-2xl bg-red-600 text-white hover:bg-red-700">
              {t("cancelPackage")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!pendingDeleteId} onOpenChange={(open) => !open && setPendingDeleteId(null)}>
        <AlertDialogContent className="w-[calc(100%-2rem)] max-w-sm rounded-3xl">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("deletePackageTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("deletePackageDesc")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:space-x-0">
            <AlertDialogCancel className="mt-0 h-11 rounded-2xl">{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="h-11 rounded-2xl bg-red-600 text-white hover:bg-red-700">
              {t("deleteAction")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </motion.div>
  );
}

function HeadingButton({ icon: Icon, label, onClick }: { icon: typeof Plus; label: string; onClick: () => void }) {
  return (
    <Button size="sm" variant="ghost" onClick={onClick}
      className="-me-2 h-11 gap-1.5 rounded-2xl px-3 font-semibold text-accent hover:bg-accent/10 hover:text-accent">
      <Icon className="h-4 w-4" />
      {label}
    </Button>
  );
}

function ActivateButton({ busy, label, onClick }: { busy: boolean; label: string; onClick: () => void }) {
  return (
    <Button disabled={busy} onClick={onClick}
      className="h-11 w-full gap-1.5 rounded-2xl bg-emerald-600 text-sm font-semibold text-white hover:bg-emerald-700">
      <CheckCircle2 className="h-4 w-4" />
      {label}
    </Button>
  );
}

/** Number field with its unit inside at the end. Same Number(value) as before. */
function NumberInput({ id, min, unit, value, onChange }: { id: string; min: number; unit: string; value: number; onChange: (v: number) => void }) {
  return (
    <div className="relative">
      <Input id={id} type="number" inputMode="numeric" min={min} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-12 rounded-xl pe-14 tabular-nums" />
      <span className="pointer-events-none absolute inset-y-0 end-3 flex items-center text-sm text-foreground/50">{unit}</span>
    </div>
  );
}
