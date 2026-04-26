/**
 * Extracts up to 2 initials from a business name.
 * Splits on whitespace — works correctly with Hebrew, Arabic, and Latin scripts
 * since all use U+0020 space as word separator.
 *
 * Examples:
 *   "Linor Beauty"     → "LB"
 *   "ספר אמיר"         → "סא"  (Hebrew: charAt(0) of each word, toUpperCase is a no-op for non-Latin)
 *   "صالون الجمال"     → "صا"  (Arabic: same)
 *   "Studio"           → "S"   (single word)
 */
export function getInitials(businessName: string): string {
  const words = businessName.trim().split(/\s+/);
  if (words.length === 1) return words[0].charAt(0).toUpperCase();
  return (words[0].charAt(0) + words[1].charAt(0)).toUpperCase();
}

/**
 * Haversine formula: straight-line distance between two lat/lng points.
 * Returns distance in kilometres.
 */
export function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(a));
}

/**
 * Formats a kilometre value for display.
 *   < 10 km  → one decimal place  ("2.4")
 *   ≥ 10 km  → integer             ("27")
 *
 * Returns the number string only; callers embed it in the {distance} template
 * translation key (e.g. t("kmAway").replace("{distance}", formatDistance(km))).
 */
export function formatDistance(km: number): string {
  if (km < 10) return km.toFixed(1);
  return Math.round(km).toString();
}
