import { useState } from "react";
import { Plus, Pencil, Users, UserX, UserCheck } from "lucide-react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
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
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { providerDesktopSheet } from "@/components/layout/providerDesktop";
import { useLang } from "@/contexts/LangContext";
import { useProviderStaff } from "@/hooks/useProviderStaff";
import { useProviderStaffServices } from "@/hooks/useProviderStaffServices";
import { useProviderServices } from "@/hooks/useProviderServices";
import { useProviderProfile } from "@/hooks/useProviderProfile";
import { SettingsSection } from "@/components/settings/SettingsSection";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

// Raised by trg_enforce_staff_enable_no_future_bookings when flipping
// staff_enabled false→true while future confirmed/pending bookings exist.
const GUARD_TOKEN = "STAFF_ENABLE_BLOCKED_BY_FUTURE_BOOKINGS";

// serviceIds is the member's RESTRICTION set, edited locally and committed on
// save. EMPTY is a meaningful value, not an unset one: it means "performs every
// service" (inheritance rule), and it is stored as zero rows.
type EditState = { id?: string; name: string; serviceIds: string[] };

// Order-insensitive set comparison — lets save skip the assignment write
// entirely when the owner only renamed the member.
const sameSet = (a: string[], b: string[]) =>
  a.length === b.length && a.every((x) => b.includes(x));

