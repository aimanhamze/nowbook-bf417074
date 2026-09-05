import { useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Plus } from "lucide-react";
import { useLang } from "@/contexts/LangContext";
import { useAuth } from "@/contexts/AuthContext";
import { useProviderProfile } from "@/hooks/useProviderProfile";
import { useProviderStaff } from "@/hooks/useProviderStaff";
import { useProviderStaffServices } from "@/hooks/useProviderStaffServices";
import { useProviderStaffHours } from "@/hooks/useProviderStaffHours";
import { useProviderStaffTimeOff } from "@/hooks/useProviderStaffTimeOff";
import { useProviderServices } from "@/hooks/useProviderServices";
import { useStaffToday } from "@/hooks/useStaffToday";
import { BackArrow } from "@/components/ui/directional-icon";
import { Button } from "@/components/ui/button";
import { providerDesktopPage, providerDesktopColumn } from "@/components/layout/providerDesktop";
import { StaffModeBanner } from "@/components/staff/StaffModeBanner";
import { TodayStrip } from "@/components/staff/TodayStrip";
import { StaffRoster } from "@/components/staff/StaffRoster";
import { StaffEmptyState } from "@/components/staff/StaffEmptyState";
import type { StaffRowData } from "@/components/staff/StaffRow";
import { draftFromRows, hoursSummary } from "@/lib/staffHours";
import { timeOffSummary } from "@/lib/staffTimeOff";
import { todayCounts } from "@/lib/staffToday";

/**
 * /staff — the provider's team as its own page.
 *
 * What a provider sees first: the customer-facing staff switch, then how many
 * hands they have TODAY, then the roster with each member's today chip and the
 * coming week as dots. Tapping a row opens /staff/:id. Nothing is edited here.
 *
 * UI ONLY. Every read is a hook the settings section already mounted, and the
 * today/week layer (useStaffToday) is pure derivation over the resolver — the
 * page adds no query and no schema.
 */
export default function ProviderStaff() {
  const { t } = useLang();
  const { user, isProvider } = useAuth();
  const navigate = useNavigate();
  const { profile, isLoading: profileLoading } = useProviderProfile();
  const { staff, activeStaff, isLoading: staffLoading } = useProviderStaff();

  // Enabled-gating discipline shared by every per-staff hook: a provider with no
  // members fires none of the per-staff queries.
  const hasStaff = staff.length > 0;
  const { servicesByStaff } = useProviderStaffServices(hasStaff);
  const { services } = useProviderServices(hasStaff);
  const { hoursByStaff } = useProviderStaffHours(hasStaff);
  const { timeOffByStaff, todayKey } = useProviderStaffTimeOff(hasStaff);
  const { dates, today, shopToday, weekFor } = useStaffToday(hasStaff);

  useEffect(() => {
    if (user && !isProvider) navigate("/", { replace: true });
  }, [user, isProvider, navigate]);

  // Assignable = active and non-group; the assigned count is intersected with
  // it so the summary can never read "5 of 3" after a service is deleted.
  const assignableServices = useMemo(() => services.filter((s) => s.service_type !== "group"), [services]);

  const rows = useMemo<StaffRowData[]>(
    () =>
      staff.map((m) => {
        const assigned = servicesByStaff.get(m.id);
        const servicesSummary =
          !assigned || assigned.size === 0
            ? t("staffServicesAll")
            : `${assignableServices.filter((s) => assigned.has(s.id)).length} ${t("staffServicesOf")} ${assignableServices.length} ${t("staffServicesUnit")}`;

        const hs = hoursSummary(draftFromRows(hoursByStaff.get(m.id)));
        const hoursLabel =
          hs === "all" ? t("staffHoursAll") : hs === "none" ? t("staffHoursNone") : t("staffHoursDays").replace("{n}", String(hs));

        const offCount = timeOffSummary(timeOffByStaff.get(m.id), todayKey);

        return {
          id: m.id,
          name: m.name,
          isActive: m.is_active,
          week: weekFor(m.id),
          servicesSummary,
          hoursSummary: hoursLabel,
          timeOffSummary: offCount > 0 ? t("staffTimeOffDays").replace("{n}", String(offCount)) : "",
        };
      }),
    [staff, servicesByStaff, assignableServices, hoursByStaff, timeOffByStaff, todayKey, weekFor, t],
  );

  const counts = useMemo(() => todayCounts(rows.filter((r) => r.isActive).map((r) => r.week[0])), [rows]);

  if (!user || !isProvider) return null;

  if (!profileLoading && !profile) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-5 gap-4">
        <p className="text-muted-foreground text-center">{t("profileNotSetup")}</p>
        <Button onClick={() => navigate("/")}>{t("home")}</Button>
      </div>
    );
  }

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
        <header className="flex items-center gap-3 px-5 pt-12 pb-4">
          <button onClick={() => navigate("/profile")} className="-ms-1.5 rounded-xl p-1.5 active:scale-95" aria-label={t("profile")}>
            <BackArrow className="h-5 w-5" />
          </button>
          <h1 className="flex-1 text-xl font-bold">{t("staffPageTitle")}</h1>
          {hasStaff && (
            <span className="rounded-full bg-accent/10 px-2.5 py-1 text-xs font-semibold text-accent">
              <bdi>{staff.length}</bdi>
            </span>
          )}
          <Button size="sm" variant="outline" onClick={() => navigate("/staff/new")} className="gap-1.5">
            <Plus className="h-4 w-4" />
            {t("staffAdd")}
          </Button>
        </header>

        <div className="flex flex-col gap-3.5 px-5">
          {staffLoading ? (
            <>
              <div className="h-[72px] rounded-2xl bg-secondary animate-pulse" />
              <div className="h-24 rounded-2xl bg-secondary animate-pulse" />
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-[76px] rounded-2xl bg-secondary animate-pulse" />
              ))}
            </>
          ) : !hasStaff ? (
            <StaffEmptyState onAdd={() => navigate("/staff/new")} />
          ) : (
            <>
              <StaffModeBanner activeCount={activeStaff.length} staffLoading={staffLoading} />
              <TodayStrip
                today={today}
                shopToday={shopToday}
                working={counts.working}
                off={counts.off}
                inactive={staff.length - activeStaff.length}
              />
              <StaffRoster members={rows} dates={dates} onOpen={(id) => navigate(`/staff/${id}`)} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
