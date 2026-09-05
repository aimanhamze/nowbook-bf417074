import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { format } from "date-fns";
import { CalendarOff, Clock, Scissors, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { useLang } from "@/contexts/LangContext";
import { useAuth } from "@/contexts/AuthContext";
import { useProviderProfile } from "@/hooks/useProviderProfile";
import { useProviderStaff } from "@/hooks/useProviderStaff";
import { useProviderStaffServices } from "@/hooks/useProviderStaffServices";
import { useProviderStaffHours } from "@/hooks/useProviderStaffHours";
import { useProviderStaffTimeOff } from "@/hooks/useProviderStaffTimeOff";
import { useProviderServices } from "@/hooks/useProviderServices";
import { useProviderAvailability } from "@/hooks/useProviderAvailability";
import { useStaffToday } from "@/hooks/useStaffToday";
import { BackArrow } from "@/components/ui/directional-icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { providerDesktopPage, providerDesktopColumn } from "@/components/layout/providerDesktop";
import { MemberHeader } from "@/components/staff/member/MemberHeader";
import { FacetCard, type FacetState } from "@/components/staff/member/FacetCard";
import { ServicesSheet } from "@/components/staff/member/ServicesSheet";
import { HoursSheet } from "@/components/staff/member/HoursSheet";
import { TimeOffSheet } from "@/components/staff/member/TimeOffSheet";
import { DeactivateDialog } from "@/components/staff/member/DeactivateDialog";
import { dateFnsLocaleFor } from "@/lib/dateFnsLocale";
import {
  draftFromRows,
  rowsFromDraft,
  sameDraft,
  hoursSummary,
  toTimeInput,
  type DayHours,
  type StaffHoursDraft,
} from "@/lib/staffHours";
import { timeOffDraftFromRows, sameDates, fromDateKey } from "@/lib/staffTimeOff";
import { narrowWeekdayLabels, uniformRange, weekDates } from "@/lib/staffToday";

type SheetKind = "services" | "hours" | "timeOff" | null;

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

// Any Sunday: the hours card's mini strip labels weekdays 0–6, not real dates.
const DOW_DATES = weekDates(new Date(2024, 0, 7), 7);

/**
 * /staff/:id and /staff/new — one member as a SUMMARY, not an editor.
 *
 * Header (avatar, inline rename, today, active switch), then three facet cards
 * that each read as a status and open a focused sheet with its own Save. The
 * four saves are the SAME four independent mutations the settings sheet made —
 * name, services, hours, time off — each skipped when unchanged, each failing
 * open, exactly as before. Only the container changed.
 *
 * /staff/new is the one place with a form: a name, and a button. Everything else
 * is configured after the row exists, because the composite FKs on the three
 * child tables need the staff id first — so the member is created alone, and
 * the three facet writes only ever run against an existing row.
 */
export default function ProviderStaffMember() {
  const { t, lang } = useLang();
  const { user, isProvider } = useAuth();
  const navigate = useNavigate();
  const { id = "" } = useParams<{ id: string }>();
  const isNew = id === "new";

  const { profile } = useProviderProfile();
  const { staff, isLoading: staffLoading, createStaff, renameStaff, setStaffActive } = useProviderStaff();
  const { servicesByStaff, setStaffServices } = useProviderStaffServices(!isNew);
  const { services } = useProviderServices(true);
  const { hoursByStaff, setStaffHours } = useProviderStaffHours(!isNew);
  const { timeOffByStaff, todayKey, setStaffTimeOff } = useProviderStaffTimeOff(!isNew);
  const { availability, isLoading: shopLoading } = useProviderAvailability(true);
  const { todayFor } = useStaffToday(!isNew);

  const [sheet, setSheet] = useState<SheetKind>(null);
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);
  const [newName, setNewName] = useState("");

  useEffect(() => {
    if (user && !isProvider) navigate("/", { replace: true });
  }, [user, isProvider, navigate]);

  const member = useMemo(() => staff.find((m) => m.id === id), [staff, id]);
  const isMonthly = profile?.availability_mode === "monthly";

  // The shop's week for the hours editor's reference lines — REFERENCE ONLY,
  // nothing here constrains what can be saved: shop hours change, and the
  // resolver's intersection is what enforces the subset at booking time.
  const shopDays = useMemo<(DayHours | null)[]>(
    () =>
      Array.from({ length: 7 }, (_, dow) => {
        const row = availability.find((a) => a.day_of_week === dow);
        if (!row) return null;
        return { is_available: row.is_available, start_time: toTimeInput(row.start_time), end_time: toTimeInput(row.end_time) };
      }),
    [availability],
  );

  const assignableServices = useMemo(() => services.filter((s) => s.service_type !== "group"), [services]);

  // ── Facet state, derived from ROWS ────────────────────────────────────────
  const assignedIds = useMemo(() => [...(servicesByStaff.get(id) ?? [])], [servicesByStaff, id]);
  const assignedNames = assignableServices.filter((s) => assignedIds.includes(s.id)).map((s) => s.name);
  const servicesState: FacetState = assignedIds.length === 0 ? "follows" : assignedNames.length === 0 ? "warn" : "custom";
  const servicesSummary =
    servicesState === "follows"
      ? t("staffSumServicesAll")
      : servicesState === "warn"
        ? t("staffSumServicesNone")
        : `${assignedNames.length} ${t("staffServicesOf")} ${assignableServices.length} ${t("staffServicesUnit")}`;

  const hoursDraft = useMemo<StaffHoursDraft>(() => draftFromRows(hoursByStaff.get(id)), [hoursByStaff, id]);
  const hs = hoursSummary(hoursDraft);
  const hoursState: FacetState = hs === "all" ? "follows" : hs === "none" ? "warn" : "custom";
  const hoursText =
    hs === "all" ? t("staffSumHoursAll") : hs === "none" ? t("staffSumHoursNone") : t("staffHoursDays").replace("{n}", String(hs));
  const dowLabels = narrowWeekdayLabels(DOW_DATES, dateFnsLocaleFor(lang));
  const hoursMini = hoursDraft && hs !== "none" ? hoursDraft.map((d, i) => ({ label: dowLabels[i], on: d.is_available })) : undefined;

  const timeOff = useMemo(() => timeOffDraftFromRows(timeOffByStaff.get(id), todayKey), [timeOffByStaff, id, todayKey]);
  const timeOffState: FacetState = timeOff.length === 0 ? "follows" : "custom";
  const timeOffText =
    timeOff.length === 0
      ? t("staffTimeOffNone")
      : `${t("staffTimeOffDays").replace("{n}", String(timeOff.length))} · ${t("staffTimeOffNext").replace(
          "{d}",
          format(fromDateKey(timeOff[0]), "EEE, d MMM", { locale: dateFnsLocaleFor(lang) }),
        )}`;

  const followsAll = servicesState === "follows" && hoursState === "follows" && timeOffState === "follows";

  // ── Saves: one per facet, skipped when unchanged, failing open ────────────
  const saveServices = async (ids: string[]) => {
    if (!member) return;
    if (!sameSet(ids, assignedIds)) {
      try {
        await setStaffServices.mutateAsync({ staffId: member.id, serviceIds: ids });
      } catch {
        toast.error(t("staffServicesSaveFailed"));
        return;
      }
      toast.success(t("staffSaved"));
    }
    setSheet(null);
  };

  const saveHours = async (draft: StaffHoursDraft) => {
    if (!member) return;
    if (!sameDraft(draft, hoursDraft)) {
      try {
        await setStaffHours.mutateAsync({ staffId: member.id, days: rowsFromDraft(draft) });
      } catch {
        toast.error(t("staffHoursSaveFailed"));
        return;
      }
      toast.success(t("staffSaved"));
    }
    setSheet(null);
  };

  const saveTimeOff = async (dates: string[]) => {
    if (!member) return;
    if (!sameDates(dates, timeOff)) {
      try {
        await setStaffTimeOff.mutateAsync({ staffId: member.id, dates });
      } catch {
        toast.error(t("staffTimeOffSaveFailed"));
        return;
      }
      toast.success(t("staffSaved"));
    }
    setSheet(null);
  };

  const rename = async (name: string) => {
    if (!member) return;
    try {
      await renameStaff.mutateAsync({ id: member.id, name });
      toast.success(t("staffSaved"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error");
    }
  };

  const setActive = async (is_active: boolean) => {
    if (!member) return;
    try {
      await setStaffActive.mutateAsync({ id: member.id, is_active });
      toast.success(is_active ? t("staffReactivated") : t("staffDeactivated"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error");
    } finally {
      setConfirmDeactivate(false);
    }
  };

  const create = async () => {
    const name = newName.trim();
    if (!name || name.length > 100) {
      toast.error(t("staffNameRequired"));
      return;
    }
    try {
      const newId = await createStaff.mutateAsync({ name });
      toast.success(t("staffSaved"));
      navigate(`/staff/${newId}`, { replace: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error");
    }
  };

  if (!user || !isProvider) return null;

  return (
    <div
      className={`relative min-h-screen overflow-x-clip pb-24 ${providerDesktopPage}`}
      style={{ background: "var(--bg-atmosphere-soft)" }}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute top-[-4rem] [inset-inline-end:-5rem] h-[24rem] w-[24rem] rounded-full blur-3xl opacity-55"
        style={{ background: "radial-gradient(circle, hsl(24 95% 78% / 0.5) 0%, transparent 65%)" }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute top-[22rem] [inset-inline-start:-6rem] h-[28rem] w-[28rem] rounded-full blur-3xl opacity-45"
        style={{ background: "radial-gradient(circle, hsl(265 60% 80% / 0.4) 0%, transparent 65%)" }}
      />

      <div className={`relative ${providerDesktopColumn}`}>
        <header className="flex items-center gap-3 px-5 pt-12 pb-3">
          <button onClick={() => navigate("/staff")} className="-ms-1.5 rounded-xl p-1.5 active:scale-95" aria-label={t("staffPageTitle")}>
            <BackArrow className="h-5 w-5" />
          </button>
          <p className="flex-1 text-sm font-semibold text-muted-foreground">{t("staffPageTitle")}</p>
        </header>

        <div className="flex flex-col gap-3.5 px-5">
          {isNew ? (
            <section className="glass-card rounded-3xl p-5">
              <div className="mb-4 flex items-center gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-accent/10 text-accent">
                  <UserPlus className="h-5 w-5" />
                </span>
                <h1 className="text-lg font-bold">{t("staffNewMember")}</h1>
              </div>
              <Label htmlFor="staff-name">{t("staffNameLabel")}</Label>
              <Input
                id="staff-name"
                value={newName}
                autoFocus
                maxLength={100}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void create(); }}
                className="mt-1.5 h-12 text-base"
              />
              <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{t("staffNewMemberHelp")}</p>
              <Button onClick={() => void create()} disabled={createStaff.isPending || !newName.trim()} className="mt-4 h-12 w-full text-base font-semibold">
                {t("addStaff")}
              </Button>
            </section>
          ) : staffLoading ? (
            <>
              <div className="h-40 rounded-3xl bg-secondary animate-pulse" />
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-[88px] rounded-2xl bg-secondary animate-pulse" />
              ))}
            </>
          ) : !member ? (
            <div className="glass-card rounded-2xl p-6 text-center">
              <p className="text-sm text-muted-foreground">{t("staffNotFound")}</p>
              <Button variant="outline" className="mt-4" onClick={() => navigate("/staff")}>
                {t("staffPageTitle")}
              </Button>
            </div>
          ) : (
            <>
              <MemberHeader
                member={member}
                today={todayFor(member.id)}
                onRename={rename}
                renaming={renameStaff.isPending}
                onToggleActive={(next) => (next ? void setActive(true) : setConfirmDeactivate(true))}
                togglePending={setStaffActive.isPending}
              />

              {/* The healthy default gets one calm line, not three warnings. */}
              {followsAll && <p className="px-1.5 text-[13px] leading-relaxed text-muted-foreground">{t("staffFollowsShop")}</p>}

              <div className="flex flex-col gap-2.5">
                <FacetCard
                  icon={Scissors}
                  title={t("staffFacetServices")}
                  state={servicesState}
                  summary={servicesSummary}
                  chips={servicesState === "custom" ? assignedNames : undefined}
                  onClick={() => setSheet("services")}
                />
                <FacetCard
                  icon={Clock}
                  title={t("staffHoursLabel")}
                  state={hoursState}
                  summary={hoursText}
                  mini={hoursMini}
                  miniRange={uniformRange(hoursDraft)}
                  onClick={() => setSheet("hours")}
                />
                <FacetCard
                  icon={CalendarOff}
                  title={t("staffTimeOffLabel")}
                  state={timeOffState}
                  summary={timeOffText}
                  onClick={() => setSheet("timeOff")}
                />
              </div>

              <ServicesSheet
                open={sheet === "services"}
                onClose={() => setSheet(null)}
                memberName={member.name}
                services={assignableServices}
                initialIds={assignedIds}
                onSave={saveServices}
                saving={setStaffServices.isPending}
              />
              <HoursSheet
                open={sheet === "hours"}
                onClose={() => setSheet(null)}
                memberName={member.name}
                initialDraft={hoursDraft}
                shopDays={shopDays}
                shopLoading={shopLoading}
                isMonthly={isMonthly}
                onSave={saveHours}
                saving={setStaffHours.isPending}
              />
              <TimeOffSheet
                open={sheet === "timeOff"}
                onClose={() => setSheet(null)}
                memberName={member.name}
                initialDates={timeOff}
                onSave={saveTimeOff}
                saving={setStaffTimeOff.isPending}
              />
              <DeactivateDialog
                open={confirmDeactivate}
                onOpenChange={setConfirmDeactivate}
                onConfirm={() => void setActive(false)}
                pending={setStaffActive.isPending}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