// Staff management + the staff_enabled toggle, rendered as a section on the
// settings hub (/settings). Management (add/rename/deactivate) is always
// available so an owner can set up their team BEFORE enabling the mode;
// everything here is inert for customers until staff_enabled is on (and nothing
// customer-facing reads staff yet in this phase anyway).
export function StaffSection({ delay = 0 }: { delay?: number }) {
  const { t } = useLang();
  const { profile, updateStaffEnabled } = useProviderProfile();
  const { staff, activeStaff, isLoading, createStaff, renameStaff, setStaffActive } = useProviderStaff();
  const [editing, setEditing] = useState<EditState | null>(null);
  const [pendingDeactivateId, setPendingDeactivateId] = useState<string | null>(null);

  // Per-staff services. BOTH queries are gated on the provider actually having
  // staff members, so a provider with none fires nothing new on this page —
  // same enabled-gating discipline as useProviderActiveStaff.
  const hasStaff = staff.length > 0;
  const { servicesByStaff, setStaffServices } = useProviderStaffServices(hasStaff);
  const { services, isLoading: servicesLoading } = useProviderServices(hasStaff);

  // Assignable services = ACTIVE (the hook already filters) and NON-GROUP.
  // Group/class services are excluded from the customer staff step entirely, so
  // assigning them could never change anything. Mirrors ParallelServicesSheet's
  // `service_type !== "group"` eligibility filter.
  //
  // Services that currently have SCHEDULED SESSIONS are deliberately NOT
  // excluded, even though the staff step also skips them: session-ness is a
  // transient, date-derived property (a future-dated provider_sessions row),
  // not an attribute of the service. Filtering on it would make this list
  // change shape as sessions come and go, and — because saving rewrites the
  // member's whole set — would silently DELETE a valid assignment the moment a
  // session was added. An assignment on a session service is inert, not wrong.
  const assignableServices = services.filter((s) => s.service_type !== "group");

  // Assigned count is intersected with the assignable list so the subtitle can
  // never read "5 of 3" after a service is deleted or converted to a group.
  // A member whose every assigned service is gone honestly reads "0 of N" —
  // that is a real misconfiguration (nobody can perform anything) and hiding it
  // would be worse than showing it.
  const assignmentSummary = (staffId: string) => {
    const assigned = servicesByStaff.get(staffId);
    if (!assigned || assigned.size === 0) return t("staffServicesAll");
    const count = assignableServices.filter((s) => assigned.has(s.id)).length;
    return `${count} ${t("staffServicesOf")} ${assignableServices.length} ${t("staffServicesUnit")}`;
  };

  const toggleEditingService = (serviceId: string, next: boolean) => {
    setEditing((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        serviceIds: next
          ? [...prev.serviceIds, serviceId]
          : prev.serviceIds.filter((id) => id !== serviceId),
      };
    });
  };

  const staffEnabled = profile?.staff_enabled ?? false;
  // Enabling with zero active staff would (in later phases) show customers an
  // empty picker — require at least one active member first. Turning OFF is
  // never gated.
  const enableBlockedNoStaff = !staffEnabled && activeStaff.length === 0;

  const handleToggle = async (next: boolean) => {
    try {
      await updateStaffEnabled.mutateAsync(next);
      toast.success(t("profileSaved"));
    } catch (err) {
      // The Switch is controlled by profile.staff_enabled (query cache), which
      // only changes on success — so on failure it simply stays "off".
      //
      // The thrown value is the PLAIN PostgREST response object
      // ({ message, details, hint, code }), NOT an Error instance — verified
      // against supabase-js 2.99.3, where `instanceof Error` is false and
      // String(err) is "[object Object]". Never gate on instanceof here; read
      // the fields directly (same reason RescheduleSheet reads .code via cast).
      const e = (err ?? {}) as { message?: unknown; details?: unknown; hint?: unknown; code?: unknown };
      const haystack = [e.message, e.details, e.hint, e.code]
        .filter((v): v is string => typeof v === "string")
        .join(" | ");
      if (haystack.includes(GUARD_TOKEN)) {
        toast.error(t("staffEnableBlockedByFutureBookings"));
      } else {
        console.warn("staff_enabled toggle failed:", err);
        toast.error(typeof e.message === "string" && e.message ? e.message : "Error");
      }
    }
  };

  const handleSave = async () => {
    if (!editing) return;
    const name = editing.name.trim();
    if (!name) {
      toast.error(t("staffNameRequired"));
      return;
    }
    if (name.length > 100) {
      toast.error(t("staffNameRequired"));
      return;
    }
    try {
      // Name FIRST, assignments second — the composite FK on
      // provider_staff_services requires the staff row to exist before any
      // assignment can reference it. On create we therefore write the member,
      // take the returned id, and only then write the set. If that second write
      // fails the member still exists, unrestricted (fails OPEN), visible in
      // the list, and fixable by reopening the sheet — so the partial state is
      // both safe and recoverable rather than silent.
      let staffId = editing.id;
      if (staffId) {
        await renameStaff.mutateAsync({ id: staffId, name });
      } else {
        staffId = await createStaff.mutateAsync({ name });
      }

      const current = editing.id ? [...(servicesByStaff.get(editing.id) ?? [])] : [];
      if (!sameSet(editing.serviceIds, current)) {
        try {
          await setStaffServices.mutateAsync({ staffId, serviceIds: editing.serviceIds });
        } catch {
          // The member was saved; only the assignment write failed. Say exactly
          // that rather than a generic error the owner can't act on.
          toast.error(t("staffServicesSaveFailed"));
          setEditing(null);
          return;
        }
      }

      toast.success(t("staffSaved"));
      setEditing(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error");
    }
  };

  const handleSetActive = async (id: string, is_active: boolean) => {
    try {
      await setStaffActive.mutateAsync({ id, is_active });
      toast.success(is_active ? t("staffReactivated") : t("staffDeactivated"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error");
    } finally {
      setPendingDeactivateId(null);
    }
  };

  return (
    <SettingsSection
      icon={Users}
      title={t("staffSectionTitle")}
      delay={delay}
      action={
        <Button size="sm" variant="outline" onClick={() => setEditing({ name: "", serviceIds: [] })} className="gap-1.5">
          <Plus className="h-4 w-4" />
          {t("addStaff")}
        </Button>
      }
    >
      {/* staff_enabled toggle — mirrors the other boolean-flag rows */}
      <div className="flex items-start gap-3">
        <Switch
          checked={staffEnabled}
          onCheckedChange={handleToggle}
          disabled={updateStaffEnabled.isPending || enableBlockedNoStaff}
        />
        <div className="flex-1">
          <Label className="text-sm font-medium">{t("staffEnabledLabel")}</Label>
          <p className="text-xs text-muted-foreground mt-1">{t("staffEnabledHelp")}</p>
          {enableBlockedNoStaff && !isLoading && (
            <p className="text-xs text-orange-600 mt-1">{t("staffEnableRequiresStaff")}</p>
          )}
        </div>
      </div>

      {/* Staff list. Rows are Tier-2 `.surface-soft` — repeated items must not
          each carry a backdrop-filter inside an already-glass card. */}
      {isLoading ? (
        <div className="space-y-2 pt-3 border-t border-border/60">
          {[1, 2].map(i => (
            <div key={i} className="h-12 rounded-xl bg-secondary animate-pulse" />
          ))}
        </div>
      ) : staff.length === 0 ? (
        <div className="text-center py-6 text-muted-foreground border-t border-border/60">
          <p className="text-sm font-medium">{t("noStaff")}</p>
          <p className="text-xs mt-1">{t("addFirstStaff")}</p>
        </div>
      ) : (
        <div className="space-y-2 pt-3 border-t border-border/60">
          {staff.map((member, i) => (
            <motion.div
              key={member.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              className="surface-soft flex items-center justify-between rounded-xl px-3 py-2"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2 min-w-0">
                  <p className={`text-sm font-medium truncate ${member.is_active ? "" : "text-muted-foreground line-through"}`}>
                    {member.name}
                  </p>
                  {!member.is_active && (
                    <span className="shrink-0 text-[10px] px-2 py-0.5 rounded-full bg-secondary text-muted-foreground font-medium">
                      {t("staffInactive")}
                    </span>
                  )}
                </div>
                {/* Which services this member performs, legible without opening
                    the sheet. "All services" is the unrestricted (zero-rows)
                    state — the common case and the default for new members. */}
                {!servicesLoading && (
                  <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                    {assignmentSummary(member.id)}
                  </p>
                )}
              </div>
              <div className="flex gap-1 shrink-0">
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8"
                  onClick={() =>
                    setEditing({
                      id: member.id,
                      name: member.name,
                      serviceIds: [...(servicesByStaff.get(member.id) ?? [])],
                    })
                  }
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                {member.is_active ? (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 text-destructive"
                    title={t("deactivateStaff")}
                    onClick={() => setPendingDeactivateId(member.id)}
                  >
                    <UserX className="h-3.5 w-3.5" />
                  </Button>
                ) : (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 text-accent"
                    title={t("reactivateStaff")}
                    disabled={setStaffActive.isPending}
                    onClick={() => handleSetActive(member.id, true)}
                  >
                    <UserCheck className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {/* Add/edit staff — bottom sheet, same container pattern as ServicesTab */}
      <Sheet open={!!editing} onOpenChange={(open) => { if (!open) setEditing(null); }}>
        <SheetContent
          side="bottom"
          className={`flex max-h-[92vh] flex-col gap-0 rounded-t-3xl border-t p-0 ${providerDesktopSheet}`}
        >
          <div className="mx-auto mt-3 h-1.5 w-10 shrink-0 rounded-full bg-muted-foreground/20" />
          <SheetHeader className="shrink-0 px-5 pb-1 pt-3 text-start">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-accent/10 text-accent">
                {editing?.id ? <Pencil className="h-5 w-5" /> : <Plus className="h-5 w-5" />}
              </span>
              <SheetTitle>{editing?.id ? t("editStaffTitle") : t("addStaff")}</SheetTitle>
            </div>
          </SheetHeader>

          {editing && (
            <div className="flex-1 space-y-4 overflow-y-auto px-5 pb-5 pt-4">
              <div>
                <Label>{t("staffNameLabel")}</Label>
                <Input
                  value={editing.name}
                  autoFocus
                  maxLength={100}
                  onChange={e => setEditing({ ...editing, name: e.target.value })}
                  onKeyDown={e => { if (e.key === "Enter") handleSave(); }}
                />
              </div>

              {/* Services this member performs. Switch rows reuse
                  ParallelServicesSheet's visual so "pick a set of services"
                  looks the same everywhere in the provider UI. */}
              {assignableServices.length > 0 && (
                <div className="space-y-2">
                  <Label>{t("staffServicesLabel")}</Label>

                  {/* The empty set is MEANINGFUL, not unset — say so out loud,
                      otherwise an owner reads an all-off list as "not
                      configured yet" and never learns that off-means-all. */}
                  {editing.serviceIds.length === 0 && (
                    <p className="rounded-2xl border border-accent/15 bg-accent/[0.06] p-3 text-xs leading-relaxed text-foreground/70">
                      {t("staffServicesAllHint")}
                    </p>
                  )}

                  <div className="space-y-2">
                    {assignableServices.map((svc) => {
                      const checked = editing.serviceIds.includes(svc.id);
                      return (
                        <div
                          key={svc.id}
                          className={cn(
                            "flex items-center gap-3 rounded-2xl border px-4 py-3 transition-colors",
                            checked ? "border-accent/40 bg-accent/[0.06]" : "border-border bg-card"
                          )}
                        >
                          <span className="min-w-0 flex-1 truncate text-sm font-medium">{svc.name}</span>
                          <Switch
                            checked={checked}
                            onCheckedChange={(next) => toggleEditingService(svc.id, next)}
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="shrink-0 border-t border-border bg-background/95 px-5 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] backdrop-blur-sm">
            <div className="flex gap-2">
              <Button
                onClick={handleSave}
                disabled={createStaff.isPending || renameStaff.isPending || setStaffServices.isPending}
                className="h-12 flex-1 text-base font-semibold"
              >
                {t("save")}
              </Button>
              <Button variant="ghost" onClick={() => setEditing(null)} className="h-12">{t("cancel")}</Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* Deactivate confirmation — explains that booking history survives */}
      <AlertDialog open={!!pendingDeactivateId} onOpenChange={(open) => { if (!open) setPendingDeactivateId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("deactivateStaffConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("deactivateStaffConfirmBody")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={setStaffActive.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (pendingDeactivateId) handleSetActive(pendingDeactivateId, false);
              }}
            >
              {t("deactivateStaff")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SettingsSection>
  );
}
