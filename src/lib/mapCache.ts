const STORAGE_KEY = "ehjezly:map:lastView:v1";

export interface MapView {
  center: [number, number];
  zoom: number;
}

/**
 * Persists the current map view to sessionStorage.
 * Silently ignores storage errors (private browsing, quota exceeded, etc.).
 */
export function saveMapView(center: [number, number], zoom: number): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ center, zoom }));
  } catch {
    // Unavailable or full — best-effort, non-fatal
  }
}

/**
 * Reads the last persisted map view from sessionStorage.
 * Returns null if nothing is cached, the data is malformed, or values are out of range.
 * Never throws.
 */
export function loadMapView(): MapView | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as unknown;

    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !Array.isArray((parsed as MapView).center) ||
      (parsed as MapView).center.length !== 2 ||
      typeof (parsed as MapView).center[0] !== "number" ||
      typeof (parsed as MapView).center[1] !== "number" ||
      typeof (parsed as MapView).zoom !== "number"
    ) {
      return null;
    }

    const { center, zoom } = parsed as MapView;
    const [lat, lng] = center;

    if (lat < -90 || lat > 90)   return null;
    if (lng < -180 || lng > 180) return null;
    if (zoom < 0 || zoom > 22)   return null;

    return { center, zoom };
  } catch {
    return null;
  }
}
