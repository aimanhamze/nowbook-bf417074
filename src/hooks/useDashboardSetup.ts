import { format } from "date-fns";
import { useProviderProfile } from "@/hooks/useProviderProfile";
import { useProviderServices } from "@/hooks/useProviderServices";
import { useProviderAvailability } from "@/hooks/useProviderAvailability";
import { useProviderPhotos } from "@/hooks/useProviderPhotos";
import { useProviderClassSchedule } from "@/hooks/useProviderClassSchedule";
import { usePackageTemplates } from "@/hooks/usePackageTemplates";
import { useAcademyCourses } from "@/hooks/useAcademyCourses";
import { useAcademyInstructors } from "@/hooks/useAcademyInstructors";
import { useAcademyRegistrations } from "@/hooks/useAcademyRegistrations";
import { isAcademyCategory } from "@/lib/academyCategory";
import {
  getSetupSteps,
  summarizeWeeklyHours,
  type HoursSummary,
  type SetupStep,
} from "@/lib/dashboardSetup";

/** One hub row's data: still loading, failed (shown as a neutral line, never
 *  the raw error), or loaded with its value. */
export type Fact<T> = { state: "loading" } | { state: "error" } | { state: "ok"; value: T };

function fact<T>(isLoading: boolean, error: unknown, value: () => T): Fact<T> {
  if (error) return { state: "error" };
  if (isLoading) return { state: "loading" };
  return { state: "ok", value: value() };
}

export type HoursFact =
  | { mode: "weekly"; summary: HoursSummary }
  | { mode: "monthly"; defaultOpen: boolean; start: string; end: string; hasOpenDay: boolean };

export interface DashboardSetup {
  isFitnessStudio: boolean;
  isAcademy: boolean;
  /** Academy only: active courses, active instructors, pending requests. */
  courses: Fact<number>;
  instructors: Fact<number>;
  pendingRegistrations: Fact<number>;
  services: Fact<number>;
  hours: Fact<HoursFact>;
  profile: { hasAvatar: boolean; hasCover: boolean; hasAbout: boolean };
  photos: Fact<number>;
  booking: { requiresApproval: boolean; windowDays: number };
  classes: Fact<number>;
  closedDays: Fact<number>;
  packages: Fact<number>;
  /** Required steps, or null until every input they need has loaded. */
  steps: SetupStep[] | null;
}

/**
 * Everything the setup hub shows, from the dashboard's existing hooks and
 * query keys — no new tables, columns or SQL. Every hook here follows the
 * active branch (they key on useProviderProfile().profile.id), so the hub
 * re-reads when a multi-branch owner switches. Studio-only and
 * non-studio-only queries are gated with the hooks' `enabled` flag so no
 * provider fetches rows the hub will not show. Same for academy: its course,
 * instructor and registration queries run only for an academy branch, which
 * in turn skips services and hours (it has neither).
 */
export function useDashboardSetup(): DashboardSetup | null {
  const { profile } = useProviderProfile();
  const ready = !!profile;
  const isFitnessStudio = profile?.category === "fitness_studio";
  const isAcademy = isAcademyCategory(profile?.category);

  const services = useProviderServices(ready && !isFitnessStudio && !isAcademy);
  const availability = useProviderAvailability(ready && !isAcademy);
  const photos = useProviderPhotos();
  const classes = useProviderClassSchedule(ready && isFitnessStudio);
  const packages = usePackageTemplates(ready && isFitnessStudio);
  const academyCourses = useAcademyCourses(ready && isAcademy);
  const academyInstructors = useAcademyInstructors(ready && isAcademy);
  const academyRegistrations = useAcademyRegistrations({ enabled: ready && isAcademy });

  if (!profile) return null;

  const todayStr = format(new Date(), "yyyy-MM-dd");
  const isMonthly = profile.availability_mode === "monthly";

  const hours: Fact<HoursFact> = isMonthly
    ? fact(availability.dateOverridesLoading, availability.dateOverridesError, () => {
        const defaultOpen = profile.monthly_default_available ?? true;
        const futureOpenOverride = availability.dateOverrides.some(
          (o) => o.is_available && String(o.override_date).slice(0, 10) >= todayStr,
        );
        return {
          mode: "monthly" as const,
          defaultOpen,
          start: String(profile.monthly_default_start ?? "").slice(0, 5),
          end: String(profile.monthly_default_end ?? "").slice(0, 5),
          hasOpenDay: defaultOpen || futureOpenOverride,
        };
      })
    : fact(availability.isLoading, availability.error, () => ({
        mode: "weekly" as const,
        summary: summarizeWeeklyHours(availability.availability),
      }));

  const servicesFact = fact(services.isLoading, services.error, () => services.services.length);
  const classesFact = fact(classes.isLoading, classes.error, () => classes.schedule.length);

  const profileFacts = {
    hasAvatar: !!profile.avatar_image?.trim(),
    hasCover: !!profile.cover_image?.trim(),
    hasAbout: !!profile.about?.trim(),
  };

  // Steps only once their inputs are known, so the progress card never shows
  // a false 25% while the services or hours query is still in flight.
  const coursesFact = fact(academyCourses.isLoading, academyCourses.error, () =>
    academyCourses.courses.filter((c) => c.is_active).length,
  );

  let steps: SetupStep[] | null = null;
  if (isAcademy) {
    if (coursesFact.state === "ok") {
      steps = getSetupSteps({
        isFitnessStudio: false, activeServiceCount: 0, hasOpenDay: false, classCount: 0,
        isAcademy, activeCourseCount: coursesFact.value, ...profileFacts,
      });
    }
  } else if (isFitnessStudio) {
    if (classesFact.state === "ok") {
      steps = getSetupSteps({
        isFitnessStudio, activeServiceCount: 0, hasOpenDay: false,
        classCount: classesFact.value, ...profileFacts,
      });
    }
  } else if (servicesFact.state === "ok" && hours.state === "ok") {
    const hasOpenDay = hours.value.mode === "monthly"
      ? hours.value.hasOpenDay
      : hours.value.summary.kind !== "none";
    steps = getSetupSteps({
      isFitnessStudio, activeServiceCount: servicesFact.value, hasOpenDay,
      classCount: 0, ...profileFacts,
    });
  }

  return {
    isFitnessStudio,
    isAcademy,
    courses: coursesFact,
    instructors: fact(academyInstructors.isLoading, academyInstructors.error, () =>
      academyInstructors.activeInstructors.length,
    ),
    pendingRegistrations: fact(academyRegistrations.isLoading, null, () => academyRegistrations.counts.pending),
    services: servicesFact,
    hours,
    profile: profileFacts,
    photos: fact(photos.isLoading, photos.error, () => photos.photos.length),
    booking: {
      requiresApproval: profile.requires_booking_approval ?? false,
      // Same read and default as BookingSettingsTab.
      windowDays: (profile as { booking_window_days?: number | null }).booking_window_days ?? 14,
    },
    classes: classesFact,
    closedDays: fact(availability.blockedDatesLoading, availability.blockedDatesError, () =>
      availability.blockedDates.filter((d) => String(d.blocked_date).slice(0, 10) >= todayStr).length,
    ),
    packages: fact(packages.isLoading, packages.error, () => packages.templates.filter((p) => p.is_active).length),
    steps,
  };
}
