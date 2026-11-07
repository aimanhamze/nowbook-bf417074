import { isAcademyCategory } from "@/lib/academyCategory";

/** Provider dashboard tabs, in display order. */
export const DASHBOARD_TAB_IDS = ["profile", "booking", "availability", "services", "courses", "gallery", "packages"] as const;
export type DashboardTabId = (typeof DASHBOARD_TAB_IDS)[number];

/**
 * Which dashboard tabs a provider of this category sees.
 *
 *  - fitness_studio: no "services" (classes live in provider_class_schedule and
 *    are edited from /calendar); "packages" only for them. "availability" stays,
 *    for its blocked-dates card.
 *  - academy: runs on courses, so "services", "availability" and "packages" are
 *    replaced by "courses".
 *  - everyone else: neither "packages" nor "courses".
 */
export function visibleDashboardTabs(category: string | null | undefined): DashboardTabId[] {
  const isFitnessStudio = category === "fitness_studio";
  const isAcademy = isAcademyCategory(category);
  return DASHBOARD_TAB_IDS.filter((id) => {
    if (id === "courses") return isAcademy;
    if (isAcademy) return id !== "services" && id !== "availability" && id !== "packages";
    if (id === "packages") return isFitnessStudio;
    if (id === "services") return !isFitnessStudio;
    return true;
  });
}
