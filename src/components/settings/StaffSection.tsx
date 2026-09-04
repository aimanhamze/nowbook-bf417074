import { useMemo, useState } from "react";
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
import { useProviderStaffHours } from "@/hooks/useProviderStaffHours";
import { useProviderStaffTimeOff } from "@/hooks/useProviderStaffTimeOff";
import { useProviderServices } from "@/hooks/useProviderServices";
import { useProviderAvailability } from "@/hooks/useProviderAvailability";
import { useProviderProfile } from "@/hooks/useProviderProfile";
import { SettingsSection } from "@/components/settings/SettingsSection";
import { StaffHoursEditor } from "@/components/settings/StaffHoursEditor";
import { StaffTimeOffEditor } from "@/components/settings/StaffTimeOffEditor";
import {
  draftFromRows,
  rowsFromDraft,
  sameDraft,
  hoursSummary,
  isInvalidRange,
  toTimeInput,
  type DayHours,
  type StaffHoursDraft,
} from "@/lib/staffHours";
import {
  timeOffDraftFromRows,
  sameDates,
  timeOffSummary,
} from "@/lib/staffTimeOff";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

// Raised by trg_enforce_staff_enable_no_future_bookings when flipping
// staff_enabled false→true while future confirmed/pending bookings exist.
const GUARD_TOKEN = "STAFF_ENABLE_BLOCKED_BY_FUTURE_BOOKINGS";

