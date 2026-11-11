/**
 * The provider category that runs on courses instead of per-service bookings.
 * Every academy gate in the UI goes through this one string, the way the
 * fitness-studio gates all compare against "fitness_studio".
 */
export const ACADEMY_CATEGORY = "academy";

export function isAcademyCategory(category: string | null | undefined): boolean {
  return category === ACADEMY_CATEGORY;
}