// serviceIds is the member's RESTRICTION set, edited locally and committed on
// save. EMPTY is a meaningful value, not an unset one: it means "performs every
// service" (inheritance rule), and it is stored as zero rows.
//
// `hours` is the same idea one level up, and its NULL is just as meaningful:
// null means "works all shop hours" (zero rows), an array means a configured
// week. It is derived from ROWS on open (draftFromRows) and committed only on
// save, so opening this sheet can never write a configuration — see
// lib/staffHours.ts for the three states involved.
//
// `timeOff` is a plain string[] of upcoming "YYYY-MM-DD" days off. Unlike
// `hours` it needs no null state: absence and emptiness both mean "no time off".
// It holds FUTURE dates ONLY — past days off are history, never loaded here and
// never rewritten (see the range-scoped delete in useProviderStaffTimeOff).
type EditState = {
  id?: string;
  name: string;
  serviceIds: string[];
  hours: StaffHoursDraft;
  timeOff: string[];
};

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
  // Per-staff working hours. Gated on hasStaff like the two above — the list
  // subtitles need every member's state at once, so this is one query for the
  // whole provider, and a provider with no staff fires nothing new on this page.
  const { hoursByStaff, isLoading: hoursLoading, setStaffHours } = useProviderStaffHours(hasStaff);
  // Per-staff time off. Same hasStaff gate as its two siblings.
  const {
    timeOffByStaff,
    todayKey,
    isLoading: timeOffLoading,
    setStaffTimeOff,
  } = useProviderStaffTimeOff(hasStaff);
  // The shop's own week is needed ONLY inside the edit sheet, so it is gated on
  // the sheet being open rather than on hasStaff. Two reasons, and the second is
  // the important one: nothing fires on the settings page until an owner
  // actually opens a member, AND a provider adding their very FIRST member still
  // gets real shop hours — hasStaff is false at that moment (no rows yet), which
  // would have left the editor reporting "Shop closed" for all seven days.
  const { availability, isLoading: shopLoading } = useProviderAvailability(!!editing);

  // Monthly-mode shops have no per-weekday hours, so the editor suppresses its
  // per-day shop reference and explains the weekly limit instead.
  const isMonthly = profile?.availability_mode === "monthly";

  // The shop's week, indexed by day_of_week (0 = Sunday). null = no row for that
  // weekday, which the editor reads the same as closed. This is REFERENCE ONLY:
  // nothing here constrains what can be saved, because the shop's hours change
  // and Phase 3's intersection is what actually enforces the subset at booking
  // time. Showing it is what makes "always inside the shop's hours" concrete for
  // the owner rather than a claim in a help line.
  const shopDays = useMemo<(DayHours | null)[]>(
    () =>
      Array.from({ length: 7 }, (_, dow) => {
        const row = availability.find((a) => a.day_of_week === dow);
        if (!row) return null;
        return {
          is_available: row.is_available,
          start_time: toTimeInput(row.start_time),
          end_time: toTimeInput(row.end_time),
        };
      }),
    [availability]
  );

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

  // Hours state, legible from the list without opening the sheet. The three
  // states are reported honestly and separately:
  //   "All shop hours"       → zero rows, the default and the common case
  //   "Not working any day"  → configured with every day off. A real
  //                            misconfiguration (this member can never be
  //                            booked), surfaced rather than normalised into
  //                            "all" — same reasoning as the "0 of N" services
  //                            summary above.
  //   "N working days"       → a normal configured week
  const hoursSummaryLabel = (staffId: string) => {
    const summary = hoursSummary(draftFromRows(hoursByStaff.get(staffId)));
    if (summary === "all") return t("staffHoursAll");
    if (summary === "none") return t("staffHoursNone");
    return t("staffHoursDays").replace("{n}", String(summary));
  };

  // Upcoming days off, for the list subtitle. Counts FUTURE dates only — past
  // days off are history, and counting them would read a long tail of last
  // year's holidays as absence still to come.
  const timeOffCount = (staffId: string) =>
    timeOffSummary(timeOffByStaff.get(staffId), todayKey);

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
    // Refuse a window that can never produce a slot. Checked BEFORE anything is
    // written, so a broken day cannot leave the member half-saved. This is the
    // only save-blocking validation on hours: a window that merely pokes outside
    // the shop's is flagged inline and allowed through, because shop hours
    // change and Phase 3's intersection trims it anyway.
    if (editing.hours?.some(isInvalidRange)) {
      toast.error(t("staffHoursInvalidRange"));
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

      // Hours last, same failure-open reasoning as the assignments above: a
      // member left with no hours rows works all of the shop's hours, which is
      // the state they were already in.
      //
      // The write is SKIPPED when the draft is unchanged — and crucially, an
      // untouched member opens on exactly what draftFromRows produced, so
      // sameDraft is true and NOTHING is written. That is what makes "open the
      // sheet, press Save, walk away" a no-op rather than a configuration.
      //
      // When the draft IS null and rows existed, rowsFromDraft returns [] and
      // the mutation deletes them — the one path back to "works all shop hours".
      const currentHours = editing.id ? draftFromRows(hoursByStaff.get(editing.id)) : null;
      if (!sameDraft(editing.hours, currentHours)) {
        try {
          await setStaffHours.mutateAsync({ staffId, days: rowsFromDraft(editing.hours) });
        } catch {
          toast.error(t("staffHoursSaveFailed"));
          setEditing(null);
          return;
        }
      }

      // Time off last. Same skip-when-unchanged discipline, and the same
      // failure-open direction: a member left with no upcoming days off is
      // bookable, which is the state they were in before this feature existed.
      //
      // The mutation's delete is RANGE-SCOPED to today and later — see the boxed
      // note in useProviderStaffTimeOff. Both sides of that scoping meet here:
      // `editing.timeOff` was built by timeOffDraftFromRows, which drops past
      // dates, so the set being written describes exactly the range the delete
      // clears. Widening one without the other is what would destroy history.
      const currentTimeOff = editing.id
        ? timeOffDraftFromRows(timeOffByStaff.get(editing.id), todayKey)
        : [];
      if (!sameDates(editing.timeOff, currentTimeOff)) {
        try {
          await setStaffTimeOff.mutateAsync({ staffId, dates: editing.timeOff });
        } catch {
          toast.error(t("staffTimeOffSaveFailed"));
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
        /* A NEW member starts unrestricted on both axes: no service rows and no
           hours rows. `hours: null` is not a placeholder — it is the state that
           gets saved, and it saves as zero rows. */
        <Button size="sm" variant="outline" onClick={() => setEditing({ name: "", serviceIds: [], hours: null, timeOff: [] })} className="gap-1.5">
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
                    {!hoursLoading && <> · {hoursSummaryLabel(member.id)}</>}
                    {/* Only when there IS upcoming time off. Absence is the
                        common case and does not deserve a "0 days off" label. */}
                    {!timeOffLoading && timeOffCount(member.id) > 0 && (
                      <> · {t("staffTimeOffDays").replace("{n}", String(timeOffCount(member.id)))}</>
                    )}
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
                      // Derived from ROWS, never from a form default. A member
                      // with no rows opens on null (= works all shop hours) and
                      // stays there unless the owner explicitly switches modes.
                      hours: draftFromRows(hoursByStaff.get(member.id)),
                      // Future dates only — timeOffDraftFromRows drops any past
                      // row, so history cannot enter the draft and therefore
                      // cannot be rewritten by a save.
                      timeOff: timeOffDraftFromRows(timeOffByStaff.get(member.id), todayKey),
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

              {/* Working hours. Rendered for every member, including inactive
                  ones and brand-new ones — an owner setting up a team should be
                  able to fill in hours before the member goes live, exactly as
                  they can with services. */}
              <StaffHoursEditor
                draft={editing.hours}
                onChange={(hours) => setEditing((prev) => (prev ? { ...prev, hours } : prev))}
                shopDays={shopDays}
                shopLoading={shopLoading}
                isMonthly={isMonthly}
              />

              {/* Days off, below the weekly hours they sit on top of. Same
                  draft-then-save discipline as everything above it. */}
              <StaffTimeOffEditor
                dates={editing.timeOff}
                onChange={(timeOff) => setEditing((prev) => (prev ? { ...prev, timeOff } : prev))}
              />
            </div>
          )}

          <div className="shrink-0 border-t border-border bg-background/95 px-5 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] backdrop-blur-sm">
            <div className="flex gap-2">
              <Button
                onClick={handleSave}
                disabled={
                  createStaff.isPending ||
                  renameStaff.isPending ||
                  setStaffServices.isPending ||
                  setStaffHours.isPending ||
                  setStaffTimeOff.isPending
                }
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
